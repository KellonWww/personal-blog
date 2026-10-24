import { useI18n, withLocale } from '@/lib/i18n/react';
import { useEffect, useMemo, useState } from 'react';

interface SearchItem {
  id: string;
  title: string;
  slug: string;
  summary: string;
  publishedAt: string | null;
  wordCount: number;
  tags: string[];
  categories: string[];
}

interface Props {
  inputId?: string;
  autoFocus?: boolean;
}

function SearchApp({ inputId = 'garden-search', autoFocus = false }: Props) {
  const { t } = useI18n();
  const [items, setItems] = useState<SearchItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    fetch('/api/search-index', { headers: { Accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) throw new Error('索引请求失败');
        return response.json() as Promise<{ data: { items: SearchItem[] } }>;
      })
      .then((payload) => {
        if (active) {
          setItems(payload.data?.items ?? []);
        }
      })
      .catch(() => {
        if (active) {
          setError('暂时没能加载文章索引，请再试一次。');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const results = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return items.slice(0, 12);
    }
    const terms = keyword.split(/\s+/).filter(Boolean);
    return items.filter((item) => {
      const haystack = [item.title, item.summary, item.tags.join(' '), item.categories.join(' ')].join(' ').toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [items, query]);

  return (
    <div className="search-app space-y-6">
      <div className="search-box">
        <label htmlFor={inputId} className="block mb-3 text-sm font-medium">{t("搜索关键词")}</label>
        <div className="search-input-row flex items-center gap-3">
        <svg className="search-input-icon" aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
        <input
          id={inputId}
          autoFocus={autoFocus}
          className="field"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("输入标题、标签或摘要关键词…")}
          autoComplete="off"
        />
        {query && <button type="button" className="btn" onClick={() => setQuery('')}>{t("清空")}</button>}
        </div>
        <p className="search-status mt-3 text-xs text-muted" role="status" aria-live="polite">
          {loading ? t('正在整理文章索引…') : error ? t('索引尚未就绪') : query ? t("找到 {0} 篇相关文章", results.length) : t("共 {0} 篇文章 · 展示最近 {1} 篇", items.length, results.length)}
          {query ? t('（按空格分隔可多关键词匹配）') : t('（默认展示最新文章）')}
        </p>
      </div>

      {error && <div role="alert" className="empty-state"><p>{t(error)}</p><button type="button" className="btn" onClick={() => setAttempt((value) => value + 1)}>{t("重新加载")}</button></div>}
      {loading && <div aria-hidden="true" className="search-skeleton">{[0, 1, 2].map((row) => <div key={row}><span /><span /></div>)}</div>}

      {!loading && !error && (results.length === 0 ? (
        <div className="empty-state"><h2>{t("没有匹配的文章。")}</h2><p>{t("尝试缩短关键词，或浏览文章分类。")}</p><a href="/categories" className="text-link">{t("浏览分类")}</a></div>
      ) : (
        <ul className="search-results space-y-3">
          {results.map((item) => (
            <li key={item.id} className="search-result border-b border-line py-4">
              <a href={`/post/${item.slug}`} className="search-result-title text-base font-semibold transition-colors hover:text-accent">{item.title}<span className="search-result-arrow" aria-hidden="true">↗</span></a>
              <p className="mt-1 line-clamp-2 text-sm text-muted">{item.summary || t('（暂无摘要）')}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                {item.categories.map((category) => <span key={category} className="chip">{category}</span>)}
                {item.tags.slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}
                <span className="ml-auto">{item.publishedAt?.slice(0, 10) ?? t('未发布')}</span>
              </div>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

export default withLocale(SearchApp);
