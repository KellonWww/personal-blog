import type { JsonResult } from './toolbox';

export const FORMAT_INPUT_LIMIT = 200_000;
export type FormatLanguage = 'json' | 'sql' | 'html' | 'css' | 'javascript' | 'typescript' | 'markdown' | 'yaml';
export type SqlDialect = 'sql' | 'mysql' | 'postgresql' | 'sqlite' | 'transactsql';
export type FormatMode = 'pretty' | 'compact' | 'validate';
export interface FormatRequest { source: string; language: FormatLanguage; dialect: SqlDialect; indent: 2 | 4; mode: FormatMode }
export interface FormatResult { output: string; json: JsonResult | null }

export const FORMAT_LANGUAGES: { value: FormatLanguage; label: string; example: string }[] = [
  { value: 'json', label: 'JSON', example: '{"name":"Kale","tags":["Java","写作"],"settings":{"theme":"moye"},"published":true}' },
  { value: 'sql', label: 'SQL', example: "select p.id,p.title,count(c.id) as comment_count from posts p left join comments c on c.post_id=p.id where p.status='published' group by p.id,p.title order by p.id desc;" },
  { value: 'html', label: 'HTML', example: '<main><section><h1>数字花园</h1><p>记录写作与代码。</p></section></main>' },
  { value: 'css', label: 'CSS', example: '.garden{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}.garden a:hover{color:green}' },
  { value: 'javascript', label: 'JavaScript', example: 'const posts=[{title:"花园",published:true}];function visible(items){return items.filter(item=>item.published)}' },
  { value: 'typescript', label: 'TypeScript', example: 'interface Post{title:string;published:boolean}const visible=(items:Post[]):Post[]=>items.filter(item=>item.published)' },
  { value: 'markdown', label: 'Markdown', example: '# 数字花园\n\n- 写作\n- 代码\n\n|名称|状态|\n|-|-|\n|花园|生长中|' },
  { value: 'yaml', label: 'YAML', example: 'site: {name: Kale, tags: [Java, 写作]}\nposts:\n  - {title: 花园, published: true}' }
];
