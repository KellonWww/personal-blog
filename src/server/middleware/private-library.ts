import type { MiddlewareHandler } from 'astro';
import { env } from 'cloudflare:workers';
import { getCurrentSession } from '@/server/services/auth';
import { sessionCookie } from '@/server/cookie';

function protectResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  const vary = headers.get('Vary')?.split(',').map((value) => value.trim()) ?? [];
  if (!vary.some((value) => value.toLowerCase() === 'cookie' || value === '*')) vary.push('Cookie');
  headers.set('Vary', vary.join(', '));
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Authenticate before rendering or querying any private document, including error responses. */
export const privateLibrary: MiddlewareHandler = async (context, next) => {
  let pathname: string;
  try {
    pathname = decodeURIComponent(context.url.pathname);
  } catch {
    pathname = context.url.pathname;
  }
  if (pathname !== '/private' && !pathname.startsWith('/private/')) {
    return next();
  }
  try {
    const token = context.cookies.get(sessionCookie(env).name)?.value;
    const user = await getCurrentSession(env.DB, token);
    if (!user) {
      const query = new URLSearchParams({ returnTo: context.url.pathname + context.url.search });
      return protectResponse(context.redirect('/admin/login?' + query, 302));
    }
    if (user.role !== 'admin') {
      return protectResponse(new Response('私人文库仅限管理员访问。', { status: 403 }));
    }
    if (env.ARCHIVES_ENABLED !== 'true') {
      return protectResponse(new Response('私人文库尚未启用。', { status: 503 }));
    }
    context.locals.privateLibraryAuthorized = true;
    return protectResponse(await next());
  } catch {
    // Never expose database errors, document text, or search terms in a public error page/log.
    return protectResponse(new Response('私人文库暂时无法加载，请稍后重试。', { status: 503 }));
  }
};
