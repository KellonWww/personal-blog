import type { ArchiveTaxonomyTerm } from '@/server/services/archive-taxonomy';

/** ⚠️ 需牢大审核后人工执行：仅生成应用事务语句，AI 不调用写入接口。 */
export function archiveTaxonomyStatements(db: D1Database, projection: {
  archiveId: string; terms: ArchiveTaxonomyTerm[]; operator: string;
}) {
  const { archiveId, terms, operator } = projection;
  const statements = [db.prepare('DELETE FROM archive_taxonomy_links WHERE archive_id = ?').bind(archiveId)];
  for (const term of terms) {
    statements.push(db.prepare('INSERT INTO archive_taxonomy (id, kind, name, normalized_name, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?) ' +
      "ON CONFLICT(kind, normalized_name) DO UPDATE SET deleted_at = NULL, updated_at = datetime('now'), updated_by = excluded.updated_by")
      .bind(term.id, term.kind, term.name, term.name, operator, operator));
    statements.push(db.prepare('INSERT INTO archive_taxonomy_links (archive_id, taxonomy_id, created_by) ' +
      'SELECT ?, id, ? FROM archive_taxonomy WHERE kind = ? AND normalized_name = ? AND deleted_at IS NULL')
      .bind(archiveId, operator, term.kind, term.name));
  }
  return statements;
}
