import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createApp } from '@/server/app';
import { fail } from '@/lib/api';
import { ARCHIVE_IMPORT_MAX_BYTES } from '@/server/services/archive-import-model';

export const prerender = false;

const app = createApp();

// Bound private archive bodies before buffering; a Hono-only limit runs too late.
async function readArchiveBody(request: Request): Promise<ArrayBuffer | null> {
  if (!request.body) { return new ArrayBuffer(0); }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) { break; }
      size += result.value.byteLength;
      if (size > ARCHIVE_IMPORT_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body.buffer;
}

/**
 * 前端统一以 /api/* 访问，Hono 内部路由不带前缀，
 * 因此在这里剥离 /api 前缀后再交给 Hono 处理。
 * 请求体先读入（档案请求有界），避免 Hono 未消费 body（如 401 直接返回）时
 * 遗留未读流，污染 dev server → miniflare 的连接。
 */
export const ALL: APIRoute = async ({ request, locals }) => {
  const url = new URL(request.url);
  const stripped = url.pathname.replace(/^\/api(?=\/|$)/, '');
  url.pathname = stripped === '' ? '/' : stripped;

  const init: RequestInit = { method: request.method, headers: request.headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const archiveRequest = /^\/admin\/(?:imports|archives)(?:\/|$)/.test(url.pathname);
    const body = archiveRequest ? await readArchiveBody(request) : await request.arrayBuffer();
    if (body === null) {
      return new Response(JSON.stringify(fail('BODY_TOO_LARGE', '档案请求不能超过 1 MiB')), {
        status: 413,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'private, no-store', Vary: 'Cookie',
          'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff'
        }
      });
    }
    init.body = body;
  }
  const rewritten = new Request(url, init);
  return app.fetch(rewritten, env, locals.cfContext);
};
