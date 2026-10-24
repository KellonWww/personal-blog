/** Local, read-only language integration checks. Admin/search data are mocked. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const base = process.env.UI_TEST_BASE || 'http://127.0.0.1:4321';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local server only');
const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { channel: process.argv[3] } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const evidence = join(homedir(), '.agents/evidence/personal-blog');
await mkdir(evidence, { recursive: true });
const fixture = { id: 'locale-fixture', title: '测试原文：未发布', slug: 'locale-fixture', summary: '这里是原始摘要。', status: 'draft', wordCount: 1600, viewCount: 12, commentCount: 1, categories: [], tags: [], updatedAt: '2026-10-20T10:00:00Z', createdAt: '2026-10-18T10:00:00Z', publishedAt: null, coverImage: '', authorId: 'fixture', authorName: '测试作者', authorAvatar: '' };
let failIndex = false;
await page.route('**/api/**', async route => {
  const req = route.request();
  if (req.method() !== 'GET') { errors.push('Unexpected API write: ' + req.url()); await route.abort(); return; }
  const url = new URL(req.url());
  let data;
  if (url.pathname === '/api/search-index') {
    if (failIndex) { await route.fulfill({ status: 503, json: {} }); return; }
    data = { items: [{ ...fixture, categories: ['测试分类'], tags: ['测试标签'] }] };
  } else if (url.pathname === '/api/auth/me') data = { user: { id: 'fixture', username: '测试作者', displayName: '测试作者', role: 'admin', csrfToken: 'fixture-only' } };
  else if (url.pathname === '/api/admin/stats') data = { publishedPosts: 12, draftPosts: 2, comments: 3, guestbook: 1, pendingComments: 1, pendingGuestbook: 0 };
  else if (url.pathname === '/api/admin/posts') data = { items: [fixture], total: 1, totalPages: 1, page: 1, pageSize: 10 };
  else if (url.pathname === '/api/admin/comments') data = { items: [{ id: 'comment-fixture', type: 'comment', userName: '原始姓名', title: fixture.title, content: '未发布', status: 'pending', createdAt: fixture.updatedAt }] };
  else if (url.pathname === '/api/admin/settings') data = { settings: { 'profile.name': '原始站名', 'site.social_links': '[]' } };
  else if (url.pathname === '/api/admin/archives') data = { items: [], total: 0, totalPages: 1, page: 1, pageSize: 20 };
  else if (['/api/admin/archive-sources', '/api/admin/archive-taxonomy'].includes(url.pathname)) data = { items: [] };
  else if (url.pathname === '/api/admin/taxonomy') data = { categories: [], tags: [] };
  else { await route.continue(); return; }
  await route.fulfill({ json: { code: 'OK', data } });
});
const setLocale = locale => context.addCookies([{ name: 'blog-locale', value: locale, url: base }]);
const layout = async label => {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), label + ': horizontal overflow');
  const toggle = page.locator('[data-language-switch] button');
  assert(await toggle.isVisible(), label + ': language control missing');
  const box = await toggle.boundingBox();
  const width = page.viewportSize().width;
  assert(box && box.x >= 0 && box.x + box.width <= width, label + ': language control outside viewport');
};
try {
  // Native form POST works with JS disabled and redirects safely.
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const nativePage = await noJs.newPage();
  await nativePage.goto(base + '/about?source=language#main');
  await nativePage.getByRole('button', { name: 'Switch to English' }).click();
  await nativePage.waitForURL('**/about?source=language');
  assert.equal(await nativePage.locator('html').getAttribute('lang'), 'en');
  assert.equal((await noJs.cookies()).find(cookie => cookie.name === 'blog-locale')?.httpOnly, true);
  await nativePage.reload();
  assert.equal(await nativePage.locator('html').getAttribute('lang'), 'en');
  await noJs.close();
  for (const returnTo of ['//example.com', '/\\example.com', '/%5cexample.com', '/safe\nInjected: x']) {
    const response = await context.request.post(base + '/language', { form: { locale: 'en', returnTo }, maxRedirects: 0 });
    assert.equal(response.status(), 303);
    assert.equal(new URL(response.headers().location, base).origin, new URL(base).origin);
  }
  assert.equal((await context.request.post(base + '/language', { form: { locale: 'xx' }, maxRedirects: 0 })).status(), 400);
  assert.equal((await context.request.post(base + '/language', { headers: { Origin: 'https://example.com' }, form: { locale: 'en' }, maxRedirects: 0 })).status(), 403);
  console.log('[language-ui] PASS native switching, persistence, invalid locale and same-origin redirect');

  for (const locale of ['zh-CN', 'en']) {
    await setLocale(locale);
    for (const theme of ['dianqing', 'moye']) {
      await context.addInitScript(id => localStorage.setItem('blog-theme', id), theme);
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const path of ['/', '/about', '/search', '/archive', '/toolbox', '/toolbox/time', '/toolbox/format', '/toolbox/regex', '/admin/login']) {
          const response = await page.goto(base + path);
          assert.equal(await page.locator('html').getAttribute('lang'), locale);
          assert(response.headers()['cache-control'].includes('private'));
          assert(response.headers().vary.toLowerCase().includes('cookie'));
          await layout(locale + '/' + theme + '/' + width + path);
          if (path === '/' || path === '/toolbox') {
            await page.addStyleTag({ content: 'astro-dev-toolbar{display:none!important}' });
            await page.screenshot({ path: join(evidence, `language-${locale}-${theme}-${width}-${path === '/' ? 'home' : 'tools'}.png`), fullPage: true });
          }
          if (path === '/toolbox/regex' && locale === 'en') assert(!/[\u3400-\u9fff]/.test((await page.locator('.tool-note').allTextContents()).join(' ')));
        }
      }
    }
  }
  console.log('[language-ui] PASS both languages/themes, public SSR/cache headers, 320/1440px layout');

  await setLocale('zh-CN');
  await page.goto(base + '/about?source=language#main');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Switch to English' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await page.waitForURL('**/about?source=language#main');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'moye');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Control+f');
  const dialog = page.getByRole('dialog', { name: 'Site search' });
  await dialog.waitFor();
  await dialog.getByRole('link', { name: fixture.title, exact: true }).waitFor();
  await dialog.getByRole('searchbox').fill('zzzzz');
  await dialog.getByText('No matching posts.', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#site-search-dialog').open);
  failIndex = true;
  await page.goto(base + '/search');
  await page.getByRole('alert').waitFor();
  assert(!/[\u3400-\u9fff]/.test(await page.getByRole('alert').innerText()));
  failIndex = false;
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await page.getByRole('link', { name: fixture.title, exact: true }).waitFor();
  console.log('[language-ui] PASS query/hash retained, localized search/empty/error/retry, original results unchanged');

  await page.goto(base + '/toolbox/format');
  await page.waitForFunction(() => document.querySelector('#format-source')?.closest('astro-island')?.hasAttribute('ssr') === false);
  await page.locator('#format-source').fill('{"original":"未发布","list":[1,2]}');
  await page.getByRole('button', { name: 'Format', exact: true }).click();
  await page.locator('.tool-path-list li').first().waitFor();
  assert((await page.locator('#format-output').inputValue()).includes('未发布'));
  const previews = await page.locator('.tool-path-list').innerText();
  assert(previews.includes('未发布') && previews.includes('Object') && previews.includes('Array'));
  await page.goto(base + '/toolbox/time');
  await page.waitForFunction(() => document.querySelector('#timestamp')?.closest('astro-island')?.hasAttribute('ssr') === false);
  await page.locator('#timestamp').fill('1792627200');
  await page.getByRole('button', { name: 'Convert to date', exact: true }).click();
  assert(!/[\u3400-\u9fff]/.test(await page.locator('.tool-status').innerText()));
  assert(!/[\u3400-\u9fff]/.test(await page.locator('.tool-result-list').innerText()));
  await page.locator('.tool-result-list button').first().click();
  assert(!/[\u3400-\u9fff]/.test(await page.locator('.tool-result-list').innerText()));
  console.log('[language-ui] PASS tools localize labels/metadata/copy feedback without translating input/output');

  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const view of ['overview', 'posts', 'archives', 'moderation', 'settings']) {
      await page.goto(base + '/admin?view=' + view);
      await page.waitForFunction(() => !document.querySelector('.admin-empty[role="status"], [aria-busy="true"]'));
      await layout('admin/' + width + '/' + view);
      assert(!/[\u3400-\u9fff]/.test(await page.locator('.admin-page-header').innerText()));
      if (view === 'overview') {
        assert.equal(await page.locator('#manuscript-title').innerText(), fixture.title);
        assert(!/[\u3400-\u9fff]/.test(await page.locator('.admin-census-list').innerText()));
      }
      if (view === 'moderation') {
        assert.equal(await page.locator('.admin-moderation-body').innerText(), '未发布');
        assert(!/[\u3400-\u9fff]/.test(await page.locator('.admin-status').first().innerText()));
      }
      if (view === 'settings') assert.equal(await page.locator('[id="profile.name"]').inputValue(), '原始站名');
      if (view === 'overview') await page.addStyleTag({ content: 'astro-dev-toolbar{display:none!important}' });
      if (view === 'overview') await page.screenshot({ path: join(evidence, `language-admin-en-${width}.png`), fullPage: true });
    }
  }
  await setLocale('invalid');
  await page.goto(base + '/about');
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  assert.deepEqual(errors, []);
  console.log('[language-ui] PASS five mocked admin views, original content preserved, invalid cookie fallback, no JS errors');
} finally { await browser.close(); }
