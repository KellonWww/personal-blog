// Private text importer: no SQL execution, public-post writes, image reads or resource fetching.
import { parseArgs } from 'node:util';
import { loadArchiveManifest, readArchiveDocument, predictArchiveImport, TextImportError } from './lib/archive-manifest.mjs';

const HELP = [
  '私人文本档案导入（资源未归档）',
  '预检：node scripts/import-archives.mjs --source <备份根> --source-key <稳定命名空间> --preflight',
  '比较：预检命令增加 --site <可信站点 origin>；只读获取基线',
  '提交：node scripts/import-archives.mjs --source <备份根> --source-key <稳定命名空间> --site <origin> --run-id <稳定批次ID> --apply --confirm-text-only',
  '凭据仅从环境读取：ARCHIVE_TRUSTED_ORIGIN、ARCHIVE_SESSION_COOKIE、ARCHIVE_CSRF_TOKEN；禁止写入仓库',
  '同 run-id 重试不重复写入；已成功/失败登记的文档若改变文本须新建批次。'
].join('\n');

class ApiError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

function options() {
  const { values } = parseArgs({ options: {
    source: { type: 'string' }, 'source-key': { type: 'string' }, provider: { type: 'string', default: 'yuque' },
    name: { type: 'string', default: '语雀私人文本' }, site: { type: 'string' }, 'run-id': { type: 'string' },
    preflight: { type: 'boolean' }, apply: { type: 'boolean' }, 'confirm-text-only': { type: 'boolean' }, help: { type: 'boolean' }
  } });
  if (values.help) { return values; }
  if (!values.source || !values['source-key'] || values['source-key'].length > 512 || /[\p{Cc}]/u.test(values['source-key'])) {
    throw new Error('必须指定 source 和稳定 source-key（不超过 512 字符）');
  }
  if (!/^[a-z0-9_-]{1,50}$/.test(values.provider) || !values.name.trim() || values.name.trim().length > 200) {
    throw new Error('provider 或来源名称不合法');
  }
  if (values.apply && (values.preflight || !values['confirm-text-only'] || !values.site || !/^[a-zA-Z0-9_-]{1,128}$/.test(values['run-id'] ?? ''))) {
    throw new Error('apply 必须显式确认仅文本、指定可信站点和稳定 run-id，不能与 preflight 同用');
  }
  return values;
}

function apiClient(site) {
  const url = new URL(site);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) { throw new Error('site 必须是无路径、无凭据的站点 origin'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) { throw new Error('仅允许 HTTPS 或本机 HTTP'); }
  if (process.env.ARCHIVE_TRUSTED_ORIGIN !== url.origin) { throw new Error('site 必须与 ARCHIVE_TRUSTED_ORIGIN 完全一致'); }
  const cookie = process.env.ARCHIVE_SESSION_COOKIE;
  const csrf = process.env.ARCHIVE_CSRF_TOKEN;
  if (!cookie || !csrf) { throw new Error('缺少管理员短期会话或 CSRF 环境变量'); }
  return async (endpoint, body) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await fetch(new URL('/api/admin/imports' + endpoint, url.origin), {
          method: body === undefined ? 'GET' : 'POST', redirect: 'manual', signal: globalThis.AbortSignal.timeout(30000),
          headers: { Cookie: cookie, 'X-CSRF-Token': csrf, Origin: url.origin, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      } catch {
        if (attempt < 2) { continue; }
        throw new ApiError('NETWORK_ERROR', 0);
      }
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.code === 'OK') { return payload.data; }
      if (response.status >= 500 && attempt < 2) { continue; }
      throw new ApiError(payload?.code || 'HTTP_' + response.status, response.status);
    }
    throw new ApiError('NETWORK_ERROR', 0);
  };
}

function emit(report) { console.log(JSON.stringify(report)); }

async function baselineFor(request, source, docs) {
  if (!request) { return new Map(); }
  const result = await request('/baseline', { provider: source.provider, namespace: source.namespace, docIds: docs.map((doc) => doc.docId) });
  return new Map(result.items.map((item) => [item.docId, item]));
}

async function submitText(request, runId, text, baseline, source) {
  const { contentHash: _hash, resourceSyntaxDetected: _syntax, ...payload } = text;
  let current = baseline;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await request('/' + runId + '/items', { ...payload, expectedVersion: current?.expectedVersion ?? 0, expectedHead: current?.expectedHead ?? null });
    } catch (error) {
      if (!(error instanceof ApiError) || !['ARCHIVE_HEAD_CONFLICT', 'IMPORT_CONFLICT'].includes(error.code) || attempt > 0) { throw error; }
      const refreshed = await baselineFor(request, source, [{ docId: text.docId }]);
      current = refreshed.get(text.docId);
    }
  }
}

async function processDoc(context, doc, baseline) {
  let text;
  try { text = await readArchiveDocument(context.backupRoot, doc); }
  catch (error) {
    const code = error instanceof TextImportError ? error.code : 'TEXT_INVALID';
    if (context.apply) { await context.request('/' + context.runId + '/items', { docId: doc.docId, errorCode: code }); }
    return { docId: doc.docId, action: 'failed', errorCode: code };
  }
  const predicted = context.request ? predictArchiveImport(baseline, text.contentHash) : 'uncompared';
  const result = context.apply ? await submitText(context.request, context.runId, text, baseline, context.source) : { docId: doc.docId, action: predicted };
  return { ...result, sourceUrlMissing: !text.sourceUrl, resourceSyntaxDetected: text.resourceSyntaxDetected, resourcesArchived: false };
}

async function main() {
  const args = options();
  if (args.help) { console.log(HELP); return; }
  const manifest = await loadArchiveManifest(args.source);
  const source = { provider: args.provider, namespace: args['source-key'], name: args.name.trim() };
  const request = args.site ? apiClient(args.site) : null;
  const apply = Boolean(args.apply);
  const runId = args['run-id'];
  emit({ mode: apply ? 'apply' : 'preflight', runId, manifestHash: manifest.manifestHash, total: manifest.docs.length, resourcesArchived: false,
    notice: '仅保存 Markdown 文本；图片、文件和外链资源均未归档，不代表完整备份' });
  if (apply) { await request('', { runId, source, manifestHash: manifest.manifestHash, expectedItems: manifest.docs.length }); }
  const context = { backupRoot: manifest.backupRoot, source, request, apply, runId };
  const counts = {};
  let incomplete = false;
  for (let offset = 0; offset < manifest.docs.length; offset += 50) {
    const batch = manifest.docs.slice(offset, offset + 50);
    const baseline = await baselineFor(request, source, batch);
    for (const doc of batch) {
      let result;
      try { result = await processDoc(context, doc, baseline.get(doc.docId)); }
      catch (error) {
        if (error instanceof ApiError && [401, 403].includes(error.status)) { throw error; }
        incomplete = true;
        result = { docId: doc.docId, action: 'failed', errorCode: error instanceof ApiError ? error.code : 'IMPORT_ERROR', retryable: true };
      }
      counts[result.action] = (counts[result.action] ?? 0) + 1;
      emit(result);
    }
  }
  if (apply && !incomplete) { emit({ finished: await request('/' + runId + '/finish', {}) }); }
  emit({ counts, incomplete, runId, resourcesArchived: false });
  if (counts.failed || incomplete || counts['blocked-deleted']) { process.exitCode = 1; }
}

main().catch((error) => {
  // Never print fetch error objects, headers, credentials or private Markdown bodies.
  console.error(JSON.stringify({ error: error instanceof ApiError ? error.code : 'PREFLIGHT_ERROR',
    message: error instanceof ApiError ? '请求失败；鉴权错误请更新会话，其余错误保留原批次 ID 重试' : error.message }));
  process.exitCode = 1;
});
