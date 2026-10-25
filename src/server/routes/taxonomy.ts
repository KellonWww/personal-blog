import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { fail, ok } from '@/lib/api';
import { listManagedTaxonomy } from '@/server/db/taxonomy';
import { mutateTaxonomy } from '@/server/services/taxonomy';
import { TaxonomyError, taxonomyDeleteSchema, taxonomyInputSchema, taxonomyKindSchema, taxonomyUpdateSchema } from '@/server/services/taxonomy-model';
import type { AppBindings } from '@/server/types';

// Mounted below the shared /admin/* role guard; session and CSRF middleware stay in force.
const taxonomy = new Hono<AppBindings>();
taxonomy.use('/admin/taxonomy/*', bodyLimit({ maxSize: 8192, onError: (c) => c.json(fail('BODY_TOO_LARGE', '分类或标签请求不能超过 8 KiB'), 413) }));
taxonomy.get('/admin/taxonomy/:kind', async (c) => {
  const kind = taxonomyKindSchema.safeParse(c.req.param('kind'));
  if (!kind.success) return c.json(fail('VALIDATION_ERROR', '管理类型必须为 categories 或 tags'), 422);
  return c.json(ok({ items: await listManagedTaxonomy(c.env.DB, kind.data) }));
});
const schemas = {
  post: taxonomyInputSchema.transform((input) => ({ input, version: undefined })),
  put: taxonomyUpdateSchema.transform((data) => ({ input: data.value, version: data.version })),
  delete: taxonomyDeleteSchema.transform((data) => ({ input: undefined, version: data.version }))
};
for (const method of ['post', 'put', 'delete'] as const) {
  taxonomy[method](method === 'post' ? '/admin/taxonomy/:kind' : '/admin/taxonomy/:kind/:id', async (c) => {
    const kind = taxonomyKindSchema.safeParse(c.req.param('kind'));
    if (!kind.success) return c.json(fail('VALIDATION_ERROR', '管理类型必须为 categories 或 tags'), 422);
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = schemas[method].safeParse(body);
    if (!parsed.success) return c.json(fail('VALIDATION_ERROR', parsed.error.issues.map((issue) => issue.message).join('；')), 422);
    const { input, version } = parsed.data;
    if (kind.data === 'tags' && input && (input.description || input.sortOrder !== 0)) {
      return c.json(fail('VALIDATION_ERROR', '标签不支持分类简介和排序'), 422);
    }
    try {
      const result = await mutateTaxonomy(c.env.DB, {
        kind: kind.data, id: method === 'post' ? undefined : c.req.param('id'),
        operator: c.get('user')!.id, version, input
      });
      return c.json(ok(result), method === 'post' ? 201 : 200);
    } catch (error) {
      if (error instanceof TaxonomyError) return c.json(fail(error.code, error.message), error.status);
      throw error;
    }
  });
}
export default taxonomy;
