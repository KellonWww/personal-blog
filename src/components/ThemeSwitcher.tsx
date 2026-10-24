import { useI18n, withLocale } from '@/lib/i18n/react';
import { useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Check } from '@/components/Icons';

type ThemeMode = 'light' | 'dark';

export interface ThemeDef {
  id: string;
  name: string;
  mode: ThemeMode;
  tone: 'cool' | 'warm';
}

const DEFAULT_LIGHT: ThemeDef = { id: 'dianqing', name: '日光', mode: 'light', tone: 'warm' };
const DEFAULT_DARK: ThemeDef = { id: 'moye', name: '夜航', mode: 'dark', tone: 'cool' };

export const THEMES: ThemeDef[] = [DEFAULT_DARK, DEFAULT_LIGHT];
const LEGACY_THEMES: Record<string, string> = {
  light: 'dianqing', dark: 'moye', xuanzhi: 'moye', songyan: 'moye', taichen: 'dianqing', xingye: 'dianqing'
};

const STORAGE_KEY = 'blog-theme';

interface ViewTransitionLike {
  finished: Promise<void>;
  ready: Promise<void>;
  skipTransition: () => void;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransitionLike;
};

function themeById(id: string): ThemeDef {
  return THEMES.find((theme) => theme.id === id) ?? DEFAULT_LIGHT;
}

/** 读 html 上的 data-theme（由 BaseLayout 内联脚本预先写好）。 */
function documentThemeId(): string {
  const current = document.documentElement.dataset.theme ?? '';
  return THEMES.some((theme) => theme.id === current) ? current : DEFAULT_LIGHT.id;
}

/** 已存的主题；null 表示跟随系统。兼容旧的 light/dark 两个取值。 */
function storedThemeId(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value && LEGACY_THEMES[value]) return LEGACY_THEMES[value];
    if (value && THEMES.some((theme) => theme.id === value)) return value;
  } catch {
    /* 隐私模式下忽略 */
  }
  return null;
}

function syncMetaColor() {
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="theme-color"]');
  const surface = getComputedStyle(root).getPropertyValue('--surface').trim();
  if (meta && surface) meta.setAttribute('content', surface);
}

function applyTheme(theme: ThemeDef, persist = true) {
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.classList.toggle('dark', theme.mode === 'dark');
  syncMetaColor();

  if (!persist) return;
  try {
    localStorage.setItem(STORAGE_KEY, theme.id);
  } catch {
    /* 隐私模式下忽略 */
  }
}

function ThemeSwitcher() {
  const { t } = useI18n();
  const [current, setCurrent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const desiredTheme = useRef<string | null>(null);
  const desiredSystem = useRef(false);
  const transitionRef = useRef<ViewTransitionLike | null>(null);
  const panelId = useId();
  const [system, setSystem] = useState(false);

  useEffect(() => {
    setCurrent(documentThemeId());
    setSystem(!storedThemeId());
    syncMetaColor();

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    function followSystem(event: MediaQueryListEvent) {
      if (storedThemeId()) return;
      const next = event.matches ? DEFAULT_DARK : DEFAULT_LIGHT;
      desiredTheme.current = next.id;
      applyTheme(next, false);
      setCurrent(next.id);
    }

    media.addEventListener('change', followSystem);
    return () => {
      media.removeEventListener('change', followSystem);
      transitionRef.current?.skipTransition();
      delete document.documentElement.dataset.themeTransition;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"].theme-option')?.focus({ preventScroll: true });

    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        settingsRef.current?.focus({ preventScroll: true });
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function select(theme: ThemeDef, followSystem = false) {
    setOpen(false);
    desiredTheme.current = theme.id;
    desiredSystem.current = followSystem;
    (open ? settingsRef : triggerRef).current?.focus({ preventScroll: true });
    setSystem(followSystem);
    if (followSystem) {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* 忽略存储异常 */ }
    }
    if (theme.id === current) {
      applyTheme(theme, !followSystem);
      return;
    }
    transitionRef.current?.skipTransition();

    const root = document.documentElement;
    const animated = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const startViewTransition = (document as ViewTransitionDocument).startViewTransition;

    const commit = (withTransition: boolean) => {
      if (withTransition) root.dataset.themeTransition = 'true';
      const latest = themeById(desiredTheme.current ?? theme.id);
      applyTheme(latest, !desiredSystem.current);
      flushSync(() => setCurrent(latest.id));
    };

    const bounds = triggerRef.current?.getBoundingClientRect();
    if (bounds) {
      root.style.setProperty('--theme-x', `${bounds.left + bounds.width / 2}px`);
      root.style.setProperty('--theme-y', `${bounds.top + bounds.height / 2}px`);
    }
    if (animated && startViewTransition) {
      const transition = startViewTransition.call(document, () => commit(true));
      transitionRef.current = transition;
      // 视口变化或快速切换可能取消揭示，但主题本身仍应正常应用。
      void transition.ready.catch(() => undefined);
      const cleanup = () => {
        if (transitionRef.current !== transition) return;
        delete root.dataset.themeTransition;
        transitionRef.current = null;
      };
      void transition.finished.then(cleanup, cleanup);
      return;
    }

    commit(false);
  }

  const active = current ? themeById(current) : null;

  return (
    <div className="theme-picker" ref={rootRef} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <div className="theme-switch-actions">
        <button
          type="button"
          ref={triggerRef}
          className="btn btn-ghost theme-picker-trigger"
          aria-label={active?.mode === 'dark' ? t('切换到日光主题') : t('切换到夜航主题')}
          title={active?.mode === 'dark' ? t('切换到日光主题') : t('切换到夜航主题')}
          onClick={() => select(themeById((desiredTheme.current ?? documentThemeId()) === 'moye' ? 'dianqing' : 'moye'))}
        >
          <svg className="theme-toggle-icon" data-mode={active?.mode ?? 'light'} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <g className="theme-sun"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></g>
            <path className="theme-moon" d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>
          </svg>
          {active && <span className="hidden md:inline">{t(active.name)}</span>}
        </button>
        <button type="button" ref={settingsRef} className="btn btn-ghost theme-settings-trigger"
          aria-label={t("主题设置")} title={t("主题设置与跟随系统")} aria-controls={open ? panelId : undefined} aria-expanded={open}
          onClick={() => setOpen(value => !value)}
          onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5"/></svg>
        </button>
      </div>

      {open && (
        <div className="theme-panel" id={panelId} role="group" aria-label={t("选择主题")} onKeyDown={(event) => {
          const keys = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'];
          if (!keys.includes(event.key)) return;
          const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
          const index = options.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
            : (index + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + options.length) % options.length;
          event.preventDefault();
          options[next]?.focus();
        }}>
          <p className="theme-group-label">{t("花园的两种光线")}</p>
          {THEMES.map((theme) => (
            <button key={theme.id} type="button" aria-pressed={theme.id === current}
              className="theme-option" onClick={() => select(theme)}>
              <span className="theme-dots" data-theme={theme.id} aria-hidden="true">
                <i className="dot-surface" /><i className="dot-ink" /><i className="dot-accent" />
              </span>
              <span>{t(theme.name)}</span>
              <span className="theme-option-check" aria-hidden="true">{theme.id === current && <Check size={14} />}</span>
            </button>
          ))}
          <button type="button" className="theme-system" aria-pressed={system} onClick={() => select(
            window.matchMedia('(prefers-color-scheme: dark)').matches ? DEFAULT_DARK : DEFAULT_LIGHT, true
          )}>{t("跟随系统")}{system ? t(' · 已开启') : ''}</button>
        </div>
      )}
    </div>
  );
}

export default withLocale(ThemeSwitcher);
