import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { fail, ok } from '@/lib/api';
import { loginDestination } from '@/lib/auth-redirect';
import { safeJsonParse } from '@/lib/format';
import { oauthStateCookie, sessionCookie } from '@/server/cookie';
import { buildGitHubLogin, completeGitHubLogin, createDevelopmentSession, getCurrentSession, revokeSession } from '@/server/services/auth';
import type { AppBindings } from '@/server/types';

const auth = new Hono<AppBindings>();

auth.use('/auth/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  c.header('Referrer-Policy', 'no-referrer');
  await next();
});

auth.get('/auth/login', async (c) => {
  const env = c.env;
  const returnTo = loginDestination(c.req.query('returnTo'));
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return c.redirect('/admin/login?' + new URLSearchParams({ error: 'oauth_not_configured', returnTo }));
  }
  const { url, stateCookie } = await buildGitHubLogin(env.DB, env);
  const { name, options } = oauthStateCookie(env);
  setCookie(c, name, stateCookie, options);
  // Bind the short-lived destination to this OAuth attempt, never to an arbitrary callback query.
  setCookie(c, name + '_return', JSON.stringify({ state: stateCookie, returnTo }), options);
  return c.redirect(url);
});

auth.get('/auth/callback', async (c) => {
  const env = c.env;
  const code = c.req.query('code') ?? '';
  const state = c.req.query('state') ?? '';
  const { name: stateName, options: stateOptions } = oauthStateCookie(env);
  const cookieState = getCookie(c, stateName) ?? '';
  const saved = safeJsonParse<{ state?: unknown; returnTo?: unknown } | null>(getCookie(c, stateName + '_return') ?? '', null);
  const returnTo = saved?.state === state && typeof saved.returnTo === 'string' ? loginDestination(saved.returnTo) : '/admin';
  deleteCookie(c, stateName + '_return', { path: stateOptions.path });
  if (!code || !state) {
    return c.redirect('/admin/login?' + new URLSearchParams({ error: 'oauth_denied', returnTo }));
  }
  try {
    const token = await completeGitHubLogin(env.DB, env, code, state, cookieState);
    const { name, options } = sessionCookie(env);
    setCookie(c, name, token, options);
    deleteCookie(c, stateName, { path: stateOptions.path });
    return c.redirect(returnTo);
  } catch (error) {
    console.error('[auth] OAuth 回调失败', error);
    return c.redirect('/admin/login?' + new URLSearchParams({ error: 'oauth_failed', returnTo }));
  }
});

auth.post('/auth/dev-login', async (c) => {
  const env = c.env;
  if (env.ENVIRONMENT !== 'development' || env.AUTH_DEV_MODE !== 'true') {
    return c.json(fail('NOT_FOUND', '接口不存在'), 404);
  }
  let username = env.DEV_ADMIN_USERNAME ?? 'laoda';
  const body = await c.req.json<{ username?: string }>().catch(() => ({}) as { username?: string });
  if (body.username && body.username.trim()) {
    username = body.username.trim();
  }
  const token = await createDevelopmentSession(env.DB, username);
  const { name, options } = sessionCookie(env);
  setCookie(c, name, token, options);
  const user = await getCurrentSession(env.DB, token);
  return c.json(ok({ user }));
});

auth.get('/auth/me', (c) => {
  const user = c.get('user');
  return c.json(ok({ authenticated: Boolean(user), user: user ?? null }));
});

auth.post('/auth/logout', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json(fail('UNAUTHORIZED', '未登录'), 401);
  }
  const { name } = sessionCookie(c.env);
  const token = getCookie(c, name);
  await revokeSession(c.env.DB, token);
  deleteCookie(c, name, { path: '/' });
  return c.json(ok({ loggedOut: true }));
});

export default auth;

