import { queryAll, queryOne } from '@/server/db/client';
import { sha256Hex } from '@/server/auth/crypto';
import type { ArchivePagination } from '@/server/services/archive-query';
import type { ImportHead, ImportItemRow, ImportRunRow, ImportRunInput } from '@/server/services/archive-import-model';

export async function archiveSourceId(source: { provider: string; namespace: string }) {
  return 'src_' + await sha256Hex(JSON.stringify([source.provider, source.namespace]));
}

export function findImportRun(db: D1Database, id: string) {
  return queryOne<ImportRunRow>(db,
    'SELECT r.id, r.source_id AS sourceId, r.status, r.manifest_hash AS manifestHash, r.expected_items AS expectedItems ' +
    'FROM archive_import_runs r JOIN archive_sources s ON s.id = r.source_id ' +
    'WHERE r.id = ? AND r.deleted_at IS NULL AND s.deleted_at IS NULL', [id]);
}

export function findImportItem(db: D1Database, runId: string, docId: string) {
  return queryOne<ImportItemRow>(db,
    'SELECT id, doc_id AS docId, archive_id AS archiveId, version_id AS versionId, action, request_hash AS requestHash, error_code AS errorCode ' +
    'FROM archive_import_items WHERE run_id = ? AND doc_id = ? AND deleted_at IS NULL', [runId, docId]);
}

export function findImportHeads(db: D1Database, sourceId: string, docIds: string[]) {
  if (!docIds.length) { return Promise.resolve([]); }
  const slots = docIds.map(() => '?').join(',');
  return queryAll<ImportHead & { docId: string }>(db,
    'SELECT a.id, a.source_doc_id AS docId, a.version, a.current_version_id AS currentVersionId, ' +
    'a.accepted_source_version_id AS acceptedSourceVersionId, a.latest_source_version_id AS latestSourceVersionId, ' +
    'a.conflict_state AS conflictState, a.deleted_at AS deletedAt, ' +
    'v.content_hash AS currentHash, b.content_hash AS acceptedHash, s.content_hash AS latestHash ' +
    'FROM archives a LEFT JOIN archive_versions v ON v.id = a.current_version_id AND v.archive_id = a.id ' +
    'LEFT JOIN archive_versions b ON b.id = a.accepted_source_version_id AND b.archive_id = a.id ' +
    'LEFT JOIN archive_versions s ON s.id = a.latest_source_version_id AND s.archive_id = a.id ' +
    'WHERE a.source_id = ? AND a.source_doc_id IN (' + slots + ')', [sourceId, ...docIds]);
}

export function importRunStatements(db: D1Database, input: ImportRunInput, sourceId: string, operator: string) {
  // ⚠️ 需牢大审核后人工执行：此处仅生成应用事务语句；AI 不调用写入接口。
  return [
    db.prepare('INSERT INTO archive_sources (id, provider, namespace, display_name, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(provider, namespace) DO NOTHING').bind(sourceId, input.source.provider, input.source.namespace, input.source.name, operator, operator),
    db.prepare('INSERT INTO archive_import_runs (id, source_id, manifest_hash, expected_items, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(input.runId, sourceId, input.manifestHash, input.expectedItems, operator, operator)
  ];
}

export function listImportRuns(db: D1Database, pagination: ArchivePagination) {
  return queryAll<ImportRunRow & { startedAt: string; finishedAt: string | null }>(db,
    'SELECT r.id, r.source_id AS sourceId, r.status, r.manifest_hash AS manifestHash, r.expected_items AS expectedItems, ' +
    'r.started_at AS startedAt, r.finished_at AS finishedAt FROM archive_import_runs r ' +
    'JOIN archive_sources s ON s.id = r.source_id WHERE r.deleted_at IS NULL AND s.deleted_at IS NULL ' +
    'ORDER BY r.started_at DESC, r.id LIMIT ? OFFSET ?', [pagination.pageSize, (pagination.page - 1) * pagination.pageSize]);
}

export function listImportItems(db: D1Database, runId: string, pagination: ArchivePagination) {
  return queryAll<Omit<ImportItemRow, 'requestHash'>>(db,
    'SELECT id, doc_id AS docId, archive_id AS archiveId, version_id AS versionId, action, error_code AS errorCode ' +
    'FROM archive_import_items WHERE run_id = ? AND deleted_at IS NULL ORDER BY doc_id LIMIT ? OFFSET ?',
    [runId, pagination.pageSize, (pagination.page - 1) * pagination.pageSize]);
}

export function importCounts(db: D1Database, runId: string) {
  return queryAll<{ action: string; total: number }>(db,
    'SELECT action, count(*) AS total FROM archive_import_items WHERE run_id = ? AND deleted_at IS NULL GROUP BY action', [runId]);
}
