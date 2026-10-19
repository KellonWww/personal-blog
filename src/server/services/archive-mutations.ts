import { sha256Hex } from '@/server/auth/crypto';
import { findArchiveRow, findArchiveVersion, type ArchiveRow, type ArchiveVersionRow } from '@/server/db/archives';
import { archiveMutationStatements, findArchiveMutation, type ArchiveMutationPlan, type ArchiveMutationRow } from '@/server/db/archive-mutations';
import { DatabaseError } from '@/server/db/client';
import { ARCHIVE_MAX_TEXT_LENGTH, archiveMetadataSchema } from '@/server/services/archive-import-model';
import { ArchiveMutationError, type ArchiveMutation, type ArchiveMutationInput, type ArchiveMutationKind } from '@/server/services/archive-mutation-model';
import { archiveTaxonomyIds } from '@/server/services/archive-taxonomy';
import { prepareArchiveText } from '@/server/services/archive-text';
import type { ArchiveMetadata } from '@/types/archive';

function mutationResult(row: ArchiveMutationRow, requestHash: string, replayed: boolean) {
  if (row.requestHash !== requestHash) {
    throw new ArchiveMutationError('IDEMPOTENCY_CONFLICT', '同一操作 ID 已用于其他请求，请为新操作更换 ID');
  }
  return { archiveId: row.archiveId, versionId: row.versionId, sequence: row.sequence, kind: row.kind, replayed };
}

async function requireVersion(db: D1Database, archiveId: string, versionId: string) {
  const version = await findArchiveVersion(db, archiveId, versionId);
  if (!version) { throw new ArchiveMutationError('NOT_FOUND', '目标版本不属于该档案或已不可访问', 404); }
  return version;
}

function snapshot(version: ArchiveVersionRow) {
  const metadata = archiveMetadataSchema.parse(JSON.parse(version.metadataJson));
  return { title: version.title, content: version.content, metadata };
}

async function selectMutationText(db: D1Database, head: ArchiveRow, input: ArchiveMutationInput) {
  if ('mode' in input) {
    if (head.conflictState !== 'pending' || head.latestSourceVersionId !== input.expectedSource) {
      throw new ArchiveMutationError('ARCHIVE_SOURCE_CONFLICT', '来源候选已变化或冲突已解决，请刷新后重试');
    }
    if (input.mode === 'merge') { return { title: input.title, content: input.content, metadata: input.metadata }; }
    const versionId = input.mode === 'keep-local' ? input.expectedHead : input.expectedSource;
    return snapshot(await requireVersion(db, head.id, versionId));
  }
  if ('targetVersionId' in input) { return snapshot(await requireVersion(db, head.id, input.targetVersionId)); }
  return { title: input.title, content: input.content, metadata: input.metadata };
}

async function prepareMutationText(input: { title: string; content: string; metadata: ArchiveMetadata }) {
  const text = await prepareArchiveText({ title: input.title, rawContent: input.content, metadata: input.metadata });
  if (!text.title || text.title.length > 200 || text.content.length > ARCHIVE_MAX_TEXT_LENGTH ||
      !archiveMetadataSchema.safeParse(text.metadata).success) {
    throw new ArchiveMutationError('TEXT_TOO_LARGE', '规范化文本或分类标签超过上限', 422);
  }
  return text;
}

function changeReason(input: ArchiveMutationInput, kind: ArchiveMutationKind) {
  if (input.reason) { return input.reason; }
  if ('mode' in input) {
    return { 'keep-local': '保留本地并接受最新来源基线', 'accept-source': '接受最新来源', merge: '手工合并最新来源' }[input.mode];
  }
  return kind === 'restore' ? '恢复历史快照' : '编辑档案';
}

async function commitMutation(db: D1Database, plan: ArchiveMutationPlan) {
  try {
    await db.batch(archiveMutationStatements(db, plan));
  } catch (error) {
    // A response may be lost after commit; recover by the same operation ID without appending history twice.
    const committed = await findArchiveMutation(db, plan.head.id, plan.operationId);
    if (committed) { return mutationResult(committed, plan.requestHash, true); }
    const message = error instanceof Error ? error.message : '';
    if (/ARCHIVE_HEAD_CONFLICT|ARCHIVE_SOURCE_CONFLICT|ARCHIVE_SOURCE_UNAVAILABLE|UNIQUE constraint failed/.test(message)) {
      throw new ArchiveMutationError('ARCHIVE_HEAD_CONFLICT', '档案或来源已变化，请刷新后重试');
    }
    throw new DatabaseError('档案变更事务失败，请保留原操作 ID 重试');
  }
  const committed = await findArchiveMutation(db, plan.head.id, plan.operationId);
  if (!committed) { throw new DatabaseError('档案变更结果暂时不可读，请保留原操作 ID 重试'); }
  return mutationResult(committed, plan.requestHash, false);
}

export async function mutateArchive(db: D1Database, archiveId: string, mutation: ArchiveMutation) {
  const { kind, input, operator } = mutation;
  const operationHash = await sha256Hex(JSON.stringify([archiveId, input.operationId]));
  const operationId = 'mut_' + operationHash;
  const requestHash = await sha256Hex(JSON.stringify({ kind, input, operator }));
  const existing = await findArchiveMutation(db, archiveId, operationId);
  if (existing) { return mutationResult(existing, requestHash, true); }
  const head = await findArchiveRow(db, archiveId);
  if (!head) { throw new ArchiveMutationError('NOT_FOUND', '档案不存在或已不可访问', 404); }
  if (head.version !== input.expectedVersion || head.currentVersionId !== input.expectedHead) {
    throw new ArchiveMutationError('ARCHIVE_HEAD_CONFLICT', '档案已变化，请刷新后重试');
  }
  const text = await prepareMutationText(await selectMutationText(db, head, input));
  return commitMutation(db, {
    head, input, kind, operationId, versionId: 'ver_' + operationHash, requestHash, text,
    reason: changeReason(input, kind), operator, taxonomy: await archiveTaxonomyIds(text.metadata),
    restoredFrom: 'targetVersionId' in input ? input.targetVersionId : null,
    basedOnSource: 'mode' in input ? input.expectedSource : head.acceptedSourceVersionId
  });
}
