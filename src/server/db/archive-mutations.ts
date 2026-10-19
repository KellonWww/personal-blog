import { queryOne } from '@/server/db/client';
import { archiveTaxonomyStatements } from '@/server/db/archive-taxonomy';
import type { ArchiveRow } from '@/server/db/archives';
import type { ArchiveMutationKind, ArchiveMutationInput } from '@/server/services/archive-mutation-model';
import type { ArchiveTaxonomyTerm } from '@/server/services/archive-taxonomy';
import type { prepareArchiveText } from '@/server/services/archive-text';

export interface ArchiveMutationRow {
  archiveId: string;
  versionId: string;
  sequence: number;
  kind: ArchiveMutationKind;
  requestHash: string;
}
export interface ArchiveMutationPlan {
  head: ArchiveRow;
  input: ArchiveMutationInput;
  kind: ArchiveMutationKind;
  versionId: string;
  operationId: string;
  requestHash: string;
  reason: string;
  restoredFrom: string | null;
  basedOnSource: string | null;
  text: Awaited<ReturnType<typeof prepareArchiveText>>;
  taxonomy: ArchiveTaxonomyTerm[];
  operator: string;
}

export function findArchiveMutation(db: D1Database, archiveId: string, operationId: string) {
  return queryOne<ArchiveMutationRow>(db,
    'SELECT v.archive_id AS archiveId, v.id AS versionId, v.sequence, v.kind, v.request_hash AS requestHash ' +
    'FROM archive_versions v JOIN archives a ON a.id = v.archive_id JOIN archive_sources s ON s.id = a.source_id ' +
    'WHERE v.archive_id = ? AND v.operation_id = ? AND a.deleted_at IS NULL AND s.deleted_at IS NULL', [archiveId, operationId]);
}

/** ⚠️ 需牢大审核后人工执行：仅生成应用事务语句，AI 不执行写操作。 */
export function archiveMutationStatements(db: D1Database, plan: ArchiveMutationPlan) {
  const { head, input, text } = plan;
  // 0003 checks head/version; 0005 checks active source and the latest resolution candidate.
  // Any guard/unique failure must abort the whole D1 batch before heads/taxonomy change.
  const version = db.prepare('INSERT INTO archive_versions ' +
    '(id, archive_id, sequence, parent_id, kind, title, content_md, plain_text, metadata_snapshot_json, content_hash, ' +
    'parser_version, restored_from, based_on_source, operation_id, request_hash, change_reason, created_by, updated_by) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(plan.versionId, head.id, input.expectedVersion + 1, input.expectedHead, plan.kind, text.title, text.content,
      text.plainText, text.metadataJson, text.contentHash, text.parserVersion, plan.restoredFrom, plan.basedOnSource,
      plan.operationId, plan.requestHash, plan.reason, plan.operator, plan.operator);
  const resolution = plan.kind === 'resolution';
  const advance = db.prepare('UPDATE archives SET current_version_id = ?, accepted_source_version_id = ?, conflict_state = ?, ' +
    "version = version + 1, updated_at = datetime('now'), updated_by = ? " +
    'WHERE id = ? AND version = ? AND current_version_id = ? AND deleted_at IS NULL')
    .bind(plan.versionId, resolution ? plan.basedOnSource : head.acceptedSourceVersionId,
      resolution ? 'none' : head.conflictState, plan.operator, head.id, input.expectedVersion, input.expectedHead);
  return [version, advance, ...archiveTaxonomyStatements(db, { archiveId: head.id, terms: plan.taxonomy, operator: plan.operator })];
}
