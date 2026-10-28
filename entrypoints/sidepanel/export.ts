// One-file copies of the Notes tab: PDF (the browser's print dialog) and Word (.docx).
// Diagrams are rendered to PNG so both formats show them.
import type { Paragraph as Para, TextRun as Run } from 'docx';
import { fmt, safeName, type Session } from '@/lib/notes';
import { dataUrlToBlob } from '@/lib/vault';
import { escape, highlight, inline } from './ui';

const css = `
body { font: 11pt/1.5 Calibri, Arial, sans-serif; color: #111; max-width: 720px; margin: 24px auto; }
h1 { font-size: 20pt; margin: 0 0 4px; } h2 { font-size: 14pt; margin: 18px 0 6px; }
.meta { color: #666; font-size: 9pt; }
pre { background: #f4f4f5; border: 1px solid #ddd; padding: 10px; font: 9.5pt/1.45 Consolas, monospace; white-space: pre-wrap; }
code { font-family: Consolas, monospace; }
blockquote { border-left: 3px solid #f59e0b; margin: 8px 0; padding: 4px 10px; background: #fffbeb; }
.caption { color: #555; font-style: italic; }
img { max-width: 100%; }
.hljs-keyword, .hljs-built_in { color: #b4235a; } .hljs-string { color: #a16207; }
.hljs-number, .hljs-literal { color: #6d28d9; } .hljs-title { color: #0e7490; }
.hljs-comment { color: #6b7280; font-style: italic; }
@media print { h2, pre, img { break-inside: avoid; } }`;

// Same palette as the CSS above, for Word runs.
const colors: Record<string, string> = {
  'hljs-keyword': 'B4235A',
  'hljs-built_in': 'B4235A',
  'hljs-string': 'A16207',
  'hljs-number': '6D28D9',
  'hljs-literal': '6D28D9',
  'hljs-title': '0E7490',
  'hljs-comment': '6B7280',
};

const sorted = (s: Session) => [...s.blocks].sort((a, c) => a.ts - c.ts);

async function diagramPng(elements: unknown[]): Promise<string> {
  const { exportToBlob } = await import('@excalidraw/excalidraw');
  const blob = await exportToBlob({ elements: elements as any, appState: { exportBackground: true, viewBackgroundColor: '#ffffff' }, files: null, exportPadding: 12, mimeType: 'image/png' });
  return new Promise((ok) => {
    const r = new FileReader();
    r.onload = () => ok(r.result as string);
    r.readAsDataURL(blob);
  });
}

/** Display size in px, scaled down to fit the page (6.5in at 96 dpi). */
function size(src: string): Promise<{ width: number; height: number }> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 620 / img.naturalWidth);
      ok({ width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
    };
    img.onerror = fail;
    img.src = src;
  });
}

async function toHtml(s: Session): Promise<string> {
  const out = [`<h1>${escape(s.lesson)}</h1>`, `<p class="meta">${escape(s.course)} · ${escape(s.platform)} · ${escape(s.url)}</p>`];
  for (const b of sorted(s)) {
    switch (b.kind) {
      case 'section':
        out.push(`<h2>${escape(b.heading)}</h2><ul>${b.bullets.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
        break;
      case 'code':
        out.push(`<pre><code>${highlight(b.source.trimEnd(), b.lang)}</code></pre>`);
        if (b.explanation) out.push(`<blockquote><b>What the instructor explained:</b> ${inline(b.explanation)}</blockquote>`);
        break;
      case 'diagram': {
        const src = await diagramPng(b.elements).catch(() => b.frame);
        out.push(`<p><b>${escape(b.title)}</b></p>`, src ? `<p><img src="${src}"></p>` : '');
        if (b.caption) out.push(`<p class="caption">${escape(b.caption)}</p>`);
        break;
      }
      case 'screenshot':
        out.push(`<p><img src="${b.image}"></p>`, `<p class="caption">${fmt(b.ts)}</p>`);
        break;
      case 'flag':
        out.push(`<blockquote>${inline(b.text)}</blockquote>`);
        break;
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(s.lesson)}</title><style>${css}</style></head><body>${out.join('\n')}</body></html>`;
}

/** Opens the note in a new tab and shows the print dialog, where "Save as PDF" is a destination. Call from a click. */
export async function exportPdf(s: Session) {
  const w = window.open('', '_blank');
  if (!w) throw new Error('Pop-up blocked. Allow pop-ups for LectureInk to export a PDF.');
  w.document.write(await toHtml(s));
  w.document.close();
  await Promise.all([...w.document.images].map((i) => i.decode().catch(() => {})));
  w.print();
}

/** Downloads the note as a Word document. The library loads on first use. */
export async function exportDocx(s: Session) {
  const { AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, Paragraph, ShadingType, TextRun } = await import('docx');
  type Style = { bold?: boolean; italics?: boolean; font?: string; color?: string };

  // inline() / highlight() HTML → Word runs: <b>, <em>, <code> and hljs colour classes; \n becomes a line break.
  const runs = (html: string, base: Style = {}): Run[] => {
    const out: Run[] = [];
    const walk = (n: Node, st: Style) => {
      if (n.nodeType === Node.TEXT_NODE) {
        n.textContent!.split('\n').forEach((text, i) => out.push(new TextRun({ ...st, text, break: i ? 1 : undefined })));
        return;
      }
      const el = n as Element;
      const next = { ...st };
      if (el.tagName === 'B') next.bold = true;
      if (el.tagName === 'EM' || el.classList.contains('hljs-comment')) next.italics = true;
      if (el.tagName === 'CODE') next.font = 'Consolas';
      for (const c of el.classList) if (colors[c]) next.color = colors[c];
      el.childNodes.forEach((c) => walk(c, next));
    };
    walk(new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body, base);
    return out;
  };

  const picture = async (src: string) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          type: src.startsWith('data:image/png') ? 'png' : 'jpg',
          data: await dataUrlToBlob(src).arrayBuffer(),
          transformation: await size(src),
        }),
      ],
    });
  const caption = (text: string) => new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, italics: true, color: '555555' })] });
  const quote = (children: Run[]) =>
    new Paragraph({
      children,
      shading: { type: ShadingType.CLEAR, fill: 'FFFBEB' },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'F59E0B', space: 6 } },
      spacing: { before: 80, after: 160 },
    });

  const body: Para[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(s.lesson)] }),
    new Paragraph({ children: [new TextRun({ text: `${s.course} · ${s.platform} · ${s.url}`, color: '666666', size: 18 })] }),
  ];
  for (const b of sorted(s)) {
    switch (b.kind) {
      case 'section':
        body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(b.heading)] }));
        for (const x of b.bullets) body.push(new Paragraph({ bullet: { level: 0 }, children: runs(inline(x)) }));
        break;
      case 'code': {
        const line = { style: BorderStyle.SINGLE, size: 4, color: 'DDDDDD', space: 4 };
        body.push(
          new Paragraph({
            children: runs(highlight(b.source.trimEnd(), b.lang), { font: 'Consolas' }),
            shading: { type: ShadingType.CLEAR, fill: 'F4F4F5' },
            border: { top: line, bottom: line, left: line, right: line },
            spacing: { before: 120, after: 120 },
          }),
        );
        if (b.explanation) body.push(quote([new TextRun({ text: 'What the instructor explained: ', bold: true }), ...runs(inline(b.explanation))]));
        break;
      }
      case 'diagram': {
        body.push(new Paragraph({ children: [new TextRun({ text: b.title, bold: true })] }));
        const src = await diagramPng(b.elements).catch(() => b.frame);
        if (src) body.push(await picture(src));
        if (b.caption) body.push(caption(b.caption));
        break;
      }
      case 'screenshot':
        body.push(await picture(b.image), caption(fmt(b.ts)));
        break;
      case 'flag':
        body.push(quote(runs(inline(b.text))));
        break;
    }
  }

  const doc = new Document({
    title: s.lesson,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children: body }],
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await Packer.toBlob(doc));
  a.download = `${safeName(s.lesson)}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
