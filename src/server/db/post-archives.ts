import { queryOne } from '@/server/db/client';
import { finishImportStatement, importWriteStatements, type ImportWritePlan } from '@/server/db/archive-import-writes';
import { importRunStatements } from '@/server/db/archive-imports';
import { postSnapshotGuard, type PostSnapshot } from '@/server/db/post-actions';
import type { ImportRunInput, ImportRunRow } from '@/server/services/archive-import-model';

export function findPostCopySource(db: D1Database, sourceId: string) {
  return queryOne<{ deletedAt: string | null }>(db, 'SELECT deleted_at AS deletedAt FROM archive_sources WHERE id = ?', [sourceId]);
}

/** ⚠️ 需牢大审核后人工执行：应用运行时整批复制，AI 不执行。 */
export function postArchiveStatements(db: D1Database, input: ImportRunInput, run: ImportRunRow, plans: ImportWritePlan[], posts: PostSnapshot[], operator: string) {
  const statements = [postSnapshotGuard(db, posts), ...importRunStatements(db, input, run.sourceId, operator)];
  // Fresh archives only: defer taxonomy projection to two set-based statements for the entire batch.
  for (const plan of plans) statements.push(...importWriteStatements(db, { ...plan, taxonomy: [] }));
  const terms = [...new Map(plans.flatMap((plan) => plan.taxonomy).map((term) => [term.id, term])).values()];
  const links = plans.flatMap((plan) => plan.taxonomy.map((term) => ({ archiveId: plan.archiveId, kind: term.kind, name: term.name })));
  statements.push(db.prepare('INSERT INTO archive_taxonomy (id, kind, name, normalized_name, created_by, updated_by) ' +
    "SELECT json_extract(value, '$.id'), json_extract(value, '$.kind'), json_extract(value, '$.name'), json_extract(value, '$.name'), ?, ? " +
    "FROM json_each(?) WHERE true ON CONFLICT(kind, normalized_name) DO UPDATE SET deleted_at = NULL, updated_at = datetime('now'), updated_by = excluded.updated_by")
    .bind(operator, operator, JSON.stringify(terms)));
  statements.push(db.prepare('INSERT INTO archive_taxonomy_links (archive_id, taxonomy_id, created_by) ' +
    "SELECT json_extract(l.value, '$.archiveId'), t.id, ? FROM json_each(?) l JOIN archive_taxonomy t " +
    "ON t.kind = json_extract(l.value, '$.kind') AND t.normalized_name = json_extract(l.value, '$.name') WHERE t.deleted_at IS NULL")
    .bind(operator, JSON.stringify(links)));
  statements.push(finishImportStatement(db, run, operator));
  return statements;
}
