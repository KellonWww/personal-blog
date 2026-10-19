import { sha256Hex } from '@/server/auth/crypto';
import { findPublicationConfirmation, publicationConfirmationStatement, type ConfirmationRow } from '@/server/db/archive-publication-confirmations';
import { DatabaseError } from '@/server/db/client';
import { ArchiveMutationError } from '@/server/services/archive-mutation-model';
import type { ArchiveConfirmInput } from '@/server/services/archive-publication-model';
import { readPublicationSnapshot } from '@/server/services/archive-publication-preview';
import { PUBLICATION_REVIEW_POLICY } from '@/server/services/archive-publication-references';
import { publicationConfig, verifyPublicationToken } from '@/server/services/archive-publication-token';
import type { ArchivePublicationConfirmation } from '@/types/archive';

function result(row: ConfirmationRow, requestHash: string, replayed: boolean): ArchivePublicationConfirmation {
  if (row.requestHash !== requestHash) { throw new ArchiveMutationError('IDEMPOTENCY_CONFLICT', '操作 ID 已用于不同确认请求'); }
  return { confirmationId: row.confirmationId, publicationId: row.publicationId, postId: row.postId,
    confirmedPostVersion: row.confirmedPostVersion, confirmedAt: row.confirmedAt,
    postStatus: row.postStatus, postDeleted: Boolean(row.postDeleted), replayed };
}

export async function confirmArchivePublication(db: D1Database, archiveId: string, publicationId: string,
  context: { input: ArchiveConfirmInput; env: Env; operator: string }) {
  const { input, env, operator } = context;
  const operationId = 'confirm_' + await sha256Hex(JSON.stringify([archiveId, publicationId, input.operationId]));
  const requestHash = await sha256Hex(JSON.stringify({ archiveId, publicationId, input, operator }));
  // Historical success precedes expiry/config checks; this path has no write and never resurrects a post.
  const existing = await findPublicationConfirmation(db, archiveId, operationId);
  if (existing) { return result(existing, requestHash, true); }
  const config = publicationConfig(env);
  const claims = await verifyPublicationToken(input.previewToken, config.secret);
  if (claims.archiveId !== archiveId || claims.publicationId !== publicationId || claims.operator !== operator ||
      claims.origin !== config.origin || claims.policyVersion !== PUBLICATION_REVIEW_POLICY) {
    throw new ArchiveMutationError('PREVIEW_INVALID', '预览身份、站点或规则已变化，请重新审阅', 422);
  }
  const review = await readPublicationSnapshot(db, archiveId, publicationId);
  if (!review) { throw new ArchiveMutationError('NOT_FOUND', '关联稿不存在或已不可访问', 404); }
  if (review.blockers.length) { throw new ArchiveMutationError('PUBLICATION_BLOCKED', '存在阻断项，请重新读取审阅清单', 422); }
  if (review.snapshot.postVersion !== claims.postVersion || review.snapshotHash !== claims.snapshotHash || review.referencesHash !== claims.referencesHash) {
    throw new ArchiveMutationError('PREVIEW_STALE', '草稿、作者或分类标签已变化，请重新审阅');
  }
  try {
    await db.batch([publicationConfirmationStatement(db, { id: operationId, publicationId,
      postId: review.snapshot.postId, operationId, requestHash, postVersion: claims.postVersion,
      snapshotJson: review.snapshotJson, snapshotHash: review.snapshotHash, referencesJson: JSON.stringify(review.references),
      referencesHash: review.referencesHash, policyVersion: PUBLICATION_REVIEW_POLICY, origin: config.origin,
      expiresAt: claims.expiresAt, operator })]);
  } catch (error) {
    const committed = await findPublicationConfirmation(db, archiveId, operationId);
    if (committed) { return result(committed, requestHash, true); }
    if (error instanceof Error && /ARCHIVE_PUBLICATION_STALE|ARCHIVE_PUBLICATION_CONFIRM_REQUIRED|UNIQUE constraint failed/.test(error.message)) {
      throw new ArchiveMutationError('PREVIEW_STALE', '确认时状态已变化，请重新读取；原请求未提交');
    }
    // Never expose driver errors that can contain bound private Markdown or signed tokens.
    throw new DatabaseError('发布结果不明，请保留原操作 ID 和预览令牌重试');
  }
  const committed = await findPublicationConfirmation(db, archiveId, operationId);
  if (!committed) { throw new DatabaseError('确认记录暂时不可读，请保留原请求重试'); }
  return result(committed, requestHash, false);
}
