import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { fail } from '@/lib/api';
import { getCurrentSession } from '@/server/services/auth';
import { sessionCookie } from '@/server/cookie';
import type { AppBindings } from '@/server/types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const sessionMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  const { name } = sessionCookie(c.env);
  const token = getCookie(c, name);
  const user = await getCurrentSession(c.env.DB, token, c.env);
  c.set('user', user ?? null);
  await next();
};

function sameOrigin(origin: string, env: Env): boolean {
  if (!origin) {
    return true;
  }
  const site = env.SITE_URL.replace(/\/$/, '');
  if (origin === site) {
    return true;
  }
  try {
    const target = new URL(origin);
    const allowed = new URL(site);
    return target.host === allowed.host;
  } catch {
    return false;
  }
}

export const csrfMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method.toUpperCase())) {
    await next();
    return;
  }
  const user = c.get('user');
  if (!user) {
    await next();
    return;
  }
  const header = c.req.header('X-CSRF-Token') ?? '';
  if (!header || header !== user.csrfToken) {
    return c.json(fail('CSRF_INVALID', 'CSRF 校验失败，请刷新页面重试'), 403);
  }
  const origin = c.req.header('Origin') ?? c.req.header('Referer') ?? '';
  if (!sameOrigin(origin, c.env)) {
    return c.json(fail('ORIGIN_INVALID', '请求来源校验失败'), 403);
  }
  await next();
};

export function requireUser(c: { get: (key: 'user') => AppBindings['Variables']['user'] }): AppBindings['Variables']['user'] {
  return c.get('user');
}
