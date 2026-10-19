import { archiveTaxonomyIds } from '@/server/services/archive-taxonomy';
import { sha256Hex } from '@/server/auth/crypto';
import { DatabaseError } from '@/server/db/client';
import { archiveSourceId, findImportHeads, findImportItem, findImportRun, importCounts, importRunStatements, listImportItems, listImportRuns } from '@/server/db/archive-imports';
import { finishImportStatement, importItemStatement, importWriteStatements } from '@/server/db/archive-import-writes';
import { ArchiveImportError, decideImport, type FailedImportItemInput, type ImportItemInput, type ImportItemRow, type ImportRunInput, type ImportRunRow } from '@/server/services/archive-import-model';
import { prepareArchiveText } from '@/server/services/archive-text';
import type { ArchivePagination } from '@/server/services/archive-query';

function itemResult(item: ImportItemRow) {
  return { id: item.id, docId: item.docId, archiveId: item.archiveId, versionId: item.versionId, action: item.action, errorCode: item.errorCode };
}

function assertSameItem(item: ImportItemRow, requestHash: string) {
  if (item.requestHash !== requestHash) {
    throw new ArchiveImportError('IDEMPOTENCY_CONFLICT', '同一批次和文档 ID 不能提交不同文本；修改资料后请新建批次');
  }
  if (item.action === 'pending') { throw new ArchiveImportError('IMPORT_PENDING', '该文档尚未完成，请重试'); }
  return itemResult(item);
}

async function requireRun(db: D1Database, runId: string): Promise<ImportRunRow> {
  const run = await findImportRun(db, runId);
  if (!run) { throw new ArchiveImportError('NOT_FOUND', '导入批次不存在', 404); }
  return run;
}

function assertRunInput(run: ImportRunRow, input: ImportRunInput, sourceId: string) {
  if (run.sourceId !== sourceId || run.manifestHash !== input.manifestHash || run.expectedItems !== input.expectedItems) {
    throw new ArchiveImportError('IDEMPOTENCY_CONFLICT', '批次 ID 已用于其他来源或清单');
  }
  return run;
}

export async function startArchiveImport(db: D1Database, input: ImportRunInput, operator: string) {
  const sourceId = await archiveSourceId(input.source);
  const existing = await findImportRun(db, input.runId);
  if (existing) { return assertRunInput(existing, input, sourceId); }
  try {
    await db.batch(importRunStatements(db, input, sourceId, operator));
  } catch {
    // A parallel or retried start may already have committed. Never echo SQL/content to logs.
    const committed = await findImportRun(db, input.runId);
    if (committed) { return assertRunInput(committed, input, sourceId); }
    throw new DatabaseError('导入批次创建失败，请检查来源状态后重试');
  }
  return requireRun(db, input.runId);
}

export async function getImportBaseline(db: D1Database, input: { provider: string; namespace: string; docIds: string[] }) {
  const sourceId = await archiveSourceId(input);
  const heads = await findImportHeads(db, sourceId, input.docIds);
  const byDocId = new Map(heads.map((head) => [head.docId, head]));
  return {
    sourceId,
    items: [...new Set(input.docIds)].map((docId) => {
      const head = byDocId.get(docId);
      return { docId, expectedVersion: head?.version ?? 0, expectedHead: head?.currentVersionId ?? null,
        conflictState: head?.conflictState ?? 'none', deleted: Boolean(head?.deletedAt),
        currentHash: head?.currentHash ?? null, acceptedHash: head?.acceptedHash ?? null, latestHash: head?.latestHash ?? null };
    })
  };
}

async function commitItem(db: D1Database, request: {
  runId: string; docId: string; requestHash: string; statements: D1PreparedStatement[];
}) {
  try {
    await db.batch(request.statements);
  } catch (error) {
    const committed = await findImportItem(db, request.runId, request.docId);
    if (committed) { return assertSameItem(committed, request.requestHash); }
    const message = error instanceof Error ? error.message : '';
    if (/ARCHIVE_HEAD_CONFLICT|ARCHIVE_IMPORT_RUN_CLOSED|UNIQUE constraint failed/.test(message)) {
      throw new ArchiveImportError('IMPORT_CONFLICT', '档案版本或批次状态已变化，请重新获取基线后重试');
    }
    throw new DatabaseError('文本导入事务失败，请保留原批次 ID 重试');
  }
  const committed = await findImportItem(db, request.runId, request.docId);
  if (!committed) { throw new DatabaseError('导入结果暂时不可读取，请保留原批次 ID 重试'); }
  return assertSameItem(committed, request.requestHash);
}

export async function importArchiveText(db: D1Database, runId: string, input: ImportItemInput, operator: string) {
  const run = await requireRun(db, runId);
  const { expectedVersion: _version, expectedHead: _head, ...payload } = input;
  const requestHash = await sha256Hex(JSON.stringify(payload));
  const existing = await findImportItem(db, runId, input.docId);
  if (existing) { return assertSameItem(existing, requestHash); }
  if (run.status !== 'running') { throw new ArchiveImportError('IMPORT_CLOSED', '导入批次已结束'); }
  const heads = await findImportHeads(db, run.sourceId, [input.docId]);
  const head = heads[0] ?? null;
  if (head?.deletedAt) {
    // Persist a terminal result so a deleted item cannot leave the whole run permanently running.
    const operationId = 'imp_' + await sha256Hex(JSON.stringify([runId, input.docId]));
    const statement = importItemStatement(db, {
      runId, docId: input.docId, operationId, requestHash, errorCode: 'ARCHIVE_DELETED', operator
    });
    return commitItem(db, { runId, docId: input.docId, requestHash, statements: [statement] });
  }
  if ((head?.version ?? 0) !== input.expectedVersion || (head?.currentVersionId ?? null) !== input.expectedHead) {
    throw new ArchiveImportError('ARCHIVE_HEAD_CONFLICT', '档案已变化，请刷新基线后重试');
  }
  const text = await prepareArchiveText(input);
  if (text.title.length > 200 || text.content.length > 100000) {
    throw new ArchiveImportError('TEXT_TOO_LARGE', '规范化文本超过档案体积上限', 422);
  }
  const operationHash = await sha256Hex(JSON.stringify([runId, input.docId]));
  const archiveId = head?.id ?? 'arc_' + await sha256Hex(JSON.stringify([run.sourceId, input.docId]));
  const statements = importWriteStatements(db, {
    run, input, head, text, archiveId, operationId: 'imp_' + operationHash, versionId: 'ver_' + operationHash,
    requestHash, action: decideImport(head, text.contentHash), taxonomy: await archiveTaxonomyIds(text.metadata), operator
  });
  return commitItem(db, { runId, docId: input.docId, requestHash, statements });
}

export async function recordFailedArchiveImport(db: D1Database, runId: string, input: FailedImportItemInput, operator: string) {
  const run = await requireRun(db, runId);
  const requestHash = await sha256Hex(JSON.stringify(input));
  const existing = await findImportItem(db, runId, input.docId);
  if (existing) { return assertSameItem(existing, requestHash); }
  if (run.status !== 'running') { throw new ArchiveImportError('IMPORT_CLOSED', '导入批次已结束'); }
  const operationId = 'imp_' + await sha256Hex(JSON.stringify([runId, input.docId]));
  const statement = importItemStatement(db, { ...input, runId, requestHash, operationId, operator });
  return commitItem(db, { runId, docId: input.docId, requestHash, statements: [statement] });
}

export async function finishArchiveImport(db: D1Database, runId: string, operator: string) {
  const run = await requireRun(db, runId);
  if (run.status === 'running') {
    await finishImportStatement(db, run, operator).run();
  }
  const finished = await requireRun(db, runId);
  if (finished.status === 'running') { throw new ArchiveImportError('IMPORT_INCOMPLETE', '批次仍有未提交文档，不能结束'); }
  return { run: finished, counts: await importCounts(db, runId) };
}

export async function getArchiveImportReport(db: D1Database, runId: string, pagination: ArchivePagination) {
  const run = await requireRun(db, runId);
  return { run, counts: await importCounts(db, runId), items: await listImportItems(db, runId, pagination), ...pagination };
}

export async function getArchiveImports(db: D1Database, pagination: ArchivePagination) {
  return { items: await listImportRuns(db, pagination), ...pagination };
}
