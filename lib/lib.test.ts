import { describe, expect, it } from 'vitest';
import { parseJson } from './ai';
import { counts, toElements, toExcalidrawMd, wrap } from './excalidraw';
import { diagramPath, fmt, mergeBlocks, notePath, safeName, sessionKey, toMarkdown, type Block, type Session } from './notes';
import { notesPrompt } from './prompts';
import { SceneDetector, isBlack } from './scene';

const frame = (v: number) => new Uint8Array(32 * 18).fill(v);

describe('scene', () => {
  it('fires on first frame, ignores repeats, fires once a change settles', () => {
    const d = new SceneDetector();
    expect(d.push(frame(100))).toBe(true);
    expect(d.push(frame(100))).toBe(false);
    expect(d.push(frame(200))).toBe(false); // changed, not settled yet
    expect(d.push(frame(200))).toBe(true); // settled
    expect(d.push(frame(200))).toBe(false);
  });
  it('detects black DRM frames', () => {
    expect(isBlack(frame(0))).toBe(true);
    expect(isBlack(frame(80))).toBe(false);
  });
});

describe('notes', () => {
  it('safeName drops trailing dots and spaces Windows rejects', () => {
    expect(safeName('Loop Engineering explained in 20 mins.')).toBe('Loop Engineering explained in 20 mins');
    expect(safeName('Wait... ')).toBe('Wait');
    expect(safeName('...')).toBe('Untitled');
    expect(safeName('a'.repeat(79) + ' b')).toBe('a'.repeat(79));
  });

  const s: Session = {
    url: 'https://www.youtube.com/watch?v=abc&list=x',
    platform: 'YouTube',
    course: 'Data: Apps?',
    lesson: 'Kafka partitions',
    transcript: [],
    source: 'captions',
    startedAt: 0,
    blocks: [
      { kind: 'code', ts: 767, lang: 'python', source: 'x = 1\n', explanation: 'sets x' },
      { kind: 'section', ts: 724, heading: 'Why partitions exist', bullets: ['scale out'] },
      { kind: 'diagram', ts: 751, id: 'd', title: 'Topic to consumers', caption: 'cap', elements: [], confidence: 0.9 },
      { kind: 'screenshot', ts: 41, image: '' },
    ],
  };
  it('formats time', () => {
    expect(fmt(65)).toBe('01:05');
    expect(fmt(3725)).toBe('1:02:05');
  });
  it('normalizes YouTube session keys', () => {
    expect(sessionKey(s.url)).toBe('https://www.youtube.com/watch?v=abc');
    expect(sessionKey('https://www.youtube.com/shorts/a7bd2Pn-_Pw?feature=share')).toBe('https://www.youtube.com/watch?v=a7bd2Pn-_Pw');
  });
  it('writes ordered markdown with embeds and no per-block links', () => {
    const md = toMarkdown(s, new Date('2026-10-27'));
    expect(md).toContain('captured: 2026-10-27');
    expect(md.indexOf('Why partitions exist')).toBeLessThan(md.indexOf('```python'));
    expect(md).toContain('\n## Why partitions exist\n');
    expect(md.match(/youtube\.com/g)).toHaveLength(1); // only `source:`
    expect(md).toContain('![[diagrams/12-31-topic-to-consumers.excalidraw]]');
    expect(md).toContain('![00:41](attachments/00-41.jpg)');
    expect(md).toContain('> **What the instructor explained:** sets x');
  });
  it('builds safe paths', () => {
    expect(notePath(s)).toBe('Data Apps/Kafka partitions/Kafka partitions.md');
    expect(diagramPath({ ts: 751, title: 'A/B test!' })).toBe('diagrams/12-31-a-b-test.excalidraw.md');
  });
});

describe('mergeBlocks', () => {
  const sec = (ts: number, heading: string, bullet: string): Block => ({ kind: 'section', ts, heading, bullets: [bullet] });
  const dia = (ts: number, id: string, title: string): Block => ({ kind: 'diagram', ts, id, title, caption: id, elements: [], confidence: 1 });
  it('extends the last section when its heading repeats, not older ones', () => {
    const out = mergeBlocks([sec(10, 'Intro', 'a'), sec(20, 'Router', 'b')], [sec(30, 'router', 'c'), sec(40, 'Intro', 'd')]);
    expect(out.map((b) => b.kind === 'section' && `${b.heading}:${b.bullets.join('')}`)).toEqual(['Intro:a', 'Router:bc', 'Intro:d']);
  });
  it('starts a new section when a diagram came after the last one', () => {
    const out = mergeBlocks([sec(10, 'Loops', 'a'), dia(20, 'd', 'Cycle')], [sec(30, 'Loops', 'b')]);
    expect(out.map((b) => b.kind)).toEqual(['section', 'diagram', 'section']);
  });
  it('replaces a diagram redrawn soon after under the same title, keeping id and time', () => {
    const out = mergeBlocks([dia(537, 'old', 'Router pipeline')], [dia(538, 'new', 'Router Pipeline'), dia(900, 'later', 'Router pipeline')]);
    expect(out.map((b) => b.kind === 'diagram' && `${b.id}@${b.ts}:${b.caption}`)).toEqual(['old@537:new', 'later@900:later']);
  });
});

describe('excalidraw', () => {
  const els = toElements({
    title: 't',
    caption: 'c',
    shapes: [
      { id: 'p', type: 'rectangle', x: 0, y: 100, w: 120, h: 60, label: 'Producer' },
      { id: 'g', type: 'rectangle', x: 300, y: 50, w: 200, h: 200, label: 'topic: orders', dashed: true },
      { id: 'c', type: 'ellipse', x: 700, y: 100, w: 120, h: 60, label: 'Consumer' },
    ],
    arrows: [
      { from: 'p', to: 'c', label: 'reads' },
      { from: 'p', to: 'missing' },
    ],
  });
  it('binds labels and arrows, drops dangling arrows', () => {
    expect(counts(els)).toEqual({ shapes: 3, arrows: 1, labels: 4 });
    const arrow = els.find((e) => e.type === 'arrow')!;
    expect(arrow.x).toBe(120); // right edge of Producer
    // to left edge of Consumer, an ellipse widened from 120 to fit its label: (96 + 20) / 0.7
    expect(arrow.points[1][0]).toBeCloseTo(760 - 116 / 0.7 / 2 - 120);
    expect(arrow.points[1][1]).toBe(0);
    expect(els.find((e) => e.id === 'p')!.boundElements).toEqual([
      { type: 'text', id: 'p-text' },
      { type: 'arrow', id: 'arrow-0' },
    ]);
  });
  it('wraps long labels and grows the box to fit them', () => {
    expect(wrap('evaluate each question in parallel', 120)).toBe('evaluate\neach\nquestion\nin\nparallel');
    const [box, label] = toElements({ title: 't', caption: 'c', arrows: [], shapes: [{ id: 'b', type: 'rectangle', x: 100, y: 100, w: 140, h: 70, label: 'evaluate each question against the state in parallel' }] });
    const lines = label.text.split('\n');
    expect(label.originalText).toBe('evaluate each question against the state in parallel');
    expect(Math.max(...lines.map((l: string) => l.length)) * 12).toBeLessThanOrEqual(box.width - 20);
    expect(lines.length * 25).toBeLessThanOrEqual(box.height - 20);
    expect(box.x + box.width / 2).toBe(170); // grown around its centre
  });
  it('writes a parseable Obsidian Excalidraw file', () => {
    const md = toExcalidrawMd(els);
    expect(md).toContain('excalidraw-plugin: parsed');
    expect(md).toContain('Producer ^p-text');
    const json = md.split('```json')[1].split('```')[0];
    expect(JSON.parse(json).elements).toHaveLength(els.length);
  });
});

describe('parseJson', () => {
  it('handles fenced and wrapped replies', () => {
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJson('Sure! {"a":{"b":2}} done')).toEqual({ a: { b: 2 } });
    expect(() => parseJson('no json')).toThrow();
  });
});

describe('prompts', () => {
  it('labels transcript lines in seconds so the model can copy them as ts', () => {
    const s = { course: 'C', lesson: 'L', blocks: [] } as unknown as Session;
    const p = notesPrompt(s, [{ ts: 626.4, text: 'LLMs predict the next word' }], 704, { frame: false, code: true, diagrams: true });
    expect(p).toContain('[626s] LLMs predict the next word');
  });
});
