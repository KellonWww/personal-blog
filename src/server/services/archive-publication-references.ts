import { Marked } from 'marked';
import type { ArchivePublicationReference, ArchivePublicationSnapshot } from '@/types/archive';

export const PUBLICATION_REVIEW_POLICY = 'text-review-v2';
const MAX_REFERENCES = 200;
const MAX_URL_LENGTH = 2048;
// Isolated lexer: do not mutate the public renderer or request any referenced resource.
const markdown = new Marked({ gfm: true, breaks: true });

function urlReason(value: string): { verdict: 'blocked' | 'review'; reason: string } {
  const blocked = (reason: string) => ({ verdict: 'blocked' as const, reason });
  if (!value || value.length > MAX_URL_LENGTH) { return blocked('地址为空或超过 2048 字符'); }
  // Fail closed on encoded/entity-obfuscated addresses; this review does not normalize them into approval.
  if (/[\\\s%&<>]/u.test(value) || [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) { return blocked('地址含空白、编码、实体或不明确字符，需改成可直接审阅的地址'); }
  if (value.startsWith('#')) { return { verdict: 'review', reason: '页内锚点；仍需人工核对目标' }; }
  if (value.startsWith('/api/media/') && !value.includes('..') && /^\/api\/media\/[A-Za-z0-9_./-]+$/.test(value)) {
    return { verdict: 'review', reason: '既有公开媒体接口；未读取资源或核验存在性/公开授权' };
  }
  if (!/^https?:\/\//i.test(value)) { return blocked('只接受明确 HTTP(S) 地址、页内锚点或既有公开媒体路径'); }
  let url: URL;
  try { url = new URL(value); } catch { return blocked('地址无法解析'); }
  if (url.username || url.password || (url.port && url.port !== '80' && url.port !== '443')) {
    return blocked('地址含凭据或非标准端口');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion|home|lan|arpa)$/.test(host)) {
    return blocked('不接受 IP、本地主机、保留域或无法明确审阅的主机名');
  }
  if (/\/(?:admin|archives?|archive-sources|archive-taxonomy|imports?|api)(?:\/|$)/i.test(url.pathname)) {
    return blocked('地址指向管理、档案或 API 路径；请改用明确公开的引用');
  }
  return { verdict: 'review', reason: '外部 HTTP(S) 地址：未做 DNS、重定向、登录要求或内容可用性验证；需人工确认公开引用权限' };
}

export function inspectPublicationReferences(snapshot: ArchivePublicationSnapshot) {
  const references: ArchivePublicationReference[] = [];
  const blockers: string[] = [];
  let overflow = false;
  let unsupportedDiagram = false;
  function add(kind: ArchivePublicationReference['kind'], value: string) {
    if (references.length >= MAX_REFERENCES) { overflow = true; return; }
    references.push({ kind, value, ...urlReason(value) });
  }
  if (snapshot.coverImage) { add('cover', snapshot.coverImage); }
  if (snapshot.authorAvatar) { add('avatar', snapshot.authorAvatar); }
  const tokens = markdown.lexer(snapshot.content);
  markdown.walkTokens(tokens, (token) => {
    if (token.type === 'code' && /^mermaid(?:\s|$)/i.test(token.lang ?? '')) { unsupportedDiagram = true; }
    if (token.type === 'link' || token.type === 'image') { add(token.type, token.href); }
    if (token.type === 'html' && !/^(?:\s*<br\s*\/?\s*>\s*)+$/i.test(token.text)) {
      if (references.length >= MAX_REFERENCES) { overflow = true; return; }
      references.push({ kind: 'html', value: token.text, verdict: 'blocked', reason: '原始 HTML 不进入资源审阅；请改为 Markdown 或移除' });
    }
  });
  if (unsupportedDiagram) { blockers.push('Mermaid 代码块可能含图片或链接，当前无法完整核查；请改为普通代码块或移除后发布'); }
  if (overflow) { blockers.push('引用超过 200 条，清单不完整；请精简后重新读取'); }
  if (references.some((item) => item.verdict === 'blocked')) { blockers.push('存在不明确或不允许的资源引用，请修改博客草稿后重新读取'); }
  return { references, blockers };
}
