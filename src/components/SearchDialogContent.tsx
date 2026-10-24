import { withLocale } from '@/lib/i18n/react';
import { useEffect, useState } from 'react';
import SearchApp from '@/components/SearchApp';

/** 由 Astro island 管理 React 生命周期，首次呼出后再加载搜索索引。 */
function SearchDialogContent() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const open = () => setMounted(true);
    document.addEventListener('site-search-open', open);
    // 快捷键可能早于 island 水合完成，补上已经打开的那一次。
    if (document.querySelector<HTMLDialogElement>('#site-search-dialog')?.open) open();
    return () => document.removeEventListener('site-search-open', open);
  }, []);
  return mounted ? <SearchApp inputId="site-search-input" autoFocus /> : null;
}

export default withLocale(SearchDialogContent);
