import { useEffect, useRef, useState } from 'react';
import type { PostSummary } from '@/types/domain';
import type { Paginated } from '@/types/api';
import type { PostArchiveResult, PostBatchResult, PostTaxonomy } from '@/types/post-actions';
import { adminRequest, adminWrite, errorMessage } from '@/lib/admin-api';
import { formatDate, formatNumber } from '@/lib/format';
import PostBatchToolbar, { POST_ACTION_LABELS, type PostManagerAction } from './PostBatchToolbar';

export default function PostManager({ token }: { token: string }) {
  const [result, setResult] = useState<Paginated<PostSummary> | null>(null);
  const [taxonomy, setTaxonomy] = useState<PostTaxonomy>({ categories: [], tags: [] });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [categoryId, setCategoryId] = useState('');
  const [privateDocument, setPrivateDocument] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const lock = useRef(false);
  const selectAll = useRef<HTMLInputElement>(null);
  const items = result?.items ?? [];
  const selectedPosts = items.filter((post) => selected.includes(post.id));
  const allSelected = items.length > 0 && selectedPosts.length === items.length;
  const disabled = busy || loading || Boolean(error);

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selectedPosts.length > 0 && !allSelected;
  }, [selectedPosts.length, allSelected, loading]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSelected([]);
    setError('');
    const query = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize), search, categoryId, order: 'updated' });
    if (privateDocument !== 'all') query.set('privateDocument', privateDocument);
    Promise.all([
      adminRequest<Paginated<PostSummary>>('/api/admin/posts?' + query, { signal: controller.signal }),
      adminRequest<PostTaxonomy>('/api/admin/taxonomy', { signal: controller.signal })
    ]).then(([posts, terms]) => {
      if (controller.signal.aborted) return;
      if (page > posts.totalPages) { setPage(posts.totalPages); return; }
      setResult(posts);
      setTaxonomy(terms);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [status, page, pageSize, search, categoryId, privateDocument, refresh]);

  async function applyAction(posts: PostSummary[], action: PostManagerAction, taxonomyIds?: string[]) {
    if (lock.current || disabled || !posts.length) return;
    const label = POST_ACTION_LABELS[action];
    let warning = '';
    if (action === 'archive') warning = '仅复制标题、Markdown 正文、分类和标签；保留原文章及状态。已转存的文章会跳过，不覆盖档案编辑。已发布原文仍然公开，如需隐藏请另行撤回草稿。';
    if (action === 'publish') warning = '发布后内容将公开。档案关联稿不能从此入口发布，混选时整批不执行。';
    if (action === 'delete') warning = '文章将下线并删除，本版暂无回收站。已转存的私人档案不受影响。';
    if (action === 'categories' || action === 'tags') warning = '会替换所选文章的原有' + (action === 'categories' ? '分类' : '标签') + '；本次目标共 ' + (taxonomyIds?.length ?? 0) + ' 项，0 项表示清空。';
    if (!window.confirm('确认对 ' + posts.length + ' 篇文章执行「' + label + '」？\n' + warning)) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    setActionError('');
    try {
      const ids = posts.map((post) => post.id);
      if (action === 'archive') {
        const response = await adminRequest<PostArchiveResult>('/api/admin/posts/to-archives', adminWrite(token, 'POST', { ids }));
        const created = response.items.filter((item) => item.action === 'created').length;
        setMessage('已新建 ' + created + ' 份私人档案，跳过 ' + (response.items.length - created) + ' 份已有档案；原文章和草稿均保留。');
      } else {
        const response = await adminRequest<PostBatchResult>('/api/admin/posts/batch', adminWrite(token, 'POST', { ids, action, taxonomyIds }));
        setMessage(label + '完成：实际更新 ' + response.affected + ' 篇文章。');
      }
      setSelected([]);
      setLoading(true);
      setRefresh((value) => value + 1);
    } catch (reason) { setActionError(errorMessage(reason)); }
    finally { lock.current = false; setBusy(false); }
  }

  return <>
    {busy && <p role="status" className="admin-notice">正在执行操作，请勿重复提交…</p>}
    {message && <p role="status" className="admin-notice">{message}</p>}
    {actionError && <div role="alert" className="admin-notice">{actionError}<button type="button" className="btn" disabled={busy || loading} onClick={() => { setActionError(''); setRefresh((value) => value + 1); }}>刷新核对</button></div>}
    {error && <div role="alert" className="admin-notice">{error}<button type="button" className="btn" onClick={() => setRefresh((value) => value + 1)}>重新加载</button></div>}
    <section className="admin-panel" aria-busy={loading || busy}>
      <div className="admin-toolbar">
        <form className="admin-search" role="search" onSubmit={(event) => { event.preventDefault(); if (!busy) { setPage(1); setSearch(searchInput.trim()); } }}>
          <input className="field" aria-label="搜索文章" placeholder="搜索标题、摘要或路径…" value={searchInput} maxLength={200} disabled={busy} onChange={(event) => setSearchInput(event.target.value)} />
          <button className="btn" type="submit" disabled={busy}>搜索</button>
        </form>
        <select className="field" aria-label="文章状态" value={status} disabled={busy} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">全部状态</option><option value="published">已发布</option><option value="draft">草稿</option></select>
        <select className="field" aria-label="文章分类" value={categoryId} disabled={busy} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}><option value="">全部分类</option>{taxonomy.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select className="field" aria-label="是否为私文档" value={privateDocument} disabled={busy} onChange={(event) => { setPrivateDocument(event.target.value); setPage(1); }}><option value="all">是否为私文档：全部</option><option value="true">是否为私文档：是</option><option value="false">是否为私文档：否</option></select>
        {(search || status !== 'all' || categoryId || privateDocument !== 'all') && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setSearch(''); setSearchInput(''); setStatus('all'); setCategoryId(''); setPrivateDocument('all'); setPage(1); }}>重置</button>}
      </div>
      <PostBatchToolbar count={selectedPosts.length} disabled={disabled} taxonomy={taxonomy} onApply={(action, terms) => void applyAction(selectedPosts, action, terms)} onClear={() => setSelected([])} />
      {loading ? <div role="status" className="admin-empty">正在加载文章…</div> : error ? <div className="admin-empty">文章加载失败，请重试。</div> : items.length ? <div className="admin-table-scroll"><table className="admin-table"><thead><tr>
        <th className="post-selection-cell"><input ref={selectAll} type="checkbox" aria-label="选择当前页全部文章" checked={allSelected} disabled={disabled} onChange={(event) => setSelected(event.target.checked ? items.map((post) => post.id) : [])} /></th>
        <th>文章</th><th>状态</th><th>浏览 / 字数</th><th>最近更新</th><th className="text-right">操作</th>
      </tr></thead><tbody>{items.map((post) => <tr key={post.id} data-selected={selected.includes(post.id)}>
        <td className="post-selection-cell"><input type="checkbox" aria-label={'选择《' + post.title + '》'} checked={selected.includes(post.id)} disabled={disabled} onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, post.id] : previous.filter((id) => id !== post.id))} /></td>
        <td><a className="admin-table-title" href={'/admin/editor?id=' + encodeURIComponent(post.id)}>{post.title}</a><p className="admin-table-subtitle">{post.categories.map((item) => item.name).join(' / ') || '未分类'} · /{post.slug}</p></td>
        <td><span className="admin-status" data-status={post.status}>{post.status === 'published' ? '已发布' : '草稿'}</span></td>
        <td className="tabular-nums whitespace-nowrap">{formatNumber(post.viewCount)} / {formatNumber(post.wordCount)}</td><td className="whitespace-nowrap text-muted">{formatDate(post.updatedAt)}</td>
        <td><div className="admin-row-actions"><a href={'/admin/editor?id=' + encodeURIComponent(post.id)}>编辑</a>{post.status === 'published' && <a href={'/post/' + encodeURIComponent(post.slug)} target="_blank" rel="noreferrer">查看 ↗</a>}
          <button type="button" disabled={disabled} onClick={() => void applyAction([post], 'archive')}>转私人档案</button>
          <button type="button" disabled={disabled} onClick={() => void applyAction([post], post.status === 'published' ? 'draft' : 'publish')}>{post.status === 'published' ? '下线' : '发布'}</button>
          <button type="button" disabled={disabled} onClick={() => void applyAction([post], 'delete')}>删除</button>
        </div></td>
      </tr>)}</tbody></table></div> : <div className="admin-empty"><p>{search || categoryId || status !== 'all' || privateDocument !== 'all' ? '没有符合筛选条件的文章。' : '还没有文章，开始你的第一篇记录。'}</p><a className="btn" href="/admin/editor">写文章</a></div>}
      <div className="admin-pagination"><span>{result ? '共 ' + result.total + ' 篇文章' : '文章列表'}</span><div><select className="field !w-auto" aria-label="每页文章数" value={pageSize} disabled={busy} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={10}>10 篇 / 页</option><option value={20}>20 篇 / 页</option><option value={50}>50 篇 / 页</option></select>
        <button type="button" className="btn" disabled={disabled || page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page} / {result?.totalPages ?? 1}</span><button type="button" className="btn" disabled={disabled || page >= (result?.totalPages ?? 1)} onClick={() => setPage((value) => value + 1)}>下一页</button>
      </div></div>
    </section>
  </>;
}
