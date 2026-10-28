import { useState } from 'react';
import type { Msg } from '@/lib/ai';
import { engine } from './engine';
import { Icon, inline } from './ui';

export default function Ask({ back }: { back: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState(new Set<number>());

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    const history: Msg[] = [...msgs, { role: 'user', text: q }];
    setMsgs(history);
    setInput('');
    setBusy(true);
    setError('');
    try {
      setMsgs([...history, { role: 'assistant', text: await engine.ask(history) }]);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <header className="top">
        <button className="icon-btn" aria-label="Back" onClick={back}>
          <Icon name="back" />
        </button>
        <h1>Ask about this lesson</h1>
      </header>
      <main className="content chat">
        {!msgs.length && <p className="empty">Ask anything about the lecture. Answers use your notes and the transcript.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="bubble" dangerouslySetInnerHTML={{ __html: inline(m.text) }} />
            {m.role === 'assistant' && (
              <button
                className="chip"
                disabled={added.has(i)}
                onClick={() => {
                  engine.addAnswer(msgs[i - 1].text, m.text);
                  setAdded(new Set(added).add(i));
                }}
              >
                {added.has(i) ? 'Added' : 'Add to notes'}
              </button>
            )}
          </div>
        ))}
        {busy && <p className="muted">Thinking…</p>}
        {error && <div className="banner err">{error}</div>}
      </main>
      <form
        className="bottom"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input className="field grow" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Why does the key decide the partition?" aria-label="Question" />
        <button className="primary" disabled={busy || !input.trim()}>
          <Icon name="sparkle" /> Ask
        </button>
      </form>
    </div>
  );
}
