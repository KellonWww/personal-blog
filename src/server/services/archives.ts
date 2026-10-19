import { z } from 'zod';
import { findArchiveRow, findArchiveVersion, listArchiveRows, listArchiveVersionRows, listArchiveSources, listArchiveTaxonomy, type ArchiveRow, type ArchiveVersionRow } from '@/server/db/archives';
import { DatabaseError } from '@/server/db/client';
import { archiveSnippet, type ArchivePagination, type ArchiveQuery } from '@/server/services/archive-query';
import type { ArchiveDetail, ArchivePage, ArchiveSummary, ArchiveVersion } from '@/types/archive';

const metadataSchema = z.object({ categories: z.array(z.string()), tags: z.array(z.string()) });

function toSummary(row: ArchiveRow, query = ''): ArchiveSummary {
  return {
    id: row.id, title: row.title, snippet: archiveSnippet(row.matchText, query),
    sourceId: row.sourceId, sourceName: row.sourceName, sourceDocId: row.sourceDocId,
    conflictState: row.conflictState, version: row.version, updatedAt: row.updatedAt
  };
}

function toVersion(row: ArchiveVersionRow): ArchiveVersion {
  const { metadataJson, ...version } = row;
  const metadata = metadataSchema.parse(JSON.parse(metadataJson));
  return { ...version, metadata };
}

export async function listArchives(db: D1Database, query: ArchiveQuery): Promise<ArchivePage<ArchiveSummary>> {
  const result = await listArchiveRows(db, query);
  return { items: result.rows.map((row) => toSummary(row, query.q)), total: result.total, page: query.page, pageSize: query.pageSize };
}

export async function getArchive(db: D1Database, id: string): Promise<ArchiveDetail | null> {
  const row = await findArchiveRow(db, id);
  if (!row) {
    return null;
  }
  const version = await findArchiveVersion(db, id, row.currentVersionId);
  if (!version) {
    throw new DatabaseError('档案当前版本缺失');
  }
  return {
    ...toSummary(row), sourceUrl: row.sourceUrl, currentVersion: toVersion(version),
    acceptedSourceVersionId: row.acceptedSourceVersionId, latestSourceVersionId: row.latestSourceVersionId
  };
}

export async function getArchiveVersion(db: D1Database, id: string, versionId: string): Promise<ArchiveVersion | null> {
  const row = await findArchiveVersion(db, id, versionId);
  return row ? toVersion(row) : null;
}

export async function getArchiveHistory(db: D1Database, id: string, pagination: ArchivePagination) {
  if (!await findArchiveRow(db, id)) {
    return null;
  }
  const items = await listArchiveVersionRows(db, id, pagination);
  return { items, page: pagination.page, pageSize: pagination.pageSize };
}

export async function getArchiveSources(db: D1Database, pagination: ArchivePagination) {
  return { items: await listArchiveSources(db, pagination), ...pagination };
}

export async function getArchiveTaxonomy(db: D1Database, pagination: ArchivePagination) {
  return { items: await listArchiveTaxonomy(db, pagination), ...pagination };
}
