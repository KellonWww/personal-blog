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
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(15000);
const results = [];
const routes = ['/', '/post', '/archive', '/categories', '/tags', '/guestbook', '/about', '/social', '/search', '/toolbox', '/toolbox/format', '/toolbox/diff', '/admin/login'];
async function layout(label) {
  const overflow = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  assert(overflow.content <= overflow.viewport + 1, `${label}: horizontal overflow ${JSON.stringify(overflow)}`);
}
function luminance(color) {
  const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); }
try {
  for (const theme of ['dianqing', 'moye']) {
    await page.goto(base);
    await page.evaluate(value => localStorage.setItem('blog-theme', value), theme);
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const route of routes) {
        const response = await page.goto(base + route);
        assert.equal(response.status(), 200, route);
        await page.locator('main, .login-layout').first().waitFor({ state: 'attached' }).catch(async () => {
          assert(route === '/admin/login');
          await page.locator('form').waitFor();
        });
        await page.addStyleTag({ content: 'astro-dev-toolbar { display:none!important; }' });
        await layout(theme + '/' + width + route);
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        const firstHeading = page.locator('main h1');
        if (route !== '/admin/login') assert.equal(await firstHeading.count(), 1, route + ' must have one page heading');
        if ([320, 1440].includes(width) && ['/', '/categories', '/about', '/toolbox', '/admin/login'].includes(route)) {
          await page.screenshot({ path: join(evidence, `studio-${theme}-${width}-${route.replaceAll('/', '-') || 'home'}-20261024.png`), fullPage: true });
        }
      }
      results.push(theme + '/' + width + ': 13 routes, no horizontal overflow, theme and heading intact');
    }
    await page.goto(base);
    await page.waitForFunction(() => document.querySelector('[data-garden]')?.dataset.motionState);
    const palette = await page.evaluate(() => {
      const sample = document.createElement('span'); document.body.append(sample);
      const colors = {};
      for (const token of ['ink', 'muted', 'surface', 'paper', 'accent', 'accent-ink', 'accent-soft', 'secondary', 'secondary-ink', 'secondary-text', 'secondary-soft', 'specimen-surface', 'specimen-ink']) { sample.style.color = `var(--${token})`; colors[token] = window.getComputedStyle(sample).color; }
      sample.remove(); return colors;
    });
    for (const text of ['ink', 'muted']) for (const surface of ['surface', 'paper']) assert(contrast(palette[text], palette[surface]) >= 4.5, `${theme}: ${text}/${surface} contrast`);
    assert(contrast(palette.accent, palette['accent-ink']) >= 4.5);
    assert(contrast(palette.secondary, palette['secondary-ink']) >= 4.5, theme + ': warm panel text');
    assert(contrast(palette['specimen-surface'], palette['specimen-ink']) >= 4.5, theme + ': specimen caption');
    for (const surface of ['surface', 'paper', 'secondary-soft']) assert(contrast(palette['secondary-text'], palette[surface]) >= 4.5, theme + ': warm text/' + surface);
    for (const surface of ['accent-soft', 'secondary-soft']) for (const text of ['ink', 'muted']) assert(contrast(palette[text], palette[surface]) >= 4.5, theme + ': tinted surface ' + text + '/' + surface);
    const cards = page.locator('.path-card');
    assert.notEqual(await cards.nth(0).evaluate(el => window.getComputedStyle(el).backgroundColor), await cards.nth(1).evaluate(el => window.getComputedStyle(el).backgroundColor), theme + ': contrasting entry colors');
    assert(await page.locator('.app-header').evaluate(el => window.getComputedStyle(el).backdropFilter.includes('blur')));
    await page.evaluate(() => window.scrollTo(0, 850));
    assert((await page.locator('.app-header').boundingBox()).y <= 13);
    await page.screenshot({ path: join(evidence, `studio-glass-nav-${theme}-20261024.png`) });
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Control+f');
    await page.getByRole('dialog', { name: '站内搜索' }).waitFor();
    await page.getByRole('dialog').getByRole('searchbox').waitFor();
    await page.screenshot({ path: join(evidence, `studio-glass-search-${theme}-20261024.png`) });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#site-search-dialog').open);
    results.push(theme + ': AA color tokens, glass navigation stays sticky, search opens and dismisses');
  }
  await page.goto(base);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('[data-garden]')?.dataset.motionState === 'static');
  assert.equal(await page.locator('.botanical-study').evaluate(el => window.getComputedStyle(el).transform), 'none');
  // 用只读 HTML 样本验证文章版式，避免访问真实文章路由累加阅读数。
  await page.evaluate(() => {
    document.querySelector('#main').innerHTML = '<article class="reading-sheet mx-auto max-w-3xl"><header><h1>阅读样本：让文字有舒适的留白</h1><p>此内容仅用于本地视觉核验，不加载或修改真实文章。</p></header><div class="prose-editorial"><h2>写下所学，留下所想</h2><p>代码应该清晰，阅读也应该如此。这是文章正文样本，验证中文段落、标题与代码块在同一视觉体系中保持适当的行距和对比度。</p><pre><code>const garden = { notes: [], growing: true };</code></pre><blockquote>给下一次思考，留一个可以回来的地方。</blockquote></div></article>';
  });
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await layout('read-only article fixture/' + width);
    await page.screenshot({ path: join(evidence, `studio-reading-fixture-${width}-20261024.png`), fullPage: true });
  }
  results.push('Reduced motion and read-only article fixture pass; no real article views incremented');
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'studio-verification-20261024.json'), JSON.stringify({ results, errors }, null, 2));
  console.log('[studio-ui] PASS ' + results.join('\n[studio-ui] PASS '));
} finally { await browser.close(); }
