import { useState } from 'react';
import { transformText, type TextOperation } from '@/lib/text-tools';
import TransformPanels from './TransformPanels';

const operations: [TextOperation, string][] = [['dedupe', '按行去重（保留首次出现）'], ['sort-asc', '按行升序'], ['sort-desc', '按行降序'], ['empty', '移除空白行'], ['trim', '去除每行首尾空白'], ['upper', '转为大写'], ['lower', '转为小写'], ['wrap', '每行添加前后缀']];
export default function TextWorkbench() {
  const [source, setSource] = useState('');
  const [operation, setOperation] = useState<TextOperation>('dedupe');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [output, setOutput] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  function invalidate() { setOutput(null); setNotice(''); setError(''); }
  function edit(value: string) { setSource(value); invalidate(); }
  function process() {
    try { const next = transformText(source, operation, prefix, suffix); setOutput(next); setNotice(`处理完成：${source.length.toLocaleString()} → ${next.length.toLocaleString()} 字符。`); setError(''); }
    catch (cause) { setOutput(null); setNotice(''); setError(cause instanceof Error ? cause.message : '处理失败，请检查输入。'); }
  }
  return <div className="tool-workspace">
    <div className="tool-toolbar"><label className="tool-inline-field" htmlFor="text-operation">处理方式<select id="text-operation" value={operation} onChange={(event) => { setOperation(event.target.value as TextOperation); invalidate(); }}>{operations.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button type="button" className="btn btn-ghost" onClick={() => edit('Kale\n花园\nKale\n\n  写作  ')}>填入示例</button></div>
    {operation === 'wrap' && <div className="tool-columns tool-affixes"><label className="tool-field" htmlFor="text-prefix"><span>每行前缀</span><input id="text-prefix" type="text" value={prefix} onChange={(event) => { setPrefix(event.target.value); invalidate(); }} /></label><label className="tool-field" htmlFor="text-suffix"><span>每行后缀</span><input id="text-suffix" type="text" value={suffix} onChange={(event) => { setSuffix(event.target.value); invalidate(); }} /></label></div>}
    <p className="tool-note">输入最多 100,000 字符，结果最多 500,000 字符；前后缀合计最多 2,000 字符。按行操作统一换行符，去重区分大小写与空格；排序使用中文自然顺序。可将结果作为输入，继续下一步处理。</p>
    <TransformPanels id="text" source={source} output={output} onChange={edit}><button type="button" className="btn btn-primary" onClick={process}>处理文本</button></TransformPanels>
    <p className="tool-status" role="status">{notice}</p>{error && <p className="tool-error" role="alert">{error}</p>}
  </div>;
}
