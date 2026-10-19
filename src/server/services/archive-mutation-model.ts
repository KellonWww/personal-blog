import { z } from 'zod';
import { archiveIdSchema } from '@/server/services/archive-query';
import { ARCHIVE_MAX_TEXT_LENGTH, archiveMetadataSchema } from '@/server/services/archive-import-model';

const mutationBase = z.object({
  operationId: archiveIdSchema,
  expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1),
  expectedHead: archiveIdSchema,
  reason: z.string().trim().max(500).default('')
});
export const archiveEditableSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(ARCHIVE_MAX_TEXT_LENGTH).refine((value) => !value.includes('\0'), '正文不能包含空字节'),
  metadata: archiveMetadataSchema
});
export const archiveEditSchema = mutationBase.extend(archiveEditableSchema.shape).strict();
export const archiveRestoreSchema = mutationBase.extend({ targetVersionId: archiveIdSchema }).strict();
export const archiveResolveSchema = z.discriminatedUnion('mode', [
  mutationBase.extend({ mode: z.literal('keep-local'), expectedSource: archiveIdSchema }).strict(),
  mutationBase.extend({ mode: z.literal('accept-source'), expectedSource: archiveIdSchema }).strict(),
  mutationBase.extend({ mode: z.literal('merge'), expectedSource: archiveIdSchema, ...archiveEditableSchema.shape }).strict()
]);
export type ArchiveEditInput = z.infer<typeof archiveEditSchema>;
export type ArchiveRestoreInput = z.infer<typeof archiveRestoreSchema>;
export type ArchiveResolveInput = z.infer<typeof archiveResolveSchema>;
export type ArchiveMutationInput = ArchiveEditInput | ArchiveRestoreInput | ArchiveResolveInput;
export type ArchiveMutationKind = 'edit' | 'restore' | 'resolution';
export type ArchiveMutation = (
  | { kind: 'edit'; input: ArchiveEditInput }
  | { kind: 'restore'; input: ArchiveRestoreInput }
  | { kind: 'resolution'; input: ArchiveResolveInput }
) & { operator: string };

export class ArchiveMutationError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: 404 | 409 | 422 | 503 = 409) {
    super(message);
    this.name = 'ArchiveMutationError';
  }
}
