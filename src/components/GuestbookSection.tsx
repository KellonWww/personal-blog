import { useI18n, withLocale } from '@/lib/i18n/react';
import { useEffect, useState } from 'react';
import type { GuestbookItem, SessionUser } from '@/types/domain';

interface Props {
  initialItems: GuestbookItem[];
  initialTotal: number;
}

function GuestbookNode({ item, onReply }: { item: GuestbookItem; onReply: (id: string, name: string) => void }) {
  const { t } = useI18n();
  return (
    <li className="space-y-2">
      <div className="flex gap-3">
        {item.avatarUrl ? (
          <img src={item.avatarUrl} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-full border border-line object-cover" loading="lazy" />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-paper-soft text-sm text-accent">{item.name.slice(0, 1) || t('访')}</span>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {item.website ? (
              <a href={item.website} target="_blank" rel="noopener noreferrer" className="font-medium text-ink hover:text-accent">{item.name}</a>
            ) : (
              <span className="font-medium text-ink">{item.name}</span>
            )}
            <time>{item.createdAt}</time>
            <button type="button" className="hover:text-accent" onClick={() => onReply(item.id, item.name)}>{t("回复")}</button>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.content}</p>
        </div>
      </div>
      {item.replies && item.replies.length > 0 && (
        <ul className="ml-12 space-y-4 border-l border-line pl-4">
          {item.replies.map((reply) => (
            <GuestbookNode key={reply.id} item={reply} onReply={onReply} />
          ))}
        </ul>
      )}
    </li>
  );
}

function GuestbookSection({ initialItems, initialTotal }: Props) {
  const { t } = useI18n();
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [content, setContent] = useState('');
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [parentId, setParentId] = useState('');
  const [parentName, setParentName] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/me', { headers: { Accept: 'application/json' } })
      .then((response) => response.json() as Promise<{ data: { user: SessionUser | null } }>)
      .then((payload) => {
        if (active) {
          setUser(payload.data?.user ?? null);
          if (payload.data?.user) {
            setName(payload.data.user.displayName || payload.data.user.username);
          }
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function reload() {
    const response = await fetch('/api/guestbook', { headers: { Accept: 'application/json' } });
    const payload = (await response.json()) as { data: { items: GuestbookItem[]; total: number } };
    setItems(payload.data.items);
    setTotal(payload.data.total);
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !content.trim() || pending) {
      return;
    }
    setPending(true);
    setMessage('');
    try {
      const response = await fetch('/api/guestbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': user.csrfToken },
        body: JSON.stringify({ content, parentId, name, website })
      });
      const payload = (await response.json()) as { message: string; data: GuestbookItem | null };
      if (!response.ok) {
        setMessage(payload.message || '提交失败');
        return;
      }
      setContent('');
      setParentId('');
      setParentName('');
      if (payload.data && payload.data.status === 'approved') {
        await reload();
        setMessage('留言已发布');
      } else {
        setTotal((value) => value + 1);
        setMessage('留言已提交，等待博主审核后展示');
      }
    } catch {
      setMessage('网络异常，请稍后重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="border-t border-line pt-6" aria-label={t("发布留言")}>
        <h2 className="mb-3 text-lg font-semibold">{t("写留言")}</h2>
        {user ? (
          <form onSubmit={submit} className="space-y-3">
            {parentId && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <span>{t("正在回复")}{parentName}</span>
                <button type="button" className="text-accent" onClick={() => { setParentId(''); setParentName(''); }}>{t("取消")}</button>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("昵称")} maxLength={32} />
              <input className="field" value={website} onChange={(event) => setWebsite(event.target.value)} placeholder={t("网站（可选，http:// 开头）")} maxLength={200} />
            </div>
            <textarea className="field min-h-24 resize-y" value={content} onChange={(event) => setContent(event.target.value)} placeholder={t("说点什么…")} maxLength={2000} required />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">{content.length}/2000</span>
              <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? t('提交中…') : t('提交留言')}</button>
            </div>
          </form>
        ) : (
          <p className="border-l-2 border-accent-line pl-3 py-1 text-sm text-muted">{t("留言需要登录，请前往")}<a href="/admin/login" className="text-accent">{t("登录页")}</a>。
          </p>
        )}
        {message && <p className="mt-3 text-sm text-accent">{t(message)}</p>}
      </section>

      <section className="border-t border-line pt-8" aria-label={t("留言列表")}>
        <h2 className="mb-4 text-lg font-semibold">{t("全部留言 ·")}{total}</h2>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{t("还没有留言，欢迎来踩踩。")}</p>
        ) : (
          <ul className="space-y-6">
            {items.map((item) => (
              <GuestbookNode key={item.id} item={item} onReply={(id, replyName) => { setParentId(id); setParentName(replyName); }} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default withLocale(GuestbookSection);
