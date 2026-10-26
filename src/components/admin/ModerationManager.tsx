import { useI18n, withLocale } from '@/lib/i18n/react';
import { useEffect, useRef, useState } from 'react';
import type { ModerationStatus } from '@/types/domain';
import { adminRequest, adminWrite, errorMessage } from '@/lib/admin-api';
import { formatDateTime } from '@/lib/format';

export interface ModerationItem { type: 'comment' | 'guestbook'; id: string; title: string; content: string; userName: string; createdAt: string; status: ModerationStatus }
const LABELS: Record<ModerationStatus, string> = { pending: '待审核', approved: '已通过', hidden: '已隐藏' };
const itemKey = (item: ModerationItem) => `${item.type}-${item.id}`;

function ModerationManager({ token }: { token: string }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<ModerationItem[]>([]);
  const [status, setStatus] = useState('pending');
  const [type, setType] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setSelected([]);
    adminRequest<{ items: ModerationItem[] }>(`/api/admin/comments?status=${status}`, { signal: controller.signal })
      .then((result) => setItems(result.items))
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [status, refresh]);
  const filtered = items.filter((item) => type === 'all' || item.type === type);
  const totalPages = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * 10, currentPage * 10);

  async function moderate(targets: ModerationItem[], nextStatus: ModerationStatus) {
    if (!targets.length || lock.current) return;
    lock.current = true; setBusy(true); setMessage(''); setError('');
    let succeeded = 0;
    const failures: string[] = [];
    try {
      // Reuse the existing per-item API with bounded concurrency, not an unbounded request burst.
      for (let offset = 0; offset < targets.length; offset += 5) {
        const results = await Promise.allSettled(targets.slice(offset, offset + 5).map((item) => adminRequest('/api/admin/comments', adminWrite(token, 'PATCH', { type: item.type, id: item.id, status: nextStatus }))));
        results.forEach((result) => { if (result.status === 'fulfilled') succeeded++; else failures.push(errorMessage(result.reason)); });
      }
      setMessage(failures.length ? t('已处理 {0} 条，{1} 条失败：{2}', succeeded, failures.length, t(failures[0])) : t('已处理 {0} 条', succeeded));
      setRefresh((value) => value + 1);
    } finally { lock.current = false; setBusy(false); }
  }

  return <>
    {message && <p role="status" className="admin-notice">{t(message)}</p>}
    {error && <div role="alert" className="admin-notice">{t(error)}<button type="button" className="btn" onClick={() => setRefresh((value) => value + 1)}>{t("重试")}</button></div>}
    <section className="admin-panel" aria-busy={loading}>
      <div className="admin-toolbar"><select className="field" aria-label={t("审核状态")} disabled={busy} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="pending">{t("待审核")}</option><option value="approved">{t("已通过")}</option><option value="hidden">{t("已隐藏")}</option><option value="all">{t("全部状态")}</option></select><select className="field" aria-label={t("互动类型")} disabled={busy} value={type} onChange={(event) => { setType(event.target.value); setPage(1); setSelected([]); }}><option value="all">{t("评论与留言")}</option><option value="comment">{t("文章评论")}</option><option value="guestbook">{t("留言板")}</option></select><span className="text-xs text-muted">{t("每种类型最近 100 条")}</span></div>
      {!loading && !error && visible.length > 0 && <div className="admin-toolbar admin-moderation-bulk"><label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={busy} checked={visible.every((item) => selected.includes(itemKey(item)))} onChange={(event) => setSelected(event.target.checked ? visible.map(itemKey) : [])} />{t("选择本页")}</label><span className="text-xs text-muted">{t("已选 {0} 条", selected.length)}</span><div className='admin-moderation-batch-actions'><button type="button" className="btn" disabled={busy || !selected.length} onClick={() => moderate(filtered.filter((item) => selected.includes(itemKey(item))), 'approved')}>{t("批量通过")}</button><button type="button" className="btn" disabled={busy || !selected.length} onClick={() => moderate(filtered.filter((item) => selected.includes(itemKey(item))), 'hidden')}>{t("批量隐藏")}</button></div></div>}
      {loading ? <div role='status' className='admin-empty'>{t('正在加载互动…')}</div>
        : error ? <div className='admin-empty'>{t('加载失败，请重试。')}</div>
        : visible.length ? visible.map((item) => (
          <article className='admin-feed-item' key={itemKey(item)}>
            <input
              className='admin-feed-select'
              aria-label={t('选择 {0} 的互动', item.userName)}
              type='checkbox'
              disabled={busy}
              checked={selected.includes(itemKey(item))}
              onChange={(event) => setSelected(event.target.checked
                ? [...selected, itemKey(item)]
                : selected.filter((key) => key !== itemKey(item)))}
            />
            <div className='admin-feed-content'>
              <div className='admin-feed-meta'>
                <strong className='text-ink'>{item.userName}</strong>
                <span>{item.type === 'comment' ? t('文章评论') : t('留言板')}</span>
                <span className='admin-status' data-status={item.status}>{t(LABELS[item.status])}</span>
                <time>{formatDateTime(item.createdAt, locale)}</time>
              </div>
              <p className='admin-table-subtitle'>{t('来自：')}{item.title}</p>
              <p className='admin-moderation-body'>{item.content}</p>
            </div>
            <div className='admin-moderation-actions'>
              {item.status !== 'approved' && <button type='button' className='btn' disabled={busy} onClick={() => moderate([item], 'approved')}>{t('通过')}</button>}
              {item.status !== 'hidden' && <button type='button' className='btn' disabled={busy} onClick={() => moderate([item], 'hidden')}>{t('隐藏')}</button>}
              {item.status !== 'pending' && <button type='button' className='btn btn-ghost' disabled={busy} onClick={() => moderate([item], 'pending')}>{t('重新待审')}</button>}
            </div>
          </article>
        )) : <div className='admin-empty'>{t('当前条件下没有互动内容。')}</div>}
      <div className="admin-pagination"><span>{t("当前列表 {0} 条", filtered.length)}</span><div><button type="button" className="btn" disabled={loading || busy || currentPage <= 1} onClick={() => { setPage(currentPage - 1); setSelected([]); }}>{t("上一页")}</button><span>{currentPage} / {totalPages}</span><button type="button" className="btn" disabled={loading || busy || currentPage >= totalPages} onClick={() => { setPage(currentPage + 1); setSelected([]); }}>{t("下一页")}</button></div></div>
    </section>
  </>;
}

export default withLocale(ModerationManager);
