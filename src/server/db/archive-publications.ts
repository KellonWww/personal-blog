import { queryAll, queryOne } from '@/server/db/client';
import type { ArchivePublication } from '@/types/archive';
import type { ArchivePagination } from '@/server/services/archive-query';

export interface ArchivePublicationRow extends ArchivePublication { requestHash: string }
const PUBLICATION_COLUMNS = 'p.id, p.archive_id AS archiveId, p.version_id AS versionId, p.post_id AS postId, ' +
  'p.request_hash AS requestHash, p.created_at AS createdAt, b.status AS postStatus, ' +
  'CASE WHEN b.deleted_at IS NULL THEN 0 ELSE 1 END AS postDeleted';

export function findArchivePublicationOperation(db: D1Database, operationId: string) {
  // Keep tombstones visible to idempotent replay; never recreate a deleted blog draft.
  return queryOne<ArchivePublicationRow>(db, 'SELECT ' + PUBLICATION_COLUMNS +
    ' FROM archive_publications p JOIN posts b ON b.id = p.post_id WHERE p.operation_id = ?', [operationId]);
}

export function listArchivePublicationRows(db: D1Database, archiveId: string, page: ArchivePagination) {
  return queryAll<ArchivePublicationRow>(db, 'SELECT ' + PUBLICATION_COLUMNS +
    ' FROM archive_publications p JOIN posts b ON b.id = p.post_id WHERE p.archive_id = ? ' +
    'ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?', [archiveId, page.pageSize, (page.page - 1) * page.pageSize]);
}

export interface ArchiveDraftPlan {
  archiveId: string; expectedVersion: number; versionId: string;
  publicationId: string; postId: string; operationId: string; requestHash: string;
  title: string; content: string; wordCount: number; slug: string; operator: string;
}

/** ⚠️ 需牢大审核后人工执行：只生成事务语句，AI 不执行写操作。 */
export function archiveDraftStatements(db: D1Database, plan: ArchiveDraftPlan) {
  // 0006 validates the source, exact head/event sequence and draft snapshot in this same batch.
  // A failed association must roll back the post; no taxonomy/source metadata is copied.
  const post = db.prepare('INSERT INTO posts ' +
    '(id, title, slug, summary, content, cover_image, status, author_id, word_count, created_by, updated_by) ' +
    "VALUES (?, ?, ?, '', ?, '', 'draft', ?, ?, ?, ?)")
    .bind(plan.postId, plan.title, plan.slug, plan.content, plan.operator, plan.wordCount, plan.operator, plan.operator);
  const publication = db.prepare('INSERT INTO archive_publications ' +
    '(id, archive_id, version_id, post_id, operation_id, request_hash, archive_sequence, created_by, updated_by) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(plan.publicationId, plan.archiveId, plan.versionId, plan.postId, plan.operationId,
      plan.requestHash, plan.expectedVersion, plan.operator, plan.operator);
  return [post, publication];
}
