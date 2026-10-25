/** Browser integration: all API traffic is mocked, never writes real data. */
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
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const term = (id, name) => ({ id, name, slug: id, description: '', sortOrder: 0, parentId: null, postCount: 2, version: 0 });
const items = { categories: Array.from({ length: 22 }, (_, i) => term('cat-' + i, 'Category ' + i)), tags: [term('tag-0', 'Tag zero')] };
let failLoad = false;
let failSave = false;
let writes = 0;
await page.route('**/api/**', async route => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  let data;
  if (path === '/api/auth/me' && request.method() === 'GET') data = { user: { id: 'mock', role: 'admin', username: 'test', csrfToken: 'mock-csrf' } };
  else if (path.startsWith('/api/admin/taxonomy/')) {
    const [, , , , kind, id] = path.split('/');
    assert(kind === 'categories' || kind === 'tags');
    if (request.method() === 'GET') {
      if (failLoad) { await route.fulfill({ status: 503, json: { message: '模拟加载失败' } }); return; }
      data = { items: items[kind] };
    } else {
      assert.equal(request.headers()['x-csrf-token'], 'mock-csrf');
      writes++;
      if (failSave) { await route.fulfill({ status: 503, json: { message: '模拟保存失败' } }); return; }
      const body = request.postDataJSON();
      if (request.method() === 'POST') {
        const value = { ...term('new-' + writes, body.name), ...body };
        value.slug ||= 'generated-slug'; items[kind].unshift(value); data = { id: value.id };
      } else {
        const index = items[kind].findIndex(item => item.id === id);
        assert(index >= 0); assert.equal(body.version, items[kind][index].version);
        if (request.method() === 'PUT') items[kind][index] = { ...items[kind][index], ...body.value, version: body.version + 1 };
        else { assert.equal(request.method(), 'DELETE'); items[kind].splice(index, 1); }
        data = { id };
      }
    }
  } else { errors.push('Unexpected API: ' + path); await route.abort(); return; }
  await route.fulfill({ json: { code: 'OK', message: 'ok', data } });
});
const button = name => page.getByRole('button', { name, exact: true });
const save = () => button('保存分类或标签');
async function loaded() { await button('新增分类').waitFor(); await page.waitForFunction(() => !document.querySelector('.admin-empty[role="status"]')); }
async function saved() { await page.getByRole('status').filter({ hasText: '已保存分类或标签' }).waitFor(); await loaded(); }
try {
  await page.goto(base + '/admin?view=taxonomy'); await loaded();
  assert.equal(await page.locator('.admin-taxonomy-list li').count(), 20);
  await button('下一页').click(); assert.equal(await page.locator('.admin-taxonomy-list li').count(), 2);
  await page.getByRole('searchbox').fill('Category 21'); assert.equal(await page.locator('.admin-taxonomy-list li').count(), 1);
  await page.getByRole('searchbox').fill('');
  await button('新增分类').click();
  await page.locator('#taxonomy-name').fill('新分类');
  await page.locator('#taxonomy-description').fill('分类介绍');
  await page.locator('#taxonomy-order').fill('-2');
  page.once('dialog', dialog => dialog.dismiss()); await button('标签').click();
  assert.equal(await page.locator('#taxonomy-name').inputValue(), '新分类');
  page.once('dialog', dialog => dialog.dismiss()); await button('工作台').click();
  assert(page.url().includes('view=taxonomy'));
  failSave = true; await save().click();
  await page.getByRole('alert').filter({ hasText: '模拟保存失败' }).waitFor();
  assert.equal(await page.locator('#taxonomy-name').inputValue(), '新分类');
  failSave = false; await save().click(); await saved();
  assert.equal(items.categories[0].description, '分类介绍'); assert.equal(items.categories[0].sortOrder, -2);
  assert.equal(items.categories[0].slug, 'generated-slug');
  await button('编辑 新分类').click(); await page.locator('#taxonomy-name').fill('改名分类');
  await save().click(); await saved();
  const before = writes;
  page.once('dialog', dialog => dialog.dismiss()); await button('删除 改名分类').click(); assert.equal(writes, before);
  page.once('dialog', dialog => { assert(dialog.message().includes('不会删除文章')); return dialog.accept(); });
  await button('删除 改名分类').click();
  await page.getByRole('status').filter({ hasText: '已删除分类或标签' }).waitFor(); await loaded();
  assert(!items.categories.some(item => item.name === '改名分类'));
  await button('标签').click(); await button('新增标签').click();
  assert.equal(await page.locator('#taxonomy-description').count(), 0);
  await page.locator('#taxonomy-name').fill('新标签'); await save().click();
  await page.getByRole('status').filter({ hasText: '已保存分类或标签' }).waitFor();
  await button('编辑 新标签').click(); await page.locator('#taxonomy-name').fill('改名标签'); await save().click();
  await button('删除 改名标签').waitFor(); page.once('dialog', dialog => dialog.accept()); await button('删除 改名标签').click();
  await page.getByRole('status').filter({ hasText: '已删除分类或标签' }).waitFor();
  failLoad = true; await button('分类').click();
  await page.getByRole('alert').filter({ hasText: '模拟加载失败' }).waitFor(); assert(await button('新增分类').isDisabled());
  failLoad = false; await button('刷新列表').click(); await loaded();
  await button('新增分类').click(); await page.locator('#taxonomy-name').fill('很长的分类名称用于验证移动端编辑区域');
  const evidence = join(homedir(), '.agents/evidence/personal-blog'); await mkdir(evidence, { recursive: true });
  for (const theme of ['dianqing', 'moye']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), theme + '/' + width + ': overflow');
      if (width === 390 || width === 1440) await page.screenshot({ path: join(evidence, `taxonomy-${theme}-${width}-20261025.png`), fullPage: true });
    }
  }
  await context.addCookies([{ name: 'blog-locale', value: 'en', url: base }]);
  page.once('dialog', dialog => dialog.accept()); await page.reload();
  await page.getByRole('heading', { name: 'Categories & tags', exact: true }).waitFor();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'English overflow/' + width);
  }
  assert.deepEqual(errors, []);
  console.log('[taxonomy-ui] PASS category/tag CRUD, pagination/search, failed save retains draft, delete confirmation/cancel, unsaved tab/navigation guard, load retry, dual themes, English and 320–1440px; no real database writes.');
} finally { await browser.close(); }
