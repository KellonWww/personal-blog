import type { D1Database } from '@cloudflare/workers-types';
import { SESSION_DAYS } from '@/lib/constants';
import { codeChallenge, randomToken, sha256Hex } from '@/server/auth/crypto';
import { consumeOAuthState, createOAuthState, createSession, deleteSession, getSessionUser, upsertUser } from '@/server/db/auth';

export async function buildGitHubLogin(db: D1Database, env: Env): Promise<{ url: string; stateCookie: string }> {
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = await codeChallenge(verifier);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const callbackUrl = `${env.SITE_URL.replace(/\/$/, '')}/api/auth/callback`;
  await createOAuthState(db, state, verifier, callbackUrl, expiresAt);
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', env.GITHUB_CLIENT_ID ?? '');
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('scope', 'read:user user:email');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('allow_signup', 'true');
  return { url: url.toString(), stateCookie: state };
}

export async function completeGitHubLogin(db: D1Database, env: Env, code: string, state: string, cookieState: string): Promise<string> {
  if (!cookieState || cookieState !== state) {
    throw new Error('OAuth state 校验失败');
  }
  const stored = await consumeOAuthState(db, state);
  if (!stored) {
    throw new Error('OAuth state 已过期，请重新登录');
  }
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: stored.redirectUri,
      code_verifier: stored.codeVerifier
    })
  });
  if (!tokenResponse.ok) {
    throw new Error(`GitHub token 交换失败：${tokenResponse.status}`);
  }
  const tokenPayload = (await tokenResponse.json()) as { access_token?: string; error?: string };
  if (!tokenPayload.access_token) {
    throw new Error(tokenPayload.error ?? 'GitHub 未返回 access_token');
  }
  const headers = { Authorization: `Bearer ${tokenPayload.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'personal-blog' };
  const profileResponse = await fetch('https://api.github.com/user', { headers });
  if (!profileResponse.ok) {
    throw new Error('读取 GitHub 用户资料失败');
  }
  const profile = (await profileResponse.json()) as { id: number; login: string; name?: string; email?: string; avatar_url?: string };
  let email = profile.email ?? '';
  if (!email) {
    const emailResponse = await fetch('https://api.github.com/user/emails', { headers });
    if (emailResponse.ok) {
      const emails = (await emailResponse.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
      email = emails.find((item) => item.primary && item.verified)?.email ?? emails.find((item) => item.verified)?.email ?? '';
    }
  }
  const owner = env.GITHUB_ADMIN_USERNAME?.trim().toLowerCase();
  const isAdmin = Boolean(owner) && profile.login.toLowerCase() === owner;
  const user = await upsertUser(db, {
    id: `usr_${profile.id}`,
    githubId: String(profile.id),
    username: profile.login,
    displayName: profile.name || profile.login,
    email,
    avatarUrl: profile.avatar_url ?? '',
    role: isAdmin ? 'admin' : 'user'
  });
  return createUserSession(db, user.id);
}

export async function createDevelopmentSession(db: D1Database, username = 'laoda'): Promise<string> {
  const safeUsername = username.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'laoda';
  const user = await upsertUser(db, {
    id: `usr_dev_${safeUsername}`,
    githubId: `dev-${safeUsername}`,
    username: safeUsername,
    displayName: safeUsername === 'laoda' ? '牢大' : safeUsername,
    email: '',
    avatarUrl: '',
    role: 'admin'
  });
  return createUserSession(db, user.id);
}

export async function createUserSession(db: D1Database, userId: string): Promise<string> {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await createSession(db, { id: crypto.randomUUID(), userId, tokenHash, csrfToken, expiresAt });
  return token;
}

export async function getCurrentSession(db: D1Database, token: string | undefined, env: Env): Promise<ReturnType<typeof getSessionUser>> {
  if (!token) {
    return Promise.resolve(null);
  }
  const tokenHash = await sha256Hex(token);
  const user = await getSessionUser(db, tokenHash);
  if (!user || user.role !== 'admin') return user;
  // A historical admin role must not grant access to someone other than the owner.
  const owner = env.GITHUB_ADMIN_USERNAME?.trim().toLowerCase();
  const isOwner = Boolean(owner) && user.username.toLowerCase() === owner;
  const isDevelopmentOwner = env.ENVIRONMENT === 'development' && env.AUTH_DEV_MODE === 'true'
    && user.id === 'usr_dev_' + (env.DEV_ADMIN_USERNAME ?? 'laoda');
  return isOwner || isDevelopmentOwner ? user : { ...user, role: 'user' };
}

export async function revokeSession(db: D1Database, token: string | undefined): Promise<void> {
  if (!token) {
    return;
  }
  const tokenHash = await sha256Hex(token);
  await deleteSession(db, tokenHash);
}

