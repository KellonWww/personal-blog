import { countWords } from '@/lib/format';
import { sha256Hex } from '@/server/auth/crypto';
import { findArchiveRow, findArchiveVersion } from '@/server/db/archives';
import { archiveDraftStatements, findArchivePublicationOperation, listArchivePublicationRows,
  type ArchiveDraftPlan, type ArchivePublicationRow } from '@/server/db/archive-publications';
import { DatabaseError } from '@/server/db/client';
import { ArchiveMutationError } from '@/server/services/archive-mutation-model';
import type { ArchiveDraftInput } from '@/server/services/archive-publication-model';
import type { ArchivePagination } from '@/server/services/archive-query';
import type { ArchivePublication } from '@/types/archive';

function publicationDto(row: ArchivePublicationRow): ArchivePublication {
  return { id: row.id, archiveId: row.archiveId, versionId: row.versionId, postId: row.postId,
    postStatus: row.postStatus, postDeleted: Boolean(row.postDeleted), createdAt: row.createdAt };
}
function draftResult(row: ArchivePublicationRow, requestHash: string, replayed: boolean) {
  if (row.requestHash !== requestHash) {
    throw new ArchiveMutationError('IDEMPOTENCY_CONFLICT', '操作 ID 已用于其他转稿请求，请更换 ID');
  }
  return { publication: publicationDto(row), replayed };
}

async function commitDraft(db: D1Database, plan: ArchiveDraftPlan) {
  try {
    await db.batch(archiveDraftStatements(db, plan));
  } catch (error) {
    const committed = await findArchivePublicationOperation(db, plan.operationId);
    if (committed) { return draftResult(committed, plan.requestHash, true); }
    const message = error instanceof Error ? error.message : '';
    if (/ARCHIVE_DRAFT_HEAD_CONFLICT/.test(message)) {
      throw new ArchiveMutationError('ARCHIVE_HEAD_CONFLICT', '工作快照、来源或冲突状态已变化，请重新读取');
    }
    if (/ARCHIVE_DRAFT_INVALID|UNIQUE constraint failed/.test(message)) {
      throw new ArchiveMutationError('ARCHIVE_DRAFT_CONFLICT', '转稿绑定冲突，请重新读取并核对已有草稿');
    }
    // Do not expose driver messages containing bound private Markdown.
    throw new DatabaseError('转稿结果不明，请保留原操作 ID 重试');
  }
  const committed = await findArchivePublicationOperation(db, plan.operationId);
  if (!committed) { throw new DatabaseError('转稿结果暂时不可读，请保留原操作 ID 重试'); }
  return draftResult(committed, plan.requestHash, false);
}

export async function createArchiveDraft(db: D1Database, archiveId: string, input: ArchiveDraftInput, operator: string) {
  const head = await findArchiveRow(db, archiveId);
  if (!head) { throw new ArchiveMutationError('NOT_FOUND', '档案不存在或已不可访问', 404); }
  const hash = await sha256Hex(JSON.stringify([archiveId, input.operationId]));
  const operationId = 'draft_' + hash;
  const requestHash = await sha256Hex(JSON.stringify({ archiveId, input, operator }));
  const existing = await findArchivePublicationOperation(db, operationId);
  if (existing) { return draftResult(existing, requestHash, true); }
  if (head.version !== input.expectedVersion || head.currentVersionId !== input.expectedHead) {
    throw new ArchiveMutationError('ARCHIVE_HEAD_CONFLICT', '工作快照已变化，请重新读取');
  }
  if (head.conflictState !== 'none') {
    throw new ArchiveMutationError('ARCHIVE_SOURCE_CONFLICT', '请先解决来源冲突，再主动转稿');
  }
  const version = await findArchiveVersion(db, archiveId, input.expectedHead);
  if (!version) { throw new ArchiveMutationError('NOT_FOUND', '工作快照已不可访问', 404); }
  return commitDraft(db, { archiveId, expectedVersion: input.expectedVersion, versionId: input.expectedHead,
    publicationId: 'pub_' + hash, postId: 'post_' + hash, operationId, requestHash,
    title: version.title, content: version.content, wordCount: countWords(version.content),
    slug: 'draft-' + hash.slice(0, 32), operator });
}

export async function getArchivePublications(db: D1Database, archiveId: string, page: ArchivePagination) {
  if (!await findArchiveRow(db, archiveId)) { return null; }
  const rows = await listArchivePublicationRows(db, archiveId, page);
  return { items: rows.map(publicationDto), page: page.page, pageSize: page.pageSize };
}
