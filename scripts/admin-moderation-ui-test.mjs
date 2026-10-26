/** Browser regression with real components/build CSS and isolated HTTP fixtures; no database writes. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const evidence = join(homedir(), '.agents/evidence/personal-blog');
await mkdir(evidence, { recursive: true });
const bundle = await build({
  stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
    import Dashboard from './src/components/admin/AdminDashboard';
    import LoginForm from './src/components/LoginForm';
    const query = new URLSearchParams(location.search);
    const locale = document.documentElement.lang;
    createRoot(document.getElementById('root')).render(location.pathname === '/login'
      ? React.createElement(LoginForm, { locale, oauthEnabled: true, devMode: false, errorCode: '', returnTo: query.get('returnTo') })
      : React.createElement(Dashboard, { locale }));`, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, format: 'esm', jsx: 'automatic', tsconfig: join(root, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': JSON.stringify('production') }, logLevel: 'silent'
});
const assets = join(root, 'dist/client/_astro');
const files = await readdir(assets);
const css = (await Promise.all(files.filter(name => /^(studio|AdminShell).*\.css$/.test(name)).sort((a) => a.startsWith('studio') ? -1 : 1)
  .map(name => readFile(join(assets, name), 'utf8')))).join('\n');
assert(css.includes('.admin-feed-item'), 'Run npm run build before this test');
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return; }
  if (url.pathname === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return; }
  if (url.pathname.startsWith('/_astro/')) {
    const path = resolve(assets, url.pathname.slice('/_astro/'.length));
    if (!path.startsWith(assets + sep)) { response.writeHead(404); response.end(); return; }
    try { response.setHeader('Content-Type', 'font/woff2'); response.end(await readFile(path)); }
    catch { response.writeHead(404); response.end(); }
    return;
  }
  const locale = url.searchParams.get('locale') === 'en' ? 'en' : 'zh-CN';
  const theme = url.searchParams.get('theme') === 'dianqing' ? 'dianqing' : 'moye';
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<html lang='${locale}' data-theme='${theme}'><head><meta name='viewport' content='width=device-width,initial-scale=1'><link rel='stylesheet' href='/fixture.css'></head><body class='admin-site'><div id='root'></div><script type='module' src='/bundle.js'></script></body></html>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { channel: process.argv[3] } : {}) });
const context = await browser.newContext({ reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let role = 'admin';
let fail = false;
let writes = 0;
let items = ['approved', 'pending', 'hidden'].flatMap(status => Array.from({ length: 3 }, (_, index) => ({
  id: status + index, type: index % 2 ? 'comment' : 'guestbook', status,
  userName: index === 2 ? 'long-author-'.repeat(12) : '读者 ' + index,
  title: index === 2 ? 'LongSource'.repeat(25) : 'Spring 系列 · 阅读与实践',
  content: index === 2 ? 'LongUnbrokenContent'.repeat(40) : '谢谢分享，这篇文章很有帮助。\n期待下一篇更新。', createdAt: '2026-10-26 03:43:00'
})));
await page.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  let data;
  let status = 200;
  if (url.pathname === '/api/auth/me') data = { authenticated: true, user: { id: 'fixture', username: 'Owner', displayName: 'Kale', role, csrfToken: 'fixture' } };
  else if (url.pathname === '/api/auth/logout') { assert.equal(request.headers()['x-csrf-token'], 'fixture'); data = { loggedOut: true }; }
  else if (url.pathname === '/api/admin/comments') {
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      assert.equal(request.headers()['x-csrf-token'], 'fixture');
      items = items.map(item => item.id === body.id ? { ...item, status: body.status } : item); writes++; data = {};
    } else if (fail) { status = 500; data = null; }
    else data = { items: items.filter(item => url.searchParams.get('status') === 'all' || item.status === url.searchParams.get('status')) };
  } else { errors.push('Unexpected API: ' + url.pathname); await route.abort(); return; }
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: status === 200, data, message: 'fixture failure' }) });
});
try {
  for (const locale of ['zh-CN', 'en']) for (const theme of ['moye', 'dianqing']) for (const width of [320, 390, 768, 1100, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(base + '/admin?view=moderation&locale=' + locale + '&theme=' + theme);
    await page.locator('.admin-feed-item').first().waitFor();
    await page.locator('.admin-toolbar select').first().selectOption('approved');
    await page.waitForFunction(() => document.querySelectorAll('.admin-feed-item .admin-status[data-status=approved]').length === 3);
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      rows: [...document.querySelectorAll('.admin-feed-item')].map(item => {
        const box = item.getBoundingClientRect();
        const select = item.querySelector('input').getBoundingClientRect();
        const body = item.querySelector('.admin-feed-content').getBoundingClientRect();
        const actions = item.querySelector('.admin-moderation-actions').getBoundingClientRect();
        return { inset: select.left - box.left, bodyLeft: body.left - select.right, contained: actions.right <= box.right && body.right <= box.right, padding: parseFloat(window.getComputedStyle(item).paddingLeft) };
      })
    }));
    assert(!layout.overflow, 'No overflow: ' + [locale, theme, width]);
    assert(layout.rows.every(row => row.inset >= 19 && row.bodyLeft >= 11 && row.contained && row.padding >= 20), 'Consistent row padding/columns: ' + [locale, theme, width]);
    if (locale === 'zh-CN' && [390, 1440].includes(width)) await page.screenshot({ path: join(evidence, 'moderation-' + theme + '-' + width + '-20261026.png'), fullPage: true });
    console.log('[moderation-ui] PASS ' + [locale, theme, width]);
  }
  await page.goto(base + '/admin?view=moderation');
  await page.locator('.admin-feed-item').first().waitFor();
  await page.locator('.admin-toolbar input[type=checkbox]').check();
  await page.locator('.admin-toolbar button').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.admin-feed-item').length === 0);
  assert.equal(writes, 3, 'All selected fixture items processed once');
  await page.locator('.admin-toolbar select').first().selectOption('all');
  await page.locator('.admin-feed-item').first().waitFor();
  fail = true;
  await page.reload();
  await page.getByRole('alert').waitFor();
  fail = false;
  await page.getByRole('alert').getByRole('button').click();
  await page.getByRole('alert').waitFor({ state: 'hidden' });
  await page.locator('.admin-toolbar select').first().selectOption('all');
  await page.locator('.admin-feed-item').first().waitFor();
  role = 'user';
  await page.goto(base + '/login?returnTo=%2Fadmin');
  await page.getByRole('button', { name: '退出', exact: true }).waitFor();
  assert.equal(await page.locator('.admin-shell').count(), 0);
  assert.equal(await page.getByRole('link', { name: '进入后台', exact: true }).count(), 0);
  assert.equal(await page.getByRole('link', { name: '返回数字花园', exact: true }).getAttribute('href'), '/');
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await page.getByRole('link', { name: '使用 GitHub 登录', exact: true }).waitFor();
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('[moderation-ui] PASS batch selection, status filters, error/retry, public login/logout; no browser errors');
} finally { await browser.close(); await new Promise(done => server.close(done)); }
