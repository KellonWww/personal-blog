import { useEffect, useState } from 'react';
import { archiveRequest } from '@/lib/archive-admin';
import { errorMessage } from '@/lib/admin-api';
import { formatDate } from '@/lib/format';
import type { ArchivePage, ArchiveSummary } from '@/types/archive';
import ArchiveWorkspace from './ArchiveWorkspace';

type Source = { id: string; name: string };
type Term = { id: string; name: string; kind: 'category' | 'tag' };
const PAGE_SIZE = 20;
const LOOKUP_SIZE = 50;

export default function ArchiveManager({ token, onDirtyChange }: { token: string; onDirtyChange: (dirty: boolean) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<ArchivePage<ArchiveSummary> | null>(null);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [category, setCategory] = useState('');
  const [tag, setTag] = useState('');
  const [conflict, setConflict] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [lookupPage, setLookupPage] = useState(1);
  const [moreSources, setMoreSources] = useState(true);
  const [moreTerms, setMoreTerms] = useState(true);
  const [lookupError, setLookupError] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);

  useEffect(() => {
    if (selected) { return; }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setResult(null);
    const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), q: search });
    for (const [key, value] of Object.entries({ source, category, tag, conflict })) {
      if (value) { query.set(key, value); }
    }
    archiveRequest<ArchivePage<ArchiveSummary>>('/api/admin/archives?' + query, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) { return; }
        if (page > 1 && !data.items.length) { setPage(1); return; }
        setResult(data);
      }).catch((reason: unknown) => { if (!controller.signal.aborted) { setError(errorMessage(reason)); } })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); } });
    return () => controller.abort();
  }, [page, search, source, category, tag, conflict, selected, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    setLookupError('');
    setLookupLoading(true);
    const suffix = '?page=' + lookupPage + '&pageSize=' + LOOKUP_SIZE;
    Promise.all([
      archiveRequest<{ items: Source[] }>('/api/admin/archive-sources' + suffix, { signal: controller.signal }),
      archiveRequest<{ items: Term[] }>('/api/admin/archive-taxonomy' + suffix, { signal: controller.signal })
    ]).then(([sourcePage, termPage]) => {
      if (controller.signal.aborted) { return; }
      setSources((old) => [...new Map([...old, ...sourcePage.items].map((item) => [item.id, item])).values()]);
      setTerms((old) => [...new Map([...old, ...termPage.items].map((item) => [item.id, item])).values()]);
      setMoreSources(sourcePage.items.length === LOOKUP_SIZE);
      setMoreTerms(termPage.items.length === LOOKUP_SIZE);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) { setLookupError(errorMessage(reason)); } })
      .finally(() => { if (!controller.signal.aborted) { setLookupLoading(false); } });
    return () => controller.abort();
  }, [lookupPage, refresh]);

  if (selected) {
    return <ArchiveWorkspace key={selected} archiveId={selected} token={token} onDirtyChange={onDirtyChange}
      onBack={() => { setSelected(null); setLookupPage(1); setSources([]); setTerms([]); setRefresh((value) => value + 1); }} />;
  }
  return <>
    <p className="admin-notice">私人文本空间 · 不会自动发布，也不备份图片和附件。关闭状态下仅显示启用提示，不查询档案内容。</p>
    {error && <div role="alert" className="admin-notice">{error}<button type="button" className="btn" onClick={() => setRefresh((value) => value + 1)}>重试</button></div>}
    <section className="admin-panel" aria-busy={loading}>
      <form className="admin-toolbar" role="search" onSubmit={(event) => { event.preventDefault(); setSearch(input.trim()); setPage(1); }}>
        <div className="admin-search"><input className="field" aria-label="检索私人档案" placeholder="搜索正文、标题或代码…" maxLength={200} value={input} onChange={(event) => setInput(event.target.value)} /><button className="btn" type="submit">检索</button></div>
        <select className="field" aria-label="来源" value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}><option value="">全部来源</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        {(['category', 'tag'] as const).map((kind) => <select key={kind} className="field" aria-label={kind === 'category' ? '私有分类' : '私有标签'} value={kind === 'category' ? category : tag} onChange={(event) => { (kind === 'category' ? setCategory : setTag)(event.target.value); setPage(1); }}><option value="">{kind === 'category' ? '全部私有分类' : '全部私有标签'}</option>{terms.filter((item) => item.kind === kind).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>)}
        <select className="field" aria-label="冲突状态" value={conflict} onChange={(event) => { setConflict(event.target.value); setPage(1); }}><option value="">全部档案</option><option value="pending">待解决冲突</option><option value="none">无冲突</option></select>
      </form>
      {lookupError ? <p role="alert" className="archive-note">筛选项加载失败：{lookupError} <button type="button" className="btn" onClick={() => setRefresh((value) => value + 1)}>重试筛选项</button></p> : (moreSources || moreTerms) && <p className="archive-note"><button className="btn" type="button" disabled={lookupLoading || lookupPage >= 10000} onClick={() => setLookupPage((value) => value + 1)}>{lookupLoading ? '加载筛选项…' : '继续加载来源与私有词表'}</button><span>已载入 {sources.length} 个来源、{terms.length} 个词条</span></p>}
      {loading ? <div role="status" className="admin-empty">正在检索私人档案…</div> : result && <>
        {result.items.length ? <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th scope="col">档案</th><th scope="col">来源</th><th scope="col">状态</th><th scope="col">更新</th></tr></thead><tbody>{result.items.map((item) => <tr key={item.id}><td><button type="button" className="admin-table-title archive-open" onClick={() => setSelected(item.id)}>{item.title}</button><p className="archive-snippet">{item.snippet}</p></td><td>{item.sourceName}</td><td><span className="admin-status">{item.conflictState === 'pending' ? '待解决冲突' : '私有'} · v{item.version}</span></td><td>{formatDate(item.updatedAt)}</td></tr>)}</tbody></table></div> : <div className="admin-empty">没有匹配档案。文本导入仍通过 CLI 人工执行，不会扫描本地资料。</div>}
        <div className="admin-pagination"><span>共 {result.total} 篇 · 第 {page} 页</span><div><button type="button" className="btn" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><button type="button" className="btn" disabled={page * PAGE_SIZE >= result.total || page >= 10000} onClick={() => setPage((value) => value + 1)}>下一页</button></div></div>
      </>}
    </section>
  </>;
}
