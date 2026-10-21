/** Run against local Astro: node scripts/admin-ui-test.mjs [path-to-playwright-module].
 * API writes are intercepted: these tests never modify a real database.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const BASE = process.env.ADMIN_TEST_BASE || 'http://127.0.0.1:4321';
assert(['127.0.0.1', 'localhost'].includes(new URL(BASE).hostname), 'UI test only accepts a local server');
// Probe the real server before installing mocks: SSR/import errors must fail this suite.
for (const path of ['/admin', '/admin/editor', '/admin/login']) {
  const response = await fetch(BASE + path);
  assert.equal(response.status, 200, `Real preview failed: ${path}`);
  const html = await response.text();
  assert(html.includes('博客后台') && !html.includes('The file does not exist at'), `SSR error: ${path}`);
}
const authResponse = await fetch(`${BASE}/api/auth/me`);
assert.equal(authResponse.status, 200, 'Real auth route must load without optimizer errors');
assert.equal((await authResponse.json()).data.authenticated, false);
const protectedResponse = await fetch(`${BASE}/api/admin/stats`);
assert.equal(protectedResponse.status, 401, 'Real admin route must reject anonymous requests');
console.log('[admin-ui] PASS 真实预览页面、认证及权限接口（只读，无请求拦截）');

const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { channel: process.argv[3] } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const ok = (data) => ({ code: 'OK', message: 'ok', data });
const user = { id: 'ui-test-admin', username: 'Kale', displayName: 'Kale', avatarUrl: '', role: 'admin', csrfToken: 'ui-test-token' };
const category = { id: 'cat-tech', name: '技术笔记', slug: 'tech', description: '', parentId: '', sortOrder: 0 };
const posts = Array.from({ length: 23 }, (_, index) => ({ id: `post-${index}`, title: index === 0 ? '一篇特别的技术笔记' : `花园记录 ${index + 1}`, slug: `garden-${index}`, summary: '记录技术和生活', content: '## 写作\n这里是文章正文。', coverImage: '', status: index % 3 ? 'published' : 'draft', authorId: user.id, authorName: 'Kale', authorAvatar: '', viewCount: index * 21, wordCount: 300 + index, commentCount: 0, publishedAt: '2026-10-14 08:00:00', createdAt: '2026-10-14 08:00:00', updatedAt: '2026-10-14 08:00:00', categories: index % 2 ? [] : [category], tags: [] }));
const queue = Array.from({ length: 12 }, (_, index) => ({ id: `interaction-${index}`, type: index % 2 ? 'comment' : 'guestbook', title: index % 2 ? posts[0].title : '留言板', content: '这篇记录对我很有帮助，期待更多分享。', userName: `读者 ${index + 1}`, createdAt: '2026-10-14 08:00:00', status: index < 8 ? 'pending' : 'approved' }));
let settings = { 'profile.name': 'Kale的数字花园', 'profile.motto': '慢慢生长。', 'profile.bio': '记录技术、阅读和生活。', 'profile.avatar': '', 'site.announcement': '', 'site.icp': '', 'site.started_at': '2026-10-01', 'site.about': '# 关于我', 'site.social_links': '[]' };
let failPosts = false;
let failSave = false;
let uploadCount = 0;
let createCount = 0;
let partialModeration = false;
let writtenPost = null;
let writtenSettings = null;
const log = (message) => console.log(`[admin-ui] PASS ${message}`);

// Exercise real hydration/auth redirect before mocking authenticated admin data.
await page.goto(`${BASE}/admin`);
await page.waitForURL('**/admin/login');
await page.getByRole('heading', { name: '博客后台登录' }).waitFor();
assert.deepEqual(errors, []);
log('真实浏览器预览正常渲染，未登录访问后台跳转登录页');

await context.route('**/api/**', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  let data;
  if (path === '/api/auth/me') data = { user };
  else if (path === '/api/admin/stats') data = { publishedPosts: 15, draftPosts: 8, comments: 18, pendingComments: 4, pendingGuestbook: 4, guestbook: 12 };
  else if (path === '/api/admin/taxonomy') data = { categories: [category], tags: [{ id: 'tag-one', name: '随笔' }] };
  else if (path === '/api/admin/posts' && request.method() === 'GET') {
    if (failPosts) return route.fulfill({ status: 500, json: { code: 'FAILED', message: '测试加载失败', data: null } });
    const search = url.searchParams.get('search') || '';
    const status = url.searchParams.get('status') || 'all';
    const categoryId = url.searchParams.get('categoryId') || '';
    const matches = posts.filter((post) => (!search || (post.title + post.summary + post.slug).includes(search)) && (status === 'all' || post.status === status) && (!categoryId || post.categories.some((item) => item.id === categoryId)));
    const current = Number(url.searchParams.get('page') || 1);
    const size = Number(url.searchParams.get('pageSize') || 10);
    data = { items: matches.slice((current - 1) * size, current * size), total: matches.length, page: current, pageSize: size, totalPages: Math.max(1, Math.ceil(matches.length / size)) };
  } else if (path === '/api/admin/posts' || path.startsWith('/api/admin/posts/')) {
    if (request.method() === 'GET') data = posts.find((post) => path.endsWith(`/${post.id}`));
    else {
      if (failSave) return route.fulfill({ status: 422, json: { code: 'FAILED', message: '测试保存失败', data: null } });
      assert.equal(request.headers()['x-csrf-token'], user.csrfToken);
      writtenPost = request.postDataJSON();
      if (request.method() === 'POST') { createCount++; data = { ...posts[0], ...writtenPost, id: 'post-0' }; }
      else data = { ...posts[0], ...writtenPost };
    }
  } else if (path === '/api/admin/comments') {
    if (request.method() === 'PATCH') {
      const input = request.postDataJSON();
      if (partialModeration && input.id === 'interaction-1') return route.fulfill({ status: 500, json: { code: 'FAILED', message: '单条审核失败', data: null } });
      const item = queue.find((entry) => entry.id === input.id && entry.type === input.type);
      if (item) item.status = input.status;
      data = { updated: true };
    } else {
      const status = url.searchParams.get('status');
      const items = queue.filter((item) => status === 'all' || item.status === status);
      data = { items, total: items.length };
    }
  } else if (path === '/api/admin/settings') {
    if (request.method() === 'PUT') { writtenSettings = request.postDataJSON(); settings = writtenSettings; }
    data = { settings };
  } else if (path === '/api/admin/uploads') {
    assert.equal(request.headers()['x-csrf-token'], user.csrfToken);
    uploadCount++;
    data = { url: '/avatar.svg', key: 'mock-upload' };
  } else return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: path, data: null } });
  await route.fulfill({ status: 200, json: ok(data) });
});

try {
  await page.goto(`${BASE}/admin`);
  await page.getByRole('heading', { name: '最近编辑' }).waitFor();
  assert.equal(await page.locator('.admin-census-row').count(), 4);
  log('工作台统计与最近编辑');
  const evidence = join(homedir(), '.agents', 'evidence', 'personal-blog');
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, 'admin-dashboard-20261014.png'), fullPage: true });
  await page.getByRole('button', { name: '文章管理', exact: true }).click();
  await page.locator('.admin-table tbody tr').first().waitFor();
  assert.equal(await page.locator('.admin-table tbody tr').count(), 10);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByText('2 / 3', { exact: true }).waitFor();
  await page.getByLabel('搜索文章').fill('特别');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByText('共 1 篇文章', { exact: true }).waitFor();
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await page.getByLabel('文章状态', { exact: true }).selectOption('draft');
  await page.getByText('共 8 篇文章', { exact: true }).waitFor();
  await page.getByLabel('文章分类', { exact: true }).selectOption('cat-tech');
  await page.getByText('共 4 篇文章', { exact: true }).waitFor();
  log('文章分页、搜索、组合筛选与重置');
  failPosts = true;
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '测试加载失败' }).waitFor();
  failPosts = false;
  await page.getByRole('button', { name: '重新加载' }).click();
  await page.locator('.admin-table tbody tr').first().waitFor();
  log('加载失败与重试，不会卡在加载状态');
  await page.getByRole('button', { name: '互动审核', exact: true }).click();
  await page.getByLabel('选择本页').check();
  partialModeration = true;
  await page.getByRole('button', { name: '批量通过' }).click();
  await page.getByText('已处理 7 条，1 条失败：单条审核失败', { exact: true }).waitFor();
  await page.getByLabel('审核状态').selectOption('approved');
  await page.getByLabel('互动类型').selectOption('guestbook');
  await page.getByText('当前列表 6 条', { exact: true }).waitFor();
  log('审核批处理、部分失败报告及状态/类型筛选');
  await page.getByRole('button', { name: '站点设置', exact: true }).click();
  await page.getByLabel('站点名称', { exact: true }).fill('新的花园名字');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '工作台', exact: true }).click();
  assert.equal(await page.getByLabel('站点名称').inputValue(), '新的花园名字');
  await page.getByRole('button', { name: '添加链接' }).click();
  await page.getByLabel('链接 1 名称').fill('GitHub');
  await page.getByLabel('链接 1 地址').fill('https://github.com/example');
  await page.getByRole('button', { name: '保存设置' }).click();
  await page.getByText('站点设置已保存，前台刷新后生效').waitFor();
  assert.equal(JSON.parse(writtenSettings['site.social_links'])[0].label, 'GitHub');
  assert.equal(writtenSettings['profile.name'], '新的花园名字');
  log('站点设置、社交链接编辑与未保存导航拦截');
  await page.goto(`${BASE}/admin/editor`);
  await page.getByLabel('文章标题', { exact: true }).fill('临时修改');
  await page.waitForFunction(() => !!localStorage.getItem('admin-draft:ui-test-admin:new'));
  await page.getByLabel('文章标题', { exact: true }).fill('');
  await page.waitForFunction(() => localStorage.getItem('admin-draft:ui-test-admin:new') === null);
  log('内容改回服务端原样后清理旧备份，不误报未保存修改');
  await page.getByLabel('文章标题', { exact: true }).fill('本机备份测试');
  await page.getByLabel('Markdown 正文').fill('# 标题\n正文内容\n<script>window.evil=true</script>\n[危险](javascript:alert(1))');
  await page.waitForFunction(() => !!localStorage.getItem('admin-draft:ui-test-admin:new'));
  assert.equal(await page.locator('.admin-editor-preview script').count(), 0);
  assert.equal(await page.locator('.admin-editor-preview a[href^="javascript:"]').count(), 0);
  assert.equal(createCount, 0);
  log('自动本机备份不创建文章，预览拒绝脚本和危险链接');
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: '恢复备份' }).click();
  assert.equal(await page.getByLabel('文章标题').inputValue(), '本机备份测试');
  assert.equal(createCount, 0);
  log('刷新后手动恢复备份，不自动覆盖服务端');
  await page.getByRole('button', { name: '插入粗体' }).click();
  assert((await page.getByLabel('Markdown 正文').inputValue()).includes('**'));
  await page.getByRole('button', { name: '分栏', exact: true }).click();
  assert.equal(await page.locator('.admin-editor-content').getAttribute('data-mode'), 'split');
  await page.locator('input[type="file"]').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await page.getByText('图片已插入正文', { exact: true }).waitFor();
  assert((await page.getByLabel('Markdown 正文').inputValue()).includes('![图片](/avatar.svg)'));
  assert.equal(uploadCount, 1);
  log('Markdown 工具栏、分栏预览与图片上传插入');
  failSave = true;
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByText('测试保存失败', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '保存草稿', exact: true }).isEnabled(), true);
  failSave = false;
  await page.keyboard.press('Control+s');
  await page.waitForURL('**/admin/editor?id=post-0');
  assert.equal(createCount, 1);
  assert.equal(writtenPost.status, 'draft');
  assert.equal(await page.evaluate(() => localStorage.getItem('admin-draft:ui-test-admin:new')), null);
  log('保存失败后可重试，快捷键保存成功且清除本地备份');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('文章标题').waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: join(evidence, 'admin-editor-mobile-20261014.png'), fullPage: true });
  await page.goto(`${BASE}/admin?view=posts`);
  await page.locator('.admin-table tbody tr').first().waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  log('390px 移动端编辑器与文章表格无页面横向溢出');
  assert.deepEqual(errors, []);
  console.log('[admin-ui] All assertions passed; screenshot data uses mocked fixtures.');
} finally { await browser.close(); }
