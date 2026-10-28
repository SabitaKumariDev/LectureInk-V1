// Turns the model's diagram description into Excalidraw elements and the
// Obsidian Excalidraw plugin's `.excalidraw.md` file. Pure: no Excalidraw import,
// so it runs in tests; Excalidraw's own restore() fills any defaults on load.

export interface DiagramShape {
  id: string;
  type: 'rectangle' | 'ellipse' | 'diamond' | 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  dashed?: boolean; // a grouping container; label goes above it
}

export interface DiagramSpec {
  title: string;
  caption: string;
  confidence?: number;
  shapes: DiagramShape[];
  arrows: { from: string; to: string; label?: string }[];
}

type El = Record<string, any>;

const INK = '#1e1e1e';
const ACCENT = '#0f766e';
const FONT = 5; // Excalifont: the hand-drawn, OFL-licensed Excalidraw font
const SIZE = 20;
const CHAR_W = SIZE * 0.6; // ponytail: average glyph width estimate, real Excalifont widths vary per letter
const PAD = 10;
// Share of a shape's box that holds its label (an ellipse or diamond is narrower inside).
const INNER = { rectangle: 1, ellipse: 0.7, diamond: 0.5 } as const;

/** Word-wraps a label to a width in pixels; a word longer than the width keeps its own line. */
export function wrap(value: string, width: number): string {
  const max = Math.max(1, Math.floor(width / CHAR_W));
  return value
    .split('\n')
    .map((line) => {
      const out: string[] = [];
      let cur = '';
      for (const w of line.split(' ')) {
        if (cur && cur.length + 1 + w.length > max) {
          out.push(cur);
          cur = w;
        } else cur = cur ? `${cur} ${w}` : w;
      }
      return [...out, cur].join('\n');
    })
    .join('\n');
}

function seedOf(id: string): number {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function base(id: string, type: string, x: number, y: number, width: number, height: number, extra: El = {}): El {
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: INK,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: type === 'rectangle' || type === 'diamond' ? { type: 3 } : type === 'ellipse' ? { type: 2 } : null,
    seed: seedOf(id),
    version: 1,
    versionNonce: seedOf(id + 'n'),
    isDeleted: false,
    boundElements: [],
    updated: 1,
    link: null,
    locked: false,
    ...extra,
  };
}

function text(id: string, value: string, cx: number, cy: number, extra: El = {}): El {
  const lines = value.split('\n');
  const width = Math.max(...lines.map((l) => l.length)) * CHAR_W;
  const height = lines.length * SIZE * 1.25;
  return base(id, 'text', cx - width / 2, cy - height / 2, width, height, {
    text: value,
    originalText: value,
    fontSize: SIZE,
    fontFamily: FONT,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: null,
    lineHeight: 1.25,
    autoResize: true,
    roundness: null,
    ...extra,
  });
}

export function toElements(spec: DiagramSpec): El[] {
  const els: El[] = [];
  const byId = new Map<string, El>();

  for (const s of spec.shapes) {
    if (s.type === 'text') {
      if (s.label) els.push(text(s.id, s.label, s.x + s.w / 2, s.y + s.h / 2));
      continue;
    }
    // Models size boxes too small for their labels: wrap the label, then grow the box around its centre.
    const boxed = !!s.label && !s.dashed;
    const inner = INNER[s.type] ?? 1; // models sometimes send other shape names
    const label = boxed ? wrap(s.label!, s.w * inner - 2 * PAD) : s.label;
    const lines = label?.split('\n') ?? [];
    const w = boxed ? Math.max(s.w, (Math.max(...lines.map((l) => l.length)) * CHAR_W + 2 * PAD) / inner) : s.w;
    const h = boxed ? Math.max(s.h, (lines.length * SIZE * 1.25 + 2 * PAD) / inner) : s.h;
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    const shape = base(s.id, s.type, cx - w / 2, cy - h / 2, w, h, s.dashed ? { strokeStyle: 'dashed', strokeColor: ACCENT } : {});
    els.push(shape);
    byId.set(s.id, shape);
    if (!s.label) continue;
    if (s.dashed) {
      els.push(text(`${s.id}-label`, s.label, s.x + s.w / 2, s.y - 16, { strokeColor: ACCENT }));
    } else {
      const t = text(`${s.id}-text`, label!, cx, cy, { containerId: s.id, originalText: s.label });
      shape.boundElements.push({ type: 'text', id: t.id });
      els.push(t);
    }
  }

  spec.arrows.forEach((a, i) => {
    const from = byId.get(a.from);
    const to = byId.get(a.to);
    if (!from || !to) return;
    const fc = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const tc = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    const horizontal = Math.abs(tc.x - fc.x) >= Math.abs(tc.y - fc.y);
    const dir = horizontal ? Math.sign(tc.x - fc.x) || 1 : Math.sign(tc.y - fc.y) || 1;
    const start = horizontal ? { x: fc.x + (dir * from.width) / 2, y: fc.y } : { x: fc.x, y: fc.y + (dir * from.height) / 2 };
    const end = horizontal ? { x: tc.x - (dir * to.width) / 2, y: tc.y } : { x: tc.x, y: tc.y - (dir * to.height) / 2 };
    const id = `arrow-${i}`;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const arrow = base(id, 'arrow', start.x, start.y, Math.abs(dx), Math.abs(dy), {
      points: [
        [0, 0],
        [dx, dy],
      ],
      lastCommittedPoint: null,
      startBinding: { elementId: from.id, focus: 0, gap: 4 },
      endBinding: { elementId: to.id, focus: 0, gap: 4 },
      startArrowhead: null,
      endArrowhead: 'arrow',
      elbowed: false,
      roundness: { type: 2 },
    });
    from.boundElements.push({ type: 'arrow', id });
    to.boundElements.push({ type: 'arrow', id });
    els.push(arrow);
    if (a.label) {
      const t = text(`${id}-text`, a.label, start.x + dx / 2, start.y + dy / 2, { containerId: id, fontSize: 16 });
      arrow.boundElements.push({ type: 'text', id: t.id });
      els.push(t);
    }
  });

  return els;
}

export function counts(elements: El[]) {
  const live = elements.filter((e) => !e.isDeleted);
  return {
    shapes: live.filter((e) => ['rectangle', 'ellipse', 'diamond'].includes(e.type)).length,
    arrows: live.filter((e) => e.type === 'arrow').length,
    labels: live.filter((e) => e.type === 'text').length,
  };
}

export function scene(elements: unknown[]) {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://github.com/lectureink/lectureink',
    elements,
    appState: { viewBackgroundColor: '#ffffff', gridSize: null },
    files: {},
  };
}

/** File format read by the Obsidian Excalidraw plugin (uncompressed JSON). */
export function toExcalidrawMd(elements: El[]): string {
  const texts = elements
    .filter((e) => e.type === 'text' && !e.isDeleted)
    .map((e) => `${e.originalText ?? e.text} ^${e.id}\n`)
    .join('\n');
  return [
    '---',
    '',
    'excalidraw-plugin: parsed',
    'tags: [excalidraw]',
    '',
    '---',
    '==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==',
    '',
    '# Excalidraw Data',
    '',
    '## Text Elements',
    texts,
    '%%',
    '## Drawing',
    '```json',
    JSON.stringify(scene(elements), null, 2),
    '```',
    '%%',
    '',
  ].join('\n');
}
