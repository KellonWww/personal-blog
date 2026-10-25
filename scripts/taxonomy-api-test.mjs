/** Integration checks use an isolated in-memory SQLite database, never local/remote D1 data. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { Hono } from 'hono';

const root = fileURLToPath(new URL('../', import.meta.url));
const hook = registerHooks({
  resolve(specifier, context, next) {
    const base = specifier.startsWith('@/') ? resolve(root, 'src', specifier.slice(2))
      : specifier.startsWith('.') && context.parentURL?.startsWith('file:') ? resolve(dirname(fileURLToPath(context.parentURL)), specifier) : null;
    if (base) {
      for (const candidate of [base + '.ts', resolve(base, 'index.ts')]) {
        if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.ts') && !url.includes('/node_modules/')) {
      return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext }
      }).outputText };
    }
    if (url.startsWith('file:') && url.endsWith('.json') && !url.includes('/node_modules/')) {
      return { format: 'module', shortCircuit: true, source: 'export default ' + readFileSync(fileURLToPath(url), 'utf8') };
    }
    return next(url, context);
  }
});
const { default: admin } = await import('../src/server/routes/admin.ts');
const { csrfMiddleware } = await import('../src/server/middleware/auth.ts');
const { createPost, updatePost } = await import('../src/server/services/posts.ts');
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(resolve(root, 'migrations/0001_init.sql'), 'utf8'));
sqlite.exec("INSERT INTO users (id, username, role) VALUES ('admin', 'test', 'admin'); CREATE TABLE archive_publications (post_id TEXT)");
let beforeBatch;
const db = {
  prepare(sql) {
    const statement = { params: [], bind(...params) { this.params = params; return this; },
      async all() { return this.execute(); }, async run() { return this.execute(); },
      execute() { return { results: sqlite.prepare(sql).all(...this.params), success: true, meta: { changes: sqlite.prepare('SELECT changes() AS n').get().n } }; }
    };
    return statement;
  },
  async batch(statements) {
    if (beforeBatch) { const action = beforeBatch; beforeBatch = undefined; action(); }
    sqlite.exec('BEGIN');
    try { const results = statements.map((statement) => statement.execute()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }
};
const app = new Hono();
app.use('*', async (c, next) => {
  const role = c.req.header('test-role');
  c.set('user', role ? { id: 'admin', role, csrfToken: 'test-token' } : null);
  await next();
});
app.use('*', csrfMiddleware);
app.route('/', admin);
app.onError(() => new Response('Unexpected integration failure', { status: 500 }));
const env = { DB: db, SITE_URL: 'http://localhost' };
let checks = 0;
async function request(method, path, body, status = 200, extra = {}) {
  const response = await app.request('http://localhost' + path, {
    method, headers: { 'test-role': 'admin', 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-token', Origin: 'http://localhost', ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }, env);
  assert.equal(response.status, status, method + ' ' + path + ': ' + await response.clone().text());
  checks++;
  return (await response.json()).data;
}
const input = { name: '技术', slug: 'tech', description: '技术文章', sortOrder: 4 };
try {
  await request('GET', '/admin/taxonomy/categories', undefined, 401, { 'test-role': '' });
  await request('GET', '/admin/taxonomy/categories', undefined, 403, { 'test-role': 'user' });
  await request('POST', '/admin/taxonomy/categories', input, 403, { 'X-CSRF-Token': '' });
  await request('POST', '/admin/taxonomy/categories', input, 403, { Origin: 'https://untrusted.example' });
  await request('GET', '/admin/taxonomy/unknown', undefined, 422);
  for (const body of [{ ...input, name: ' ' }, { ...input, slug: '../bad' }, { ...input, sortOrder: 1.5 }, { ...input, description: 'x'.repeat(501) }, { ...input, parentId: 'invalid' }]) {
    await request('POST', '/admin/taxonomy/categories', body, 422);
  }
  const category = await request('POST', '/admin/taxonomy/categories', input, 201);
  const tag = await request('POST', '/admin/taxonomy/tags', { name: 'JavaScript' }, 201);
  assert.equal((await request('GET', '/admin/taxonomy/tags')).items[0].slug, 'javascript');
  await request('POST', '/admin/taxonomy/categories', input, 409);
  await request('POST', '/admin/taxonomy/categories', { ...input, name: 'Other' }, 409);
  await request('POST', '/admin/taxonomy/tags', input, 422);
  const post = await createPost(db, { title: 'Original', summary: '', content: 'Body stays intact', status: 'published', categoryIds: [category.id], tagIds: [tag.id] }, 'admin');
  assert.equal((await request('GET', '/admin/taxonomy/categories')).items[0].postCount, 1);
  await request('PUT', '/admin/taxonomy/categories/' + category.id, { version: 0, value: { ...input, name: '改名', slug: 'renamed', sortOrder: -2 } });
  const term = (await request('GET', '/admin/taxonomy/categories')).items[0];
  assert.equal(term.name, '改名'); assert.equal(term.sortOrder, -2); assert.equal(term.version, 1);
  assert.equal((await request('GET', '/admin/taxonomy')).categories[0].name, '改名');
  await request('PUT', '/admin/taxonomy/categories/' + category.id, { version: 0, value: input }, 409);
  await request('DELETE', '/admin/taxonomy/categories/' + category.id, {}, 422);
  // Simulate a concurrent update after prechecks and before D1's atomic batch.
  beforeBatch = () => sqlite.prepare('UPDATE categories SET version = version + 1 WHERE id = ?').run(category.id);
  await request('PUT', '/admin/taxonomy/categories/' + category.id, { version: 1, value: input }, 409);
  assert.equal(sqlite.prepare('SELECT name FROM categories WHERE id = ?').get(category.id).name, '改名');
  sqlite.prepare("INSERT INTO categories (id, name, slug, parent_id) VALUES ('child', 'Child', 'child', ?)").run(category.id);
  await request('DELETE', '/admin/taxonomy/categories/' + category.id, { version: 2 }, 409);
  sqlite.exec("DELETE FROM categories WHERE id = 'child'");
  sqlite.prepare('INSERT INTO archive_publications (post_id) VALUES (?)').run(post.id);
  await request('DELETE', '/admin/taxonomy/tags/' + tag.id, { version: 0 }, 409);
  await request('PUT', '/admin/taxonomy/categories/' + category.id, { version: 2, value: input }, 409);
  sqlite.exec('DELETE FROM archive_publications');
  // A protected publication appearing after prechecks must also be rejected transactionally.
  beforeBatch = () => sqlite.prepare('INSERT INTO archive_publications (post_id) VALUES (?)').run(post.id);
  await request('DELETE', '/admin/taxonomy/tags/' + tag.id, { version: 0 }, 409);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM post_tags').get().n, 1);
  sqlite.exec('DELETE FROM archive_publications');
  await request('DELETE', '/admin/taxonomy/categories/' + category.id, { version: 2 });
  await request('DELETE', '/admin/taxonomy/tags/' + tag.id, { version: 0 });
  assert.equal((await request('GET', '/admin/taxonomy/categories')).items.length, 0);
  assert.equal((await request('GET', '/admin/taxonomy')).tags.length, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM post_categories').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM post_tags').get().n, 0);
  const kept = sqlite.prepare('SELECT title, content, status, deleted_at FROM posts WHERE id = ?').get(post.id);
  assert.deepEqual({ ...kept }, { title: 'Original', content: 'Body stays intact', status: 'published', deleted_at: null });
  await assert.rejects(() => createPost(db, { title: 'Stale create', summary: '', content: 'Body', status: 'draft', categoryIds: [category.id] }, 'admin'));
  await assert.rejects(() => updatePost(db, post.id, { title: 'Stale update', summary: '', content: 'Changed', status: 'draft', tagIds: [tag.id] }, 'admin'));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 1);
  assert.equal(sqlite.prepare('SELECT content FROM posts WHERE id = ?').get(post.id).content, 'Body stays intact');
  await request('DELETE', '/admin/taxonomy/tags/' + tag.id, { version: 0 }, 404);
  const recreated = await request('POST', '/admin/taxonomy/categories', input, 201);
  assert.notEqual(recreated.id, category.id);
  // An insert racing the duplicate-name precheck must be rejected without creating a duplicate.
  beforeBatch = () => sqlite.exec("INSERT INTO tags (id,name,slug) VALUES ('race','Race','race-other')");
  await request('POST', '/admin/taxonomy/tags', { name: 'Race', slug: 'race' }, 409);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM tags WHERE name = 'Race'").get().n, 1);
  console.log(`[taxonomy-api] PASS ${checks} API checks plus atomic rollback, duplicate races, stale post selections, protected publications, and post preservation. No real database writes.`);
} finally { sqlite.close(); hook.deregister(); }
