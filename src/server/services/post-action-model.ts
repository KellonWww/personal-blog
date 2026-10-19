import { z } from 'zod';
import { POST_BATCH_LIMIT } from '@/types/post-actions';

const id = z.string().trim().min(1).max(200);
export const postSelectionSchema = z.object({
  ids: z.array(id).min(1).max(POST_BATCH_LIMIT).transform((ids) => [...new Set(ids)])
});
export const postBatchSchema = postSelectionSchema.extend({
  action: z.enum(['publish', 'draft', 'delete', 'categories', 'tags']),
  taxonomyIds: z.array(id).max(20).transform((ids) => [...new Set(ids)]).optional()
}).superRefine((input, ctx) => {
  if ((input.action === 'categories' || input.action === 'tags') && !input.taxonomyIds) {
    ctx.addIssue({ code: 'custom', message: '修改分类或标签时必须明确传入目标列表；空数组表示清空', path: ['taxonomyIds'] });
  }
});
export class PostActionError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: 404 | 409 | 422 = 409) {
    super(message);
    this.name = 'PostActionError';
  }
}
