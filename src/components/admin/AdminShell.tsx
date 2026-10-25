import { useI18n, withLocale } from '@/lib/i18n/react';
import AdminArrow from './AdminArrow';
import LanguageToggle from '@/components/LanguageToggle';
import { useEffect, useRef, type ReactNode } from 'react';
import { mountPageMotion } from '@/lib/page-motion';
import ThemeSwitcher from '@/components/ThemeSwitcher';

export type AdminView = 'overview' | 'posts' | 'archives' | 'moderation' | 'taxonomy' | 'settings';
export const ADMIN_NAV: Array<{ key: AdminView; label: string; mark: string }> = [
  { key: 'overview', label: '工作台', mark: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z' },
  { key: 'posts', label: '文章管理', mark: 'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5' },
  { key: 'archives', label: '私人档案', mark: 'M4 7h16v14H4z M3 3h18v4H3z M9 11h6' },
  { key: 'moderation', label: '互动审核', mark: 'M4 4h16v12H9l-5 4z M8 8h8 M8 12h5' },
  { key: 'taxonomy', label: '分类与标签', mark: 'M3 5h7l11 11-5 5L3 8z M7 8h.01' },
  { key: 'settings', label: '站点设置', mark: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6' }
];

interface Props {
  active: AdminView;
  title: string;
  description: string;
  children: ReactNode;
  actions?: ReactNode;
  userName?: string;
  onNavigate?: (view: AdminView) => void;
  onLogout?: () => void;
}

function AdminShell({ active, title, description, children, actions, userName, onNavigate, onLogout }: Props) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current ? mountPageMotion(root.current) : undefined, []);
  return (
    <div className="admin-shell" ref={root}>
      <a className="admin-skip-link" href="#admin-content">{t("跳到工作区")}</a>
      <aside className="admin-sidebar">
        <a href="/admin" className="admin-brand"><span className="admin-brand-mark">K</span><span>Kale<span className="admin-brand-caption">{t("数字花园的编辑室")}</span></span></a>
        <p className="admin-nav-caption">{t("工作空间")}</p>
        <nav aria-label={t("后台导航")} className="admin-nav">
          {ADMIN_NAV.map(({ key, label, mark }) => onNavigate ? (
            <button key={key} type="button" aria-current={active === key ? 'page' : undefined} onClick={() => onNavigate(key)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={mark} /></svg><span>{t(label)}</span></button>
          ) : (
            <a key={key} href={`/admin?view=${key}`} aria-current={active === key ? 'page' : undefined}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={mark} /></svg><span>{t(label)}</span></a>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <a href="/" target="_blank" rel="noreferrer" className="admin-site-link">{t("访问数字花园")}<AdminArrow /></a>
          <div className="admin-account"><span className="admin-account-avatar" aria-hidden="true">{(userName || 'K').slice(0, 1)}</span><span>{userName || t('管理空间')}</span>{onLogout && <button type="button" onClick={onLogout}>{t("退出")}</button>}</div>
        </div>
      </aside>
      <main className="admin-main" id="admin-content" tabIndex={-1}>
        <div className="admin-topline"><div className="admin-breadcrumb"><a href="/">{t("数字花园")}</a><span aria-hidden="true">/</span><span>{t("编辑室")}</span><span aria-hidden="true">/</span><span aria-current="page">{t(title)}</span></div><div className="admin-display-controls"><LanguageToggle /><ThemeSwitcher /></div></div>
        <header className="admin-page-header" key={active} data-motion><div><h1>{t(title)}</h1><p>{t(description)}</p></div><div className="admin-page-actions">{actions}</div></header>
        <div className="admin-content">{children}</div>
        <footer className="admin-footer"><span>{t("Kale 的数字花园")}</span><a href="/" target="_blank" rel="noreferrer">{t("查看公开站点")}<AdminArrow /></a></footer>
      </main>
    </div>
  );
}

export default withLocale(AdminShell);
