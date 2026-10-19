import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ARCHIVE_IMPORT_MAX_BYTES } from '@/server/services/archive-import-model';
import { archiveEditSchema, archiveRestoreSchema, archiveResolveSchema } from '@/server/services/archive-mutation-model';
import { getArchivePublicationPreview } from '@/server/services/archive-publication-preview';
import { confirmArchivePublication } from '@/server/services/archive-publication-confirmations';
import { archiveConfirmSchema, archiveDraftSchema } from '@/server/services/archive-publication-model';
import { createArchiveDraft, getArchivePublications } from '@/server/services/archive-publications';
import { mutateArchive } from '@/server/services/archive-mutations';
import { archiveDiffQuerySchema, archiveExportQuerySchema, getArchiveDiff, getArchiveExport } from '@/server/services/archive-reading';
import { requireArchiveAdmin } from '@/server/middleware/archives';
import { z } from 'zod';
import { fail, ok } from '@/lib/api';
import { archiveIdSchema, archivePageSchema, archiveQuerySchema } from '@/server/services/archive-query';
import { getArchive, getArchiveHistory, getArchiveSources, getArchiveTaxonomy, getArchiveVersion, listArchives } from '@/server/services/archives';
import type { AppBindings } from '@/server/types';

const archives = new Hono<AppBindings>();
const archivePathSchema = z.object({ id: archiveIdSchema });
const versionPathSchema = archivePathSchema.extend({ versionId: archiveIdSchema });

for (const route of ['/admin/archives', '/admin/archives/*', '/admin/archive-sources', '/admin/archive-taxonomy']) {
  archives.use(route, requireArchiveAdmin);
}

archives.use('/admin/archives/*', bodyLimit({
  maxSize: ARCHIVE_IMPORT_MAX_BYTES,
  onError: (c) => c.json(fail('BODY_TOO_LARGE', '档案请求不能超过 1 MiB'), 413)
}));

archives.get('/admin/archives', async (c) => {
  const query = archiveQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json(fail('VALIDATION_ERROR', '档案查询条件不合法', query.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))), 422);
  }
  return c.json(ok(await listArchives(c.env.DB, query.data)));
});

archives.get('/admin/archive-sources', async (c) => {
  const query = archivePageSchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json(fail('VALIDATION_ERROR', '分页参数不合法'), 422);
  }
  return c.json(ok(await getArchiveSources(c.env.DB, query.data)));
});

archives.get('/admin/archive-taxonomy', async (c) => {
  const query = archivePageSchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json(fail('VALIDATION_ERROR', '分页参数不合法'), 422);
  }
  return c.json(ok(await getArchiveTaxonomy(c.env.DB, query.data)));
});

archives.get('/admin/archives/:id', async (c) => {
  const params = archivePathSchema.safeParse(c.req.param());
  if (!params.success) {
    return c.json(fail('VALIDATION_ERROR', '档案 ID 不合法'), 422);
  }
  const archive = await getArchive(c.env.DB, params.data.id);
  return archive ? c.json(ok({ archive })) : c.json(fail('NOT_FOUND', '档案不存在'), 404);
});

archives.get('/admin/archives/:id/versions', async (c) => {
  const params = archivePathSchema.safeParse(c.req.param());
  const query = archivePageSchema.safeParse(c.req.query());
  if (!params.success || !query.success) {
    return c.json(fail('VALIDATION_ERROR', '档案 ID 或分页参数不合法'), 422);
  }
  const history = await getArchiveHistory(c.env.DB, params.data.id, query.data);
  return history ? c.json(ok(history)) : c.json(fail('NOT_FOUND', '档案不存在'), 404);
});

archives.get('/admin/archives/:id/versions/:versionId', async (c) => {
  const params = versionPathSchema.safeParse(c.req.param());
  if (!params.success) {
    return c.json(fail('VALIDATION_ERROR', '档案或版本 ID 不合法'), 422);
  }
  const version = await getArchiveVersion(c.env.DB, params.data.id, params.data.versionId);
  return version ? c.json(ok({ version })) : c.json(fail('NOT_FOUND', '档案版本不存在'), 404);
});

archives.get('/admin/archives/:id/diff', async (c) => {
  const id = archiveIdSchema.safeParse(c.req.param('id'));
  const query = archiveDiffQuerySchema.safeParse(c.req.query());
  if (!id.success || !query.success) { return c.json(fail('VALIDATION_ERROR', '档案 ID 或差异版本参数不合法'), 422); }
  const diff = await getArchiveDiff(c.env.DB, id.data, query.data);
  if (!diff) { return c.json(fail('NOT_FOUND', '档案或目标版本不存在'), 404); }
  if (diff.status === 'too-large') {
    return c.json(fail('DIFF_TOO_LARGE', '差异超过计算上限，请分别导出版本进行本地比较', {
      maxLinesPerVersion: diff.maxLinesPerVersion, maxCells: diff.maxCells
    }), 422);
  }
  return c.json(ok(diff));
});

archives.get('/admin/archives/:id/export', async (c) => {
  const id = archiveIdSchema.safeParse(c.req.param('id'));
  const query = archiveExportQuerySchema.safeParse(c.req.query());
  if (!id.success || !query.success) { return c.json(fail('VALIDATION_ERROR', '必须提供合法的档案 ID 和 versionId'), 422); }
  const result = await getArchiveExport(c.env.DB, id.data, query.data.versionId);
  if (!result) { return c.json(fail('NOT_FOUND', '档案或目标版本不存在'), 404); }
  c.header('Content-Type', 'text/markdown; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="' + result.filename + '"');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Security-Policy', "default-src 'none'; sandbox");
  return c.body(result.content);
});

archives.patch('/admin/archives/:id', async (c) => {
  const id = archiveIdSchema.safeParse(c.req.param('id'));
  const input = archiveEditSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !input.success) { return c.json(fail('VALIDATION_ERROR', '档案 ID、文本或编辑版本参数不合法'), 422); }
  return c.json(ok(await mutateArchive(c.env.DB, id.data, { kind: 'edit', input: input.data, operator: c.get('user')!.id })));
});

archives.post('/admin/archives/:id/restore', async (c) => {
  const id = archiveIdSchema.safeParse(c.req.param('id'));
  const input = archiveRestoreSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !input.success) { return c.json(fail('VALIDATION_ERROR', '档案 ID 或历史恢复参数不合法'), 422); }
  return c.json(ok(await mutateArchive(c.env.DB, id.data, { kind: 'restore', input: input.data, operator: c.get('user')!.id })));
});

archives.post('/admin/archives/:id/resolve', async (c) => {
  const id = archiveIdSchema.safeParse(c.req.param('id'));
  const input = archiveResolveSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !input.success) { return c.json(fail('VALIDATION_ERROR', '档案 ID 或冲突解决参数不合法'), 422); }
  return c.json(ok(await mutateArchive(c.env.DB, id.data, { kind: 'resolution', input: input.data, operator: c.get('user')!.id })));
});

archives.get('/admin/archives/:id/publications', async (c) => {
  const id = archiveIdSchema.safeParse(c.req.param('id'));
  const page = archivePageSchema.safeParse(c.req.query());
  if (!id.success || !page.success) { return c.json(fail('VALIDATION_ERROR', '档案 ID 或分页参数不合法'), 422); }
  const result = await getArchivePublications(c.env.DB, id.data, page.data);
  return result ? c.json(ok(result)) : c.json(fail('NOT_FOUND', '档案不存在'), 404);
});

archives.post('/admin/archives/:id/blog-draft', async (c) => {
  const id = archiveIdSchema.safeParse(c.req.param('id'));
  const input = archiveDraftSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !input.success) { return c.json(fail('VALIDATION_ERROR', '档案 ID 或转稿快照参数不合法'), 422); }
  return c.json(ok(await createArchiveDraft(c.env.DB, id.data, input.data, c.get('user')!.id)));
});

archives.get('/admin/archives/:id/publications/:publicationId/preview', async (c) => {
  const id = archiveIdSchema.safeParse(c.req.param('id'));
  const publicationId = archiveIdSchema.safeParse(c.req.param('publicationId'));
  if (!id.success || !publicationId.success) { return c.json(fail('VALIDATION_ERROR', '档案或关联稿 ID 不合法'), 422); }
  const result = await getArchivePublicationPreview(c.env.DB, id.data, publicationId.data, { env: c.env, operator: c.get('user')!.id });
  return result ? c.json(ok(result)) : c.json(fail('NOT_FOUND', '关联稿不存在或已不可访问'), 404);
});

archives.post('/admin/archives/:id/publications/:publicationId/confirm', async (c) => {
  const id = archiveIdSchema.safeParse(c.req.param('id'));
  const publicationId = archiveIdSchema.safeParse(c.req.param('publicationId'));
  const input = archiveConfirmSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !publicationId.success || !input.success) { return c.json(fail('VALIDATION_ERROR', '关联稿、预览令牌或明确确认参数不合法'), 422); }
  return c.json(ok(await confirmArchivePublication(c.env.DB, id.data, publicationId.data,
    { input: input.data, env: c.env, operator: c.get('user')!.id })));
});

export default archives;
