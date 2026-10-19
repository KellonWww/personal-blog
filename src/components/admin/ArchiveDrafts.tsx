import { useEffect, useState } from 'react';
import ArchivePublicationReview from '@/components/admin/ArchivePublicationReview';
import { archiveRequest } from '@/lib/archive-admin';
import { errorMessage } from '@/lib/admin-api';
import type { ArchivePublication } from '@/types/archive';

const PAGE_SIZE = 20;
export default function ArchiveDrafts({ archiveId, token, disabled, onDirtyChange }: {
  archiveId: string; token: string; disabled: boolean; onDirtyChange: (dirty: boolean) => void;
}) {
  const [reviewDirty, setReviewDirty] = useState(false);
  useEffect(() => { onDirtyChange(reviewDirty); }, [reviewDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const [inspected, setInspected] = useState('');
  const [items, setItems] = useState<ArchivePublication[]>([]);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    archiveRequest<{ items: ArchivePublication[] }>('/api/admin/archives/' + encodeURIComponent(archiveId) +
      '/publications?page=' + page + '&pageSize=' + PAGE_SIZE, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setItems(result.items); } })
      .catch((reason: unknown) => { if (!controller.signal.aborted) { setError(errorMessage(reason)); } })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); } });
    return () => controller.abort();
  }, [archiveId, page, refresh]);
  return <section className="admin-panel archive-section">
    <h2>已转博客稿</h2>
    <p className="archive-note">这里只显示关联记录，不请求图片或打开公开页面。删除草稿不会解除档案关联；来源更新不会覆盖已转稿。</p>
    {loading ? <p role="status">正在读取转稿记录…</p> : error ? <div role="alert"><p>{error}</p><button type="button" className="btn" onClick={() => setRefresh((value) => value + 1)}>重试读取</button></div> : items.length ?
      <ul>{items.map((item) => <li key={item.id}>
        <p>{item.postDeleted ? '已删除' : item.postStatus === 'draft' ? '私有草稿' : '已发布'} · {item.createdAt}</p>
        {!item.postDeleted && <button type="button" className="btn" disabled={reviewDirty || disabled} onClick={() => setInspected(item.id)}>审阅确认</button>}
        <label className="archive-label">博客文章 ID<input className="field" readOnly value={item.postId} onFocus={(event) => event.currentTarget.select()} /></label>
      </li>)}</ul> : <p>本页没有转稿记录。</p>}
    {inspected && <ArchivePublicationReview key={archiveId + ':' + inspected} archiveId={archiveId} publicationId={inspected} token={token} disabled={disabled} onDirtyChange={setReviewDirty} onConfirmed={() => setRefresh((value) => value + 1)} onClose={() => setInspected('')} />}
    <div className="archive-actions">
      <button type="button" className="btn" disabled={reviewDirty || loading || page === 1} onClick={() => setPage((value) => value - 1)}>上一页</button>
      <span>第 {page} 页</span>
      <button type="button" className="btn" disabled={reviewDirty || loading || Boolean(error) || items.length < PAGE_SIZE} onClick={() => setPage((value) => value + 1)}>下一页</button>
    </div>
  </section>;
}
