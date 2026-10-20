import { defineMiddleware } from 'astro:middleware';

const LEGACY_HOST = 'personal-blog.stock-backend-wkl.workers.dev';
const SITE_ORIGIN = 'https://blog.kalevip.top';

export const onRequest = defineMiddleware((context, next) => {
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
