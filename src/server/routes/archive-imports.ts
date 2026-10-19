import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { fail, ok } from '@/lib/api';
import { requireArchiveAdmin } from '@/server/middleware/archives';
import { ARCHIVE_IMPORT_MAX_BYTES, baselineSchema, failedImportItemSchema, importItemSchema, importRunSchema } from '@/server/services/archive-import-model';
import { finishArchiveImport, getArchiveImportReport, getArchiveImports, getImportBaseline, importArchiveText, recordFailedArchiveImport, startArchiveImport } from '@/server/services/archive-imports';
import { archiveIdSchema, archivePageSchema } from '@/server/services/archive-query';
import type { AppBindings } from '@/server/types';

const imports = new Hono<AppBindings>();
for (const route of ['/admin/imports', '/admin/imports/*']) {
  imports.use(route, requireArchiveAdmin);
  imports.use(route, bodyLimit({ maxSize: ARCHIVE_IMPORT_MAX_BYTES, onError: (c) => c.json(fail('BODY_TOO_LARGE', '导入请求不能超过 1 MiB'), 413) }));
}

imports.get('/admin/imports', async (c) => {
  const pagination = archivePageSchema.safeParse(c.req.query());
  if (!pagination.success) { return c.json(fail('VALIDATION_ERROR', '分页参数不合法'), 422); }
  return c.json(ok(await getArchiveImports(c.env.DB, pagination.data)));
});

// Read-only baseline: POST carries up to 50 raw source IDs without putting them in URLs/logs.
imports.post('/admin/imports/baseline', async (c) => {
  const input = baselineSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) { return c.json(fail('VALIDATION_ERROR', '来源或批量基线参数不合法'), 422); }
  return c.json(ok(await getImportBaseline(c.env.DB, input.data)));
});

imports.post('/admin/imports', async (c) => {
  const input = importRunSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) { return c.json(fail('VALIDATION_ERROR', '导入批次参数不合法'), 422); }
  return c.json(ok({ run: await startArchiveImport(c.env.DB, input.data, c.get('user')!.id) }));
});

imports.get('/admin/imports/:id', async (c) => {
  const id = archiveIdSchema.safeParse(c.req.param('id'));
  const pagination = archivePageSchema.safeParse(c.req.query());
  if (!id.success || !pagination.success) { return c.json(fail('VALIDATION_ERROR', '批次 ID 或分页参数不合法'), 422); }
  return c.json(ok(await getArchiveImportReport(c.env.DB, id.data, pagination.data)));
});

imports.get('/admin/imports/:id/items', async (c) => {
  const id = archiveIdSchema.safeParse(c.req.param('id'));
  const pagination = archivePageSchema.safeParse(c.req.query());
  if (!id.success || !pagination.success) { return c.json(fail('VALIDATION_ERROR', '批次 ID 或分页参数不合法'), 422); }
  return c.json(ok(await getArchiveImportReport(c.env.DB, id.data, pagination.data)));
});

imports.post('/admin/imports/:id/items', async (c) => {
  const id = archiveIdSchema.safeParse(c.req.param('id'));
  if (!id.success) { return c.json(fail('VALIDATION_ERROR', '批次 ID 不合法'), 422); }
  const body = await c.req.json().catch(() => null);
  const failed = failedImportItemSchema.safeParse(body);
  if (failed.success) {
    return c.json(ok(await recordFailedArchiveImport(c.env.DB, id.data, failed.data, c.get('user')!.id)));
  }
  const input = importItemSchema.safeParse(body);
  if (!input.success) {
    return c.json(fail('VALIDATION_ERROR', '导入文本参数不合法', input.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))), 422);
  }
  return c.json(ok(await importArchiveText(c.env.DB, id.data, input.data, c.get('user')!.id)));
});

imports.post('/admin/imports/:id/finish', async (c) => {
  const id = archiveIdSchema.safeParse(c.req.param('id'));
  if (!id.success) { return c.json(fail('VALIDATION_ERROR', '批次 ID 不合法'), 422); }
  return c.json(ok(await finishArchiveImport(c.env.DB, id.data, c.get('user')!.id)));
});

export default imports;
