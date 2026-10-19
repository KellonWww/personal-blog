import { Hono } from 'hono';
import { fail } from '@/lib/api';
import { DatabaseError } from '@/server/db/client';
import { csrfMiddleware, sessionMiddleware } from '@/server/middleware/auth';
import { ARCHIVE_PRIVATE_ROUTES, archivePrivacy, isArchivePrivatePath } from '@/server/middleware/archives';
import adminRoutes from '@/server/routes/admin';
import authRoutes from '@/server/routes/auth';
import archiveRoutes from '@/server/routes/archives';
import archiveImportRoutes from '@/server/routes/archive-imports';
import { ArchiveImportError } from '@/server/services/archive-import-model';
import { ArchiveMutationError } from '@/server/services/archive-mutation-model';
import commentsRoutes from '@/server/routes/comments';
import guestbookRoutes from '@/server/routes/guestbook';
import healthRoutes from '@/server/routes/health';
import mediaRoutes from '@/server/routes/media';
import postsRoutes from '@/server/routes/posts';
import type { AppBindings } from '@/server/types';

export function createApp() {
  const app = new Hono<AppBindings>();

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'SAMEORIGIN');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  });

  for (const route of ARCHIVE_PRIVATE_ROUTES) {
    app.use(route, archivePrivacy);
  }
  app.use('*', sessionMiddleware);
  app.use('*', csrfMiddleware);

  app.route('/', healthRoutes);
  app.route('/', postsRoutes);
  app.route('/', commentsRoutes);
  app.route('/', guestbookRoutes);
  app.route('/', authRoutes);
  app.route('/', archiveRoutes);
  app.route('/', archiveImportRoutes);
  app.route('/', adminRoutes);
  app.route('/', mediaRoutes);

  app.notFound((c) => c.json(fail('NOT_FOUND', '接口不存在'), 404));

  app.onError((error, c) => {
    const cause = error instanceof DatabaseError ? error.cause : error;
    if (cause instanceof Error && cause.message.includes('ARCHIVE_PUBLICATION_CONFIRM_REQUIRED')) {
      return c.json(fail('ARCHIVE_PUBLICATION_CONFIRM_REQUIRED', '已发布的档案关联稿及其作者/分类标签受保护，请先撤回相关稿件再修改并重新审阅'), 409);
    }
    if (error instanceof ArchiveImportError || error instanceof ArchiveMutationError) {
      return c.json(fail(error.code, error.message), error.status);
    }
    if (isArchivePrivatePath(c.req.path)) {
      // Driver errors can contain bound private text; archive failures never log raw causes.
      console.error('[archives] 请求失败', error instanceof DatabaseError ? 'DATABASE_ERROR' : 'INTERNAL_ERROR');
      return error instanceof DatabaseError
        ? c.json(fail('DATABASE_ERROR', '数据库操作失败'), 500)
        : c.json(fail('INTERNAL_ERROR', '服务器内部错误'), 500);
    }
    if (error instanceof DatabaseError) {
      console.error('[api] 数据库错误', error.cause ?? error);
      return c.json(fail('DATABASE_ERROR', '数据库操作失败'), 500);
    }
    console.error('[api] 未捕获异常', error);
    return c.json(fail('INTERNAL_ERROR', '服务器内部错误'), 500);
  });

  return app;
}
