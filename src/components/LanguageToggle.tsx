import { useI18n } from '@/lib/i18n/react';

/** Native POST keeps language preference server-readable and works without client routing. */
export default function LanguageToggle() {
  const { locale } = useI18n();
  const label = locale === 'en' ? '切换到中文' : 'Switch to English';
  return <form action="/language" method="post" className="language-switcher" data-language-switch onSubmit={event => {
    const returnTo = event.currentTarget.elements.namedItem('returnTo');
    if (returnTo instanceof HTMLInputElement) returnTo.value = location.pathname + location.search + location.hash;
  }}>
    <input type="hidden" name="locale" value={locale === 'en' ? 'zh-CN' : 'en'} />
    <input type="hidden" name="returnTo" defaultValue="/admin" />
    <button type="submit" className="language-toggle" aria-label={label} title={label}>
      <span lang="zh-CN" className={locale === 'zh-CN' ? 'is-current' : undefined}>中</span>
      <span aria-hidden="true" className="language-divider">/</span>
      <span lang="en" className={locale === 'en' ? 'is-current' : undefined}>EN</span>
    </button>
  </form>;
}
