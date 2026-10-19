import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { fail, ok } from '@/lib/api';
import { requireArchiveAdmin } from '@/server/middleware/archives';
import { PostActionError, postBatchSchema, postSelectionSchema } from '@/server/services/post-action-model';
import { applyPostBatch } from '@/server/services/post-actions';
import { copyPostsToArchives } from '@/server/services/post-archives';
import type { AppBindings } from '@/server/types';

const actions = new Hono<AppBindings>();
for (const route of ['/admin/posts/batch', '/admin/posts/to-archives']) {
  actions.use(route, bodyLimit({ maxSize: 32768, onError: (c) => c.json(fail('BODY_TOO_LARGE', '批量请求不能超过 32 KiB'), 413) }));
}
actions.use('/admin/posts/to-archives', requireArchiveAdmin);
actions.post('/admin/posts/batch', async (c) => {
  const input = postBatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json(fail('VALIDATION_ERROR', '请选择 1～50 篇文章，并明确批量操作和目标分类/标签'), 422);
  try {
    return c.json(ok(await applyPostBatch(c.env.DB, input.data, c.get('user')!.id)));
  } catch (error) {
    if (error instanceof PostActionError) return c.json(fail(error.code, error.message), error.status);
    return c.json(fail('POST_BATCH_FAILED', '批量操作失败，请刷新核对文章；未返回原始数据库错误'), 500);
  }
});
actions.post('/admin/posts/to-archives', async (c) => {
  const input = postSelectionSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json(fail('VALIDATION_ERROR', '请选择 1～50 篇文章转存'), 422);
  try {
    return c.json(ok(await copyPostsToArchives(c.env.DB, input.data.ids, c.get('user')!.id)));
  } catch (error) {
    if (error instanceof PostActionError) return c.json(fail(error.code, error.message), error.status);
    return c.json(fail('ARCHIVE_COPY_FAILED', '转档失败，请核对档案迁移是否已完成；原文章不受影响'), 500);
  }
});
export default actions;
