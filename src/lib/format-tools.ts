import type { Plugin } from 'prettier';
import { analyzeJson, type JsonResult } from './toolbox';

import { FORMAT_INPUT_LIMIT, type FormatLanguage, type FormatRequest, type FormatResult } from './format-config';
const FORMAT_OUTPUT_LIMIT = 1_000_000;

async function prettierParser(language: Exclude<FormatLanguage, 'json' | 'sql'>): Promise<{ parser: string; plugins: Plugin[] }> {
  switch (language) {
    case 'javascript': return { parser: 'babel', plugins: await Promise.all([import('prettier/plugins/babel'), import('prettier/plugins/estree')]) };
    case 'typescript': return { parser: 'typescript', plugins: await Promise.all([import('prettier/plugins/typescript'), import('prettier/plugins/estree')]) };
    case 'html': return { parser: 'html', plugins: [await import('prettier/plugins/html')] };
    case 'css': return { parser: 'css', plugins: [await import('prettier/plugins/postcss')] };
    case 'markdown': return { parser: 'markdown', plugins: [await import('prettier/plugins/markdown')] };
    case 'yaml': return { parser: 'yaml', plugins: [await import('prettier/plugins/yaml')] };
    default: throw new Error('不支持的文本类型。');
  }
}

export async function formatText(request: FormatRequest): Promise<FormatResult> {
  const { source, language, dialect, indent, mode } = request;
  if (!source.trim()) throw new Error('请先输入需要处理的文本。');
  if (source.length > FORMAT_INPUT_LIMIT) throw new Error('输入超过 200,000 字符，请缩小内容后重试。');
  if (language !== 'json' && mode !== 'pretty') throw new Error('压缩和严格校验仅支持 JSON。');
  let json: JsonResult | null = null;
  let output: string;
  if (language === 'json') {
    json = analyzeJson(source, indent);
    output = mode === 'compact' ? json.compact : json.pretty;
  } else if (language === 'sql') {
    const { format } = await import('sql-formatter');
    output = format(source, { language: dialect, tabWidth: indent, keywordCase: 'upper' });
  } else {
    const [{ format }, parser] = await Promise.all([import('prettier/standalone'), prettierParser(language)]);
    output = await format(source, { ...parser, tabWidth: indent, useTabs: false, printWidth: 100, embeddedLanguageFormatting: 'off', endOfLine: 'lf' });
  }
  if (output.length > FORMAT_OUTPUT_LIMIT) throw new Error('格式化结果超过 1,000,000 字符，请缩小输入或减少嵌套。');
  return { output, json };
}
