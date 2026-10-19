import { z } from 'zod';
import { findArchiveRow } from '@/server/db/archives';
import { getArchiveVersion } from '@/server/services/archives';
import { archiveIdSchema } from '@/server/services/archive-query';
import { ARCHIVE_DIFF_MAX_CELLS, ARCHIVE_DIFF_MAX_LINES, diffArchiveLines } from '@/server/services/archive-diff';
import type { ArchiveDiff, ArchiveVersion } from '@/types/archive';

export const archiveDiffQuerySchema = z.object({ from: archiveIdSchema, to: archiveIdSchema }).strict();
export const archiveExportQuerySchema = z.object({ versionId: archiveIdSchema }).strict();

function versionSummary(version: ArchiveVersion) {
  return { id: version.id, sequence: version.sequence, title: version.title, metadata: version.metadata };
}

export async function getArchiveDiff(db: D1Database, archiveId: string, query: z.infer<typeof archiveDiffQuerySchema>) {
  const [before, after] = await Promise.all([
    getArchiveVersion(db, archiveId, query.from), getArchiveVersion(db, archiveId, query.to)
  ]);
  if (!before || !after) { return null; }
  const diff = diffArchiveLines(before.content, after.content);
  if (!diff) {
    return { status: 'too-large' as const, maxLinesPerVersion: ARCHIVE_DIFF_MAX_LINES, maxCells: ARCHIVE_DIFF_MAX_CELLS };
  }
  const result: ArchiveDiff = {
    archiveId, from: versionSummary(before), to: versionSummary(after),
    titleChanged: before.title !== after.title,
    metadataChanged: JSON.stringify(before.metadata) !== JSON.stringify(after.metadata), ...diff
  };
  return { status: 'ok' as const, ...result };
}

/** JSON scalars/flow collections are YAML-compatible; escape YAML line separators too. */
function frontmatterValue(value: unknown): string {
  return JSON.stringify(value).replace(/\u0085/g, '\\u0085').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export async function getArchiveExport(db: D1Database, archiveId: string, versionId: string) {
  const archive = await findArchiveRow(db, archiveId);
  if (!archive) { return null; }
  const version = await getArchiveVersion(db, archiveId, versionId);
  if (!version) { return null; }
  const metadata = {
    format: 'private-archive-text-v1', archiveId, versionId: version.id, sequence: version.sequence,
    title: version.title, categories: version.metadata.categories, tags: version.metadata.tags,
    kind: version.kind, createdAt: version.createdAt, reason: version.reason,
    restoredFrom: version.restoredFrom, basedOnSource: version.basedOnSource,
    source: { id: archive.sourceId, name: archive.sourceName, docId: archive.sourceDocId, url: archive.sourceUrl },
    sourceMetadataScope: 'current-at-export', resourcesIncluded: false, fullBackup: false,
    notice: '仅导出所选规范化 Markdown 快照与元数据；来源信息为导出时现值，不含原始来源文本、图片、附件或完整灾备。'
  };
  const frontmatter = Object.entries(metadata).map(([key, value]) => key + ': ' + frontmatterValue(value)).join('\n');
  return {
    filename: 'archive-' + archive.id + '-v' + version.sequence + '.md',
    content: '---\n' + frontmatter + '\n---\n\n' + version.content
  };
}
