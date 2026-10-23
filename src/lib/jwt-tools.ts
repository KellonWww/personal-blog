export interface JwtResult {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signaturePresent: boolean;
}

function decodePart(value: string, label: string): Record<string, unknown> {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error(`${label} 不是有效的 Base64URL。`);
  let decoded: unknown;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
  } catch {
    throw new Error(`${label} 无法解析为 UTF-8 JSON，请检查令牌是否完整。`);
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error(`${label} 必须是 JSON 对象。`);
  return decoded as Record<string, unknown>;
}

export function decodeJwt(input: string): JwtResult {
  if (input.length > 32768) throw new Error('令牌不能超过 32,768 字符。');
  const token = input.trim().replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length === 5) throw new Error('这是加密的 JWE，不能直接解析。此工具只读取三段式 JWT。');
  if (parts.length !== 3) throw new Error('JWT 应由三段组成，使用两个英文句点分隔。');
  const [header = '', payload = '', signature = ''] = parts;
  if (!/^[A-Za-z0-9_-]*$/.test(signature) || signature.length % 4 === 1) throw new Error('签名段不是有效的 Base64URL。');
  return { header: decodePart(header, 'Header'), payload: decodePart(payload, 'Payload'), signaturePresent: Boolean(signature) };
}

export function claimDate(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '不是有效的数值时间声明';
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? '日期超出支持范围' : date.toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

export const JWT_SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZW1vLXVzZXIiLCJuYW1lIjoiS2FsZSIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDAzNjAwfQ.ZGVtby1zaWduYXR1cmU';
