/** Local-only visual/motion regression. Admin API fixtures never write real data.
 * node scripts/ui-motion-test.mjs [path-to-playwright-module] [browser-channel]
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const base = process.env.UI_TEST_BASE || 'http://127.0.0.1:4321';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Only a local server is allowed');
const evidence = join(homedir(), '.agents', 'evidence', 'personal-blog');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { channel: process.argv[3] } : {}) });
const errors = [];
const results = [];
const routes = ['/categories', '/tags', '/archive', '/toolbox', '/post', '/guestbook', '/about', '/search', '/admin/login'];
const record = (name) => { results.push(name); console.log('[ui-motion] PASS ' + name); };

async function assertLayout(page, name) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), name + ': horizontal overflow');
  await page.locator('h1').first().waitFor({ state: 'visible' });
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  for (const theme of ['dianqing', 'moye']) {
    await context.addInitScript((id) => localStorage.setItem('blog-theme', id), theme);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const route of routes) {
        const response = await page.goto(base + route);
        assert.equal(response.status(), 200, route + ': SSR failed');
        await assertLayout(page, theme + ' ' + width + ' ' + route);
        if (width === 1440 && ['/categories', '/tags', '/toolbox', '/admin/login'].includes(route)) {
          await page.waitForTimeout(1000);
          await page.addStyleTag({ content: 'astro-dev-toolbar { display: none !important; }' });
          await page.screenshot({ path: join(evidence, 'ui-' + route.replaceAll('/', '-') + '-' + theme + '-20261021.png'), fullPage: true });
        }
      }
      record(theme + ' / ' + width + 'px: 9 routes render without overflow');
    }
  }

  await page.goto(base + '/categories');
  await page.waitForFunction(() => document.querySelector('main').getAnimations({ subtree: true }).some((animation) => animation.effect?.getKeyframes().some((frame) => frame.translate)), undefined, { timeout: 2000 });
  record('Normal-motion page entries create real Web Animations');
  const entry = page.locator('.category-entry').first();
  await entry.focus();
  assert.equal(await entry.evaluate((element) => element === document.activeElement), true);
  assert.notEqual(await entry.evaluate((element) => window.getComputedStyle(element).outlineStyle), 'none');
  const href = await entry.getAttribute('href');
  await page.keyboard.press('Enter');
  await page.waitForURL(base + href);
  record('Category keyboard focus and Enter navigation preserve filters');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const route of ['/categories', '/tags', '/archive', '/toolbox', '/admin/login']) {
    await page.goto(base + route);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('main').evaluate((element) => element.getAnimations({ subtree: true }).length), 0, route + ': reduced motion still animates');
  }
  record('Reduced-motion renders all upgraded pages without animations');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(base + '/categories');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('main').evaluate((element) => element.getAnimations({ subtree: true }).length), 0);
  assert.equal(await entry.evaluate((element) => window.getComputedStyle(element).opacity), '1');
  record('Runtime reduced-motion change cancels active animations and leaves content visible');

  const staticContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const staticPage = await staticContext.newPage();
  for (const route of ['/categories', '/tags', '/archive', '/toolbox', '/post']) {
    await staticPage.goto(base + route);
    await assertLayout(staticPage, 'No JS ' + route);
    assert(await staticPage.locator('main a').first().isVisible());
  }
  await staticContext.close();
  record('Without JavaScript, public content and navigation remain visible');

  // Mock reads only. No login, save, moderation or database changes are performed.
  await page.route('**/api/**', async (route) => {
    assert.equal(route.request().method(), 'GET', 'Visual tests must never write');
    const url = new URL(route.request().url());
    const user = { id: 'visual-fixture', username: 'Kale', displayName: 'Kale', role: 'admin', csrfToken: 'fixture-only' };
    const stats = { publishedPosts: 15, draftPosts: 8, comments: 24, guestbook: 6, pendingComments: 3, pendingGuestbook: 5 };
    const data = url.pathname === '/api/auth/me' ? { user } : url.pathname === '/api/admin/stats' ? stats : { items: [] };
    await route.fulfill({ json: { code: 'OK', message: 'ok', data } });
  });
  for (const theme of ['dianqing', 'moye']) {
    await context.addInitScript((id) => localStorage.setItem('blog-theme', id), theme);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(base + '/admin');
      await page.locator('#manuscript-title').waitFor();
      await assertLayout(page, 'Admin ' + theme + ' ' + width);
      assert.equal(await page.locator('.admin-metric-value').count(), 4);
      if (width === 1440 || width === 390) {
        await page.addStyleTag({ content: 'astro-dev-toolbar { display: none !important; }' });
        await page.screenshot({ path: join(evidence, 'ui-admin-' + theme + '-' + width + '-20261021.png'), fullPage: true });
      }
      await page.getByRole('button', { name: '站点设置', exact: true }).click();
      await page.getByRole('heading', { name: '站点设置', exact: true }).waitFor();
      await page.getByRole('button', { name: '工作台', exact: true }).click();
      await page.locator('#manuscript-title').waitFor();
      assert.deepEqual(await page.locator('.admin-shell').evaluate((element) => element.getAnimations({ subtree: true }).map((animation) => ({ target: animation.effect?.target?.className, frames: animation.effect?.getKeyframes() }))), []);
    }
  }
  record('Admin dual themes / 320–1440px / view changes / reduced-motion (mocked read-only data)');
  assert.deepEqual(errors, [], 'Browser errors');
  await writeFile(join(evidence, 'ui-motion-verification-20261021.json'), JSON.stringify({ results, errors, adminData: 'mocked read-only fixtures' }, null, 2));
  console.log('[ui-motion] All assertions passed. Evidence: ' + evidence);
} finally {
  await browser.close();
}
