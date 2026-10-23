import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeJson, parseTimestamp, parseZonedDate, formatZonedDate, diffLines } from '../src/lib/toolbox.ts';

test('JSON: format, minify and preserve field order', () => {
  const result = analyzeJson('{"b":2,"a":[true,null,"花园"]}');
  assert.equal(result.compact, '{"b":2,"a":[true,null,"花园"]}');
  assert.equal(result.pretty, JSON.stringify(JSON.parse(result.compact), null, 2));
  assert(result.entries.some((entry) => entry.path === '$.a[2]' && entry.preview === '"花园"'));
});
test('JSON: special field names, empty root, scalar roots and prototype keys', () => {
  for (const source of ['null', 'false', '0', '""', '[]', '{}']) assert.equal(analyzeJson(source).compact, source);
  const key = 'q"x';
  const result = analyzeJson(JSON.stringify({ 'a.b': { [key]: 1 }, ['__proto__']: 2, '': 3 }));
  assert(result.entries.some((entry) => entry.path === `$["a.b"][${JSON.stringify(key)}]`));
  assert(result.entries.some((entry) => entry.path === '$[""]'));
  assert(result.entries.some((entry) => entry.path === '$.__proto__'));
});
test('JSON: invalid input, limits, unsafe numbers and non-finite numbers', () => {
  for (const source of ['', '   ', '{"x":}', '{"x":1,}', 'undefined', '1e999', '9007199254740993']) {
    assert.throws(() => analyzeJson(source));
  }
  assert.throws(() => analyzeJson(' '.repeat(200_001)), /200,000|输入/);
  assert.equal(analyzeJson('{"id":"9007199254740993"}').compact, '{"id":"9007199254740993"}');
});
test('JSON: bounded path preview retains the complete output', () => {
  const result = analyzeJson(JSON.stringify(Array.from({ length: 1_000 }, (_, i) => i)));
  assert.equal(result.entries.length, 300);
  assert.equal(result.truncated, true);
  assert.equal(JSON.parse(result.compact).length, 1_000);
});
test('Timestamps: seconds, milliseconds, auto, zero and negative fractions', () => {
  for (const [source, unit, expected] of [
    ['0', 'auto', 0], ['1792627200', 'auto', 1792627200000],
    ['1792627200123', 'auto', 1792627200123], ['1', 'milliseconds', 1],
    ['1.001', 'seconds', 1001], ['-0.001', 'seconds', -1], ['+1.2300', 'seconds', 1230],
    ['-100000000000', 'auto', -100000000000], ['8640000000000000', 'milliseconds', 8640000000000000]
  ]) assert.equal(parseTimestamp(source, unit).milliseconds, expected);
});
test('Timestamps: reject invalid strings, excessive precision and out-of-range values', () => {
  for (const source of ['', '1e3', 'NaN', 'Infinity', '1.1.1', '0xFF', '8640000000000001', '9'.repeat(100)]) {
    assert.throws(() => parseTimestamp(source, 'milliseconds'));
  }
  assert.throws(() => parseTimestamp('1.0001', 'seconds'), /精度/);
  assert.throws(() => parseTimestamp('1.1', 'milliseconds'), /精度/);
});
test('Dates: explicit zones, leap years, fractional milliseconds and years below 100', () => {
  assert.equal(parseZonedDate('1970-01-01T08:00', 'Asia/Shanghai'), 0);
  assert.equal(parseZonedDate('1970-01-01T00:00:00.001', 'UTC'), 1);
  assert.equal(parseZonedDate('2024-02-29T00:00', 'UTC'), Date.UTC(2024, 1, 29));
  assert.equal(formatZonedDate(parseZonedDate('0099-01-02T03:04:05.006', 'UTC'), 'UTC'), '0099-01-02 03:04:05.006');
  assert.equal(formatZonedDate(-1, 'UTC'), '1969-12-31 23:59:59.999');
  assert.equal(formatZonedDate(-62167219200000, 'UTC'), '0000-01-01 00:00:00.000');
  assert.equal(formatZonedDate(0, 'Asia/Shanghai'), '1970-01-01 08:00:00.000');
  for (const value of ['2026-02-29T00:00', '2026-04-31T00:00', '2026-13-01T00:00', '2026-01-01T24:00', '0000-01-01T00:00', 'bad']) {
    assert.throws(() => parseZonedDate(value, 'UTC'));
  }
});
test('Dates: reject DST gaps and ambiguity instead of silently selecting an instant', () => {
  assert.throws(() => parseZonedDate('2026-03-08T02:30', 'America/New_York'), /不存在/);
  assert.throws(() => parseZonedDate('2026-11-01T01:30', 'America/New_York'), /重复/);
  assert.equal(parseZonedDate('2026-07-01T12:00', 'America/New_York'), Date.UTC(2026, 6, 1, 16));
  assert.equal(parseZonedDate('2026-01-01T12:00', 'America/New_York'), Date.UTC(2026, 0, 1, 17));
  assert.throws(() => parseZonedDate('2026-03-29T01:30', 'Europe/London'), /不存在/);
  assert.throws(() => parseZonedDate('2026-10-25T01:30', 'Europe/London'), /重复/);
});
test('Diff: insert, delete, change, line numbers and blank lines', () => {
  const rows = diffLines('one\ntwo\nthree', 'one\nchanged\nthree\nfour');
  assert.deepEqual(rows.map(({ kind, left, right }) => [kind, left, right]), [
    ['equal', 1, 1], ['remove', 2, null], ['add', null, 2], ['equal', 3, 3], ['add', null, 4]
  ]);
  assert.deepEqual(diffLines('', ''), []);
  assert.equal(diffLines('a', '').filter((row) => row.kind === 'remove').length, 1);
  assert.equal(diffLines('', 'a').filter((row) => row.kind === 'add').length, 1);
  assert.equal(diffLines('a\n', 'a').filter((row) => row.kind === 'remove').length, 1);
});
test('Diff: normalize CRLF and optionally ignore whitespace', () => {
  assert(diffLines('a\r\nb', 'a\nb').every((row) => row.kind === 'equal'));
  assert(diffLines(' a \n\tb', 'a\nb', true).every((row) => row.kind === 'equal'));
  assert(diffLines(' a ', 'a').some((row) => row.kind !== 'equal'));
});
test('Diff: duplicates, malicious HTML and full reconstruction property', () => {
  const pairs = [['a\nb\na', 'b\na\nb'], ['<script>alert(1)</script>', '<img onerror=x>'], ['\n\n', '\n'], ['甲\n乙', '乙\n丙']];
  for (const [before, after] of pairs) {
    const rows = diffLines(before, after);
    assert.equal(rows.filter((row) => row.kind !== 'add').map((row) => row.text).join('\n'), before);
    assert.equal(rows.filter((row) => row.kind !== 'remove').map((row) => row.text).join('\n'), after);
  }
});
test('Diff: bounded memory and line limits', () => {
  assert.throws(() => diffLines('x'.repeat(100_001), ''), /100,000/);
  assert.throws(() => diffLines('', '\n'.repeat(1_000)), /1,000/);
  assert.equal(diffLines(Array(1000).fill('a').join('\n'), Array(1000).fill('b').join('\n')).length, 2000);
});
