import { useI18n, withLocale } from '@/lib/i18n/react';
import AdminArrow from './AdminArrow';
import { useEffect, useState } from 'react';
import type { PostSummary } from '@/types/domain';
import { adminRequest, errorMessage } from '@/lib/admin-api';
import { formatNumber, formatDate } from '@/lib/format';
import type { AdminView } from './AdminShell';
import type { ModerationItem } from './ModerationManager';

interface Stats { publishedPosts: number; draftPosts: number; comments: number; pendingComments: number; pendingGuestbook: number; guestbook: number }
interface Props { onNavigate: (view: AdminView) => void }

function AdminOverview({ onNavigate }: Props) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<{ stats: Stats; posts: PostSummary[]; queue: ModerationItem[] } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    Promise.all([
      adminRequest<Stats>('/api/admin/stats', { signal: controller.signal }),
      adminRequest<{ items: PostSummary[] }>('/api/admin/posts?status=all&pageSize=5&order=updated', { signal: controller.signal }),
      adminRequest<{ items: ModerationItem[] }>('/api/admin/comments?status=pending', { signal: controller.signal })
    ]).then(([stats, posts, queue]) => { if (!controller.signal.aborted) setData({ stats, posts: posts.items, queue: queue.items }); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(errorMessage(reason)); });
    return () => controller.abort();
  }, [retry]);
  if (error) return <div role="alert" className="admin-notice">{t(error)}<button type="button" className="btn" onClick={() => setRetry((value) => value + 1)}>{t("重试")}</button></div>;
  if (!data) return <div role="status" className="admin-empty">{t("正在查看花园近况…")}</div>;
  const latest = data.posts[0];
  const pending = data.stats.pendingComments + data.stats.pendingGuestbook;
  const metrics = [
    { label: '已发布', value: data.stats.publishedPosts, note: '篇公开文章' },
    { label: '草稿', value: data.stats.draftPosts, note: '篇尚未发布' },
    { label: '待审核', value: pending, note: '条评论与留言' },
    { label: '互动', value: data.stats.comments + data.stats.guestbook, note: '条累计，含待审与隐藏' }
  ];
  return <div className="admin-desk-layout">
    <div className="admin-desk-primary">
      <section className="admin-manuscript" aria-labelledby="manuscript-title" data-motion>
        <div className="admin-section-label"><span>{latest ? t('上次编辑到这里') : t('写作从这里开始')}</span>{latest && <span className="admin-status" data-status={latest.status}>{latest.status === 'published' ? t('已发布') : t('草稿')}</span>}</div>
        <h2 id="manuscript-title">{latest?.title || t('还没有文章，写下第一篇。')}</h2>
        <p className="admin-manuscript-summary">{latest ? latest.summary || t('打开文章，继续编辑正文。') : t('随笔、笔记，或一个还没想清楚的问题，都可以先存为草稿。')}</p>
        {latest && <p className="admin-manuscript-meta"><span>{t("更新于")}{formatDate(latest.updatedAt, locale)}</span><span>{t("{0} 字", formatNumber(latest.wordCount, locale))}</span></p>}
        <a href={latest ? `/admin/editor?id=${encodeURIComponent(latest.id)}` : '/admin/editor'} className="admin-continue">{latest ? t('继续编辑') : t('新建第一篇文章')}<AdminArrow /></a>
      </section>
      <section className="admin-ledger" aria-labelledby="recent-title">
        <div className="admin-section-heading"><h2 id="recent-title">{t("最近编辑")}</h2><button type="button" onClick={() => onNavigate('posts')}>{t("管理全部文章")}</button></div>
        {data.posts.length ? <div className="admin-recent-list">{data.posts.map((post) => <a key={post.id} href={`/admin/editor?id=${encodeURIComponent(post.id)}`} className="admin-recent-row">
          <span className="admin-recent-title">{post.title}</span>
          <span className="admin-status" data-status={post.status}>{post.status === 'published' ? t('已发布') : t('草稿')}</span>
          <span className="admin-recent-date">{formatDate(post.updatedAt, locale)}</span>
          <AdminArrow className="admin-recent-arrow" />
        </a>)}</div> : <div className="admin-ledger-empty"><p>{t("这里会留下每一次编辑的进度。")}</p><span>{t("文章创建后，最近修改的内容会出现在这里。")}</span></div>}
      </section>
    </div>
    <aside className="admin-desk-secondary" aria-label={t("站点近况与待办")}>
      <section className="admin-census" aria-labelledby="census-title">
        <div className="admin-section-heading"><h2 id="census-title">{t("内容账目")}</h2><span>{t("当前累计")}</span></div>
        <dl className="admin-census-list">{metrics.map((metric) => <div className="admin-census-row" key={metric.label}><dt>{t(metric.label)}<span>{t(metric.note)}</span></dt><dd className="admin-metric-value">{formatNumber(metric.value, locale)}</dd></div>)}</dl>
      </section>
      <section className="admin-inbox" aria-labelledby="inbox-title">
        <div className="admin-section-heading"><h2 id="inbox-title">{t("待审核互动")}</h2><button type="button" onClick={() => onNavigate('moderation')}>{t("查看待办")}{pending > 0 && ` (${formatNumber(pending, locale)})`}</button></div>
        {data.queue.length ? data.queue.slice(0, 3).map((item) => <div className="admin-inbox-item" key={`${item.type}-${item.id}`}><div className="admin-feed-meta"><span className="admin-inbox-author">{item.userName}</span><span>{item.type === 'comment' ? t('文章评论') : t('留言')}</span></div><p className="admin-inbox-content">{item.content}</p>{item.title && <p className="admin-table-subtitle">{item.title}</p>}</div>) : <div className="admin-ledger-empty"><p>{pending ? t('暂无可展示的预览。') : t('待办已清空。')}</p><span>{pending ? t('进入审核页查看评论与留言。') : t('新的评论与留言会在这里等你。')}</span></div>}
      </section>
      <a className="admin-library-link" href="/private"><span>{t("私人文库")}<small>{t("在阅读页翻阅自己的档案")}</small></span><AdminArrow /></a>
    </aside>
  </div>;
}

export default withLocale(AdminOverview);
