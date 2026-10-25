/** Local browser regression: all API traffic is mocked; no real database writes. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const base = process.env.UI_TEST_BASE || 'http://127.0.0.1:4321';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { channel: process.argv[3] } : {}) });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let settings = { 'site.social_links': '[]', 'site.friends': JSON.stringify([{ name: 'Old friend', url: 'https://example.com', desc: 'Existing description' }]) };
let writes = 0;
let failSave = false;
await page.route('**/api/**', async (route) => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  let data;
  if (path === '/api/auth/me' && request.method() === 'GET') data = { user: { id: 'mock', role: 'admin', username: 'test', csrfToken: 'mock-csrf' } };
  else if (path === '/api/admin/settings' && request.method() === 'GET') data = { settings };
  else if (path === '/api/admin/settings' && request.method() === 'PUT') {
    writes++;
    assert.equal(request.headers()['x-csrf-token'], 'mock-csrf');
    if (failSave) { await route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: '模拟保存失败' } }); return; }
    settings = { ...settings, ...request.postDataJSON() };
    data = { settings };
  } else { errors.push('Unexpected API request: ' + path); await route.abort(); return; }
  await route.fulfill({ json: { code: 'OK', message: 'ok', data } });
});
const save = () => page.getByRole('button', { name: '保存设置', exact: true });
const friends = () => page.locator('.admin-friend-card');
async function open() {
  await page.goto(base + '/admin?view=settings');
  await page.getByRole('heading', { name: '站点设置', exact: true }).waitFor();
  if (settings['site.friends'] !== '{invalid') await page.getByRole('button', { name: '＋ 添加友链', exact: true }).waitFor();
}
async function saved() { await page.getByRole('status').filter({ hasText: '站点设置已保存' }).waitFor(); }
try {
  await open();
  assert.equal(await page.locator('#friend-name-0').inputValue(), 'Old friend');
  await page.getByRole('button', { name: '＋ 添加友链', exact: true }).click();
  await page.locator('#friend-name-1').fill('New friend');
  await page.locator('#friend-url-1').fill('https://example.org');
  await page.locator('#friend-desc-1').fill('New description');
  await page.getByRole('button', { name: '上移友链 2', exact: true }).click();
  assert.equal(await page.locator('#friend-name-0').inputValue(), 'New friend');
  await save().click(); await saved();
  assert.equal(JSON.parse(settings['site.friends'])[0].desc, 'New description');
  await open();
  assert.equal(await friends().count(), 2);
  assert.equal(await page.locator('#friend-name-0').inputValue(), 'New friend');
  await page.getByRole('button', { name: '下移友链 1', exact: true }).click();
  assert.equal(await page.locator('#friend-name-0').inputValue(), 'Old friend');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '工作台', exact: true }).click();
  assert(page.url().includes('view=settings'), 'unsaved navigation must be cancellable');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '移除友链 1', exact: true }).click();
  assert.equal(await friends().count(), 2);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '移除友链 1', exact: true }).click();
  await save().click(); await saved();
  assert.equal(JSON.parse(settings['site.friends']).length, 1);
  await page.locator('#friend-url-0').fill('javascript:alert(1)');
  const beforeInvalid = writes;
  await save().click();
  await page.getByRole('alert').filter({ hasText: '友链最多' }).waitFor();
  assert.equal(writes, beforeInvalid, 'unsafe URL must not reach API');
  await page.locator('#friend-url-0').fill('https://example.net');
  failSave = true;
  await save().click();
  await page.getByRole('alert').filter({ hasText: '模拟保存失败' }).waitFor();
  assert.equal(await page.locator('#friend-url-0').inputValue(), 'https://example.net');
  assert(await save().isEnabled(), 'failed save must preserve dirty draft');
  failSave = false;
  await save().click(); await saved();
  for (const theme of ['dianqing', 'moye']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `overflow at ${width} ${theme}`);
    }
  }
  const evidence = join(homedir(), '.agents/evidence/personal-blog');
  await mkdir(evidence, { recursive: true });
  await page.locator('[aria-labelledby="friend-links-heading"]').screenshot({ path: join(evidence, 'friends-settings-20261025.png') });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '移除友链 1', exact: true }).click();
  await save().click(); await saved();
  assert.equal(settings['site.friends'], '[]');
  await open();
  await page.getByText('还没有友链，添加一位朋友吧。', { exact: true }).waitFor();
  settings['site.friends'] = '{invalid';
  await open();
  await page.getByRole('alert').filter({ hasText: '友链最多' }).waitFor();
  assert.equal(await page.locator('form.admin-panel').count(), 0, 'malformed existing data must block destructive overwrite');
  assert.deepEqual(errors, []);
  console.log('[friends-ui] PASS existing data, add/edit/reorder/save/reload, remove/cancel, unsafe URLs, failed save, unsaved guard, 320–1440px, both themes, empty and malformed settings; no real database writes.');
} finally { await browser.close(); }
