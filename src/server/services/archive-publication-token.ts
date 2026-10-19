import { z } from 'zod';
import { base64UrlEncode } from '@/server/auth/crypto';
import { ArchiveMutationError } from '@/server/services/archive-mutation-model';
import { archiveIdSchema } from '@/server/services/archive-query';

export const PUBLICATION_TOKEN_SECONDS = 600;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const claimsSchema = z.object({
  publicationId: archiveIdSchema, archiveId: archiveIdSchema,
  operator: z.string().min(1).max(128), postVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  snapshotHash: hash, referencesHash: hash, policyVersion: z.string().min(1).max(64),
  origin: z.string().max(2048), issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive()
}).strict();
export type PublicationClaims = z.infer<typeof claimsSchema>;

export function publicationConfig(env: Env) {
  const secret = env.ARCHIVE_PUBLICATION_SECRET ?? '';
  if (env.ARCHIVE_PUBLICATION_ENABLED !== 'true' || secret.length < 32 || secret.length > 512 || secret.trim() !== secret) {
    throw new ArchiveMutationError('PUBLICATION_DISABLED', '确认发布未启用或缺少专用签名密钥，请先完成人工迁移与验证', 503);
  }
  let origin: string;
  try {
    const url = new URL(env.SITE_URL);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) { throw new Error('invalid origin'); }
    origin = url.origin;
  } catch { throw new ArchiveMutationError('PUBLICATION_DISABLED', '站点地址配置无效，无法绑定发布预览', 503); }
  return { secret, origin };
}

async function key(secret: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
function decode(value: string) {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
export async function signPublicationToken(claims: PublicationClaims, secret: string) {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claimsSchema.parse(claims))));
  const signature = await crypto.subtle.sign('HMAC', await key(secret), new TextEncoder().encode(payload));
  return payload + '.' + base64UrlEncode(new Uint8Array(signature));
}
export async function verifyPublicationToken(token: string, secret: string): Promise<PublicationClaims> {
  let claims: PublicationClaims;
  try {
    if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) { throw new Error('invalid token'); }
    const [payload, signature] = token.split('.') as [string, string];
    const signatureBytes = decode(signature);
    if (base64UrlEncode(signatureBytes) !== signature ||
        !await crypto.subtle.verify('HMAC', await key(secret), signatureBytes, new TextEncoder().encode(payload))) {
      throw new Error('invalid signature');
    }
    claims = claimsSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(payload))));
  } catch { throw new ArchiveMutationError('PREVIEW_INVALID', '预览签名无效，请重新读取并审阅', 422); }
  const now = Math.floor(Date.now() / 1000);
  if (claims.issuedAt > now || claims.expiresAt <= now || claims.expiresAt - claims.issuedAt !== PUBLICATION_TOKEN_SECONDS) {
    throw new ArchiveMutationError('PREVIEW_EXPIRED', '预览已过期，请重新读取并审阅');
  }
  return claims;
}
