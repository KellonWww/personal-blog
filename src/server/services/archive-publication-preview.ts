import { sha256Hex } from '@/server/auth/crypto';
import { findArchivePublicationPreview } from '@/server/db/archive-publication-preview';
import { ArchiveMutationError } from '@/server/services/archive-mutation-model';
import { inspectPublicationReferences, PUBLICATION_REVIEW_POLICY } from '@/server/services/archive-publication-references';
import { publicationConfig, PUBLICATION_TOKEN_SECONDS, signPublicationToken } from '@/server/services/archive-publication-token';
import type { ArchivePublicationPreview, ArchivePublicationSnapshot } from '@/types/archive';

export async function readPublicationSnapshot(db: D1Database, archiveId: string, publicationId: string) {
  const row = await findArchivePublicationPreview(db, archiveId, publicationId);
  if (!row) { return null; }
  if (row.snapshotLength > 200000 || row.snapshotJson.length > 200000 || row.contentLength > 100000) {
    throw new ArchiveMutationError('PREVIEW_TOO_LARGE', '正文或审阅字段超出完整审阅上限，请精简博客草稿', 422);
  }
  if (row.contentHasNull > 0) { throw new ArchiveMutationError('PREVIEW_INVALID_TEXT', '正文含空字节，请清理博客草稿', 422); }
  const snapshot: ArchivePublicationSnapshot = JSON.parse(row.snapshotJson);
  if (snapshot.content.length > 100000 || snapshot.categories.length > 200 || snapshot.tags.length > 200) {
    throw new ArchiveMutationError('PREVIEW_TOO_LARGE', '正文超过 100000 字符或分类/标签超过 200 项，无法完整审阅', 422);
  }
  const { references, blockers } = inspectPublicationReferences(snapshot);
  if (snapshot.status !== 'draft') { blockers.push('关联稿已发布；再次修改须先撤回为草稿并重新审阅'); }
  if (row.conflictState !== 'none') { blockers.push('档案存在未解决来源冲突，请先处理后重新审阅'); }
  return { snapshot, snapshotJson: row.snapshotJson, snapshotHash: await sha256Hex(row.snapshotJson),
    references, referencesHash: await sha256Hex(JSON.stringify(references)), blockers };
}

export async function getArchivePublicationPreview(db: D1Database, archiveId: string, publicationId: string,
  context: { env: Env; operator: string }): Promise<ArchivePublicationPreview | null> {
  const review = await readPublicationSnapshot(db, archiveId, publicationId);
  if (!review) { return null; }
  const result: ArchivePublicationPreview = { snapshot: review.snapshot, snapshotHash: review.snapshotHash,
    policyVersion: PUBLICATION_REVIEW_POLICY, references: review.references, blockers: [...review.blockers],
    publishingEnabled: false, previewToken: null, expiresAt: null };
  let config: ReturnType<typeof publicationConfig>;
  try { config = publicationConfig(context.env); }
  catch (error) {
    if (!(error instanceof ArchiveMutationError)) { throw error; }
    result.blockers.push(error.message);
    return result;
  }
  if (result.blockers.length) { return result; }
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + PUBLICATION_TOKEN_SECONDS;
  result.previewToken = await signPublicationToken({ publicationId, archiveId, operator: context.operator,
    postVersion: review.snapshot.postVersion, snapshotHash: review.snapshotHash, referencesHash: review.referencesHash,
    policyVersion: PUBLICATION_REVIEW_POLICY, origin: config.origin, issuedAt, expiresAt }, config.secret);
  result.expiresAt = new Date(expiresAt * 1000).toISOString();
  result.publishingEnabled = true;
  return result;
}
