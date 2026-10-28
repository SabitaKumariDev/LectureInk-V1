import { Excalidraw, exportToSvg } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useRef, useState } from 'react';
import { counts } from '@/lib/excalidraw';
import { diagramPath, fmt, safeName, slug, type Block } from '@/lib/notes';
import { engine } from './engine';
import { Icon } from './ui';

type Diagram = Extract<Block, { kind: 'diagram' }>;

export default function DiagramEditor({ block, course, lesson, back }: { block: Diagram; course: string; lesson: string; back: () => void }) {
  const elements = useRef<readonly any[]>(block.elements as any[]);
  const [caption, setCaption] = useState(block.caption);
  const c = counts(block.elements as any[]);
  const live = () => elements.current.filter((e) => !e.isDeleted);

  const exportSvg = async () => {
    const svg = await exportToSvg({ elements: live(), appState: { exportBackground: true, viewBackgroundColor: '#ffffff' }, files: null });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([svg.outerHTML], { type: 'image/svg+xml' }));
    a.download = `${slug(block.title)}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };

  return (
    <div className="screen">
      <header className="top">
        <button className="icon-btn" aria-label="Back" onClick={back}>
          <Icon name="back" />
        </button>
        <div className="grow">
          <h1>Diagram · {fmt(block.ts)}</h1>
          <div className="muted small">{block.title}</div>
        </div>
        <span className="chip ok">Excalidraw</span>
      </header>
      <div className="canvas">
        <Excalidraw
          initialData={{ elements: block.elements as any, appState: { viewBackgroundColor: '#ffffff' } }}
          onChange={(els) => (elements.current = els)}
          excalidrawAPI={(api) => setTimeout(() => api.scrollToContent(undefined, { fitToContent: true }))}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false } }}
        />
      </div>
      <main className="content">
        <div className="source">
          {block.frame && (
            <figure className="frame">
              <img src={block.frame} alt="Source video frame" />
              <figcaption>{fmt(block.ts)}</figcaption>
            </figure>
          )}
          <div>
            <strong>Source frame</strong>
            <p className="muted">
              Vision model read {c.shapes} shapes, {c.arrows} arrows and {c.labels} labels, then rebuilt them as Excalidraw elements. Edit anything; the frame stays attached as reference.
            </p>
            <span className="chip">confidence {block.confidence.toFixed(2)}</span>
          </div>
        </div>
        <label className="label" htmlFor="caption">
          Caption written from the talk
        </label>
        <textarea id="caption" className="field" rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} />
        <p className="path muted">
          <Icon name="file" size={16} /> {safeName(course)}/{safeName(lesson)}/{diagramPath(block)}
        </p>
      </main>
      <footer className="bottom">
        <button
          className="primary grow"
          onClick={() => {
            engine.updateDiagram(block.id, live(), caption);
            back();
          }}
        >
          Save &amp; embed in note
        </button>
        <button className="secondary" onClick={exportSvg}>
          Export SVG
        </button>
      </footer>
    </div>
  );
}
