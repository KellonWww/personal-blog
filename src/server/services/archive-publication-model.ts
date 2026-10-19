import { z } from 'zod';
import { archiveIdSchema } from '@/server/services/archive-query';

export const archiveDraftSchema = z.object({
  operationId: archiveIdSchema,
  expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1),
  expectedHead: archiveIdSchema
}).strict();
export type ArchiveDraftInput = z.infer<typeof archiveDraftSchema>;

export const archiveConfirmSchema = z.object({
  operationId: archiveIdSchema,
  previewToken: z.string().min(1).max(4096),
  reviewedContent: z.literal(true),
  reviewedReferences: z.literal(true)
}).strict();
export type ArchiveConfirmInput = z.infer<typeof archiveConfirmSchema>;
