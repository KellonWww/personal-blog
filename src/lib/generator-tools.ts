export interface PasswordOptions { upper: boolean; lower: boolean; digits: boolean; symbols: boolean; excludeAmbiguous: boolean }
function randomIndex(limit: number): number {
  const ceiling = Math.floor(0x100000000 / limit) * limit;
  const buffer = new Uint32Array(1);
  do { crypto.getRandomValues(buffer); } while (buffer[0]! >= ceiling);
  return buffer[0]! % limit;
}
function requireCrypto(): void {
  if (!globalThis.crypto?.getRandomValues) throw new Error('当前浏览器不支持安全随机数，请使用 HTTPS 或 localhost。');
}
export function generateUuids(count: number): string {
  requireCrypto();
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error('UUID 数量应为 1–50。');
  if (!crypto.randomUUID) throw new Error('当前环境不支持 UUID，请使用 HTTPS 或 localhost。');
  return Array.from({ length: count }, () => crypto.randomUUID()).join('\n');
}
export function generatePasswords(length: number, count: number, options: PasswordOptions): string {
  requireCrypto();
  if (!Number.isInteger(length) || length < 8 || length > 128) throw new Error('密码长度应为 8–128。');
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('密码数量应为 1–20。');
  const definitions = { upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lower: 'abcdefghijklmnopqrstuvwxyz', digits: '0123456789', symbols: '!@#$%^&*()-_=+[]{}:,.?' };
  const groups = (Object.keys(definitions) as (keyof typeof definitions)[]).filter((key) => options[key]).map((key) => options.excludeAmbiguous ? definitions[key].replace(/[0O1Il]/g, '') : definitions[key]);
  if (!groups.length) throw new Error('至少选择一类字符。');
  const alphabet = groups.join('');
  return Array.from({ length: count }, () => {
    const chars = groups.map((group) => group.charAt(randomIndex(group.length)));
    while (chars.length < length) chars.push(alphabet.charAt(randomIndex(alphabet.length)));
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1);
      [chars[i], chars[j]] = [chars[j]!, chars[i]!];
    }
    return chars.join('');
  }).join('\n');
}
export async function sha256(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('哈希需要安全环境，请使用 HTTPS 或 localhost。');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
