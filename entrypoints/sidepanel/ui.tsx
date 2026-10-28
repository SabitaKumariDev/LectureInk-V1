import hljs from 'highlight.js/lib/common';
import type { ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  logo: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M9 9h6M9 13h4" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
  back: <path d="M15 18l-6-6 6-6" />,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  flag: <path d="M6 21V4h11l-2 4 2 4H6" />,
  code: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />,
  sparkle: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />,
  diagram: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><path d="M10 6.5h4v7.5" /></>,
  folder: <path d="M3 6h6l2 2h10v11H3z" />,
  file: <path d="M6 3h8l4 4v14H6zM14 3v4h4" />,
};

export function Icon({ name, size = 20 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Model text → safe HTML with `code`, **bold** and *italic*. Escapes first. */
export function inline(text: string): string {
  return escape(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

export function highlight(source: string, lang: string): string {
  return hljs.getLanguage(lang) ? hljs.highlight(source, { language: lang, ignoreIllegals: true }).value : escape(source);
}

export function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : new Date(ms).toLocaleTimeString();
}
