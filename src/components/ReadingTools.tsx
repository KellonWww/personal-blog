import { useI18n, withLocale } from '@/lib/i18n/react';
import { useEffect, useRef, useState } from 'react';
import { Languages, Maximize2, Minimize2, Printer } from '@/components/Icons';

const SKIP_TAGS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'SVG']);

function ReadingTools() {
  const { t } = useI18n();
  const [fullscreen, setFullscreen] = useState(false);
  const [traditional, setTraditional] = useState(false);
  const originals = useRef(new Map<Text, string>());
  const converter = useRef<((text: string) => string) | null>(null);

  useEffect(() => {
    function onChange() {
      setFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  async function ensureConverter() {
    if (converter.current) {
      return converter.current;
    }
    const OpenCC = await import('opencc-js');
    const convert = OpenCC.Converter({ from: 'cn', to: 'tw' });
    converter.current = (text: string) => convert(text);
    return converter.current;
  }

  function walk(node: Node, visit: (text: Text) => void) {
    if (node.nodeType === Node.TEXT_NODE) {
      visit(node as Text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    if (SKIP_TAGS.has((node as Element).tagName.toUpperCase())) {
      return;
    }
    node.childNodes.forEach((child) => walk(child, visit));
  }

  async function toggleTraditional() {
    const root = document.querySelector('[data-convertible]');
    if (!root) {
      return;
    }
    if (traditional) {
      originals.current.forEach((value, node) => {
        node.nodeValue = value;
      });
      originals.current.clear();
      setTraditional(false);
      root.setAttribute('lang', 'zh-CN');
      return;
    }
    const convert = await ensureConverter();
    walk(root, (text) => {
      if (!text.nodeValue) {
        return;
      }
      if (!originals.current.has(text)) {
        originals.current.set(text, text.nodeValue);
      }
      text.nodeValue = convert(text.nodeValue);
    });
    setTraditional(true);
    root.setAttribute('lang', 'zh-Hant');
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      /* 浏览器不支持时忽略 */
    }
  }

  return (
    <div className="flex items-center gap-1 no-print">
      <button type="button" onClick={toggleTraditional} className="btn btn-ghost" aria-label={t("切换繁简")} title={t("切换繁简")}>
        <Languages size={16} />
        <span className="hidden md:inline">{traditional ? t('简体') : t('繁體')}</span>
      </button>
      <button type="button" onClick={toggleFullscreen} className="btn btn-ghost" aria-label={t("全屏阅读")} title={t("全屏阅读")}>
        {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>
      <button type="button" onClick={() => window.print()} className="btn btn-ghost" aria-label={t("打印文章")} title={t("打印文章")}>
        <Printer size={16} />
      </button>
    </div>
  );
}

export default withLocale(ReadingTools);
