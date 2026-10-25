import { z } from 'zod';
import { isValidSlug, slugify } from '@/lib/slug';

export const taxonomyKindSchema = z.enum(['categories', 'tags']);
export const taxonomyInputSchema = z.object({
  name: z.string().trim().min(1, '名称不能为空').max(100, '名称最多 100 字'),
  slug: z.string().trim().max(80).default(''),
  description: z.string().trim().max(500).default(''),
  sortOrder: z.number().int().min(-999999).max(999999).default(0)
}).strict().transform((input) => ({ ...input, slug: input.slug || slugify(input.name) }))
  .refine((input) => isValidSlug(input.slug), '路径只能包含文字、数字和连字符，且须以文字或数字开头');
export const taxonomyUpdateSchema = z.object({
  version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  value: taxonomyInputSchema
}).strict();
export const taxonomyDeleteSchema = z.object({
  version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1)
}).strict();

export class TaxonomyError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: 404 | 409 | 422 = 409) {
    super(message);
    this.name = 'TaxonomyError';
  }
}
