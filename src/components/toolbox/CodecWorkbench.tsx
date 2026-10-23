import { useState } from 'react';
import { transformCodec, type Codec } from '@/lib/text-tools';
import TransformPanels from './TransformPanels';

export default function CodecWorkbench() {
  const [source, setSource] = useState('');
  const [codec, setCodec] = useState<Codec>('base64');
  const [output, setOutput] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  function invalidate() { setOutput(null); setNotice(''); setError(''); }
  function edit(value: string) { setSource(value); invalidate(); }
  function process(mode: 'encode' | 'decode') {
    try { setOutput(transformCodec(source, codec, mode)); setNotice(mode === 'encode' ? '编码完成。' : '解码完成。'); setError(''); }
    catch (cause) { setOutput(null); setNotice(''); setError(cause instanceof Error ? cause.message : '处理失败，请检查输入。'); }
  }
  return <div className="tool-workspace">
    <div className="tool-toolbar"><label className="tool-inline-field" htmlFor="codec-type">编码类型<select id="codec-type" value={codec} onChange={(event) => { setCodec(event.target.value as Codec); invalidate(); }}><option value="base64">Base64 · UTF-8 文本</option><option value="url">URL · 参数值</option><option value="unicode">Unicode · 转义文本</option></select></label><button type="button" className="btn btn-ghost" onClick={() => edit('你好，Kale 😀')}>填入示例</button></div>
    <p className="tool-note">输入最多 100,000 字符，结果最多 500,000 字符。Base64 支持中文，不处理二进制文件；URL 按参数值处理，+ 不作为空格。Unicode 支持 \uXXXX 和 \u{'{1F600}'}。编码不是加密，请勿粘贴真实凭据。</p>
    <TransformPanels id="codec" source={source} output={output} onChange={edit}><button type="button" className="btn btn-primary" onClick={() => process('encode')}>编码</button><button type="button" className="btn btn-ghost" onClick={() => process('decode')}>解码</button></TransformPanels>
    <p className="tool-status" role="status">{notice}</p>{error && <p className="tool-error" role="alert">{error}</p>}
  </div>;
}
