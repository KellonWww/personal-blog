import { useI18n, withLocale } from '@/lib/i18n/react';
import { useEffect, useState } from 'react';
import { authorizedLoginDestination, loginDestination } from '@/lib/auth-redirect';
import type { SessionUser } from '@/types/domain';

interface Props {
  oauthEnabled: boolean;
  devMode: boolean;
  errorCode: string;
  returnTo?: string;
}

function LoginForm({ oauthEnabled, devMode, errorCode, returnTo }: Props) {
  const { t } = useI18n();
  const destination = loginDestination(returnTo);
  const privateReading = destination.startsWith('/private');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/auth/me', { headers: { Accept: 'application/json' } })
      .then((response) => response.json() as Promise<{ data: { user: SessionUser | null } }>)
      .then((payload) => setUser(payload.data?.user ?? null))
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, []);

  const errorText: Record<string, string> = {
    oauth_not_configured: '尚未配置 GitHub OAuth，本地请使用开发登录。',
    oauth_failed: 'GitHub 授权失败，请重试。',
    oauth_denied: '已取消 GitHub 授权。'
  };

  async function devLogin() {
    setPending(true);
    setMessage('');
    try {
      const response = await fetch('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        setMessage(payload.message ?? '开发登录不可用');
        return;
      }
      const payload = await response.json() as { data?: { user?: SessionUser } };
      window.location.href = authorizedLoginDestination(destination, payload.data?.user?.role);
    } catch {
      setMessage('网络异常，请稍后重试');
    } finally {
      setPending(false);
    }
  }

  async function logout() {
    if (!user) return;
    setPending(true);
    setMessage('');
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': user.csrfToken }
      });
      if (!response.ok) throw new Error('退出失败，请稍后重试');
      setUser(null);
    } catch {
      setMessage('退出失败，请稍后重试');
    } finally { setPending(false); }
  }

  if (checking) {
    return <p className="text-sm text-muted">{t("正在检查登录状态…")}</p>;
  }

  if (user) {
    return (
      <div className="space-y-3">
        <p className="text-sm">{t("已登录为")}<strong>{user.displayName || user.username}</strong>{user.role === 'admin' ? t('（管理员）') : ''}</p>
        {privateReading && user.role !== 'admin' && <p role='alert' className='text-sm text-muted'>{t('私人文库仅向站主开放，你仍可在前台参与评论与留言。')}</p>}
        <a href={authorizedLoginDestination(destination, user.role)} className='btn btn-primary'>{user.role === 'admin' && destination.startsWith('/admin') ? t('进入后台') : privateReading && user.role === 'admin' ? t('继续阅读') : t('返回数字花园')}</a>
        <button type='button' className='btn' disabled={pending} onClick={logout}>{t('退出')}</button>
        {message && <p role='alert' className='text-sm text-accent'>{t(message)}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {errorCode && errorText[errorCode] && <p className="text-sm text-accent">{t(errorText[errorCode])}</p>}
      {oauthEnabled ? (
        <a href={'/api/auth/login?' + new URLSearchParams({ returnTo: destination })} className="btn btn-primary w-full justify-center">{t("使用 GitHub 登录")}</a>
      ) : (
        <p className="border-l-2 border-accent-line pl-3 py-1 text-xs text-muted">{t("GitHub OAuth 未配置，生产环境请补充 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET。")}</p>
      )}
      {devMode && (
        <button type="button" onClick={devLogin} className="btn w-full justify-center" disabled={pending}>
          {pending ? t('登录中…') : t('本地开发登录（管理员）')}
        </button>
      )}
      {!devMode && !oauthEnabled && <p className="text-sm text-muted">{t("当前没有可用的登录方式。")}</p>}
      {message && <p className="text-sm text-accent">{t(message)}</p>}
    </div>
  );
}

export default withLocale(LoginForm);
