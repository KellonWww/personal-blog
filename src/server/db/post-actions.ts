import { placeholders, queryAll, queryOne } from '@/server/db/client';
import type { PostStatus } from '@/types/domain';
import type { PostBatchInput } from '@/types/post-actions';

export interface PostSnapshot { id: string; version: number; status: PostStatus }
export interface PostArchiveSnapshot extends PostSnapshot { title: string; content: string; slug: string }
export interface PostLabel { postId: string; name: string }

export function findPostSnapshots(db: D1Database, ids: string[]) {
  return queryAll<PostSnapshot>(db, 'SELECT id, version, status FROM posts WHERE deleted_at IS NULL AND id IN (' + placeholders(ids.length) + ')', ids);
}
export function findPostArchiveSnapshots(db: D1Database, ids: string[]) {
  return queryAll<PostArchiveSnapshot>(db, 'SELECT id, version, status, title, content, slug FROM posts WHERE deleted_at IS NULL AND id IN (' + placeholders(ids.length) + ')', ids);
}
export function findPostLabels(db: D1Database, ids: string[], kind: 'categories' | 'tags') {
  const table = kind === 'categories' ? 'post_categories' : 'post_tags';
  const column = kind === 'categories' ? 'category_id' : 'tag_id';
  return queryAll<PostLabel>(db, 'SELECT l.post_id AS postId, t.name FROM ' + table + ' l JOIN ' + kind + ' t ON t.id = l.' + column +
    ' WHERE t.deleted_at IS NULL AND l.post_id IN (' + placeholders(ids.length) + ') ORDER BY t.id', ids);
}
export async function hasArchivePublicationTable(db: D1Database) {
  const table = await queryOne<{ name: string }>(db, "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'archive_publications'");
  return Boolean(table);
}
export function findLinkedPosts(db: D1Database, ids: string[]) {
  // Tombstones never remove a private publication binding.
  return queryAll<{ postId: string }>(db, 'SELECT post_id AS postId FROM archive_publications WHERE post_id IN (' + placeholders(ids.length) + ')', ids);
}
export function findTaxonomyIds(db: D1Database, ids: string[], kind: 'categories' | 'tags') {
  if (!ids.length) return Promise.resolve([]);
  return queryAll<{ id: string }>(db, 'SELECT id FROM ' + kind + ' WHERE deleted_at IS NULL AND id IN (' + placeholders(ids.length) + ')', ids);
}

/** Read-only assertion inside the same D1 transaction; invalid JSON aborts before any writes. */
export function postSnapshotGuard(db: D1Database, posts: PostSnapshot[]) {
  const snapshot = JSON.stringify(posts.map(({ id, version }) => ({ id, version })));
  return db.prepare("SELECT CASE WHEN count(*) = json_array_length(?) THEN 1 ELSE json('POST_SNAPSHOT_CONFLICT') END AS valid " +
    "FROM json_each(?) wanted JOIN posts p ON p.id = json_extract(wanted.value, '$.id') " +
    "AND p.version = json_extract(wanted.value, '$.version') AND p.deleted_at IS NULL").bind(snapshot, snapshot);
}

/** ⚠️ 需牢大审核后人工执行：仅生成应用运行时事务语句，AI 不执行。 */
export function postBatchStatements(db: D1Database, input: PostBatchInput, operator: string, archiveSupport: boolean) {
  const ids = JSON.stringify(input.ids);
  const where = ' WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))';
  const audit = "updated_at = datetime('now'), updated_by = ?, version = version + 1";
  if (input.action === 'publish') {
    // Independent of UI checks: never send archive-linked posts through ordinary publication.
    const guards = archiveSupport ? [db.prepare("SELECT CASE WHEN count(*) = 0 THEN 1 ELSE json('ARCHIVE_PUBLICATION_CONFIRM_REQUIRED') END AS valid " +
      'FROM archive_publications WHERE post_id IN (SELECT value FROM json_each(?))').bind(ids)] : [];
    const publicationFilter = archiveSupport ? ' AND NOT EXISTS (SELECT 1 FROM archive_publications a WHERE a.post_id = posts.id)' : '';
    return [...guards, db.prepare("UPDATE posts SET status = 'published', published_at = COALESCE(published_at, datetime('now')), " + audit + where +
      " AND status = 'draft'" + publicationFilter).bind(operator, ids)];
  }
  if (input.action === 'draft' || input.action === 'delete') {
    const deletion = input.action === 'delete' ? "deleted_at = datetime('now'), " : '';
    const statusFilter = input.action === 'draft' ? " AND status = 'published'" : '';
    // Deletion also withdraws the post, including protected archive publications.
    return [db.prepare("UPDATE posts SET status = 'draft', published_at = NULL, " + deletion + audit + where + statusFilter).bind(operator, ids)];
  }
  const categories = input.action === 'categories';
  const table = categories ? 'post_categories' : 'post_tags';
  const column = categories ? 'category_id' : 'tag_id';
  return [
    db.prepare("SELECT CASE WHEN count(*) = json_array_length(?) THEN 1 ELSE json('TAXONOMY_CHANGED') END AS valid FROM " +
      (categories ? 'categories' : 'tags') + ' WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(input.taxonomyIds ?? []), JSON.stringify(input.taxonomyIds ?? [])),
    db.prepare('UPDATE posts SET ' + audit + where).bind(operator, ids),
    db.prepare('DELETE FROM ' + table + ' WHERE post_id IN (SELECT value FROM json_each(?))').bind(ids),
    db.prepare('INSERT INTO ' + table + ' (post_id, ' + column + ', created_by) ' +
      'SELECT p.value, t.value, ? FROM json_each(?) p CROSS JOIN json_each(?) t')
      .bind(operator, ids, JSON.stringify(input.taxonomyIds ?? []))
  ];
}
