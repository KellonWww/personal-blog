import { queryOne } from '@/server/db/client';
import type { ArchivePublicationConfirmation } from '@/types/archive';

export interface ConfirmationRow extends Omit<ArchivePublicationConfirmation, 'replayed' | 'postDeleted'> {
  requestHash: string;
  postDeleted: number;
}
export function findPublicationConfirmation(db: D1Database, archiveId: string, operationId: string) {
  // Retain soft-deleted posts and withdrawn publication results for replay; never republish here.
  return queryOne<ConfirmationRow>(db,
    'SELECT c.id AS confirmationId, c.publication_id AS publicationId, c.post_id AS postId, ' +
    'c.expected_post_version + 1 AS confirmedPostVersion, c.created_at AS confirmedAt, c.request_hash AS requestHash, ' +
    'b.status AS postStatus, CASE WHEN b.deleted_at IS NULL THEN 0 ELSE 1 END AS postDeleted ' +
    'FROM archive_publication_confirmations c JOIN archive_publications p ON p.id = c.publication_id ' +
    'JOIN posts b ON b.id = c.post_id JOIN archives a ON a.id = p.archive_id ' +
    'JOIN archive_sources s ON s.id = a.source_id ' +
    'WHERE p.archive_id = ? AND c.operation_id = ? AND a.deleted_at IS NULL AND s.deleted_at IS NULL LIMIT 1', [archiveId, operationId]);
}
export interface ConfirmationPlan {
  id: string; publicationId: string; postId: string; operationId: string; requestHash: string;
  postVersion: number; snapshotJson: string; snapshotHash: string; referencesJson: string;
  referencesHash: string; policyVersion: string; origin: string; expiresAt: number; operator: string;
}
/** ⚠️ 需牢大审核后人工执行：只构建语句；0007 触发器在同一 INSERT 内 CAS、发布和同步绑定。 */
export function publicationConfirmationStatement(db: D1Database, plan: ConfirmationPlan) {
  return db.prepare('INSERT INTO archive_publication_confirmations ' +
    '(id, publication_id, post_id, operation_id, request_hash, expected_post_version, snapshot_json, snapshot_hash, ' +
    'references_snapshot_json, references_hash, policy_version, site_origin, expires_at, created_by, updated_by) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(plan.id, plan.publicationId, plan.postId, plan.operationId, plan.requestHash, plan.postVersion,
      plan.snapshotJson, plan.snapshotHash, plan.referencesJson, plan.referencesHash, plan.policyVersion,
      plan.origin, plan.expiresAt, plan.operator, plan.operator);
}
