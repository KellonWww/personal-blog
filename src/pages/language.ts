import type { APIRoute } from 'astro';
import { LOCALE_COOKIE } from '@/lib/i18n';

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return new Response('Forbidden', { status: 403 });
  let form: FormData;
  try { form = await request.formData(); }
  catch { return new Response('Invalid form', { status: 400 }); }
  const locale = form.get('locale');
  if (locale !== 'zh-CN' && locale !== 'en') return new Response('Invalid locale', { status: 400 });
  const requested = form.get('returnTo');
  let target = '/';
  if (typeof requested === 'string' && requested.startsWith('/') && !requested.startsWith('//') && !/[\\\r\n]/.test(requested)) {
    const resolved = new URL(requested, url.origin);
    if (resolved.origin === url.origin) target = resolved.pathname + resolved.search + resolved.hash;
  }
  cookies.set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: true, secure: url.protocol === 'https:' });
  return redirect(target, 303);
};
