export const TEXT_INPUT_LIMIT = 100_000;
export const TEXT_OUTPUT_LIMIT = 500_000;
export type Codec = 'base64' | 'url' | 'unicode';
export type TextOperation = 'dedupe' | 'sort-asc' | 'sort-desc' | 'empty' | 'trim' | 'upper' | 'lower' | 'wrap';

export function checkInput(value: string) {
  if (value.length > TEXT_INPUT_LIMIT) throw new Error('输入最多支持 100,000 字符，请缩小内容。');
}
function checkOutput(value: string) {
  if (value.length > TEXT_OUTPUT_LIMIT) throw new Error('结果超过 500,000 字符，请缩小输入或前后缀。');
  return value;
}
function decodeUnicode(value: string) {
  return value.replace(/\\u(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))|\\u/g, (match, point: string | undefined, unit: string | undefined) => {
    if (unit) return String.fromCharCode(Number.parseInt(unit, 16));
    if (point && Number.parseInt(point, 16) <= 0x10ffff) return String.fromCodePoint(Number.parseInt(point, 16));
    throw new Error(`无效 Unicode 转义：${match}；请使用 \\uXXXX 或 \\u{1F600}。`);
  });
}
export function transformCodec(value: string, codec: Codec, mode: 'encode' | 'decode'): string {
  checkInput(value);
  try {
    if (codec === 'url') return checkOutput(mode === 'encode' ? encodeURIComponent(value) : decodeURIComponent(value));
    if (codec === 'unicode') return checkOutput(mode === 'decode' ? decodeUnicode(value) : value.split('').map((char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')).join(''));
    if (mode === 'encode') {
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error('输入包含不完整的 Unicode 字符。');
      const bytes = new TextEncoder().encode(value);
      return checkOutput(btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')));
    }
    const compact = value.replace(/\s/g, '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/.test(compact)) throw new Error('Base64 格式无效，请检查字符和补位。');
    return checkOutput(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(atob(compact), (char) => char.charCodeAt(0))));
  } catch (cause) {
    if (cause instanceof URIError) throw new Error('URL 编解码失败：请检查百分号转义或 Unicode 字符是否完整。', { cause });
    if (cause instanceof TypeError) throw new Error('Base64 内容不是有效的 UTF-8 文本，不能作为文字解码。', { cause });
    throw cause;
  }
}
export function transformText(value: string, operation: TextOperation, prefix = '', suffix = ''): string {
  checkInput(value);
  if (operation === 'wrap' && prefix.length + suffix.length > 2_000) throw new Error('前后缀合计最多支持 2,000 字符。');
  if (operation === 'upper') return checkOutput(value.toUpperCase());
  if (operation === 'lower') return checkOutput(value.toLowerCase());
  if (!value) return '';
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  let result: string[];
  switch (operation) {
    case 'dedupe': result = [...new Set(lines)]; break;
    case 'sort-asc': result = lines.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })); break;
    case 'sort-desc': result = lines.sort((a, b) => b.localeCompare(a, 'zh-CN', { numeric: true })); break;
    case 'empty': result = lines.filter((line) => line.trim() !== ''); break;
    case 'trim': result = lines.map((line) => line.trim()); break;
    case 'wrap':
      if (value.length + lines.length * (prefix.length + suffix.length) > TEXT_OUTPUT_LIMIT) throw new Error('结果超过 500,000 字符，请缩小输入或前后缀。');
      result = lines.map((line) => prefix + line + suffix); break;
  }
  return checkOutput(result.join('\n'));
}
