import { useState } from 'react';

export default function CopyButton({ text, label = '复制', disabled = false }: { text: string; label?: string; disabled?: boolean }) {
  const [notice, setNotice] = useState<{ text: string; label: string } | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ text, label: '已复制' });
    } catch {
      setNotice({ text, label: '复制失败，请手动选择复制' });
    }
  }
  const feedback = notice?.text === text ? notice.label : '';
  return <span className="tool-copy"><button type="button" className="btn btn-ghost" disabled={disabled} onClick={copy}>{label}</button><span role="status">{feedback}</span></span>;
}
