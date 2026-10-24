import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const base = process.env.UI_TEST_BASE || 'http://127.0.0.1:4321';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local server only');
const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { channel: process.argv[3] } : {}) });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let requests = 0;
let failIndex = false;
await page.route('**/api/search-index', route => {
  requests++;
  return route.fulfill({ status: failIndex ? 503 : 200, json: { data: { items: [
    { id: '1', title: 'Astro 搜索笔记', slug: 'astro-search', summary: '在花园中寻找文章', publishedAt: '2026-10-24', wordCount: 1200, tags: ['键盘'], categories: ['开发'] },
    { id: '2', title: '阅读日记', slug: 'reading', summary: '周末读书', publishedAt: '2026-10-23', wordCount: 300, tags: ['书单'], categories: ['生活'] }
  ] } } });
});
const dialog = page.getByRole('dialog', { name: '站内搜索' });
const input = dialog.getByRole('searchbox');
const isOpen = () => page.locator('#site-search-dialog').evaluate(el => el.open);
const assertFocused = async () => assert(await input.evaluate(el => el === document.activeElement));
const open = async (shortcut = 'Control+f') => {
  await page.keyboard.press(shortcut);
  await dialog.waitFor();
  await input.waitFor();
  await assertFocused();
  await dialog.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => undefined))));
};

try {
  await page.goto(base + '/search');
  await page.locator('#garden-search').waitFor();
  // 独立搜索页仍可使用；弹窗必须使用不同的 input id。
  await page.locator('#garden-search').fill('书单');
  await page.getByRole('link', { name: '阅读日记', exact: true }).waitFor();
  const baseline = requests;
  await page.goto(base + '/about');
  await page.waitForFunction(() => !!document.querySelector('[data-open-search]'));
  // 等待页面脚本初始化，但未呼出弹窗不应请求索引。
  await page.waitForLoadState('networkidle');
  assert.equal(requests, baseline);
  const trigger = page.locator('[data-open-search]');
  await trigger.focus();
  await open();
  await dialog.getByRole('link', { name: '阅读日记', exact: true }).waitFor();
  assert.equal(requests, baseline + 1);
  assert.equal(await page.evaluate(() => document.documentElement.style.overflow), 'hidden');
  await input.fill('astro 键盘');
  await dialog.getByRole('link', { name: 'Astro 搜索笔记', exact: true }).waitFor();
  assert.equal(await dialog.getByRole('link', { name: '阅读日记', exact: true }).count(), 0);
  await input.fill('不存在的关键词');
  await dialog.getByText('没有匹配的文章。', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: '清空', exact: true }).click();
  await input.fill('开发');
  await page.keyboard.press('Control+f');
  await assertFocused();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    assert(await dialog.evaluate(el => el.contains(document.activeElement)));
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#site-search-dialog').open);
  assert.equal(await isOpen(), false);
  await page.waitForFunction(() => document.activeElement?.matches('[data-open-search]'));
  await page.waitForFunction(() => document.documentElement.style.overflow === '');
  await trigger.click();
  await input.waitFor();
  await assertFocused();
  assert.equal(await input.inputValue(), '开发');
  assert.equal(requests, baseline + 1);
  await dialog.getByRole('button', { name: '关闭搜索' }).click();
  await open('Meta+f');
  await page.mouse.click(1, 1);
  await page.waitForFunction(() => !document.querySelector('#site-search-dialog').open);
  assert.equal(await isOpen(), false);

  const evidence = join(homedir(), '.agents/evidence/personal-blog');
  await mkdir(evidence, { recursive: true });
  for (const theme of ['moye', 'dianqing']) {
    await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await open();
      await input.fill('');
      const box = await dialog.boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= width);
      assert(Math.abs(box.x + box.width / 2 - width / 2) < 2);
      assert(Math.abs(box.y + box.height / 2 - 450) < 2);
      assert(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await page.screenshot({ path: join(evidence, `search-${theme}-${width}-20261024.png`) });
      await page.keyboard.press('Escape');
    }
  }
  failIndex = true;
  await page.reload();
  await page.waitForLoadState('networkidle');
  await open();
  await dialog.getByRole('alert').waitFor();
  failIndex = false;
  await dialog.getByRole('button', { name: '重新加载' }).click();
  await dialog.getByRole('link', { name: '阅读日记', exact: true }).waitFor();
  assert.equal(await dialog.getByRole('link', { name: 'Astro 搜索笔记', exact: true }).getAttribute('href'), '/post/astro-search');
  assert.deepEqual(errors, []);
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const fallback = await noJs.newPage();
  await fallback.goto(base + '/about');
  await fallback.locator('[data-open-search]').click();
  assert.equal(new URL(fallback.url()).pathname, '/search');
  await noJs.close();
  console.log('[search-ui] PASS: shortcuts, lazy index, filtering, empty/retry, focus trap/restore, dismiss, themes, responsive centering, standalone page and no-JS fallback');
} finally {
  await browser.close();
}
