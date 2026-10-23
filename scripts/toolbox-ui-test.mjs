/** Local-only toolbox regression. No login or database writes.
 * node scripts/toolbox-ui-test.mjs [playwright-module-path] [browser-channel]
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const base = process.env.UI_TEST_BASE || 'http://127.0.0.1:4321';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Only a local server is allowed');
const evidence = join(homedir(), '.agents', 'evidence', 'personal-blog', 'toolbox-20261022');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { channel: process.argv[3] } : {}) });
const errors = [];
const results = [];
const record = (message) => { results.push(message); console.log('[toolbox-ui] PASS ' + message); };
const secret = 'private-toolbox-fixture-do-not-upload';
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__toolboxClipboard = text; } } });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    assert(!request.url().includes(secret) && !(request.postData() || '').includes(secret), 'Input leaked into a network request');
    assert(['GET', 'HEAD'].includes(request.method()), 'Toolbox must never send writes');
  });
  async function open(tool) {
    await page.goto(base + '/toolbox/' + tool);
    await page.locator('astro-island[component-url*="/toolbox/"]:not([ssr])').waitFor();
  }
  async function formatAction(name) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.locator('.tool-workspace[aria-busy="false"]').waitFor();
  }
  await page.goto(base + '/toolbox');
  for (const name of ['文本格式化', '时间转换', '文本 Diff', '编解码工作台', '文本处理', '正则测试器']) { const link = page.getByRole('link', { name: '打开' + name, exact: true }); await link.scrollIntoViewIfNeeded(); await link.waitFor({ state: 'visible' }); }
  assert.equal(await page.locator('main a[href^="/admin"]').count(), 0);
  record('Index links expose tools without a public admin editor shortcut');
  await open('json');
  assert(new URL(page.url()).pathname === '/toolbox/format', 'Old JSON route must redirect to the formatter');
  await page.getByLabel('JSON 输入').fill('{"name":"' + secret + '","a.b":[1,true]}');
  await formatAction('格式化');
  assert((await page.locator('#format-output').inputValue()).includes('\n  "name"'));
  await page.getByRole('button', { name: '复制结果', exact: true }).click();
  assert((await page.evaluate(() => window.__toolboxClipboard)).includes(secret));
  await page.getByLabel('筛选字段路径').fill('[1]');
  assert.equal(await page.locator('.tool-path-list li').count(), 1);
  await page.getByRole('button', { name: '复制路径', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__toolboxClipboard), '$["a.b"][1]');
  assert.equal(await page.locator('.tool-transform-actions button').count(), 3);
  const sourceBox = await page.locator('#format-source').boundingBox();
  const actionBox = await page.locator('.tool-transform-actions').boundingBox();
  const outputBox = await page.locator('#format-output').boundingBox();
  assert(sourceBox.x + sourceBox.width <= actionBox.x && actionBox.x + actionBox.width <= outputBox.x);
  await formatAction('压缩');
  assert(!(await page.locator('#format-output').inputValue()).includes('\n'));
  await page.getByLabel('JSON 输入').fill('{"bad":}');
  await formatAction('校验');
  assert((await page.getByRole('alert').textContent()).includes('语法错误'));
  await page.getByLabel('JSON 输入').fill('9007199254740993');
  await formatAction('格式化');
  assert((await page.getByRole('alert').textContent()).includes('安全精度'));
  await page.getByLabel('JSON 输入').fill('null');
  await formatAction('校验');
  assert.equal(await page.locator('#format-output').inputValue(), 'null');
  await page.evaluate(() => { window.navigator.clipboard.writeText = async () => { throw new Error('Denied'); }; });
  await page.getByRole('button', { name: '复制结果', exact: true }).click();
  assert(await page.getByText('复制失败，请手动选择复制', { exact: true }).isVisible());
  record('JSON format/minify/validate/path copy, unsafe integers and clipboard failure');

  await open('format');
  const formatSource = page.locator('#format-source'); const formatOutput = page.locator('#format-output');
  for (const language of ['json', 'sql', 'html', 'css', 'javascript', 'typescript', 'markdown', 'yaml']) {
    await page.getByLabel('文本类型', { exact: true }).selectOption(language);
    assert.equal(await formatOutput.inputValue(), '');
    await page.getByRole('button', { name: '填入示例', exact: true }).click();
    await formatAction('格式化');
    assert.equal(await page.getByRole('alert').count(), 0, `${language} must format successfully`);
    const first = await formatOutput.inputValue(); assert(first.length > 0, `${language}: empty result`);
    if (language !== 'json') { assert.equal(await page.getByRole('button', { name: '压缩', exact: true }).count(), 0); assert.equal(await page.locator('.tool-paths').count(), 0); }
    await page.getByRole('button', { name: '结果作为输入', exact: true }).click();
    assert.equal(await formatSource.inputValue(), first); await formatAction('格式化');
    assert.equal(await formatOutput.inputValue(), first, `${language} must be idempotent`);
    await page.getByRole('button', { name: '复制结果', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__toolboxClipboard), first);
  }
  await page.getByLabel('文本类型', { exact: true }).selectOption('json');
  await page.getByLabel('缩进', { exact: true }).selectOption('4'); await formatSource.fill('{"nested":{"ok":true}}');
  await formatAction('格式化'); assert((await formatOutput.inputValue()).includes('\n    "nested"'));
  await page.getByLabel('缩进', { exact: true }).selectOption('2'); assert.equal(await formatOutput.inputValue(), '');
  await page.getByLabel('文本类型', { exact: true }).selectOption('sql');
  for (const [dialect, sql] of [
    ['sql', "select id,'a  b' as note from posts where id=42; -- keep comment"],
    ['mysql', "select `title`,'a  b' as note from `posts` where id=?;"],
    ['postgresql', "select payload->>'name' from posts where id=$1;"],
    ['sqlite', 'select name from posts where id=?;'], ['transactsql', 'select top 3 [title] from [posts];']
  ]) {
    await page.getByLabel('SQL 方言', { exact: true }).selectOption(dialect); await formatSource.fill(sql); await formatAction('格式化');
    assert.equal(await page.getByRole('alert').count(), 0, `${dialect} formatting failed`);
    assert((await formatOutput.inputValue()).includes('SELECT'));
    if (sql.includes('a  b')) assert((await formatOutput.inputValue()).includes("'a  b'"));
    if (sql.includes('keep comment')) assert((await formatOutput.inputValue()).includes('-- keep comment'));
    if (dialect === 'postgresql') assert((await formatOutput.inputValue()).includes('$1'));
  }
  await page.getByLabel('文本类型', { exact: true }).selectOption('javascript');
  await formatSource.fill('window.__formatterExecuted = true;'); await formatAction('格式化');
  assert.equal(await page.evaluate(() => window.__formatterExecuted), undefined);
  await formatSource.fill('const = ;'); await formatAction('格式化'); assert(await page.getByRole('alert').isVisible());
  assert.equal(await formatOutput.inputValue(), '');
  await page.getByLabel('文本类型', { exact: true }).selectOption('html');
  await formatSource.fill('<img src="x" onerror="window.__formatterExecuted=true"><script>window.__formatterExecuted=true</script>');
  await formatAction('格式化'); assert.equal(await page.locator('.tool-workspace img, .tool-workspace script').count(), 0);
  assert.equal(await page.evaluate(() => window.__formatterExecuted), undefined);
  await formatSource.fill('x'.repeat(200001)); await formatAction('格式化'); assert((await page.getByRole('alert').textContent()).includes('200,000'));
  await formatSource.fill(''); await formatAction('格式化'); assert((await page.getByRole('alert').textContent()).includes('请先输入'));
  // Delay the worker asset to exercise cancellation and stale-response invalidation deterministically.
  await page.route('**/src/workers/format.worker.ts*', async (route) => { await new Promise((resolve) => setTimeout(resolve, 500)); await route.continue(); });
  await page.getByRole('button', { name: '填入示例', exact: true }).click();
  await page.getByRole('button', { name: '格式化', exact: true }).click(); await page.getByRole('button', { name: '取消', exact: true }).click();
  assert(await page.getByText('已取消处理。', { exact: true }).isVisible());
  await page.getByRole('button', { name: '格式化', exact: true }).click(); await formatSource.fill('<p>新输入</p>');
  await page.waitForTimeout(700); assert.equal(await formatOutput.inputValue(), '');
  await page.unroute('**/src/workers/format.worker.ts*'); await formatAction('格式化');
  assert((await formatOutput.inputValue()).includes('新输入'));
  record('Formatter: eight languages, five SQL dialects, indentation, JSON compatibility, copy, errors, cancellation and safe rendering');

  await open('time');
  await page.getByLabel('Unix 时间戳', { exact: true }).fill('0');
  await page.getByRole('button', { name: '转换为日期', exact: true }).click();
  assert(await page.getByText('1970-01-01 08:00:00.000', { exact: true }).isVisible());
  await page.getByLabel('时区', { exact: true }).selectOption('UTC');
  assert(await page.getByText('1970-01-01 00:00:00.000', { exact: true }).isVisible());
  await page.getByLabel('所选时区的日期与时间').fill('1970-01-01T00:00:00.001');
  await page.getByRole('button', { name: '转换为时间戳', exact: true }).click();
  await page.getByRole('button', { name: '复制Unix 毫秒', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__toolboxClipboard), '1');
  await page.getByRole('button', { name: '选择日期', exact: true }).click();
  const calendar = page.getByRole('dialog', { name: '选择日期与时间' });
  assert(await calendar.isVisible());
  await calendar.getByLabel('年份', { exact: true }).fill('2024');
  await calendar.getByLabel('月份', { exact: true }).selectOption('2');
  await calendar.getByRole('button', { name: '2024-02-29', exact: true }).click();
  await calendar.getByLabel('时间（时:分:秒.毫秒）').fill('12:34:56.789');
  await calendar.getByRole('button', { name: '确定日期', exact: true }).click();
  assert.equal(await page.locator('#datetime').inputValue(), '2024-02-29T12:34:56.789');
  await page.getByRole('button', { name: '转换为时间戳', exact: true }).click();
  assert(await page.getByText('2024-02-29T12:34:56.789Z', { exact: true }).isVisible());
  await page.getByRole('button', { name: '选择日期', exact: true }).click();
  await calendar.getByRole('button', { name: '下个月', exact: true }).click();
  await page.keyboard.press('Escape');
  assert(!(await calendar.isVisible()));
  assert.equal(await page.locator('#datetime').inputValue(), '2024-02-29T12:34:56.789');
  record('Themed calendar: leap day, milliseconds, month navigation and Escape without changing value');
  await page.getByLabel('时区', { exact: true }).selectOption('America/New_York');
  await page.getByLabel('所选时区的日期与时间').fill('2026-03-08T02:30');
  await page.getByRole('button', { name: '转换为时间戳', exact: true }).click();
  assert((await page.getByRole('alert').textContent()).includes('不存在'));
  await page.getByRole('button', { name: '填入当前时间', exact: true }).click();
  assert(Math.abs(Number(await page.getByLabel('Unix 时间戳', { exact: true }).inputValue()) - Date.now()) < 5000);
  record('Timestamp zero, milliseconds, selected zones, date parsing, DST and current time');
  await open('diff');
  await page.getByLabel('原始文本').fill('one\ntwo\n<script>' + secret + '</script>');
  await page.getByLabel('修改后文本').fill('one\nchanged\n<script>' + secret + '</script>');
  await page.getByRole('button', { name: '开始对比', exact: true }).click();
  assert.equal(await page.locator('.tool-diff-add').count(), 1);
  assert.equal(await page.locator('.tool-diff-remove').count(), 1);
  assert.equal(await page.locator('.tool-diff-result script').count(), 0);
  await page.getByRole('button', { name: '复制对比结果', exact: true }).click();
  assert((await page.evaluate(() => window.__toolboxClipboard)).includes('+ changed'));
  await page.getByRole('button', { name: '交换左右', exact: true }).click();
  assert((await page.getByLabel('原始文本').inputValue()).includes('changed'));
  await page.getByLabel('原始文本').fill(' a \n b');
  await page.getByLabel('修改后文本').fill('a\nb');
  await page.getByLabel('忽略所有空白字符').check();
  await page.getByRole('button', { name: '开始对比', exact: true }).click();
  assert.equal(await page.locator('.tool-diff-add, .tool-diff-remove').count(), 0);
  assert(await page.getByText('两侧文本在忽略空白后一致。', { exact: true }).isVisible());
  assert(!(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(window.sessionStorage))).includes(secret));
  record('Diff rows, copy, swap, ignore whitespace, safe text rendering and no input persistence/upload');
  await page.getByLabel('忽略所有空白字符').uncheck();
  await page.getByLabel('原始文本').fill('host: old; port: 3000\n相同文本 😀\n删除行');
  await page.getByLabel('修改后文本').fill('host: new; port: 4321\n相同文本 😀\n新增行');
  await page.getByRole('button', { name: '开始对比', exact: true }).click();
  const editors = page.locator('.tool-diff-editor');
  assert.equal(await editors.nth(0).locator('.tool-editor-line-remove').count(), 2);
  assert.equal(await editors.nth(1).locator('.tool-editor-line-add').count(), 2);
  assert.equal(await editors.nth(0).locator('.tool-editor-line').nth(1).locator('mark').count(), 0);
  assert.equal(await editors.nth(0).locator('mark').allTextContents().then((parts) => parts.join('')), 'old000删除');
  assert.equal(await editors.nth(1).locator('mark').allTextContents().then((parts) => parts.join('')), 'new421新增');
  const originalInput = await page.locator('#diff-before').boundingBox();
  const diffActions = await page.locator('.tool-diff-actions').boundingBox();
  const modifiedInput = await page.locator('#diff-after').boundingBox();
  assert(originalInput.x + originalInput.width <= diffActions.x && diffActions.x + diffActions.width <= modifiedInput.x);
  await page.getByLabel('原始文本').fill('已编辑');
  assert.equal(await page.locator('.tool-diff-highlight mark').count(), 0);
  await page.getByLabel('原始文本').fill('a 😀 b\n');
  await page.getByLabel('修改后文本').fill('a 😎 b');
  await page.getByRole('button', { name: '开始对比', exact: true }).click();
  assert.deepEqual(await editors.nth(0).locator('mark').allTextContents(), ['😀']);
  assert.deepEqual(await editors.nth(1).locator('mark').allTextContents(), ['😎']);
  assert.equal(await editors.nth(0).locator('.tool-editor-line-remove').count(), 2);
  await page.getByLabel('原始文本').fill(' \tkey = old');
  await page.getByLabel('修改后文本').fill('key=new');
  await page.getByLabel('忽略所有空白字符').check();
  await page.getByRole('button', { name: '开始对比', exact: true }).click();
  assert.deepEqual(await editors.nth(0).locator('mark').allTextContents(), ['old']);
  assert.deepEqual(await editors.nth(1).locator('mark').allTextContents(), ['new']);
  await page.getByLabel('忽略所有空白字符').uncheck();
  const longBefore = Array.from({ length: 80 }, (_, index) => `第 ${index} 行：` + '中文长行与 tab\t'.repeat(12)).join('\n');
  await page.getByLabel('原始文本').fill(longBefore);
  await page.getByLabel('修改后文本').fill(longBefore.replaceAll('长行', '修改'));
  await page.getByRole('button', { name: '开始对比', exact: true }).click();
  await page.locator('#diff-before').evaluate((element) => { element.scrollTop = 600; element.dispatchEvent(new window.Event('scroll')); });
  assert.equal(await editors.nth(0).locator('pre').evaluate((element) => element.scrollTop), await page.locator('#diff-before').evaluate((element) => element.scrollTop));
  await page.locator('#diff-before').evaluate((element) => { element.style.height = '500px'; });
  await page.waitForTimeout(100);
  assert.equal(await editors.nth(0).locator('pre').evaluate((element) => element.clientWidth), await page.locator('#diff-before').evaluate((element) => element.clientWidth));
  await page.getByRole('button', { name: '清空', exact: true }).click();
  assert.equal(await page.locator('.tool-diff-highlight mark').count(), 0);
  record('Editable inline Diff: centered actions, character highlights, emoji, whitespace, trailing newline, scroll/resize and invalidation');


  await open('codec');
  const codecSource = page.locator('#codec-source');
  const codecOutput = page.locator('#codec-output');
  for (const mode of ['base64', 'url', 'unicode']) {
    await page.locator('#codec-type').selectOption(mode);
    await codecSource.fill('你好，Kale 😀 +' + secret);
    await page.getByRole('button', { name: '编码', exact: true }).click();
    assert((await codecOutput.inputValue()).length > 0);
    await page.getByRole('button', { name: '复制结果', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__toolboxClipboard), await codecOutput.inputValue());
    await page.getByRole('button', { name: '结果作为输入', exact: true }).click();
    assert.equal(await codecOutput.inputValue(), '');
    await page.getByRole('button', { name: '解码', exact: true }).click();
    assert.equal(await codecOutput.inputValue(), '你好，Kale 😀 +' + secret);
  }
  for (const [mode, invalid] of [['base64', '%%%'], ['url', '%zz'], ['unicode', '\\uZZZZ']]) {
    await page.locator('#codec-type').selectOption(mode); await codecSource.fill(invalid);
    await page.getByRole('button', { name: '解码', exact: true }).click();
    assert(await page.getByRole('alert').isVisible());
  }
  await page.locator('#codec-type').selectOption('url'); await codecSource.fill('a+b');
  await page.getByRole('button', { name: '解码', exact: true }).click(); assert.equal(await codecOutput.inputValue(), 'a+b');
  await page.locator('#codec-type').selectOption('unicode'); await codecSource.fill('\\u{1F600}');
  await page.getByRole('button', { name: '解码', exact: true }).click(); assert.equal(await codecOutput.inputValue(), '😀');
  await codecSource.fill('x'.repeat(100001)); await page.getByRole('button', { name: '编码', exact: true }).click();
  assert((await page.getByRole('alert').textContent()).includes('100,000'));
  record('Codecs: Chinese/emoji roundtrip, chaining, copy, malformed input and size limits');

  await open('text');
  const textSource = page.locator('#text-source'); const textOutput = page.locator('#text-output');
  for (const [operation, input, expected] of [
    ['dedupe', 'a\na\nb', 'a\nb'], ['sort-asc', 'item10\nitem2', 'item2\nitem10'],
    ['sort-desc', 'item2\nitem10', 'item10\nitem2'], ['empty', 'a\n \n\nb', 'a\nb'],
    ['trim', ' a \n b ', 'a\nb'], ['upper', 'aB中文', 'AB中文'], ['lower', 'aB中文', 'ab中文'],
    ['wrap', 'a\nb', '[a]\n[b]']
  ]) {
    await page.locator('#text-operation').selectOption(operation); await textSource.fill(input);
    if (operation === 'wrap') { await page.getByLabel('每行前缀').fill('['); await page.getByLabel('每行后缀').fill(']'); }
    await page.getByRole('button', { name: '处理文本', exact: true }).click(); assert.equal(await textOutput.inputValue(), expected);
  }
  await page.getByRole('button', { name: '结果作为输入', exact: true }).click();
  assert.equal(await textSource.inputValue(), '[a]\n[b]'); assert.equal(await textOutput.inputValue(), '');
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await page.getByRole('button', { name: '处理文本', exact: true }).click(); assert.equal(await textOutput.inputValue(), '');
  record('Text: all eight operations, numeric ordering, chained transformations and empty input');

  await open('regex');
  const pattern = page.getByLabel('正则表达式（不带 / 分隔符）');
  const regexFlags = page.getByLabel('标志（g i m s u y）');
  const regexSource = page.getByLabel('测试文本', { exact: true });
  const replacement = page.getByLabel('替换模板', { exact: true });
  const run = () => page.getByRole('button', { name: '测试正则', exact: true }).click();
  await page.getByRole('button', { name: '填入示例', exact: true }).click(); await run();
  await page.getByText('找到 2 处匹配。', { exact: true }).waitFor();
  assert.equal(await page.locator('.tool-regex-preview mark').count(), 2);
  assert.equal(await page.getByLabel('替换预览').inputValue(), 'name: 42\nprice: 100\n中文与 emoji 😀');
  await page.locator('.tool-regex-details summary').click();
  assert((await page.locator('.tool-regex-details').textContent()).includes('$2: "42"'));
  await page.getByRole('button', { name: '复制替换结果', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__toolboxClipboard), await page.getByLabel('替换预览').inputValue());
  await pattern.fill('(?:)'); await regexFlags.fill('gu'); await regexSource.fill('😀'); await replacement.fill('-'); await run();
  await page.getByText('找到 2 处匹配。', { exact: true }).waitFor(); assert.equal(await page.getByLabel('替换预览').inputValue(), '-😀-');
  await pattern.fill('('); await run(); await page.getByRole('alert').waitFor();
  await pattern.fill('a'); await regexFlags.fill('gg'); await run(); await page.getByRole('alert').waitFor();
  await regexFlags.fill('g'); await regexSource.fill('<img src=x onerror="window.__xss=1">a' + secret); await run();
  await page.getByText('找到 3 处匹配。', { exact: true }).waitFor();
  assert.equal(await page.locator('.tool-regex-preview img').count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  await pattern.fill('(?:)'); await regexSource.fill('a'.repeat(600)); await run();
  await page.getByText('匹配超过 500 处，仅展示前 500 处；未生成替换结果。', { exact: true }).waitFor();
  assert(await page.getByRole('button', { name: '复制替换结果', exact: true }).isDisabled());
  await pattern.fill('(a+)+$'); await regexSource.fill('a'.repeat(100) + '!'); await run();
  await page.getByRole('alert').filter({ hasText: '执行超过 2 秒' }).waitFor({ timeout: 10000 });
  await run(); await page.getByRole('button', { name: '取消', exact: true }).click();
  assert((await page.getByRole('alert').textContent()).includes('已取消'));
  await run(); await regexSource.fill('a'); assert.equal(await page.locator('.tool-regex-preview mark').count(), 0);
  await pattern.fill('a'); await run(); await page.getByText('找到 1 处匹配。', { exact: true }).waitFor();

  await pattern.fill('(?<letter>a)(b)?'); await regexFlags.fill(''); await regexSource.fill('zaq');
  await replacement.fill("$$-$&-$1-$2-$12-$01-$0-$<letter>-$<missing>-$`-$'"); await run();
  await page.getByText('找到 1 处匹配。', { exact: true }).waitFor();
  const nativeReplacement = await page.evaluate(() => 'zaq'.replace(/(?<letter>a)(b)?/, "$$-$&-$1-$2-$12-$01-$0-$<letter>-$<missing>-$`-$'"));
  assert.equal(await page.getByLabel('替换预览').inputValue(), nativeReplacement);
  await pattern.fill('a'); await regexFlags.fill('g'); await regexSource.fill('a'.repeat(1000)); await replacement.fill("$'"); await run();
  await page.getByRole('alert').filter({ hasText: '200,000' }).waitFor();
  await regexSource.fill('x'.repeat(20001)); await run(); await page.getByRole('alert').filter({ hasText: '20,000' }).waitFor();

  record('Regex: worker matching, captures, replacement, Unicode/zero-width, escaping, limits, timeout, cancel and recovery');

  for (const theme of ['moye', 'dianqing']) {
    await page.addInitScript((value) => localStorage.setItem('blog-theme', value), theme);
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const tool of ['format', 'time', 'diff', 'codec', 'text', 'regex']) {
        await open(tool);
        if (tool === 'format') { await page.getByRole('button', { name: '填入示例', exact: true }).click(); await formatAction('格式化'); }
        if (['codec', 'text', 'regex'].includes(tool)) { await page.getByRole('button', { name: '填入示例', exact: true }).click(); await page.getByRole('button', { name: tool === 'codec' ? '编码' : tool === 'text' ? '处理文本' : '测试正则', exact: true }).click(); if (tool === 'regex') await page.getByText('找到 2 处匹配。', { exact: true }).waitFor(); }
        if (tool === 'time') await page.getByRole('button', { name: '填入当前时间', exact: true }).click();
        if (tool === 'diff') { await page.getByLabel('原始文本').fill('服务名称: garden\n端口: 3000'); await page.getByLabel('修改后文本').fill('服务名称: garden\n端口: 4321\n本地处理: true'); await page.getByRole('button', { name: '开始对比', exact: true }).click(); }
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${theme}/${width}/${tool}: horizontal overflow`);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.screenshot({ path: join(evidence, `${tool}-${theme}-${width}.png`), fullPage: true });
        if (tool === 'format') {
          await page.getByLabel('文本类型', { exact: true }).selectOption('sql');
          await page.getByRole('button', { name: '填入示例', exact: true }).click(); await formatAction('格式化');
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${theme}/${width}/SQL: horizontal overflow`);
          const inputBounds = await page.locator('#format-source').boundingBox();
          const actionsBounds = await page.locator('.tool-transform-actions').boundingBox();
          const resultBounds = await page.locator('#format-output').boundingBox();
          if (width >= 768) assert(inputBounds.x + inputBounds.width <= actionsBounds.x && actionsBounds.x + actionsBounds.width <= resultBounds.x);
          else assert(inputBounds.y + inputBounds.height <= actionsBounds.y && actionsBounds.y + actionsBounds.height <= resultBounds.y);
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
          await page.screenshot({ path: join(evidence, `format-sql-${theme}-${width}.png`), fullPage: true });
        }
        if (tool === 'time') {
          await page.getByRole('button', { name: '选择日期', exact: true }).click();
          const panel = page.getByRole('dialog', { name: '选择日期与时间' });
          const bounds = await panel.boundingBox();
          assert(bounds.x >= 0 && bounds.x + bounds.width <= width, 'Calendar must fit viewport');
          assert.equal(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth), true);
          assert.equal(await panel.evaluate((element) => window.getComputedStyle(element).backgroundColor === window.getComputedStyle(document.querySelector('#datetime')).backgroundColor), true);
          await page.screenshot({ path: join(evidence, `calendar-${theme}-${width}.png`), fullPage: true });
          await page.keyboard.press('Escape');
        }

      }
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open('json');
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.activeElement?.tagName !== 'BODY'));
  assert.equal(await page.locator('main').evaluate((element) => element.getAnimations({ subtree: true }).length), 0);
  record('Two themes × three widths × six tools: no overflow; keyboard and reduced motion');
  const staticContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 800 } });
  const staticPage = await staticContext.newPage();
  for (const tool of ['format', 'time', 'diff', 'codec', 'text', 'regex']) {
    await staticPage.goto(base + '/toolbox/' + tool);
    assert(await staticPage.getByText('此工具需要 JavaScript 才能在浏览器中处理内容，请启用后重试。输入不会上传。', { exact: true }).isVisible());
    assert(await staticPage.getByRole('link', { name: '← 返回工具箱', exact: true }).isVisible());
  }
  await staticContext.close();
  assert.deepEqual(errors, []);
  record('No-JS instructions, working navigation and no browser runtime errors');
} finally {
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await browser.close();
}
