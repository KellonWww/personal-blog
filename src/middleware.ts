import { defineMiddleware, sequence } from 'astro:middleware';
import { privateLibrary } from '@/server/middleware/private-library';

const LEGACY_HOST = 'personal-blog.stock-backend-wkl.workers.dev';
const SITE_ORIGIN = 'https://blog.kalevip.top';

const legacyRedirect = defineMiddleware((context, next) => {
  const { request, url } = context;
  // Only redirect navigation requests; never replay writes across origins.
  if (url.hostname !== LEGACY_HOST || !['GET', 'HEAD'].includes(request.method)) {
    return next();
  }

  const target = new URL(SITE_ORIGIN);
  target.pathname = url.pathname;
  target.search = url.search;
  return context.redirect(target.toString(), 308);
});

export const onRequest = sequence(privateLibrary, legacyRedirect);
