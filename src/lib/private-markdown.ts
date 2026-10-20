import { Marked } from 'marked';
import { escapeHtml } from '@/lib/format';

// An isolated renderer must not change the rendering policy for public articles.
const privateMarkdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text).replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    },
    image({ text }) {
      // Reading a private document must never contact an imported tracking/image URL.
      return '<span class="text-sm text-muted">[图片未加载：' + escapeHtml(text || '图片') + ']</span>';
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      // Reject executable/data/protocol-relative URLs; external navigation is explicit and referrer-free.
      if (!/^(?:https?:\/\/|\/(?!\/)|#)/i.test(href) || /[\p{Cc}\s\\]/u.test(href)) {
        return label;
      }
      return '<a href="' + escapeHtml(href) + '" rel="noopener noreferrer" referrerpolicy="no-referrer">' + label + '</a>';
    }
  }
});

export function renderPrivateMarkdown(content: string): string {
  return privateMarkdown.parse(content, { async: false });
}
