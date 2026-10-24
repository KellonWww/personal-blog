import { useI18n, withLocale } from '@/lib/i18n/react';
import { useEffect, useMemo, useState } from 'react';
import type { CommentItem, SessionUser } from '@/types/domain';

interface Props {
  slug: string;
  initialComments: CommentItem[];
  initialTotal: number;
}

interface MeResponse {
  authenticated: boolean;
  user: SessionUser | null;
}

interface CommentPayload {
  items: CommentItem[];
  total: number;
}

function Avatar({ src, name }: { src: string; name: string }) {
  const { t } = useI18n();
  if (src) {
    return <img src={src} alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-full border border-line object-cover" loading="lazy" />;
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-paper-soft text-xs font-medium text-accent">
      {name.slice(0, 1) || t('访')}
    </span>
  );
}

function CommentNode({
  item,
  onReply
}: {
  item: CommentItem;
  onReply: (id: string, name: string) => void;
}) {
  const { t } = useI18n();
  return (
    <li className="space-y-2">
      <div className="flex gap-3">
        <Avatar src={item.userAvatar} name={item.userName} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="font-medium text-ink">{item.userName}</span>
            <time>{item.createdAt}</time>
            <button type="button" className="hover:text-accent" onClick={() => onReply(item.id, item.userName)}>{t("回复")}</button>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.content}</p>
        </div>
      </div>
      {item.replies && item.replies.length > 0 && (
        <ul className="ml-11 space-y-4 border-l border-line pl-4">
          {item.replies.map((reply) => (
            <CommentNode key={reply.id} item={reply} onReply={onReply} />
          ))}
        </ul>
      )}
    </li>
  );
}

function CommentSection({ slug, initialComments, initialTotal }: Props) {
  const { t } = useI18n();
  const [comments, setComments] = useState<CommentItem[]>(initialComments);
  const [total, setTotal] = useState(initialTotal);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [content, setContent] = useState('');
  const [parentId, setParentId] = useState('');
  const [parentName, setParentName] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/me', { headers: { Accept: 'application/json' } })
      .then((response) => response.json() as Promise<{ data: MeResponse }>)
      .then((payload) => {
        if (active) {
          setUser(payload.data?.user ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const placeholder = useMemo(
    () => (parentId ? `回复 ${parentName}…` : user ? '写下你的想法…' : '登录后即可参与评论'),
    [parentId, parentName, user]
  );

  async function reload() {
    const response = await fetch(`/api/posts/${encodeURIComponent(slug)}/comments`, { headers: { Accept: 'application/json' } });
    const payload = (await response.json()) as { data: CommentPayload };
    setComments(payload.data.items);
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
      const response = await fetch(`/api/posts/${encodeURIComponent(slug)}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': user.csrfToken
        },
        body: JSON.stringify({ content, parentId })
      });
      const payload = (await response.json()) as { code: string; message: string; data: CommentItem | null };
      if (!response.ok) {
        setMessage(payload.message || '提交失败');
        return;
      }
      setContent('');
      setParentId('');
      setParentName('');
      if (payload.data && payload.data.status === 'approved') {
        await reload();
        setMessage('评论已发布');
      } else {
        setTotal((value) => value + 1);
        setMessage('评论已提交，等待博主审核后展示');
      }
    } catch {
      setMessage('网络异常，请稍后重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="border-t border-line pt-8" aria-label={t("评论区")}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">{t("评论")}<span className="font-mono text-sm text-muted tabular-nums">{total}</span></h2>
        {user ? <span className="text-xs text-muted">{t("已登录：")}{user.displayName || user.username}</span> : <a href="/admin/login" className="text-xs text-accent">{t("登录后评论")}</a>}
      </div>

      {user ? (
        <form onSubmit={submit} className="mb-6 space-y-2">
          {parentId && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>{t("正在回复")}{parentName}</span>
              <button type="button" className="text-accent" onClick={() => { setParentId(''); setParentName(''); }}>{t("取消")}</button>
            </div>
          )}
          <textarea
            className="field min-h-24 resize-y"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t(placeholder)}
            maxLength={2000}
            required
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">{content.length}/2000</span>
            <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? t('提交中…') : t('发表评论')}</button>
          </div>
        </form>
      ) : (
        <p className="mb-6 border-l-2 border-line pl-4 text-sm text-muted">{t("评论需要登录。生产环境使用 GitHub 登录，本地可前往")}<a href="/admin/login" className="text-accent">{t("登录页")}</a>{t("使用开发登录。")}</p>
      )}

      {message && <p className="mb-4 text-sm text-accent">{t(message)}</p>}

      {comments.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{t("还没有评论，来抢沙发。")}</p>
      ) : (
        <ul className="space-y-6">
          {comments.map((item) => (
            <CommentNode
              key={item.id}
              item={item}
              onReply={(id, name) => {
                setParentId(id);
                setParentName(name);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* avoid-ai-design-ignore-file: SD5, SD4w — 计数读数用 mono 对齐数字；忽略误报 */

export default withLocale(CommentSection);
