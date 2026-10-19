import { queryAll, queryOne } from '@/server/db/client';
import { splitArchiveTerms, type ArchivePagination, type ArchiveQuery } from '@/server/services/archive-query';

export interface ArchiveRow {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceDocId: string;
  sourceUrl: string;
  conflictState: 'none' | 'pending';
  version: number;
  updatedAt: string;
  title: string;
  matchText: string;
  currentVersionId: string;
  acceptedSourceVersionId: string | null;
  latestSourceVersionId: string | null;
}

export interface ArchiveVersionRow {
  id: string;
  archiveId: string;
  sequence: number;
  parentId: string | null;
  kind: 'import' | 'edit' | 'restore' | 'resolution';
  title: string;
  content: string;
  metadataJson: string;
  restoredFrom: string | null;
  basedOnSource: string | null;
  createdAt: string;
  createdBy: string;
  reason: string;
}

const ARCHIVE_COLUMNS =   'a.id, a.source_id AS sourceId, s.display_name AS sourceName, a.source_doc_id AS sourceDocId, ' +
  'a.source_url AS sourceUrl, a.conflict_state AS conflictState, a.version, a.updated_at AS updatedAt, ' +
  'v.title, v.plain_text AS matchText, a.current_version_id AS currentVersionId, ' +
  'a.accepted_source_version_id AS acceptedSourceVersionId, a.latest_source_version_id AS latestSourceVersionId';
const ARCHIVE_FROM = ' FROM archives a JOIN archive_sources s ON s.id = a.source_id ' +
  'JOIN archive_versions v ON v.id = a.current_version_id AND v.archive_id = a.id ';
const ARCHIVE_VISIBLE = 'a.deleted_at IS NULL AND s.deleted_at IS NULL';
const VERSION_COLUMNS = 'v.id, v.archive_id AS archiveId, v.sequence, v.parent_id AS parentId, v.kind, ' +
  'v.title, v.content_md AS content, v.metadata_snapshot_json AS metadataJson, ' +
  'v.restored_from AS restoredFrom, v.based_on_source AS basedOnSource, ' +
  'v.created_at AS createdAt, v.created_by AS createdBy, v.change_reason AS reason';

function buildArchiveFilter(query: ArchiveQuery) {
  const terms = splitArchiveTerms(query.q);
  const conditions = [ARCHIVE_VISIBLE];
  const params: unknown[] = [];
  let join = '';
  if (terms.match) {
    join = 'JOIN archive_search ON archive_search.archive_id = a.id ';
    conditions.push('archive_search MATCH ?');
    params.push(terms.match);
  }
  for (const term of terms.shortTerms) {
    conditions.push("instr(lower(v.title || char(10) || v.plain_text), lower(?)) > 0");
    params.push(term);
  }
  if (query.source) {
    conditions.push('a.source_id = ?');
    params.push(query.source);
  }
  if (query.conflict) {
    conditions.push('a.conflict_state = ?');
    params.push(query.conflict);
  }
  for (const [kind, taxonomyId] of [['category', query.category], ['tag', query.tag]]) {
    if (!taxonomyId) {
      continue;
    }
    conditions.push('EXISTS (SELECT 1 FROM archive_taxonomy_links l JOIN archive_taxonomy t ON t.id = l.taxonomy_id ' +
      'WHERE l.archive_id = a.id AND t.id = ? AND t.kind = ? AND t.deleted_at IS NULL)');
    params.push(taxonomyId, kind);
  }
  return { from: ARCHIVE_FROM + join + 'WHERE ' + conditions.join(' AND '), params, useMatch: Boolean(terms.match) };
}

export async function listArchiveRows(db: D1Database, query: ArchiveQuery) {
  const filter = buildArchiveFilter(query);
  const order = filter.useMatch ? 'bm25(archive_search), a.updated_at DESC, a.id' : 'a.updated_at DESC, a.id';
  // Both reads share one D1 snapshot; category/tag conditions apply before ranking and pagination.
  const results = await db.batch([
    db.prepare('SELECT count(*) AS total' + filter.from).bind(...filter.params),
    db.prepare('SELECT ' + ARCHIVE_COLUMNS + filter.from + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?')
      .bind(...filter.params, query.pageSize, (query.page - 1) * query.pageSize)
  ]);
  const totalRows = results[0]?.results as Array<{ total: number }> | undefined;
  return { rows: (results[1]?.results ?? []) as unknown as ArchiveRow[], total: totalRows?.[0]?.total ?? 0 };
}

export function findArchiveRow(db: D1Database, archiveId: string) {
  return queryOne<ArchiveRow>(db, 'SELECT ' + ARCHIVE_COLUMNS + ARCHIVE_FROM + 'WHERE ' + ARCHIVE_VISIBLE + ' AND a.id = ?', [archiveId]);
}

export function findArchiveVersion(db: D1Database, archiveId: string, versionId: string) {
  return queryOne<ArchiveVersionRow>(db, 'SELECT ' + VERSION_COLUMNS +
    ' FROM archive_versions v JOIN archives a ON a.id = v.archive_id JOIN archive_sources s ON s.id = a.source_id ' +
    'WHERE ' + ARCHIVE_VISIBLE + ' AND a.id = ? AND v.id = ?', [archiveId, versionId]);
}

export async function listArchiveVersionRows(db: D1Database, archiveId: string, pagination: ArchivePagination) {
  const params = [archiveId, pagination.pageSize, (pagination.page - 1) * pagination.pageSize];
  return queryAll<Omit<ArchiveVersionRow, 'content' | 'metadataJson'>>(db,
    'SELECT v.id, v.archive_id AS archiveId, v.sequence, v.parent_id AS parentId, v.kind, v.title, ' +
    'v.restored_from AS restoredFrom, v.based_on_source AS basedOnSource, v.created_at AS createdAt, v.created_by AS createdBy, v.change_reason AS reason ' +
    'FROM archive_versions v WHERE v.archive_id = ? ORDER BY v.sequence DESC LIMIT ? OFFSET ?', params);
}

export function listArchiveSources(db: D1Database, pagination: ArchivePagination) {
  return queryAll<{ id: string; provider: string; name: string }>(db,
    'SELECT id, provider, display_name AS name FROM archive_sources WHERE deleted_at IS NULL ORDER BY display_name, id LIMIT ? OFFSET ?',
    [pagination.pageSize, (pagination.page - 1) * pagination.pageSize]);
}

export function listArchiveTaxonomy(db: D1Database, pagination: ArchivePagination) {
  return queryAll<{ id: string; kind: 'category' | 'tag'; name: string }>(db,
    'SELECT id, kind, name FROM archive_taxonomy WHERE deleted_at IS NULL ORDER BY kind, normalized_name, id LIMIT ? OFFSET ?',
    [pagination.pageSize, (pagination.page - 1) * pagination.pageSize]);
}
