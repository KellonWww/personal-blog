import { Hono } from 'hono';
import { z } from 'zod';
import { fail, ok } from '@/lib/api';
import { FRIENDS_ERROR, parseFriends } from '@/lib/friends';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '@/lib/constants';
import { queryOne } from '@/server/db/client';
import { listPosts } from '@/server/db/content';
import { listModerationQueue, updateModerationStatus } from '@/server/db/interactions';
import { getSiteSettings, upsertSetting } from '@/server/db/settings';
import { createPost, getAdminPost, listSelectableTaxonomy, PostValidationError, softDeletePost, updatePost } from '@/server/services/posts';
import postActions from '@/server/routes/post-actions';
import taxonomyRoutes from '@/server/routes/taxonomy';
import type { AppBindings } from '@/server/types';

const admin = new Hono<AppBindings>();

admin.use('/admin/*', async (c, next) => {
  const user = c.get('user');
  if (!user) {
    return c.json(fail('UNAUTHORIZED', '请先登录'), 401);
  }
  if (user.role !== 'admin') {
    return c.json(fail('FORBIDDEN', '需要管理员权限'), 403);
  }
  c.set('user', user);
  await next();
});

const postSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(200, '标题不能超过 200 字'),
  slug: z.string().trim().max(80).optional().default(''),
  summary: z.string().trim().max(500).optional().default(''),
  content: z.string().min(1, '正文不能为空'),
  coverImage: z.string().trim().max(500).optional().default(''),
  status: z.enum(['draft', 'published']),
  categoryIds: z.array(z.string()).optional().default([]),
  tagIds: z.array(z.string()).optional().default([])
});

const SETTING_KEYS = new Set([
  'profile.name',
  'profile.bio',
  'profile.avatar',
  'profile.motto',
  'site.announcement',
  'site.about',
  'site.icp',
  'site.started_at',
  'site.social_links',
  'site.friends'
]);

function isWebUrl(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

const socialLinksSchema = z.array(z.object({
  label: z.string().trim().min(1).max(100),
  url: z.string().max(500).refine(isWebUrl)
})).max(20);

const settingsSchema = z.object({
  'profile.name': z.string().max(100),
  'profile.bio': z.string().max(500),
  'profile.avatar': z.string().max(500).refine((value) => !value || (value.startsWith('/') && !value.startsWith('//')) || isWebUrl(value), '头像地址必须为站内路径或 http(s) 地址'),
  'profile.motto': z.string().max(200),
  'site.announcement': z.string().max(1000),
  'site.about': z.string().max(20000),
  'site.icp': z.string().max(100),
  'site.started_at': z.string().refine((value) => {
    if (!value) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, '建站日期必须是有效的 YYYY-MM-DD 日期'),
  'site.friends': z.string().max(150000).transform((value, ctx) => {
    try { return JSON.stringify(parseFriends(value)); }
    catch { ctx.addIssue({ code: 'custom', message: FRIENDS_ERROR }); return z.NEVER; }
  }),
  'site.social_links': z.string().max(15000).refine((value) => {
    try { return socialLinksSchema.safeParse(JSON.parse(value)).success; } catch { return false; }
  }, '社交链接必须包含名称及有效 http(s) 地址，最多 20 项')
}).partial();

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function operator(c: { get: (key: 'user') => AppBindings['Variables']['user'] }): string {
  return c.get('user')?.id ?? '';
}

admin.route('/', postActions);
admin.route('/', taxonomyRoutes);

admin.get('/admin/posts', async (c) => {
  const query = c.req.query();
  const status = query.status === 'published' || query.status === 'draft' ? query.status : 'all';
  if (query.privateDocument !== undefined && !['all', 'true', 'false'].includes(query.privateDocument)) {
    return c.json(fail('VALIDATION_ERROR', '是否为私文档筛选值非法'), 422);
  }
  const result = await listPosts(c.env.DB, {
    page: toInt(query.page, 1),
    pageSize: toInt(query.pageSize, 20),
    status,
    search: query.search?.slice(0, 200),
    categoryId: query.categoryId,
    privateDocument: query.privateDocument === 'true' ? true : query.privateDocument === 'false' ? false : undefined,
    order: query.order === 'updated' ? 'updated' : undefined
  });
  return c.json(ok(result));
});

admin.get('/admin/posts/:id', async (c) => {
  const post = await getAdminPost(c.env.DB, c.req.param('id'));
  if (!post) {
    return c.json(fail('POST_NOT_FOUND', '文章不存在'), 404);
  }
  return c.json(ok(post));
});

admin.post('/admin/posts', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail('VALIDATION_ERROR', parsed.error.issues.map((issue) => issue.message).join('；'), parsed.error.issues), 422);
  }
  try {
    const post = await createPost(c.env.DB, parsed.data, operator(c));
    return c.json(ok(post), 201);
  } catch (error) {
    if (error instanceof PostValidationError) { return c.json(fail('POST_CREATE_FAILED', error.message), 400); }
    return c.json(fail('POST_CREATE_FAILED', '文章创建结果不明，请重新读取核对'), 500);
  }
});

admin.put('/admin/posts/:id', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail('VALIDATION_ERROR', parsed.error.issues.map((issue) => issue.message).join('；'), parsed.error.issues), 422);
  }
  try {
    const post = await updatePost(c.env.DB, c.req.param('id'), parsed.data, operator(c));
    return c.json(ok(post));
  } catch (error) {
    if (error instanceof Error && error.message.includes('ARCHIVE_PUBLICATION_CONFIRM_REQUIRED')) {
      return c.json(fail('ARCHIVE_PUBLICATION_CONFIRM_REQUIRED', '档案关联稿须先撤回草稿，再从档案关联记录审阅确认发布；不能通过普通编辑入口直接发布'), 409);
    }
    if (error instanceof PostValidationError) { return c.json(fail('POST_UPDATE_FAILED', error.message), 400); }
    // Drafts can now contain private archive text; never return raw driver messages.
    return c.json(fail('POST_UPDATE_FAILED', '文章更新结果不明，请重新读取核对'), 500);
  }
});

admin.delete('/admin/posts/:id', async (c) => {
  await softDeletePost(c.env.DB, c.req.param('id'), operator(c));
  return c.json(ok({ deleted: true }));
});

admin.get('/admin/taxonomy', async (c) => c.json(ok(await listSelectableTaxonomy(c.env.DB))));

admin.get('/admin/comments', async (c) => {
  const status = c.req.query('status');
  const filter = status === 'approved' || status === 'hidden' ? status : status === 'all' ? 'all' : 'pending';
  const items = await listModerationQueue(c.env.DB, filter);
  return c.json(ok({ items, total: items.length }));
});

admin.patch('/admin/comments', async (c) => {
  const body = await c.req
    .json<{ type?: string; id?: string; status?: string }>()
    .catch(() => ({}) as { type?: string; id?: string; status?: string });
  if (body.type !== 'comment' && body.type !== 'guestbook') {
    return c.json(fail('VALIDATION_ERROR', 'type 必须是 comment 或 guestbook'), 422);
  }
  if (!body.id) {
    return c.json(fail('VALIDATION_ERROR', '缺少内容 id'), 422);
  }
  if (body.status !== 'approved' && body.status !== 'hidden' && body.status !== 'pending') {
    return c.json(fail('VALIDATION_ERROR', 'status 非法'), 422);
  }
  await updateModerationStatus(c.env.DB, body.type, body.id, body.status, operator(c));
  return c.json(ok({ updated: true }));
});

admin.get('/admin/settings', async (c) => c.json(ok({ settings: await getSiteSettings(c.env.DB) })));

admin.put('/admin/settings', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json(fail('VALIDATION_ERROR', '请求体格式不正确'), 422);
  }
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail('VALIDATION_ERROR', parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('；')), 422);
  }
  const entries = Object.entries(parsed.data).filter(([key]) => SETTING_KEYS.has(key));
  if (entries.length === 0) {
    return c.json(fail('VALIDATION_ERROR', '没有可更新的配置项'), 422);
  }
  for (const [key, value] of entries) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    await upsertSetting(c.env.DB, key, text, operator(c));
  }
  return c.json(ok({ settings: await getSiteSettings(c.env.DB) }));
});

admin.get('/admin/stats', async (c) => {
  const [posts, drafts, comments, pending, guestbook, pendingGuestbook] = await Promise.all([
    queryOne<{ total: number }>(c.env.DB, "SELECT COUNT(*) AS total FROM posts WHERE status = 'published' AND deleted_at IS NULL"),
    queryOne<{ total: number }>(c.env.DB, "SELECT COUNT(*) AS total FROM posts WHERE status = 'draft' AND deleted_at IS NULL"),
    queryOne<{ total: number }>(c.env.DB, 'SELECT COUNT(*) AS total FROM comments WHERE deleted_at IS NULL'),
    queryOne<{ total: number }>(c.env.DB, "SELECT COUNT(*) AS total FROM comments WHERE status = 'pending' AND deleted_at IS NULL"),
    queryOne<{ total: number }>(c.env.DB, 'SELECT COUNT(*) AS total FROM guestbook WHERE deleted_at IS NULL'),
    queryOne<{ total: number }>(c.env.DB, "SELECT COUNT(*) AS total FROM guestbook WHERE status = 'pending' AND deleted_at IS NULL")
  ]);
  return c.json(
    ok({
      publishedPosts: Number(posts?.total ?? 0),
      draftPosts: Number(drafts?.total ?? 0),
      comments: Number(comments?.total ?? 0),
      pendingComments: Number(pending?.total ?? 0),
      pendingGuestbook: Number(pendingGuestbook?.total ?? 0),
      guestbook: Number(guestbook?.total ?? 0)
    })
  );
});

admin.post('/admin/uploads', async (c) => {
  const form = await c.req.parseBody();
  const file = form['file'];
  if (!(file instanceof File)) {
    return c.json(fail('FILE_REQUIRED', '请选择要上传的图片'), 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json(fail('FILE_TOO_LARGE', `图片不能超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`), 413);
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return c.json(fail('FILE_TYPE_INVALID', '仅支持 JPG / PNG / WebP / GIF 图片'), 415);
  }
  const rawExt = file.name.includes('.') ? file.name.split('.').pop() ?? '' : '';
  const ext = /^[a-z0-9]{2,5}$/i.test(rawExt) ? rawExt.toLowerCase() : 'png';
  const key = `uploads/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  const buffer = await file.arrayBuffer();
  await c.env.BUCKET.put(key, buffer, { httpMetadata: { contentType: file.type } });
  return c.json(ok({ key, url: `/api/media/${key}` }), 201);
});

export default admin;
