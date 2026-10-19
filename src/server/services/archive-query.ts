import { z } from 'zod';

export const ARCHIVE_PAGE_SIZE = 20;
export const ARCHIVE_MAX_PAGE_SIZE = 50;
export const ARCHIVE_SNIPPET_LENGTH = 180;
export const ARCHIVE_MAX_QUERY_TERMS = 8;

export const archiveIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const archivePageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(ARCHIVE_MAX_PAGE_SIZE).default(ARCHIVE_PAGE_SIZE)
});
export const archiveQuerySchema = archivePageSchema.extend({
  q: z.string().trim().max(200).superRefine((value, ctx) => {
    const terms = value.split(/\s+/u).filter(Boolean);
    if (new Set(terms).size > ARCHIVE_MAX_QUERY_TERMS) {
      ctx.addIssue({ code: 'custom', message: '搜索最多支持 8 个关键词' });
    }
    if (/[\p{Cc}]/u.test(value)) {
      ctx.addIssue({ code: 'custom', message: '搜索词不能包含控制字符' });
    }
  }).default(''),
  source: archiveIdSchema.optional(),
  category: archiveIdSchema.optional(),
  tag: archiveIdSchema.optional(),
  conflict: z.enum(['none', 'pending']).optional()
});
export type ArchiveQuery = z.infer<typeof archiveQuerySchema>;
export type ArchivePagination = z.infer<typeof archivePageSchema>;

/** Escape MATCH syntax as literal phrases; short words require a body scan, not an empty FTS hit. */
export function splitArchiveTerms(query: string): { match: string; shortTerms: string[] } {
  const terms = [...new Set(query.trim().split(/\s+/u).filter(Boolean))];
  if (terms.length > ARCHIVE_MAX_QUERY_TERMS) {
    throw new Error('搜索最多支持 8 个关键词');
  }
  if (terms.some((term) => /[\p{Cc}]/u.test(term))) {
    throw new Error('搜索词不能包含控制字符');
  }
  const longTerms = terms.filter((term) => Array.from(term).length >= 3);
  return {
    match: longTerms.map((term) => '"' + term.replaceAll('"', '""') + '"').join(' AND '),
    shortTerms: terms.filter((term) => Array.from(term).length < 3)
  };
}

/** Plain text only. Consumers must render this as text, never as an HTML fragment. */
export function archiveSnippet(text: string, query: string): string {
  const terms = query.trim().split(/\s+/u).filter(Boolean);
  const folded = text.toLowerCase();
  const positions = terms.map((term) => folded.indexOf(term.toLowerCase())).filter((index) => index >= 0);
  const hit = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, hit - 40);
  const excerpt = text.slice(start, start + ARCHIVE_SNIPPET_LENGTH);
  return (start ? '…' : '') + excerpt + (start + excerpt.length < text.length ? '…' : '');
}
