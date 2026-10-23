export const REGEX_INPUT_LIMIT = 20_000;
export const REGEX_PATTERN_LIMIT = 2_000;
export const REGEX_MATCH_LIMIT = 500;
const OUTPUT_LIMIT = 200_000;
export interface RegexRequest { pattern: string; flags: string; source: string; replacement: string }
export interface RegexMatch { index: number; text: string; captures: (string | null)[]; groups: Record<string, string | null> }
export interface RegexResult { matches: RegexMatch[]; truncated: boolean; replacement: string | null }

function replacementToken(token: string, key: string, match: RegExpExecArray, source: string): string {
  if (key === '$') return '$';
  if (key === '&') return match[0];
  if (key === '`') return source.slice(0, match.index);
  if (key === "'") return source.slice(match.index + match[0].length);
  if (key.startsWith('<')) return match.groups ? (match.groups[key.slice(1, -1)] ?? '') : token;
  const index = Number(key);
  if (index > 0 && index < match.length) return match[index] ?? '';
  const first = Number(key[0]);
  if (key.length === 2 && first > 0 && first < match.length) return (match[first] ?? '') + key[1];
  return token;
}
function expandReplacement(template: string, match: RegExpExecArray, source: string) {
  const pieces: string[] = [];
  let length = 0;
  let cursor = 0;
  function append(value: string) {
    length += value.length;
    if (length > OUTPUT_LIMIT) throw new Error('替换结果超过 200,000 字符，请缩小文本或模板。');
    pieces.push(value);
  }
  for (const token of template.matchAll(/\$([$&`']|\d{1,2}|<[^>]*>)/g)) {
    append(template.slice(cursor, token.index));
    append(replacementToken(token[0], token[1]!, match, source));
    cursor = token.index + token[0].length;
  }
  append(template.slice(cursor));
  return pieces.join('');
}

export function runRegex(request: RegexRequest): RegexResult {
  const { pattern, flags, source, replacement } = request;
  if (source.length > REGEX_INPUT_LIMIT) throw new Error('测试文本最多支持 20,000 字符。');
  if (pattern.length > REGEX_PATTERN_LIMIT || replacement.length > 2_000) throw new Error('表达式和替换模板分别最多支持 2,000 字符。');
  if (!/^[gimsuy]*$/.test(flags)) throw new Error('仅支持 g、i、m、s、u、y 标志。');
  const regex = new RegExp(pattern, flags);
  const matches: RegexMatch[] = [];
  let result = '';
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    if (matches.length === REGEX_MATCH_LIMIT) return { matches, truncated: true, replacement: null };
    matches.push({ index: match.index, text: match[0], captures: match.slice(1, 51).map((value) => value ?? null), groups: Object.fromEntries(Object.entries(match.groups ?? {}).slice(0, 50).map(([key, value]) => [key, value ?? null])) });
    result += source.slice(cursor, match.index) + expandReplacement(replacement, match, source);
    if (result.length > OUTPUT_LIMIT) throw new Error('替换结果超过 200,000 字符，请缩小文本或模板。');
    cursor = match.index + match[0].length;
    if (!regex.global) break;
    // exec does not advance on empty matches; Unicode mode must skip a whole code point.
    if (match[0] === '') regex.lastIndex += regex.unicode && (source.codePointAt(regex.lastIndex) ?? 0) > 0xffff ? 2 : 1;
  }
  result += source.slice(cursor);
  if (result.length > OUTPUT_LIMIT) throw new Error('替换结果超过 200,000 字符，请缩小文本或模板。');
  return { matches, truncated: false, replacement: result };
}
