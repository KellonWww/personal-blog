import type { MiddlewareHandler } from 'astro';
import { env } from 'cloudflare:workers';
import { sessionCookie } from '@/server/cookie';
import { getCurrentSession } from '@/server/services/auth';

function protectResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  const vary = headers.get('Vary')?.split(',').map((value) => value.trim()) ?? [];
  if (!vary.some((value) => value.toLowerCase() === 'cookie' || value === '*')) vary.push('Cookie');
  headers.set('Vary', vary.join(', '));
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Never render the workspace or editor before checking the server-side session. */
export const adminWorkspace: MiddlewareHandler = async (context, next) => {
  let pathname: string;
  try { pathname = decodeURIComponent(context.url.pathname); }
  catch { pathname = context.url.pathname; }
  if (pathname !== '/admin' && !pathname.startsWith('/admin/')) return next();
  if (/^\/admin\/login\/?$/.test(pathname)) {
    return protectResponse(context.redirect('/login?returnTo=%2Fadmin', 302));
  }

  let user;
  try {
    const token = context.cookies.get(sessionCookie(env).name)?.value;
    user = await getCurrentSession(env.DB, token, env);
  } catch {
    return protectResponse(new Response('登录状态暂时无法验证，请稍后重试。', { status: 503 }));
  }
  if (!user) {
    const query = new URLSearchParams({ returnTo: context.url.pathname + context.url.search });
    return protectResponse(context.redirect('/login?' + query, 302));
  }
  if (user.role !== 'admin') return protectResponse(context.redirect('/', 302));
  return protectResponse(await next());
};
