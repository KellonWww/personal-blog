/** Read-only local admin UI regression. No real authentication or writes. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const base = process.env.UI_TEST_BASE || 'http://127.0.0.1:4321';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local server only');
const evidence = join(homedir(), '.agents/evidence/personal-blog');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { channel: process.argv[3] } : {}) });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
const results = [];
const requests = [];
page.on('pageerror', error => errors.push(error.message));
const record = message => { results.push(message); console.log('[admin-ui] PASS ' + message); };
let scenario = 'populated';
let statsFailures = 0;
const posts = ['把零散的念头，整理成自己的数字花园', '一个人的博客，为什么还值得认真维护', '阅读笔记：把问题留在纸上', '周末的散步与没有目的的观察', '写给下一次打开编辑器的自己'].map((title, index) => ({
  id: 'post-' + index, title, slug: 'note-' + index,
  summary: '记录那些还没有想清楚的事情。在一次次修改中，给思考留下一条可以回来的路。',
  status: index % 2 ? 'published' : 'draft', wordCount: 1240 + index * 120,
  viewCount: 87, categories: [], tags: [], updatedAt: '2026-10-20T10:00:00Z',
  createdAt: '2026-10-18T10:00:00Z', publishedAt: null, coverImage: '',
  authorId: 'fixture', authorName: 'Kale', authorAvatar: '', commentCount: 2
}));
const stats = { publishedPosts: 15, draftPosts: 8, comments: 24, guestbook: 6, pendingComments: 3, pendingGuestbook: 5 };
await page.route('**/api/**', async route => {
  const request = route.request();
  requests.push({ method: request.method(), url: request.url() });
  if (request.method() !== 'GET') { errors.push('Unexpected write: ' + request.method()); await route.abort(); return; }
  const url = new URL(request.url());
  let data;
  if (url.pathname === '/api/auth/me') data = { user: { id: 'fixture', username: 'Kale', displayName: 'Kale', role: 'admin', csrfToken: 'fixture-only' } };
  else if (url.pathname === '/api/admin/stats') {
    if (statsFailures > 0) { statsFailures--; await route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: '暂时无法读取统计，请重试' } }); return; }
    data = scenario === 'empty' ? Object.fromEntries(Object.keys(stats).map(key => [key, 0])) : stats;
  } else if (url.pathname === '/api/admin/posts') {
    let items = scenario === 'empty' ? [] : scenario === 'long' ? [{ ...posts[0], title: '很长的文章标题'.repeat(30), summary: 'unbroken'.repeat(90) }] : posts;
    if (url.searchParams.get('search')) items = items.filter(post => post.title.includes(url.searchParams.get('search')));
    data = { items, total: items.length, totalPages: 1, page: 1, pageSize: 10 };
  } else if (url.pathname === '/api/admin/comments') data = { items: scenario === 'empty' ? [] : [
    { id: 'comment-1', type: 'comment', userName: '林间来信', title: posts[0].title, content: '很喜欢把博客当作长期笔记的想法。也想听听你整理旧文章的方法。', status: 'pending', createdAt: posts[0].updatedAt },
    { id: 'message-1', type: 'guestbook', userName: '路过的读者', title: '', content: '来坐一会儿，等下一篇更新。', status: 'pending', createdAt: posts[0].updatedAt }
  ] };
  else if (url.pathname === '/api/admin/posts/post-0') data = { ...posts[0], content: '# 写作笔记\n\n一份只读的视觉测试正文。' };
  else if (url.pathname === '/api/admin/taxonomy') data = { categories: [], tags: [] };
  else if (url.pathname === '/api/admin/settings') data = { settings: { 'site.name': 'Kale的数字花园', 'site.social_links': '[]' } };
  else if (url.pathname === '/api/admin/archives') data = { items: [], total: 0, totalPages: 1, page: 1, pageSize: 20 };
  else if (url.pathname === '/api/admin/archive-sources' || url.pathname === '/api/admin/archive-taxonomy') data = { items: [] };
  else { errors.push('Unmocked API: ' + url.pathname); await route.abort(); return; }
  await route.fulfill({ json: { code: 'OK', message: 'ok', data } });
});
async function layout(label) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), label + ': horizontal overflow');
  assert(await page.locator('.admin-page-header h1').isVisible(), label + ': title missing');
  assert.equal(await page.getByRole('navigation', { name: '后台导航' }).locator('[aria-current="page"]').count(), 1);
}
const views = [['工作台', 'overview'], ['文章管理', 'posts'], ['私人档案', 'archives'], ['互动审核', 'moderation'], ['站点设置', 'settings']];
try {
  for (const theme of ['dianqing', 'moye']) {
    await context.addInitScript(id => localStorage.setItem('blog-theme', id), theme);
    for (const width of [320, 390, 768, 1100, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(base + '/admin');
      await page.locator('#manuscript-title').waitFor();
      assert.equal(await page.locator('#manuscript-title').textContent(), posts[0].title);
      assert.deepEqual(await page.locator('.admin-metric-value').allTextContents(), ['15', '8', '8', '30']);
      assert.equal(await page.locator('.admin-continue').getAttribute('href'), '/admin/editor?id=post-0');
      assert.equal(await page.locator('.admin-recent-row').count(), 5);
      for (const [label, view] of views) {
        await page.getByRole('navigation', { name: '后台导航' }).getByRole('button', { name: label, exact: true }).click();
        await page.getByRole('heading', { name: label, exact: true }).waitFor();
        await page.waitForFunction(() => !document.querySelector('.admin-empty[role="status"], [aria-busy="true"]'));
        await layout(theme + '/' + width + '/' + view);
        assert.equal(await page.getByRole('alert').count(), 0);
        if ((width === 1440 || width === 390) && (view === 'overview' || view === 'posts' || view === 'settings')) {
          await page.addStyleTag({ content: 'astro-dev-toolbar{display:none!important}' });
          await page.screenshot({ path: join(evidence, `admin-${view}-${theme}-${width}-20261021.png`), fullPage: true });
        }
      }
      record(theme + '/' + width + ': five views, no overflow, active navigation and populated data');
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base + '/admin?view=posts');
  await page.getByRole('checkbox', { name: '选择当前页全部文章' }).check();
  assert.equal(await page.locator('tr[data-selected="true"]').count(), 5);
  await page.getByRole('checkbox', { name: '选择当前页全部文章' }).uncheck();
  const search = page.getByRole('search').getByRole('textbox');
  await search.fill('周末');
  await search.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.admin-table tbody tr').length === 1);
  assert(await page.getByRole('link', { name: posts[3].title, exact: true }).isVisible());
  record('Article selection and search preserve behavior without writes');
  await page.getByRole('button', { name: '工作台', exact: true }).click();
  await page.locator('#manuscript-title').waitFor();
  await page.getByRole('button', { name: '管理全部文章', exact: true }).click();
  assert(new URL(page.url()).searchParams.get('view') === 'posts');
  await page.goBack();
  await page.locator('#manuscript-title').waitFor();
  await page.getByRole('button', { name: /查看待办/ }).click();
  assert(new URL(page.url()).searchParams.get('view') === 'moderation');
  record('Overview shortcuts and browser back preserve navigation');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(base + '/admin/editor?id=post-0');
    await page.locator('.admin-editor-textarea').waitFor();
    await layout('editor/' + width);
    assert.equal(await page.locator('.admin-editor-title').inputValue(), posts[0].title);
    await page.addStyleTag({ content: 'astro-dev-toolbar{display:none!important}' });
    await page.screenshot({ path: join(evidence, `admin-editor-${width}-20261021.png`), fullPage: true });
  }
  record('Article editor inherits the shell and remains usable on desktop and mobile');
  await page.goto(base + '/admin?view=settings');
  await page.getByRole('textbox').first().fill('修改但不保存');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '工作台', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get('view'), 'settings');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '工作台', exact: true }).click();
  await page.locator('#manuscript-title').waitFor();
  record('Unsaved settings still guard navigation; cancel and confirm both work');
  await page.goto(base + '/admin');
  await page.locator('#manuscript-title').waitFor();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'admin-skip-link');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'admin-content');
  record('Keyboard skip link targets the main workspace');
  scenario = 'empty';
  await page.goto(base + '/admin');
  await page.getByRole('heading', { name: '还没有文章，写下第一篇。' }).waitFor();
  assert.equal(await page.locator('.admin-continue').getAttribute('href'), '/admin/editor');
  assert(await page.getByText('待办已清空。', { exact: true }).isVisible());
  record('Empty state has a real writing action and accurate moderation copy');
  scenario = 'long';
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.goto(base + '/admin');
  await page.locator('#manuscript-title').waitFor();
  await layout('320px long content');
  record('Long titles and unbroken summaries do not overflow');
  scenario = 'populated';
  statsFailures = 1;
  await page.goto(base + '/admin');
  await page.getByRole('alert').waitFor();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.locator('#manuscript-title').waitFor();
  record('Failed overview loads recover through retry');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.locator('#manuscript-title').waitFor();
  await page.locator('.admin-continue').hover();
  assert.equal(await page.locator('.admin-shell').evaluate(el => el.getAnimations({ subtree: true }).length), 0);
  assert.equal(await page.locator('.admin-continue > svg').evaluate(el => window.getComputedStyle(el).transform), 'none');
  record('Reduced motion disables entries and hover movement');
  assert.deepEqual(errors, []);
  assert(requests.every(request => request.method === 'GET'));
  await writeFile(join(evidence, 'admin-ui-verification-20261021.json'), JSON.stringify({ results, errors, fixture: 'Read-only mocked data; no real login or writes', requests: requests.length }, null, 2));
  console.log('[admin-ui] All assertions passed. Evidence: ' + evidence);
} finally {
  await browser.close();
}