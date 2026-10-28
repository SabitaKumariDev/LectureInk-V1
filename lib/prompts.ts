import { fmt, type Line, type Session } from './notes';
import type { DiagramSpec } from './excalidraw';

export interface NotesReply {
  sections: { ts: number; heading: string; bullets: string[] }[];
  code: { ts: number; lang: string; source: string; explanation: string } | null;
  diagram: (DiagramSpec & { ts: number }) | null;
  screenshot?: boolean;
}

export const NOTES_SYSTEM = `You write study notes for a learner watching a lecture video.
You receive the latest transcript lines and, when the picture changed, the current video frame.
Write notes that let the learner revise the lesson later without rewatching it.

Reply with one JSON object and nothing else:
{
  "sections": [{ "ts": <seconds>, "heading": "<short topic>", "bullets": ["<one idea per bullet>"] }],
  "code": null | { "ts": <seconds>, "lang": "<language>", "source": "<code exactly as on screen>", "explanation": "<what the instructor said about it, one or two sentences>" },
  "diagram": null | {
    "ts": <seconds>, "title": "<short>", "caption": "<2 to 4 sentences: what the diagram shows and how the instructor explained it>", "confidence": <0..1>,
    "shapes": [{ "id": "<id>", "type": "rectangle|ellipse|diamond|text", "x": <0..1000>, "y": <0..600>, "w": <n>, "h": <n>, "label": "<text>", "dashed": <bool> }],
    "arrows": [{ "from": "<shape id>", "to": "<shape id>", "label": "<optional>" }]
  },
  "screenshot": <true|false>
}

Rules:
- Only state what the transcript or frame supports. Never invent facts, code or labels.
- Skip filler, greetings and course admin. Return "sections": [] when nothing new was taught.
- If the transcript continues the topic of "Last heading", reuse that exact heading; its bullets get appended there. Start a new heading only when the topic moved on, and never reuse an older heading from "Already covered".
- The bullets under "Last heading" are already in the notes. Never restate them; add only new points, or return "sections": [] if there are none.
- Headings name the topic plainly. No "continued", "part 2" or "results" variants of an earlier heading.
- Never use the lesson title or course name as a heading: the whole lesson is about that. Name the sub-topic taught in this stretch instead.
- Captions are auto-generated and mishear names. Spell names of people, products, models and companies as the frame, the lesson title or earlier notes show them.
- Attribute each claim to the right subject: when the instructor contrasts two things, say which one each fact belongs to.
- Bullets are short. Use *italics* for stress and \`backticks\` for identifiers.
- "code" only when readable source code is visible in the frame. Copy it character for character.
  File names, tab or window titles, URLs and single words are not code: return null for them.
- "diagram" only when the frame shows boxes, arrows or a drawn figure (not a slide of bullet text).
  Lay shapes out on a 1000x600 canvas matching the frame. A dashed shape groups the shapes inside it.
  Size each shape to fit its label (about 12px per character, 25px per line; break long labels with \\n) and leave at least 60px between shapes so arrows show.
  If the figure is one listed under "Diagrams already drawn", return it only when it gained shapes, and keep its exact title.
- "screenshot": true when the frame shows something the learner should see and that "code" or "diagram" cannot hold:
  a chart, table, formula, app or website being demonstrated, a photo, or a slide whose layout matters.
  false for the instructor's face, title or blank slides, a frame you returned as code or diagram, or a slide of plain bullet text the notes already cover.
- "ts" is the video time in seconds where the idea starts: copy the [<n>s] number of the transcript line where it starts.`;

export function notesPrompt(
  s: Session,
  lines: Line[],
  now: number,
  opts: { frame: boolean; code: boolean; diagrams: boolean; focusCode?: boolean },
): string {
  const covered = s.blocks.flatMap((b) => (b.kind === 'section' ? [b.heading] : [])).slice(-12);
  const drawn = s.blocks.flatMap((b) => (b.kind === 'diagram' ? [b.title] : [])).slice(-6);
  const last = s.blocks.findLast((b) => b.kind === 'section');
  return [
    `Course: ${s.course}`,
    `Lesson: ${s.lesson}`,
    `Video time now: ${fmt(now)} (${Math.floor(now)}s)`,
    `Already covered: ${covered.length ? covered.join('; ') : 'nothing yet'}`,
    `Last heading: ${covered.at(-1) ?? 'none'}`,
    ...(last?.kind === 'section' ? last.bullets.slice(-8).map((x) => `  - ${x}`) : []),
    `Diagrams already drawn: ${drawn.length ? drawn.join('; ') : 'none'}`,
    '',
    'Transcript since last update:',
    lines.length ? lines.map((l) => `[${Math.floor(l.ts)}s] ${l.text}`).join('\n') : '(no speech captured)',
    '',
    opts.frame ? `The attached image is the video frame at ${fmt(now)}.` : 'No new frame.',
    opts.code ? '' : 'Return "code": null.',
    opts.diagrams ? '' : 'Return "diagram": null.',
    opts.focusCode ? 'The learner asked to capture the code on screen now. Extract it if any is visible.' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export const ASK_SYSTEM = `You help a learner with the lecture they are watching.
Answer from the notes and transcript provided. If they do not cover the question, say so, then answer from general knowledge and mark that part as such.
Be concise. Use markdown.`;

export function askContext(s: Session): string {
  const notes = s.blocks
    .map((b) =>
      b.kind === 'section'
        ? `[${fmt(b.ts)}] ${b.heading}\n${b.bullets.map((x) => `- ${x}`).join('\n')}`
        : b.kind === 'code'
          ? `[${fmt(b.ts)}] code (${b.lang}):\n${b.source}\n${b.explanation}`
          : b.kind === 'diagram'
            ? `[${fmt(b.ts)}] diagram "${b.title}": ${b.caption}`
            : b.kind === 'flag'
              ? `[${fmt(b.ts)}] flagged: ${b.text}`
              : '',
    )
    .filter(Boolean)
    .join('\n\n');
  const transcript = s.transcript.map((l) => `[${fmt(l.ts)}] ${l.text}`).join('\n');
  return `Lesson: ${s.course} / ${s.lesson}\n\n<notes>\n${notes}\n</notes>\n\n<transcript>\n${transcript}\n</transcript>`;
}
