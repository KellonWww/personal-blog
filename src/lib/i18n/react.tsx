import { createContext, useContext, type ComponentType } from 'react';
import { translator, type Locale } from './index';

const LocaleContext = createContext<Locale>('zh-CN');
export function useI18n() {
  const locale = useContext(LocaleContext);
  return { locale, t: translator(locale) };
}

/** The server supplies each island locale; nested components inherit it without reading browser globals. */
export function withLocale<P extends object>(Component: ComponentType<P>) {
  function LocalizedComponent({ locale, ...props }: P & { locale?: Locale }) {
    const inherited = useContext(LocaleContext);
    return <LocaleContext value={locale ?? inherited}><Component {...props as P} /></LocaleContext>;
  }
  LocalizedComponent.displayName = `Localized(${Component.displayName ?? Component.name})`;
  return LocalizedComponent;
}
