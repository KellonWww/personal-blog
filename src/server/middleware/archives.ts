import type { MiddlewareHandler } from 'hono';
import { fail } from '@/lib/api';
import type { AppBindings } from '@/server/types';

export const ARCHIVE_PRIVATE_ROUTES = [
  '/admin/posts', '/admin/posts/*', '/admin/archives', '/admin/archives/*', '/admin/archive-sources',
  '/admin/archive-taxonomy', '/admin/archive-taxonomy/*', '/admin/imports', '/admin/imports/*'
];

export function isArchivePrivatePath(pathname: string): boolean {
  return /^\/admin\/(?:posts|archives|archive-sources|archive-taxonomy|imports)(?:\/|$)/.test(pathname);
}

// Registered before session/CSRF so early rejections also remain private.
export const archivePrivacy: MiddlewareHandler<AppBindings> = async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  c.header('Vary', 'Cookie');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  await next();
};

// Route-level authorization is retained even when the feature is disabled.
export const requireArchiveAdmin: MiddlewareHandler<AppBindings> = async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  c.header('Vary', 'Cookie');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  const user = c.get('user');
  if (!user) {
    return c.json(fail('UNAUTHORIZED', '请先登录'), 401);
  }
  if (user.role !== 'admin') {
    return c.json(fail('FORBIDDEN', '需要管理员权限'), 403);
  }
  if (c.env.ARCHIVES_ENABLED !== 'true') {
    return c.json(fail('ARCHIVES_DISABLED', '档案功能尚未启用'), 503);
  }
  await next();
};
