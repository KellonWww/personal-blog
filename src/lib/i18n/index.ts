import english from './en.json';

export type Locale = 'zh-CN' | 'en';
export const LOCALE_COOKIE = 'blog-locale';
export function getLocale(value?: string): Locale { return value === 'en' ? 'en' : 'zh-CN'; }

const messages: Record<string, string> = english;
const editorial: Record<string, string> = {
  'Software, systems & independent work.': '软件、系统与独立开发。',
  'Notes on building software, understanding systems, and learning through practice.': '记录软件开发、系统设计与项目实践中的思考。',
  'Engineering.': '技术实践。', 'In practice.': '持续记录。',
  'Latest writing': '最新文章', 'Beyond the articles': '更多内容',
  'Topics': '主题索引', 'Utilities': '实用工具', 'Collections': '文章分类',
  'Technical notes, considered opinions,': '技术笔记、独立思考，',
  'and lessons from real projects.': '以及真实项目中的经验。',
  'Topics, utilities, and a structured archive.': '按主题浏览，使用工具，查找过往记录。',
  'Explore the ideas behind the work.': '循着主题，找到下一篇。',
  'Small tools. Less friction.': '日常工具，随手可用。',
  'A clear index of everything here.': '按分类整理的文章索引。',
  'Open for conversation': '交流与反馈', 'Good work starts with': '欢迎提问，',
  'a conversation.': '也欢迎不同意见。',
  'Questions, feedback, or a different perspective — all welcome.': '问题、反馈，或新的视角，都可以在这里交流。',
  'Notes from the field.': '实践手记。', 'Always in progress.': '持续更新。',
  'Search the archive.': '搜索站内文章。', 'Field notes': '实践手记',
  'A personal collection of thoughts, code, and things worth keeping.': '技术、代码与值得记录的内容。'
};

// Templates apply only at explicit UI call sites, never to document or user content.
const patterns = Object.entries(messages).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => {
  const slots: string[] = [];
  const escaped = key.split(/(\{\d+\})/).map(part => {
    if (/^\{\d+\}$/.test(part)) { slots.push(part); return '([\\s\\S]*?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { expression: new RegExp('^' + escaped + '$'), value, slots };
});

export function translator(locale: Locale) {
  return (text: string | null | undefined, ...values: unknown[]): string => {
    if (!text) return '';
    let result = text;
    const key = text.trim().replace(/\s+/g, ' ');
    if (locale === 'en') {
      const exact = messages[text] ?? messages[key];
      if (exact !== undefined) result = exact;
      else if (!editorial[key]) {
        for (const pattern of patterns) {
          const match = pattern.expression.exec(text);
          if (match) {
            result = pattern.value.replace(/\{\d+\}/g, slot => match[pattern.slots.indexOf(slot) + 1] ?? slot);
            break;
          }
        }
      }
    } else result = editorial[key] ?? text;
    return result.replace(/\{(\d+)\}/g, (slot, index: string) => Number(index) < values.length ? String(values[Number(index)]) : slot);
  };
}
