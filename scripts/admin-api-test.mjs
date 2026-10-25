/** Local integration checks. Only login/logout and rejected validation requests use POST/PUT.
 * Does not create, update, delete or migrate blog content.
 */
import assert from 'node:assert/strict';
const BASE = process.env.ADMIN_TEST_BASE || 'http://localhost:4321';
assert(['127.0.0.1', 'localhost'].includes(new URL(BASE).hostname), 'Integration checks require a local server');
let count = 0;
const check = (condition, name) => { assert(condition, name); count++; console.log(`[admin-api] PASS ${name}`); };
const anon = await fetch(`${BASE}/api/admin/stats`);
check(anon.status === 401, '未登录后台接口拒绝访问');
const login = await fetch(`${BASE}/api/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: '{}' });
assert.equal(login.status, 200, 'Local development login must be enabled');
const payload = await login.json();
const user = payload.data.user;
assert.equal(user.role, 'admin');
const cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
const headers = { Cookie: cookie, Accept: 'application/json' };
const writeHeaders = { ...headers, 'Content-Type': 'application/json', 'X-CSRF-Token': user.csrfToken, Origin: BASE };
async function get(path) { const response = await fetch(BASE + path, { headers }); assert.equal(response.status, 200, path); return (await response.json()).data; }
try {
  const all = await get('/api/admin/posts?status=all&pageSize=2&order=updated');
  check(all.items.length <= 2 && all.totalPages === Math.max(1, Math.ceil(all.total / 2)), '真实数据分页数量与总页数一致');
  if (all.total > 2) {
    const next = await get('/api/admin/posts?status=all&pageSize=2&page=2&order=updated');
    check(!next.items.some((post) => all.items.some((first) => first.id === post.id)), '相邻分页无重复文章');
  }
  const empty = await get('/api/admin/posts?status=all&search=admin-test-nonexistent-7b913');
  check(empty.total === 0 && empty.items.length === 0, '搜索不存在关键词返回空列表');
  if (all.items.length) {
    const keyword = all.items[0].title;
    const searched = await get(`/api/admin/posts?status=all&search=${encodeURIComponent(keyword)}`);
    check(searched.total >= 1 && searched.items.every((post) => [post.title, post.summary, post.slug].some((value) => value.toLowerCase().includes(keyword.toLowerCase()))), '真实数据标题搜索准确');
    const category = all.items.find((post) => post.categories.length)?.categories[0];
    if (category) {
      const filtered = await get(`/api/admin/posts?status=all&categoryId=${encodeURIComponent(category.id)}`);
      check(filtered.total > 0 && filtered.items.every((post) => post.categories.some((item) => item.id === category.id)), '真实数据分类筛选准确');
    }
  }
  const drafts = await get('/api/admin/posts?status=draft');
  check(drafts.items.every((post) => post.status === 'draft'), '草稿筛选不泄露已发布文章');
  const stats = await get('/api/admin/stats');
  check(stats.publishedPosts + stats.draftPosts === all.total && Number.isInteger(stats.pendingGuestbook), '工作台总文章数一致且待审留言单独计数');
  const settings = await get('/api/admin/settings');
  check(settings.settings && typeof settings.settings === 'object', '已有设置可读取');
  for (const [body, name] of [
    [{ 'site.social_links': '[{"label":"bad","url":"javascript:alert(1)"}]' }, '危险社交链接被服务端拒绝'],
    [{ 'site.friends': '[{"name":"bad","url":"javascript:alert(1)"}]' }, '危险友链被服务端拒绝'],
    [{ 'site.friends': '[{"name":"","url":"https://example.com"}]' }, '空白友链名称被拒绝'],
    [{ 'site.friends': '{}' }, '非数组友链被拒绝'],
    [{ 'site.friends': JSON.stringify(Array(101).fill({ name: 'test', url: 'https://example.com' })) }, '超出友链数量上限被拒绝'],
    [{ 'site.started_at': '2026-02-30' }, '不存在的建站日期被拒绝'],
    [{ 'profile.name': 123 }, '错误设置字段类型被拒绝'],
    [{ 'profile.avatar': '//untrusted.example/a.png' }, '协议相对头像地址被拒绝']
  ]) {
    const response = await fetch(`${BASE}/api/admin/settings`, { method: 'PUT', headers: writeHeaders, body: JSON.stringify(body) });
    check(response.status === 422, name);
  }
  const noCsrf = await fetch(`${BASE}/api/admin/settings`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json', Origin: BASE }, body: '{}' });
  check(noCsrf.status === 403, '缺失 CSRF 拒绝写入');
  console.log(`[admin-api] ${count} checks passed; no blog content was modified.`);
} finally {
  const response = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: writeHeaders });
  assert.equal(response.status, 200);
}
