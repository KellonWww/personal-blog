import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const base = process.env.UI_TEST_BASE || 'http://127.0.0.1:4321';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local server only');
const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { channel: process.argv[3] } : {}) });
const evidence = join(homedir(), '.agents/evidence/personal-blog');
await mkdir(evidence, { recursive: true });
const errors = [];
try {
  for (const locale of ['zh-CN', 'en']) {
    for (const theme of ['dianqing', 'moye']) {
      const context = await browser.newContext();
      await context.addCookies([{ name: 'blog-locale', value: locale, url: base }]);
      await context.addInitScript(value => localStorage.setItem('blog-theme', value), theme);
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.route('**/api/search-index', route => route.fulfill({ json: { data: { items: [
        { id: '1', title: 'Alpha fixture', slug: 'fixture-alpha', summary: 'Read-only fixture', publishedAt: '2026-10-24', wordCount: 100, tags: [], categories: [] },
        { id: '2', title: 'Beta fixture', slug: 'fixture-beta', summary: 'Read-only fixture', publishedAt: '2026-10-23', wordCount: 200, tags: [], categories: [] }
      ] } } }));
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const route of ['/', '/about', '/post', '/archive', '/categories', '/tags', '/search']) {
          const label = `${locale}/${theme}/${width}${route}`;
          const response = await page.goto(base + route);
          assert.equal(response.status(), 200, label);
          assert.equal(await page.locator('html').getAttribute('lang'), locale, label);
          assert.equal(await page.locator('.folio-colophon dl, .notes-all .tabular-nums, .about-ledger, .page-heading-line > span, .category-entry-title > span, .topic-count, .timeline-comments, .timeline-year-label > span').count(), 0, `${label}: decorative totals remain`);
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${label}: horizontal overflow`);
          if (route === '/post') {
            const cards = page.locator('.article-row');
            assert(await cards.count() > 0, `${label}: missing articles`);
            assert(await cards.first().locator('time').count() > 0, `${label}: date lost`);
            assert(!/\d+\s*(阅读|评论|views|comments)/i.test(await cards.first().innerText()), `${label}: popularity stats remain`);
          }
          if (route === '/search') {
            const status = page.locator('.search-status');
            const expected = locale === 'en' ? 'Showing the latest articles' : '默认展示最新文章';
            await page.waitForFunction(text => document.querySelector('.search-status')?.textContent === text, expected);
            await page.locator('#garden-search').fill('Alpha');
            await page.getByRole('link', { name: 'Alpha fixture' }).waitFor();
            assert.equal(await page.getByRole('link', { name: 'Beta fixture' }).count(), 0);
            assert.match(await status.innerText(), /1/);
            await page.locator('#garden-search').fill('');
            await page.waitForFunction(text => document.querySelector('.search-status')?.textContent === text, expected);
          }
          if (locale === 'zh-CN' && theme === 'dianqing' && ['/', '/about', '/archive'].includes(route)) {
            await page.screenshot({ path: join(evidence, `editorial-${new URL(base).port}-${width}-${route.slice(1) || 'home'}.png`), fullPage: true });
          }
        }
      }
      await context.close();
    }
  }
  // Source-only check avoids incrementing real article view counters.
  const detail = await readFile(new URL('../src/pages/post/[slug].astro', import.meta.url), 'utf8');
  const header = detail.slice(detail.indexOf('<header'), detail.indexOf('</header>'));
  assert(!header.includes('post.viewCount') && !header.includes('post.commentCount'), 'Article header still includes popularity totals');
  assert(header.includes('readingTime') && header.includes('<time'), 'Article reading guidance lost');
  assert.deepEqual(errors, []);
  console.log('Editorial UI passed: public totals removed; bilingual themes, responsive layout, dates and search feedback preserved.');
} finally {
  await browser.close();
}
