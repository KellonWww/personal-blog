export const JSON_INPUT_LIMIT = 200_000;
export const DIFF_INPUT_LIMIT = 100_000;
export const DIFF_LINE_LIMIT = 1_000;

export interface JsonEntry { path: string; preview: string; structured?: boolean }
export interface JsonResult { pretty: string; compact: string; entries: JsonEntry[]; truncated: boolean }

export function analyzeJson(source: string, indent: 2 | 4 = 2): JsonResult {
  if (!source.trim()) throw new Error('请先输入 JSON。');
  if (source.length > JSON_INPUT_LIMIT) throw new Error('JSON 超过 200,000 字符，请缩小内容后重试。');
  let value: unknown;
  try {
    value = JSON.parse(source, (_key, item: unknown) => {
      if (typeof item === 'number' && (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item)))) {
        throw new RangeError('数字超出安全精度，请将大整数或高精度数值改为字符串后重试。');
      }
      return item;
    });
  } catch (error) {
    if (error instanceof RangeError) throw error;
    throw new Error(`JSON 语法错误：${error instanceof Error ? error.message : '请检查引号、逗号和括号。'}`, { cause: error });
  }
  const entries: JsonEntry[] = [];
  const stack: { value: unknown; path: string }[] = [{ value, path: '$' }];
  // 限制可视索引规模；格式化结果仍保留完整 JSON。
  while (stack.length && entries.length < 300) {
    const current = stack.pop()!;
    const item = current.value;
    const preview = Array.isArray(item) ? `数组 · ${item.length} 项`
      : item !== null && typeof item === 'object' ? `对象 · ${Object.keys(item).length} 个字段`
      : JSON.stringify(item);
    entries.push({ path: current.path, structured: item !== null && typeof item === 'object', preview: preview.length > 160 ? preview.slice(0, 160) + '…' : preview });
    if (item !== null && typeof item === 'object') {
      const children = Object.entries(item).slice(0, 300);
      for (let index = children.length - 1; index >= 0; index--) {
        const [key, child] = children[index]!;
        const segment = Array.isArray(item) ? `[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
        stack.push({ value: child, path: current.path + segment });
      }
    }
  }
  try {
    return { pretty: JSON.stringify(value, null, indent), compact: JSON.stringify(value), entries, truncated: stack.length > 0 || entries.length === 300 };
  } catch {
    throw new Error('JSON 嵌套过深，无法安全格式化，请减少嵌套层级。');
  }
}

export type TimestampUnit = 'auto' | 'seconds' | 'milliseconds';
export function parseTimestamp(source: string, unit: TimestampUnit): { milliseconds: number; detected: string } {
  if (!/^[+-]?\d+(\.\d+)?$/.test(source.trim())) throw new Error('请输入有效数字时间戳，不支持科学计数法。');
  const number = Number(source);
  const seconds = unit === 'seconds' || (unit === 'auto' && Math.abs(number) < 100_000_000_000);
  if (source.trim().length > 40) throw new Error('时间戳超出日期范围。');
  const negative = source.trim().startsWith('-');
  const [whole, fraction = ''] = source.trim().replace(/^[+-]/, '').split('.');
  const precision = seconds ? 3 : 0;
  if (/[^0]/.test(fraction.slice(precision))) throw new Error('时间戳精度小于 1 毫秒，请减少小数位。');
  // 用十进制拼接避免 1.001 * 1000 的浮点舍入误差。
  const digits = whole! + fraction.slice(0, precision).padEnd(precision, '0');
  const milliseconds = Number(BigInt(digits) * (negative ? -1n : 1n));
  if (!Number.isSafeInteger(milliseconds) || Math.abs(milliseconds) > 8_640_000_000_000_000) {
    throw new Error('时间戳超出日期范围。');
  }
  return { milliseconds, detected: seconds ? '秒' : '毫秒' };
}

export function formatZonedDate(milliseconds: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, era: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(milliseconds);
  const get = (name: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === name)!.value;
  const ms = ((milliseconds % 1_000) + 1_000) % 1_000;
  const year = get('era') === 'BC' ? 1 - Number(get('year')) : Number(get('year'));
  const displayYear = year < 0 ? '-' + String(-year).padStart(4, '0') : String(year).padStart(4, '0');
  return `${displayYear}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}.${String(ms).padStart(3, '0')}`;
}

export function parseZonedDate(source: string, timeZone: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(source);
  if (!match) throw new Error('请选择完整日期和时间。');
  const [, year, month, day, hour, minute, second = '00', fraction = '0'] = match;
  const canonical = `${year}-${month}-${day} ${hour}:${minute}:${second}.${fraction.padEnd(3, '0')}`;
  const naive = new Date(0);
  naive.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  naive.setUTCHours(Number(hour), Number(minute), Number(second), Number(fraction.padEnd(3, '0')));
  const wall = naive.getTime();
  if (Number(year) < 1 || naive.toISOString().replace('T', ' ').slice(0, -1) !== canonical) {
    throw new Error('日期无效，请检查年月日和时间。');
  }
  // 采样切换日前后的偏移，再回读校验，避免悄悄归一化夏令时空缺或重复时间。
  const candidates = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = wall + hours * 3_600_000;
    const zoned = formatZonedDate(sample, timeZone);
    const localAsUtc = new Date(zoned.replace(' ', 'T') + 'Z').getTime();
    const candidate = wall - (localAsUtc - sample);
    if (formatZonedDate(candidate, timeZone) === canonical) candidates.add(candidate);
  }
  if (!candidates.size) throw new Error('该时区不存在这个时间（可能处于夏令时跳时），请换一个时间。');
  if (candidates.size > 1) throw new Error('该时间在夏令时回拨时重复，请改用 UTC 时间或明确的时间戳。');
  return [...candidates][0]!;
}

export interface DiffRow { kind: 'equal' | 'remove' | 'add'; text: string; left: number | null; right: number | null }
export function diffLines(before: string, after: string, ignoreWhitespace = false): DiffRow[] {
  if (before.length > DIFF_INPUT_LIMIT || after.length > DIFF_INPUT_LIMIT) throw new Error('每侧最多支持 100,000 字符。');
  const split = (text: string) => text === '' ? [] : text.replace(/\r\n?/g, '\n').split('\n');
  const left = split(before);
  const right = split(after);
  if (left.length > DIFF_LINE_LIMIT || right.length > DIFF_LINE_LIMIT) throw new Error('每侧最多支持 1,000 行，请缩小内容后重试。');
  const normalize = (line: string) => ignoreWhitespace ? line.replace(/\s/g, '') : line;
  const a = left.map(normalize);
  const b = right.map(normalize);
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push({ kind: 'equal', text: right[j]!, left: ++i, right: ++j });
    } else if (i < a.length && (j === b.length || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) {
      rows.push({ kind: 'remove', text: left[i]!, left: ++i, right: null });
    } else {
      rows.push({ kind: 'add', text: right[j]!, left: null, right: ++j });
    }
  }
  return rows;
}
