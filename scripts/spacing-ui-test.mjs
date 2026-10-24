import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const base = process.env.UI_TEST_BASE || 'http://127.0.0.1:4321';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local server only');
const evidence = join(homedir(), '.agents/evidence/personal-blog');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { channel: process.argv[3] } : {}) });
const errors = [];
const surfaces = [
  ['/toolbox', '.tool-entry', 20],
  ['/about', '.about-profile', 24],
  ['/categories', '.category-entry', 20],
  ['/tags', '.topic-field', 20]
];
const otherRoutes = ['/', '/post', '/archive', '/guestbook', '/social', '/search', '/toolbox/format', '/toolbox/diff', '/admin/login'];
async function checkLayout(page, label) {
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  assert(dimensions.content <= dimensions.width + 1, `${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
}
try {
  for (const locale of ['zh-CN', 'en']) {
    for (const theme of ['dianqing', 'moye']) {
      const context = await browser.newContext();
      await context.addCookies([{ name: 'blog-locale', value: locale, url: base }]);
      await context.addInitScript(value => localStorage.setItem('blog-theme', value), theme);
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const [route, selector, minimum] of surfaces) {
          const label = `${locale}/${theme}/${width}${route}`;
          const response = await page.goto(base + route);
          assert.equal(response.status(), 200, label);
          assert.equal(await page.locator('html').getAttribute('lang'), locale, label);
          await checkLayout(page, label);
          const cards = await page.locator(selector).evaluateAll(elements => elements.map(element => {
            const style = window.getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight), top: parseFloat(style.paddingTop), bottom: parseFloat(style.paddingBottom), radius: parseFloat(style.borderTopLeftRadius), contentWidth: box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) };
          }));
          assert(cards.length > 0, `${label}: missing cards`);
          for (const card of cards) {
            assert(card.left >= minimum && card.right >= minimum, `${label}: insufficient horizontal inset ${JSON.stringify(card)}`);
            assert(card.top >= minimum && card.bottom >= minimum, `${label}: insufficient vertical inset ${JSON.stringify(card)}`);
            assert(card.radius >= 12, `${label}: rounded surface lost`);
            assert(card.contentWidth > 100, `${label}: content area too narrow`);
          }
          if (selector === '.tool-entry' || selector === '.category-entry') {
            assert(cards.every(card => Math.abs(card.left - cards[0].left) < 1), `${label}: odd/even card insets diverged`);
          }
          if ([320, 1440].includes(width) && theme === 'dianqing') {
            await page.screenshot({ path: join(evidence, `spacing-${new URL(base).port}-${locale}-${width}-${route.slice(1)}.png`), fullPage: true });
          }
        }
        if ([320, 1440].includes(width)) {
          for (const route of otherRoutes) {
            const response = await page.goto(base + route);
            assert.equal(response.status(), 200, route);
            await checkLayout(page, `${locale}/${theme}/${width}${route}`);
          }
          // A local fixture avoids increasing real article view counters.
          await page.goto(base);
          await page.evaluate(() => {
            document.querySelector('#main').innerHTML = '<article class="reading-sheet mx-auto max-w-3xl"><header><h1>Layout fixture</h1></header><div class="prose-editorial"><p>Read-only spacing fixture.</p></div></article>';
          });
          const inset = await page.locator('.reading-sheet').evaluate(element => parseFloat(window.getComputedStyle(element).paddingLeft));
          assert(inset >= 20, 'Article fixture must retain its inset');
          await checkLayout(page, 'article fixture');
        }
      }
      console.log(`[spacing-ui] PASS ${locale}/${theme}: 5 widths, card insets, 13 routes and read-only article fixture`);
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log('[spacing-ui] PASS no JavaScript errors; no real articles visited or data modified');
} finally { await browser.close(); }
