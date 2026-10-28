// Lesson data model and its markdown form. Pure: no browser APIs.

export type Block =
  | { kind: 'section'; ts: number; heading: string; bullets: string[] }
  | { kind: 'code'; ts: number; lang: string; source: string; explanation: string }
  | {
      kind: 'diagram';
      ts: number;
      id: string;
      title: string;
      caption: string;
      elements: unknown[];
      confidence: number;
      frame?: string; // small jpeg data URL of the source frame
    }
  | { kind: 'screenshot'; ts: number; image: string }
  | { kind: 'flag'; ts: number; text: string };

export interface Line {
  ts: number;
  text: string;
}

export interface Session {
  url: string;
  platform: string;
  course: string;
  lesson: string;
  blocks: Block[];
  transcript: Line[];
  source: 'captions' | 'audio' | 'none';
  startedAt: number;
  savedAt?: number;
}

export function fmt(ts: number): string {
  const s = Math.max(0, Math.floor(ts));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

export function slug(text: string, max = 40): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '') || 'untitled'
  );
}

/** File-system safe name that keeps spaces and case (folder / note names). Windows rejects a trailing dot or space. */
export function safeName(text: string): string {
  return (
    text
      .replace(/[\\/:*?"<>|#^[\]\x00-\x1f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
      .replace(/[. ]+$/, '') || 'Untitled'
  );
}

/** Video URL without noise, used as the session key. YouTube keeps only `v`; Shorts map to their watch URL. */
export function sessionKey(url: string): string {
  const u = new URL(url);
  const short = u.hostname.endsWith('youtube.com') && u.pathname.match(/^\/shorts\/([\w-]+)/);
  if (short) return `https://www.youtube.com/watch?v=${short[1]}`;
  if (u.hostname.endsWith('youtube.com') && u.searchParams.get('v')) return `https://www.youtube.com/watch?v=${u.searchParams.get('v')}`;
  return u.origin + u.pathname;
}

const stamp = (ts: number) => fmt(ts).replace(/:/g, '-');

// Each lesson gets its own folder holding the note, attachments/ and diagrams/, so lessons never share files.
export const diagramPath = (b: { ts: number; title: string }) => `diagrams/${stamp(b.ts)}-${slug(b.title)}.excalidraw.md`;
export const screenshotPath = (b: { ts: number }) => `attachments/${stamp(b.ts)}.jpg`;
export const notePath = (s: Pick<Session, 'course' | 'lesson'>) => `${safeName(s.course)}/${safeName(s.lesson)}/${safeName(s.lesson)}.md`;

/**
 * Adds the model's new blocks to the note. A section reusing the heading of the last block extends it
 * (the prompt asks for that when a topic continues), and a diagram redrawn under the same
 * title within two minutes replaces the earlier drawing, keeping its id and file name.
 */
export function mergeBlocks(blocks: Block[], added: Block[]): Block[] {
  const out = [...blocks];
  for (const b of added) {
    if (b.kind === 'section') {
      // Only the very last block: once code, a diagram or a screenshot follows a section, new bullets
      // start a fresh section after it, so notes stay next to the pictures they explain.
      const i = out.length - 1;
      const last = out[i];
      if (last?.kind === 'section' && slug(last.heading) === slug(b.heading)) {
        out[i] = { ...last, bullets: [...last.bullets, ...b.bullets] };
        continue;
      }
    }
    if (b.kind === 'diagram') {
      const i = out.findIndex((x) => x.kind === 'diagram' && slug(x.title) === slug(b.title) && Math.abs(x.ts - b.ts) < 120);
      if (i >= 0) {
        out[i] = { ...b, id: (out[i] as typeof b).id, ts: out[i].ts };
        continue;
      }
    }
    out.push(b);
  }
  return out;
}

export function toMarkdown(s: Session, date = new Date()): string {
  const out = [
    '---',
    `source: ${s.url}`,
    `platform: ${s.platform}`,
    `course: ${JSON.stringify(s.course)}`,
    `lesson: ${JSON.stringify(s.lesson)}`,
    `captured: ${date.toISOString().slice(0, 10)}`,
    'tags: [lecture]',
    '---',
    '',
    `# ${s.lesson}`,
    '',
  ];
  // No per-block times or links: they cluttered the note. The video is in `source`, times stay in the panel.
  for (const b of [...s.blocks].sort((a, c) => a.ts - c.ts)) {
    switch (b.kind) {
      case 'section':
        out.push(`## ${b.heading}`, ...b.bullets.map((x) => `- ${x}`), '');
        break;
      case 'code':
        out.push('```' + b.lang, b.source.trimEnd(), '```');
        if (b.explanation) out.push(`> **What the instructor explained:** ${b.explanation}`);
        out.push('');
        break;
      case 'diagram':
        // Obsidian resolves the embed without the trailing .md
        out.push(`**${b.title}**`, `![[${diagramPath(b).replace(/\.md$/, '')}]]`);
        if (b.caption) out.push(`*${b.caption}*`);
        out.push('');
        break;
      case 'screenshot':
        // Plain markdown image, so the note shows it outside Obsidian too (VS Code, GitHub).
        out.push(`![${fmt(b.ts)}](${screenshotPath(b)})`, '');
        break;
      case 'flag':
        out.push(`> [!important] ${b.text}`, '');
        break;
    }
  }
  return out.join('\n');
}
