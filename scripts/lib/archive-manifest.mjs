import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

export const MAX_TEXT_LENGTH = 100000;
const MAX_TEXT_BYTES = 400000;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_DOCUMENTS = 10000;

export class TextImportError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function hashText(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function readBounded(root, relative, maxBytes) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative)) {
    throw new TextImportError('PATH_INVALID', '文本路径不合法');
  }
  const candidate = path.resolve(root, relative);
  if (!isWithin(root, candidate)) { throw new TextImportError('PATH_INVALID', '文本路径越过备份根目录'); }
  const real = await fs.realpath(candidate).catch(() => { throw new TextImportError('TEXT_MISSING', '文本不存在或不可读取'); });
  if (!isWithin(root, real)) { throw new TextImportError('PATH_INVALID', '软链接指向备份根目录之外'); }
  const handle = await fs.open(real, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) { throw new TextImportError('PATH_INVALID', '文本路径不是普通文件'); }
    if (stat.size > maxBytes) { throw new TextImportError('TEXT_TOO_LARGE', '文本字节数超过上限'); }
    const chunks = [];
    let size = 0;
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > maxBytes) { throw new TextImportError('TEXT_TOO_LARGE', '读取中文本超过字节上限'); }
      chunks.push(chunk);
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { throw new TextImportError('TEXT_ENCODING', '文本不是合法 UTF-8'); }
  } finally { await handle.close(); }
}

/** JSON.parse alone silently overwrites duplicate doc IDs; reject duplicate object keys first. */
export function parseUniqueJson(raw) {
  const parsed = JSON.parse(raw);
  const stack = [];
  for (const match of raw.matchAll(/"(?:\\.|[^"\\])*"|[{}[\],:]/g)) {
    const token = match[0];
    const current = stack.at(-1);
    if (token === '{') { stack.push({ keys: new Set(), keyExpected: true }); }
    else if (token === '[') { stack.push(null); }
    else if (token === '}' || token === ']') { stack.pop(); }
    else if (token === ',' && current) { current.keyExpected = true; }
    else if (token.startsWith('"') && current?.keyExpected) {
      const key = JSON.parse(token);
      if (current.keys.has(key)) { throw new Error('清单包含重复 JSON 键/文档身份'); }
      current.keys.add(key);
      current.keyExpected = false;
    }
  }
  return parsed;
}

export async function loadArchiveManifest(source) {
  const backupRoot = await fs.realpath(source);
  const raw = await readBounded(backupRoot, '.yuque-manifest.json', MAX_MANIFEST_BYTES);
  const manifest = parseUniqueJson(raw);
  if (!manifest || typeof manifest.docs !== 'object' || !manifest.docs || Array.isArray(manifest.docs)) {
    throw new Error('清单必须包含 docs 对象');
  }
  const entries = Object.entries(manifest.docs);
  if (!entries.length || entries.length > MAX_DOCUMENTS) { throw new Error('每批清单必须包含 1～10000 篇文档'); }
  const paths = new Set();
  const docs = entries.map(([docId, meta]) => {
    if (!docId || docId.length > 512 || /[\p{Cc}]/u.test(docId)) { throw new Error('清单文档身份不合法'); }
    if (!meta || typeof meta !== 'object' || typeof meta.path !== 'string') { throw new Error('清单文档必须有 path'); }
    const normalizedPath = path.normalize(meta.path);
    if (paths.has(normalizedPath)) { throw new Error('多个文档身份使用同一路径，整批停止'); }
    paths.add(normalizedPath);
    return { docId, meta };
  });
  return { backupRoot, docs, manifestHash: hashText(raw) };
}

function labels(value, fallback, max) {
  const values = value === undefined ? fallback : value;
  if (!Array.isArray(values) || values.length > max || values.some((label) => typeof label !== 'string' || !label.trim() || label.trim().length > 100 || /[\p{Cc}]/u.test(label))) {
    throw new TextImportError('TEXT_INVALID', '分类/标签超限或不合法');
  }
  return [...new Set(values.map((label) => label.trim().normalize('NFC')))].sort();
}

export async function readArchiveDocument(backupRoot, doc) {
  if (!/\.md$/i.test(doc.meta.path)) { throw new TextImportError('PATH_INVALID', '只允许 Markdown 文本'); }
  if (doc.meta.path.length > 1024) { throw new TextImportError('PATH_INVALID', '文本路径超过上限'); }
  const rawContent = await readBounded(backupRoot, doc.meta.path, MAX_TEXT_BYTES);
  if (rawContent.includes('\0')) { throw new TextImportError('TEXT_INVALID', 'Markdown 包含二进制空字节'); }
  if (rawContent.length > MAX_TEXT_LENGTH) { throw new TextImportError('TEXT_TOO_LARGE', 'Markdown 超过 100000 字符'); }
  const h1 = rawContent.match(/^\s*#\s+([^\r\n]+)/)?.[1];
  const title = (h1 || doc.meta.title || path.basename(doc.meta.path, '.md')).normalize('NFC').trim();
  if (!title || title.length > 200) { throw new TextImportError('TEXT_INVALID', '标题为空或超过 200 字符'); }
  const parts = doc.meta.path.replaceAll('\\', '/').split('/');
  const metadata = {
    categories: labels(doc.meta.categories, parts.length > 1 ? [parts[0]] : [], 10),
    tags: labels(doc.meta.tags, parts.length > 2 ? [parts[1]] : [], 20)
  };
  const sourceCandidate = doc.meta.source_url || doc.meta.url || '';
  let sourceUrl = '';
  try {
    const url = new URL(sourceCandidate);
    if (['https:', 'http:'].includes(url.protocol) && sourceCandidate.length <= 2000) { sourceUrl = sourceCandidate; }
  } catch { /* Missing/unreliable origin is reported, never guessed from a local path. */ }
  const content = rawContent.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').normalize('NFC');
  if (content.length > MAX_TEXT_LENGTH) { throw new TextImportError('TEXT_TOO_LARGE', '规范化文本超过上限'); }
  return {
    docId: doc.docId, title, rawContent, sourcePath: doc.meta.path, sourceUrl, metadata,
    contentHash: hashText(JSON.stringify({ title, content, metadata })),
    resourceSyntaxDetected: /!\[|<\s*(?:img|iframe|svg|object|embed)\b|\[[^\]]*\]\(/i.test(rawContent)
  };
}

export function predictArchiveImport(baseline, incomingHash) {
  if (baseline?.deleted) { return 'blocked-deleted'; }
  if (!baseline || !baseline.expectedVersion) { return 'created'; }
  if (baseline.latestHash === incomingHash) { return 'skipped'; }
  if (baseline.currentHash === incomingHash) { return 'updated'; }
  if (baseline.conflictState === 'none' && baseline.currentHash === baseline.acceptedHash) { return 'updated'; }
  return 'conflict';
}
