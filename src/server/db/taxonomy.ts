import { queryAll, queryOne } from '@/server/db/client';
import type { TaxonomyInput, TaxonomyKind, TaxonomyTerm } from '@/types/taxonomy';

// SQL identifiers are selected only from this closed map, never from request strings.
const TABLES = {
  categories: { table: 'categories', links: 'post_categories', column: 'category_id' },
  tags: { table: 'tags', links: 'post_tags', column: 'tag_id' }
} as const;

export async function listManagedTaxonomy(db: D1Database, kind: TaxonomyKind): Promise<TaxonomyTerm[]> {
  const { table, links, column } = TABLES[kind];
  return queryAll<TaxonomyTerm>(db, `SELECT t.id, t.name, t.slug, t.version,
    ${kind === 'categories' ? 't.description, t.sort_order AS sortOrder, t.parent_id AS parentId' : "'' AS description, 0 AS sortOrder, '' AS parentId"},
    COUNT(p.id) AS postCount FROM ${table} t
    LEFT JOIN ${links} l ON l.${column} = t.id
    LEFT JOIN posts p ON p.id = l.post_id AND p.deleted_at IS NULL
    WHERE t.deleted_at IS NULL GROUP BY t.id
    ORDER BY ${kind === 'categories' ? 't.sort_order ASC, ' : ''}t.name COLLATE NOCASE ASC, t.id ASC`);
}

export async function findManagedTerm(db: D1Database, kind: TaxonomyKind, id: string) {
  return queryOne<{ id: string; version: number }>(db, `SELECT id, version FROM ${TABLES[kind].table} WHERE id = ? AND deleted_at IS NULL`, [id]);
}
export async function findTaxonomyConflict(db: D1Database, kind: TaxonomyKind, input: TaxonomyInput, id: string) {
  return queryOne<{ id: string }>(db, `SELECT id FROM ${TABLES[kind].table} WHERE deleted_at IS NULL AND id != ?
    AND (lower(trim(name)) = lower(?) OR slug = ?) LIMIT 1`, [id, input.name, input.slug]);
}
export async function hasTaxonomyChildren(db: D1Database, id: string) {
  return !!await queryOne(db, 'SELECT id FROM categories WHERE parent_id = ? AND deleted_at IS NULL LIMIT 1', [id]);
}
export async function taxonomyArchiveSupport(db: D1Database) {
  return !!await queryOne(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'archive_publications'");
}
export async function taxonomyIsProtected(db: D1Database, kind: TaxonomyKind, id: string) {
  const { links, column } = TABLES[kind];
  return !!await queryOne(db, `SELECT p.id FROM posts p JOIN ${links} l ON l.post_id = p.id
    JOIN archive_publications a ON a.post_id = p.id WHERE l.${column} = ? AND p.status = 'published' LIMIT 1`, [id]);
}

export function taxonomyMutationStatements(db: D1Database, options: {
  kind: TaxonomyKind; id: string; operator: string; version?: number; input?: TaxonomyInput; archiveSupport: boolean;
}) {
  const { kind, id, operator, version, input, archiveSupport } = options;
  const { table, links, column } = TABLES[kind];
  const updating = version !== undefined;
  const statements: D1PreparedStatement[] = [];
  // These checks run inside the same D1 transaction as the mutation, closing read/write races.
  if (updating) statements.push(db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM ${table}
    WHERE id = ? AND deleted_at IS NULL AND version = ?) THEN 1 ELSE json('TAXONOMY_STALE') END`).bind(id, version));
  if (updating && archiveSupport) statements.push(db.prepare(`SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM posts p JOIN ${links} l ON l.post_id = p.id JOIN archive_publications a ON a.post_id = p.id
    WHERE l.${column} = ? AND p.status = 'published') THEN 1 ELSE json('ARCHIVE_PUBLICATION_CONFIRM_REQUIRED') END`).bind(id));
  if (input) statements.push(db.prepare(`SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ${table}
    WHERE deleted_at IS NULL AND id != ? AND (lower(trim(name)) = lower(?) OR slug = ?))
    THEN 1 ELSE json('TAXONOMY_CONFLICT') END`).bind(id, input.name, input.slug));
  if (!input && kind === 'categories') statements.push(db.prepare(`SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM categories WHERE parent_id = ? AND deleted_at IS NULL) THEN 1 ELSE json('TAXONOMY_HAS_CHILDREN') END`).bind(id));
  if (updating) statements.push(db.prepare(`UPDATE posts SET updated_at = datetime('now'), updated_by = ?, version = version + 1
    WHERE deleted_at IS NULL AND id IN (SELECT post_id FROM ${links} WHERE ${column} = ?)`).bind(operator, id));
  if (!input) {
    statements.push(db.prepare(`UPDATE ${table} SET deleted_at = datetime('now'), updated_at = datetime('now'),
      updated_by = ?, version = version + 1 WHERE id = ? AND deleted_at IS NULL AND version = ?`).bind(operator, id, version));
    statements.push(db.prepare(`DELETE FROM ${links} WHERE ${column} = ?`).bind(id));
  } else if (updating) {
    statements.push(db.prepare(`UPDATE ${table} SET name = ?, slug = ?,
      ${kind === 'categories' ? 'description = ?, sort_order = ?, ' : ''}
      updated_at = datetime('now'), updated_by = ?, version = version + 1 WHERE id = ? AND deleted_at IS NULL AND version = ?`)
      .bind(input.name, input.slug, ...(kind === 'categories' ? [input.description, input.sortOrder] : []), operator, id, version));
  } else {
    statements.push(db.prepare(`INSERT INTO ${table} (id, name, slug, ${kind === 'categories' ? 'description, sort_order, ' : ''}created_by, updated_by)
      VALUES (?, ?, ?, ${kind === 'categories' ? '?, ?, ' : ''}?, ?)`)
      .bind(id, input.name, input.slug, ...(kind === 'categories' ? [input.description, input.sortOrder] : []), operator, operator));
  }
  return statements;
}
