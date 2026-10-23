export interface UrlParameter { key: string; value: string }
export interface ParsedUrl { href: string; protocol: string; host: string; pathname: string; hash: string; rows: UrlParameter[] }
export function parseToolUrl(input: string): ParsedUrl {
  if (input.length > 20000) throw new Error('URL 不能超过 20,000 字符。');
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('请输入完整 URL，例如 https://example.com/path?a=1。'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 http / https 地址。不会打开或请求该地址。');
  const rows = Array.from(url.searchParams, ([key, value]) => ({ key, value }));
  if (rows.length > 200) throw new Error('最多编辑 200 组参数。');
  return { href: url.href, protocol: url.protocol, host: url.host, pathname: url.pathname, hash: url.hash, rows };
}
export function buildToolUrl(href: string, rows: UrlParameter[]): string {
  if (rows.length > 200) throw new Error('最多编辑 200 组参数。');
  const url = new URL(href);
  url.search = '';
  for (const row of rows) url.searchParams.append(row.key, row.value);
  if (url.href.length > 20000) throw new Error('编辑后的 URL 超出 20,000 字符，请缩短参数。');
  return url.href;
}
export const isTrackingParameter = (key: string): boolean => /^utm_/i.test(key) || /^(fbclid|gclid|msclkid|dclid)$/i.test(key);
