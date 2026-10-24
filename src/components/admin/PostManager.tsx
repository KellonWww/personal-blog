import { useI18n, withLocale } from '@/lib/i18n/react';
import { useEffect, useRef, useState } from 'react';
import type { PostSummary } from '@/types/domain';
import type { Paginated } from '@/types/api';
import type { PostArchiveResult, PostBatchResult, PostTaxonomy } from '@/types/post-actions';
import { adminRequest, adminWrite, errorMessage } from '@/lib/admin-api';
import { formatDate, formatNumber } from '@/lib/format';
import PostBatchToolbar, { POST_ACTION_LABELS, type PostManagerAction } from './PostBatchToolbar';

function PostManager({ token }: { token: string }) {
  const { t, locale } = useI18n();
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
    if (action === 'categories' || action === 'tags') warning = t('会替换所选文章的原有{0}；本次目标共 {1} 项，0 项表示清空。', t(action === 'categories' ? '分类' : '标签'), taxonomyIds?.length ?? 0);
    if (!window.confirm(t('确认对 {0} 篇文章执行「{1}」？', posts.length, t(label)) + '\n' + t(warning))) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    setActionError('');
    try {
      const ids = posts.map((post) => post.id);
      if (action === 'archive') {
        const response = await adminRequest<PostArchiveResult>('/api/admin/posts/to-archives', adminWrite(token, 'POST', { ids }));
        const created = response.items.filter((item) => item.action === 'created').length;
        setMessage(t('已新建 {0} 份私人档案，跳过 {1} 份已有档案；原文章和草稿均保留。', created, response.items.length - created));
      } else {
        const response = await adminRequest<PostBatchResult>('/api/admin/posts/batch', adminWrite(token, 'POST', { ids, action, taxonomyIds }));
        setMessage(t('{0}完成：实际更新 {1} 篇文章。', t(label), response.affected));
      }
      setSelected([]);
      setLoading(true);
      setRefresh((value) => value + 1);
    } catch (reason) { setActionError(errorMessage(reason)); }
    finally { lock.current = false; setBusy(false); }
  }

  return <>
    {busy && <p role="status" className="admin-notice">{t("正在执行操作，请勿重复提交…")}</p>}
    {message && <p role="status" className="admin-notice">{t(message)}</p>}
    {actionError && <div role="alert" className="admin-notice">{t(actionError)}<button type="button" className="btn" disabled={busy || loading} onClick={() => { setActionError(''); setRefresh((value) => value + 1); }}>{t("刷新核对")}</button></div>}
    {error && <div role="alert" className="admin-notice">{t(error)}<button type="button" className="btn" onClick={() => setRefresh((value) => value + 1)}>{t("重新加载")}</button></div>}
    <section className="admin-panel" aria-busy={loading || busy}>
      <div className="admin-toolbar">
        <form className="admin-search" role="search" onSubmit={(event) => { event.preventDefault(); if (!busy) { setPage(1); setSearch(searchInput.trim()); } }}>
          <input className="field" aria-label={t("搜索文章")} placeholder={t("搜索标题、摘要或路径…")} value={searchInput} maxLength={200} disabled={busy} onChange={(event) => setSearchInput(event.target.value)} />
          <button className="btn" type="submit" disabled={busy}>{t("搜索")}</button>
        </form>
        <select className="field" aria-label={t("文章状态")} value={status} disabled={busy} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">{t("全部状态")}</option><option value="published">{t("已发布")}</option><option value="draft">{t("草稿")}</option></select>
        <select className="field" aria-label={t("文章分类")} value={categoryId} disabled={busy} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}><option value="">{t("全部分类")}</option>{taxonomy.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select className="field" aria-label={t("是否为私文档")} value={privateDocument} disabled={busy} onChange={(event) => { setPrivateDocument(event.target.value); setPage(1); }}><option value="all">{t("是否为私文档：全部")}</option><option value="true">{t("是否为私文档：是")}</option><option value="false">{t("是否为私文档：否")}</option></select>
        {(search || status !== 'all' || categoryId || privateDocument !== 'all') && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setSearch(''); setSearchInput(''); setStatus('all'); setCategoryId(''); setPrivateDocument('all'); setPage(1); }}>{t("重置")}</button>}
      </div>
      <PostBatchToolbar count={selectedPosts.length} disabled={disabled} taxonomy={taxonomy} onApply={(action, terms) => void applyAction(selectedPosts, action, terms)} onClear={() => setSelected([])} />
      {loading ? <div role="status" className="admin-empty">{t("正在加载文章…")}</div> : t(error) ? <div className="admin-empty">{t("文章加载失败，请重试。")}</div> : items.length ? <div className="admin-table-scroll"><table className="admin-table"><thead><tr>
        <th className="post-selection-cell"><input ref={selectAll} type="checkbox" aria-label={t("选择当前页全部文章")} checked={allSelected} disabled={disabled} onChange={(event) => setSelected(event.target.checked ? items.map((post) => post.id) : [])} /></th>
        <th>{t("文章")}</th><th>{t("状态")}</th><th>{t("浏览 / 字数")}</th><th>{t("最近更新")}</th><th className="text-right">{t("操作")}</th>
      </tr></thead><tbody>{items.map((post) => <tr key={post.id} data-selected={selected.includes(post.id)}>
        <td className="post-selection-cell"><input type="checkbox" aria-label={t('选择《') + post.title + '》'} checked={selected.includes(post.id)} disabled={disabled} onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, post.id] : previous.filter((id) => id !== post.id))} /></td>
        <td><a className="admin-table-title" href={'/admin/editor?id=' + encodeURIComponent(post.id)}>{post.title}</a><p className="admin-table-subtitle">{post.categories.map((item) => item.name).join(' / ') || t('未分类')} · /{post.slug}</p></td>
        <td><span className="admin-status" data-status={post.status}>{post.status === 'published' ? t('已发布') : t('草稿')}</span></td>
        <td className="tabular-nums whitespace-nowrap">{formatNumber(post.viewCount, locale)} / {formatNumber(post.wordCount, locale)}</td><td className="whitespace-nowrap text-muted">{formatDate(post.updatedAt, locale)}</td>
        <td><div className="admin-row-actions"><a href={'/admin/editor?id=' + encodeURIComponent(post.id)}>{t("编辑")}</a>{post.status === 'published' && <a href={'/post/' + encodeURIComponent(post.slug)} target="_blank" rel="noreferrer">{t("查看 ↗")}</a>}
          <button type="button" disabled={disabled} onClick={() => void applyAction([post], 'archive')}>{t("转私人档案")}</button>
          <button type="button" disabled={disabled} onClick={() => void applyAction([post], post.status === 'published' ? 'draft' : 'publish')}>{post.status === 'published' ? t('下线') : t('发布')}</button>
          <button type="button" disabled={disabled} onClick={() => void applyAction([post], 'delete')}>{t("删除")}</button>
        </div></td>
      </tr>)}</tbody></table></div> : <div className="admin-empty"><p>{search || categoryId || status !== 'all' || privateDocument !== 'all' ? t('没有符合筛选条件的文章。') : t('还没有文章，开始你的第一篇记录。')}</p><a className="btn" href="/admin/editor">{t("写文章")}</a></div>}
      <div className="admin-pagination"><span>{result ? t('共 ') + result.total + t(' 篇文章') : t('文章列表')}</span><div><select className="field !w-auto" aria-label={t("每页文章数")} value={pageSize} disabled={busy} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={10}>{t("10 篇 / 页")}</option><option value={20}>{t("20 篇 / 页")}</option><option value={50}>{t("50 篇 / 页")}</option></select>
        <button type="button" className="btn" disabled={disabled || page <= 1} onClick={() => setPage((value) => value - 1)}>{t("上一页")}</button><span>{page} / {result?.totalPages ?? 1}</span><button type="button" className="btn" disabled={disabled || page >= (result?.totalPages ?? 1)} onClick={() => setPage((value) => value + 1)}>{t("下一页")}</button>
      </div></div>
    </section>
  </>;
}

export default withLocale(PostManager);
