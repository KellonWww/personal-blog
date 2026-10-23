import { useLayoutEffect, useRef } from 'react';
import type { LineHighlight } from '@/lib/diff-highlights';

interface Props {
  side: 'before' | 'after';
  value: string;
  highlights?: Map<number, LineHighlight>;
  onChange: (value: string) => void;
}

export default function DiffTextArea({ side, value, highlights, onChange }: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLPreElement>(null);
  // The highlight layer uses the textarea's actual client area, excluding its scrollbar.
  useLayoutEffect(() => {
    const input = textarea.current!, layer = mirror.current!;
    function sync() {
      layer.style.width = `${input.clientWidth}px`;
      layer.style.height = `${input.clientHeight}px`;
      layer.scrollTop = input.scrollTop;
      layer.scrollLeft = input.scrollLeft;
    }
    const observer = new ResizeObserver(sync);
    observer.observe(input); sync();
    return () => observer.disconnect();
  }, [value, highlights]);
  return <div className="tool-field">
    <label className="tool-field-heading" htmlFor={`diff-${side}`}>{side === 'before' ? '原始文本' : '修改后文本'}<small>{value.length.toLocaleString()} 字符</small></label>
    <div className="tool-diff-editor">
      <pre ref={mirror} className="tool-code tool-diff-highlight" aria-hidden="true">{highlights && value.replace(/\r\n?/g, '\n').split('\n').map((line, index) => {
        const highlight = highlights?.get(index + 1);
        return <span key={index} className={`tool-editor-line${highlight ? ` tool-editor-line-${highlight.kind}` : ''}`}>{highlight ? highlight.parts.map((part, partIndex) => part.changed ? <mark key={partIndex}>{part.text}</mark> : part.text) : line}{!line && '\u200b'}</span>;
      })}</pre>
      <textarea ref={textarea} id={`diff-${side}`} className="tool-code" spellCheck={false} autoCapitalize="off" autoCorrect="off" placeholder={side === 'before' ? '粘贴原始内容…' : '粘贴修改后的内容…'} value={value} onChange={(event) => onChange(event.target.value)} onScroll={(event) => { if (mirror.current) { mirror.current.scrollTop = event.currentTarget.scrollTop; mirror.current.scrollLeft = event.currentTarget.scrollLeft; } }} />
    </div>
  </div>;
}
