/** Isolated HTTP/middleware regression. No local or remote database is opened or modified. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { Hono } from 'hono';

const root = fileURLToPath(new URL('../', import.meta.url));
const sessions = new Map();
const env = { ENVIRONMENT: 'production', GITHUB_ADMIN_USERNAME: 'Owner', SITE_URL: 'https://blog.test',
  DB: { prepare(sql) {
    assert(sql.includes('FROM sessions'), 'Only session SELECTs are permitted');
    return { bind(hash) { return { async all() { return { results: sessions.has(hash) ? [sessions.get(hash)] : [] }; } }; } };
  } }
};
globalThis.__adminAccessEnv = env;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'fixture:cloudflare', shortCircuit: true };
    const base = specifier.startsWith('@/') ? resolve(root, 'src', specifier.slice(2))
      : specifier.startsWith('.') && context.parentURL?.startsWith('file:') ? resolve(dirname(fileURLToPath(context.parentURL)), specifier) : null;
    if (base) for (const candidate of [base + '.ts', resolve(base, 'index.ts')]) {
      if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'fixture:cloudflare') return { format: 'module', shortCircuit: true, source: 'export const env = globalThis.__adminAccessEnv;' };
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
const { adminWorkspace } = await import('../src/server/middleware/admin.ts');
const { sessionMiddleware } = await import('../src/server/middleware/auth.ts');
const { default: auth } = await import('../src/server/routes/auth.ts');
const { default: admin } = await import('../src/server/routes/admin.ts');
const { sessionCookie } = await import('../src/server/cookie.ts');
const { authorizedLoginDestination, loginDestination } = await import('../src/lib/auth-redirect.ts');
const app = new Hono();
app.use('*', sessionMiddleware);
app.route('/', auth);
app.route('/', admin);
let checks = 0;
function check(condition, message) { assert(condition, message); checks++; console.log('[admin-access] PASS ' + message); }
function fixture(token, username, role = 'admin', id = 'fixture-' + username) {
  sessions.set(createHash('sha256').update(token).digest('hex'), { user_id: id, username, display_name: username, avatar_url: '', role, csrf_token: 'fixture' });
}
fixture('owner', 'OWNER');
fixture('reader', 'reader', 'user');
fixture('stale-admin', 'former-owner');
fixture('dev-owner', 'laoda', 'admin', 'usr_dev_laoda');
async function page(path, token, status, location) {
  let rendered = false;
  const response = await adminWorkspace({
    url: new URL(path, env.SITE_URL),
    cookies: { get() { return token ? { value: token } : undefined; } },
    redirect(target, code) { return new Response(null, { status: code, headers: { Location: target } }); }
  }, async () => { rendered = true; return new Response('workspace', { headers: { Vary: 'Accept-Language' } }); });
  check(response.status === status && response.headers.get('Location') === (location ?? null), path + ' status/redirect for ' + (token ?? 'guest'));
  check(rendered === (status === 200), 'workspace rendering is gated for ' + (token ?? 'guest'));
  if (path.startsWith('/admin')) {
    check(response.headers.get('Cache-Control') === 'private, no-store' && response.headers.get('Vary').includes('Cookie'), 'protected response cannot be publicly cached');
  }
  if (!rendered) check(!(await response.text()).includes('workspace'), 'denied HTML contains no workspace');
}
try {
  for (const path of ['/admin', '/admin?view=moderation', '/admin/editor?id=secret', '/admin/', '/admin%2Feditor']) {
    await page(path, undefined, 302, '/login?' + new URLSearchParams({ returnTo: path }));
    await page(path, 'reader', 302, '/');
    await page(path, 'stale-admin', 302, '/');
    await page(path, 'owner', 200);
  }
  await page('/admin/login', 'reader', 302, '/login?returnTo=%2Fadmin');
  await page('/admin/login/', undefined, 302, '/login?returnTo=%2Fadmin');
  await page('/login', undefined, 200);
  await page('/guestbook', 'reader', 200);
  await page('/admin', 'expired', 302, '/login?returnTo=%2Fadmin');
  const originalDb = env.DB;
  env.DB = { prepare() { throw new Error('Database unavailable'); } };
  await page('/admin', 'owner', 503);
  env.DB = originalDb;
  for (const token of ['reader', 'stale-admin']) {
    const headers = { Cookie: sessionCookie(env).name + '=' + token };
    const me = await app.request('/auth/me', { headers }, env);
    const data = (await me.json()).data;
    check(data.authenticated && data.user.role === 'user', 'public login remains valid: ' + token);
    check((await app.request('/admin/stats', { headers }, env)).status === 403, 'admin API rejects ' + token);
  }
  check((await app.request('/admin/stats', {}, env)).status === 401, 'admin API rejects guests');
  env.GITHUB_ADMIN_USERNAME = '';
  await page('/admin', 'owner', 302, '/');
  env.ENVIRONMENT = 'development'; env.AUTH_DEV_MODE = 'true';
  await page('/admin', 'dev-owner', 200);
  env.ENVIRONMENT = 'production';
  await page('/admin', 'dev-owner', 302, '/');
  for (const value of ['https://evil.test', '//evil.test', '/api/auth/logout', '/admin/login', '/private/../api/admin', '/admin/editor%2Fbad']) {
    check(loginDestination(value) === '/', 'unsafe destination rejected: ' + value);
  }
  check(authorizedLoginDestination('/admin/editor?id=secret', 'user') === '/', 'reader OAuth cannot land in editor');
  check(authorizedLoginDestination('/private/doc', 'user') === '/', 'reader OAuth cannot land in library');
  check(authorizedLoginDestination('/admin?view=moderation', 'admin') === '/admin?view=moderation', 'owner OAuth retains workspace destination');
  check(authorizedLoginDestination('/guestbook', 'user') === '/guestbook', 'reader OAuth retains public destination');
  check(authorizedLoginDestination(null, 'user') === '/', 'default public login lands on public home');
  console.log('[admin-access] ' + checks + ' checks passed');
} finally { hooks.deregister(); delete globalThis.__adminAccessEnv; }
