import { translator, type Locale } from './i18n';

export function toBoolean(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countWords(value: string): number {
  const chinese = value.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latin = value.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  return chinese + latin;
}

export function formatDate(value: string | null | undefined, locale: Locale = 'zh-CN'): string {
  if (!value) {
    return translator(locale)('未发布');
  }
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined, locale: Locale = 'zh-CN'): string {
  if (!value) {
    return translator(locale)('未发布');
  }
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

export function formatMonth(value: string, locale: Locale = 'zh-CN'): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(new Date(`${value}-01T00:00:00Z`));
}

export function formatNumber(value: number, locale: Locale = 'zh-CN'): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function readingTime(wordCount: number, locale: Locale = 'zh-CN'): string {
  return translator(locale)('{0} 分钟', Math.max(1, Math.ceil(wordCount / 400)));
}

export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
