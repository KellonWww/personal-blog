import type { ReactNode } from 'react';
import ThemeSwitcher from '@/components/ThemeSwitcher';

export type AdminView = 'overview' | 'posts' | 'archives' | 'moderation' | 'settings';
export const ADMIN_NAV: Array<{ key: AdminView; label: string; mark: string }> = [
  { key: 'overview', label: '工作台', mark: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z' },
  { key: 'posts', label: '文章管理', mark: 'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5' },
  { key: 'archives', label: '私人档案', mark: 'M4 7h16v14H4z M3 3h18v4H3z M9 11h6' },
  { key: 'moderation', label: '互动审核', mark: 'M4 4h16v12H9l-5 4z M8 8h8 M8 12h5' },
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

export default function AdminShell({ active, title, description, children, actions, userName, onNavigate, onLogout }: Props) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <a href="/admin" className="admin-brand"><span className="admin-brand-mark">K</span><span>Kale<span className="admin-brand-caption">数字花园 · 管理空间</span></span></a>
        <p className="admin-nav-caption">内容与日常</p>
        <nav aria-label="后台导航" className="admin-nav">
          {ADMIN_NAV.map(({ key, label, mark }) => onNavigate ? (
            <button key={key} type="button" aria-current={active === key ? 'page' : undefined} onClick={() => onNavigate(key)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={mark} /></svg>{label}</button>
          ) : (
            <a key={key} href={`/admin?view=${key}`} aria-current={active === key ? 'page' : undefined}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={mark} /></svg>{label}</a>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <a href="/" target="_blank" rel="noreferrer" className="admin-site-link">访问数字花园 ↗</a>
          <div className="admin-account"><span className="admin-account-dot" /><span>{userName || '管理空间'}</span>{onLogout && <button type="button" onClick={onLogout}>退出</button>}</div>
        </div>
      </aside>
      <main className="admin-main">
        <div className="admin-topline"><span>数字花园 / {title}</span><ThemeSwitcher /></div>
        <header className="admin-page-header"><div><h1>{title}</h1><p>{description}</p></div><div className="admin-page-actions">{actions}</div></header>
        {children}
        <footer className="admin-footer">Kale · 好好写作，慢慢生长。</footer>
      </main>
    </div>
  );
}
