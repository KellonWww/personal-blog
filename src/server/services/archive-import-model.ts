import { z } from 'zod';
import { archiveIdSchema } from '@/server/services/archive-query';

export const ARCHIVE_MAX_TEXT_LENGTH = 100000;
export const ARCHIVE_IMPORT_MAX_BYTES = 1024 * 1024;
export const ARCHIVE_BASELINE_BATCH_SIZE = 50;
export const ARCHIVE_PARSER_VERSION = 'text-v1';
const identity = z.string().min(1).max(512).regex(/^[^\p{Cc}]+$/u);
const label = z.string().trim().min(1).max(100).regex(/^[^\p{Cc}]+$/u);
export const archiveMetadataSchema = z.object({
  categories: z.array(label).max(10).default([]),
  tags: z.array(label).max(20).default([])
});
export const importRunSchema = z.object({
  runId: archiveIdSchema,
  source: z.object({
    provider: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/),
    namespace: identity,
    name: z.string().trim().min(1).max(200)
  }),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedItems: z.number().int().min(1).max(10000)
});
export const importItemSchema = z.object({
  docId: identity,
  expectedVersion: z.number().int().min(0),
  expectedHead: archiveIdSchema.nullable(),
  title: z.string().trim().min(1).max(200),
  rawContent: z.string().max(ARCHIVE_MAX_TEXT_LENGTH),
  sourcePath: z.string().max(1024),
  sourceUrl: z.string().max(2000).refine((value) => {
    if (!value) { return true; }
    try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
  }),
  metadata: archiveMetadataSchema
});
export const failedImportItemSchema = z.object({
  docId: identity,
  errorCode: z.enum(['TEXT_MISSING', 'TEXT_ENCODING', 'TEXT_TOO_LARGE', 'PATH_INVALID', 'TEXT_INVALID']),
});
export const baselineSchema = z.object({
  provider: importRunSchema.shape.source.shape.provider,
  namespace: identity,
  docIds: z.array(identity).min(1).max(ARCHIVE_BASELINE_BATCH_SIZE)
});
export type ImportRunInput = z.infer<typeof importRunSchema>;
export type ImportItemInput = z.infer<typeof importItemSchema>;
export type FailedImportItemInput = z.infer<typeof failedImportItemSchema>;
export type ImportAction = 'created' | 'skipped' | 'updated' | 'conflict' | 'failed';

export interface ImportHead {
  id: string;
  version: number;
  currentVersionId: string | null;
  acceptedSourceVersionId: string | null;
  latestSourceVersionId: string | null;
  conflictState: 'none' | 'pending';
  currentHash: string | null;
  acceptedHash: string | null;
  latestHash: string | null;
  deletedAt: string | null;
}
export interface ImportRunRow {
  id: string;
  sourceId: string;
  status: 'running' | 'completed' | 'partial' | 'failed';
  manifestHash: string;
  expectedItems: number;
}
export interface ImportItemRow {
  id: string;
  docId: string;
  archiveId: string | null;
  versionId: string | null;
  action: ImportAction | 'pending';
  requestHash: string;
  errorCode: string;
}
export class ArchiveImportError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: 404 | 409 | 422 = 409) {
    super(message);
    this.name = 'ArchiveImportError';
  }
}

/** Pure three-way decision: a new source that equals local work resolves the divergence. */
export function decideImport(head: ImportHead | null, incomingHash: string): ImportAction {
  if (!head) { return 'created'; }
  if (incomingHash === head.latestHash) { return 'skipped'; }
  if (incomingHash === head.currentHash) { return 'updated'; }
  if (head.conflictState === 'none' && head.currentHash === head.acceptedHash) { return 'updated'; }
  return 'conflict';
}
