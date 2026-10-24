import { useI18n, withLocale } from '@/lib/i18n/react';
import type { ReactNode } from 'react';
import CopyButton from './CopyButton';

interface Props {
  id: string;
  source: string;
  output: string | null;
  onChange: (value: string) => void;
  children: ReactNode;
}
function TransformPanels({ id, source, output, onChange, children }: Props) {
  const { t, locale } = useI18n();
  return <>
    <div className="tool-toolbar"><button type="button" className="btn btn-ghost" onClick={() => onChange('')}>{t("清空")}</button><button type="button" className="btn btn-ghost" disabled={output === null} onClick={() => onChange(output ?? '')}>{t("结果作为输入")}</button></div>
    <div className="tool-columns tool-transform-columns">
      <label className="tool-field" htmlFor={`${id}-source`}><span>{t("输入文本")}<small>{t("{0} 字符", source.length.toLocaleString(locale))}</small></span><textarea id={`${id}-source`} className="tool-code" spellCheck={false} value={source} placeholder={t("粘贴需要处理的文本…")} onChange={(event) => onChange(event.target.value)} /></label>
      <div className="tool-transform-actions" role="group" aria-label={t("处理操作")}>{children}</div>
      <div className="tool-field"><div className="tool-field-heading"><label htmlFor={`${id}-output`}>{t("处理结果")}</label><CopyButton text={output ?? ''} label={t("复制结果")} disabled={output === null} /></div><textarea id={`${id}-output`} className="tool-code" spellCheck={false} value={output ?? ''} readOnly placeholder={t("处理结果会显示在这里。")} /></div>
    </div>
  </>;
}

export default withLocale(TransformPanels);
