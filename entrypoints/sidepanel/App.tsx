import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { fmt, type Block } from '@/lib/notes';
import { folderLabel, reconnect } from '@/lib/vault';
import Ask from './Ask';
import { exportDocx, exportPdf } from './export';
import { engine, type State } from './engine';
import Settings from './Settings';
import { ago, highlight, Icon, inline } from './ui';

const DiagramEditor = lazy(() => import('./DiagramEditor'));

type Screen = { name: 'main' } | { name: 'settings' } | { name: 'ask' } | { name: 'diagram'; id: string };
type Tab = 'notes' | 'transcript' | 'diagrams' | 'code';

export default function App() {
  const st = useSyncExternalStore(engine.subscribe, engine.getState);
  const [screen, setScreen] = useState<Screen>({ name: 'main' });
  const back = () => setScreen({ name: 'main' });

  if (screen.name === 'settings') return <Settings back={back} />;
  if (screen.name === 'ask') return <Ask back={back} />;
  if (screen.name === 'diagram') {
    const block = st.session?.blocks.find((b) => b.kind === 'diagram' && b.id === screen.id);
    if (block?.kind === 'diagram')
      return (
        <Suspense fallback={<p className="empty">Loading editor…</p>}>
          <DiagramEditor block={block} course={st.session!.course} lesson={st.session!.lesson} back={back} />
        </Suspense>
      );
  }
  return <Main st={st} go={setScreen} />;
}

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function Main({ st, go }: { st: State; go: (s: Screen) => void }) {
  const [tab, setTab] = useState<Tab>('notes');
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => void folderLabel().then(setFolder), [st.vault]);
  useTick(5000);

  const s = st.session;
  const blocks = s ? [...s.blocks].sort((a, b) => a.ts - b.ts) : [];
  const diagrams = blocks.filter((b) => b.kind === 'diagram');
  const code = blocks.filter((b) => b.kind === 'code');
  const shown = tab === 'diagrams' ? diagrams : tab === 'code' ? code : blocks;
  const pill = { listening: `Listening · ${fmt(st.time)}`, 'video-paused': `Video paused · ${fmt(st.time)}`, paused: 'Paused', 'no-video': 'No video' }[st.status];

  return (
    <div className="screen">
      <header className="top">
        <span className="logo">
          <Icon name="logo" />
        </span>
        <h1>LectureInk</h1>
        <button className={`pill ${st.status}`} onClick={() => engine.togglePause()} title="Pause or resume note-taking" disabled={st.status === 'no-video'}>
          <span className="dot" /> {pill}
          {st.busy && <span className="spinner" aria-label="Writing notes" />}
        </button>
        <button className="icon-btn" aria-label="Settings" onClick={() => go({ name: 'settings' })}>
          <Icon name="gear" />
        </button>
      </header>

      {s && (
        <section className="lesson">
          <div className="lesson-title">
            <span className="badge">{s.platform}</span>
            <strong>
              {s.course} · {s.lesson}
            </strong>
          </div>
          <div className="lesson-meta">
            <span className={folder ? 'chip ok' : 'chip'}>
              <span className="dot" /> Vault: {folder ?? 'not set'} / {s.course}
            </span>
            <span className="muted">Transcript: {{ captions: 'page captions', audio: 'audio', none: 'waiting' }[s.source]}</span>
          </div>
          <div className="muted small">
            {s.savedAt ? `Saved ${ago(s.savedAt)}` : 'Not saved yet'}
          </div>
        </section>
      )}

      {st.vault === 'prompt' && (
        <button className="banner warn" onClick={async () => (await reconnect()) && engine.refreshVault()}>
          Click to reconnect your notes folder
        </button>
      )}
      {st.vault === 'none' && (
        <button className="banner warn" onClick={() => go({ name: 'settings' })}>
          Choose a notes folder in Settings
        </button>
      )}
      {st.notice && <div className="banner warn">{st.notice}</div>}
      {st.error && <div className="banner err">{st.error}</div>}

      <nav className="tabs" role="tablist">
        {(['notes', 'transcript', 'diagrams', 'code'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
            {t === 'diagrams' && <span className="count">{diagrams.length}</span>}
            {t === 'code' && <span className="count">{code.length}</span>}
          </button>
        ))}
      </nav>

      <main className="content">
        {!s ? (
          <p className="empty">
            Open a lecture video and press play. Notes appear here.
            <br />
            <span className="small">Tab was open before LectureInk was installed? Reload it.</span>
          </p>
        ) : tab === 'transcript' ? (
          s.transcript.length ? (
            <ol className="transcript">
              {s.transcript.map((l, i) => (
                <li key={i}>
                  <button className="ts" onClick={() => engine.seek(l.ts)}>
                    {fmt(l.ts)}
                  </button>
                  {l.text}
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty">No speech yet. Captions are read from the page; without them, add a speech-to-text key in Settings.</p>
          )
        ) : (
          <>
            {tab === 'notes' && (
              <div className="lesson-h-row">
                <h2 className="lesson-h">{s.lesson}</h2>
                <ExportButton label="PDF" title="Save the note as a PDF" run={() => exportPdf(s)} />
                <ExportButton label="Word" title="Download the note as a Word document" run={() => exportDocx(s)} />
              </div>
            )}
            {shown.length ? shown.map((b, i) => <BlockView key={i} b={b} go={go} />) : <p className="empty">Nothing captured yet.</p>}
          </>
        )}
      </main>

      <footer className="bottom">
        <button className="icon-btn" aria-label="Add screenshot" onClick={() => engine.screenshot()} disabled={!s}>
          <Icon name="camera" />
        </button>
        <button className="icon-btn" aria-label="Flag this moment" onClick={() => engine.flag()} disabled={!s}>
          <Icon name="flag" />
        </button>
        <button className="icon-btn" aria-label="Capture code on screen" onClick={() => engine.captureCode()} disabled={!s || st.busy}>
          <Icon name="code" />
        </button>
        <button className="primary" title="Ask about this lesson" onClick={() => go({ name: 'ask' })} disabled={!s}>
          <Icon name="sparkle" /> Ask AI
        </button>
      </footer>
    </div>
  );
}

function ExportButton({ label, title, run }: { label: string; title: string; run: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <button
      className="chip"
      title={error || title}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        setError('');
        await run()
          .catch((e) => setError(e.message))
          .finally(() => setBusy(false));
      }}
    >
      {busy ? <span className="spinner" aria-label="Exporting" /> : <Icon name="file" size={14} />} {label}
    </button>
  );
}

function Ts({ ts }: { ts: number }) {
  return (
    <button className="ts" onClick={() => engine.seek(ts)} title="Jump to this moment">
      {fmt(ts)}
    </button>
  );
}

function BlockView({ b, go }: { b: Block; go: (s: Screen) => void }) {
  switch (b.kind) {
    case 'section':
      return (
        <article className="section">
          <h3>
            <Ts ts={b.ts} /> {b.heading}
          </h3>
          <ul>
            {b.bullets.map((x, i) => (
              <li key={i} dangerouslySetInnerHTML={{ __html: inline(x) }} />
            ))}
          </ul>
        </article>
      );
    case 'code':
      return (
        <article className="card">
          <div className="card-head">
            <Icon name="code" size={18} /> <strong>Code captured</strong> <Ts ts={b.ts} />
            <span className="chip right">{b.lang}</span>
          </div>
          <pre className="code">
            <code dangerouslySetInnerHTML={{ __html: highlight(b.source, b.lang) }} />
          </pre>
          {b.explanation && (
            <div className="card-foot">
              <strong>What the instructor explained</strong>
              <p dangerouslySetInnerHTML={{ __html: inline(b.explanation) }} />
            </div>
          )}
        </article>
      );
    case 'diagram':
      return (
        <article className="card">
          <div className="card-head">
            <Icon name="diagram" size={18} /> <strong>Diagram detected</strong> <Ts ts={b.ts} />
            <button className="chip ok right" onClick={() => go({ name: 'diagram', id: b.id })}>
              Excalidraw
            </button>
          </div>
          <button className="diagram-preview" onClick={() => go({ name: 'diagram', id: b.id })} aria-label={`Edit diagram: ${b.title}`}>
            <DiagramPreview elements={b.elements} />
          </button>
          {b.caption && <p className="caption">{b.caption}</p>}
        </article>
      );
    case 'screenshot':
      return (
        <figure className="shot">
          <img src={b.image} alt={`Video frame at ${fmt(b.ts)}`} />
          <figcaption>
            <Ts ts={b.ts} />
          </figcaption>
        </figure>
      );
    case 'flag':
      return (
        <aside className="flag">
          <Icon name="flag" size={16} /> <Ts ts={b.ts} /> {b.text}
        </aside>
      );
  }
}

function DiagramPreview({ elements }: { elements: unknown[] }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let live = true;
    import('@excalidraw/excalidraw')
      .then(({ exportToSvg }) => exportToSvg({ elements: elements as any, appState: { exportBackground: false }, files: null, exportPadding: 12 }))
      .then((el) => live && setSvg(el.outerHTML))
      .catch(() => live && setSvg(''));
    return () => {
      live = false;
    };
  }, [elements]);
  return <div className="svg" dangerouslySetInnerHTML={{ __html: svg }} />;
}
