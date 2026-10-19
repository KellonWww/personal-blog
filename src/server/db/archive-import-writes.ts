import { archiveTaxonomyStatements } from '@/server/db/archive-taxonomy';
import type { ImportAction, ImportHead, ImportItemInput, ImportRunRow } from '@/server/services/archive-import-model';
import type { prepareArchiveText } from '@/server/services/archive-text';

export interface ImportWritePlan {
  run: ImportRunRow;
  input: ImportItemInput;
  head: ImportHead | null;
  archiveId: string;
  operationId: string;
  versionId: string;
  requestHash: string;
  action: ImportAction;
  text: Awaited<ReturnType<typeof prepareArchiveText>>;
  taxonomy: Array<{ id: string; kind: 'category' | 'tag'; name: string }>;
  operator: string;
}

/** ⚠️ 需牢大审核后人工执行：应用运行时使用，AI 仅生成、不执行这些写入语句。 */
export function importItemStatement(db: D1Database, item: {
  runId: string; docId: string; operationId: string; requestHash: string; operator: string;
  archiveId?: string; versionId?: string | null; expectedVersion?: number; expectedHead?: string | null; errorCode?: string;
}) {
  return db.prepare('INSERT INTO archive_import_items ' +
    '(id, run_id, doc_id, archive_id, version_id, operation_id, request_hash, expected_version, expected_head, action, error_code, created_by, updated_by) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(item.operationId, item.runId, item.docId, item.archiveId ?? null, item.versionId ?? null,
      item.operationId, item.requestHash, item.expectedVersion ?? 0, item.expectedHead ?? null,
      item.errorCode ? 'failed' : 'pending', item.errorCode ?? '', item.operator, item.operator);
}

function createArchiveStatement(db: D1Database, plan: ImportWritePlan) {
  return db.prepare('INSERT INTO archives (id, source_id, source_doc_id, source_url, source_path, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(plan.archiveId, plan.run.sourceId, plan.input.docId, plan.input.sourceUrl, plan.input.sourcePath, plan.operator, plan.operator);
}

function createVersionStatement(db: D1Database, plan: ImportWritePlan) {
  return db.prepare('INSERT INTO archive_versions (id, archive_id, sequence, parent_id, kind, title, content_md, plain_text, ' +
    'metadata_snapshot_json, content_hash, source_hash, raw_hash, raw_content_md, parser_version, based_on_source, operation_id, created_by, updated_by) ' +
    "VALUES (?, ?, ?, ?, 'import', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(plan.versionId, plan.archiveId, plan.input.expectedVersion + 1, plan.input.expectedHead,
      plan.text.title, plan.text.content, plan.text.plainText, plan.text.metadataJson,
      plan.text.contentHash, plan.text.contentHash, plan.text.rawHash, plan.input.rawContent, plan.text.parserVersion,
      plan.head?.acceptedSourceVersionId ?? null, plan.operationId, plan.operator, plan.operator);
}

function advanceHeadStatement(db: D1Database, plan: ImportWritePlan) {
  const conflict = plan.action === 'conflict';
  return db.prepare('UPDATE archives SET current_version_id = ?, accepted_source_version_id = ?, latest_source_version_id = ?, ' +
    "conflict_state = ?, source_url = ?, source_path = ?, last_imported_at = datetime('now'), updated_at = datetime('now'), updated_by = ?, version = version + 1 WHERE id = ?")
    .bind(conflict ? plan.head?.currentVersionId : plan.versionId,
      conflict ? plan.head?.acceptedSourceVersionId : plan.versionId, plan.versionId, conflict ? 'pending' : 'none',
      plan.input.sourceUrl, plan.input.sourcePath, plan.operator, plan.archiveId);
}

export function importWriteStatements(db: D1Database, plan: ImportWritePlan) {
  const statements: D1PreparedStatement[] = [];
  if (!plan.head) { statements.push(createArchiveStatement(db, plan)); }
  // The insert trigger checks the run and CAS before any version/projection writes; duplicate keys roll the entire batch back.
  statements.push(importItemStatement(db, {
    runId: plan.run.id, docId: plan.input.docId, operationId: plan.operationId, requestHash: plan.requestHash,
    archiveId: plan.archiveId, expectedVersion: plan.input.expectedVersion, expectedHead: plan.input.expectedHead, operator: plan.operator
  }));
  if (plan.action === 'skipped') {
    statements.push(db.prepare("UPDATE archives SET source_url = ?, source_path = ?, last_imported_at = datetime('now') WHERE id = ?")
      .bind(plan.input.sourceUrl, plan.input.sourcePath, plan.archiveId));
  } else {
    statements.push(createVersionStatement(db, plan), advanceHeadStatement(db, plan));
    if (plan.action !== 'conflict') { statements.push(...archiveTaxonomyStatements(db, { archiveId: plan.archiveId, terms: plan.taxonomy, operator: plan.operator })); }
  }
  statements.push(db.prepare("UPDATE archive_import_items SET action = ?, version_id = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(plan.action, plan.action === 'skipped' ? plan.head?.latestSourceVersionId : plan.versionId, plan.operationId));
  return statements;
}

export function finishImportStatement(db: D1Database, run: ImportRunRow, operator: string) {
  return db.prepare("UPDATE archive_import_runs SET status = CASE WHEN EXISTS (SELECT 1 FROM archive_import_items WHERE run_id = ? AND action = 'failed') " +
    "THEN 'partial' ELSE 'completed' END, finished_at = datetime('now'), updated_at = datetime('now'), updated_by = ?, version = version + 1 " +
    "WHERE id = ? AND status = 'running' AND expected_items = (SELECT count(*) FROM archive_import_items WHERE run_id = ?) " +
    "AND NOT EXISTS (SELECT 1 FROM archive_import_items WHERE run_id = ? AND action = 'pending')")
    .bind(run.id, operator, run.id, run.id, run.id);
}
