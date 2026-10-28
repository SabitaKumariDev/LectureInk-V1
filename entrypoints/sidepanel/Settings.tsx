import { useEffect, useState } from 'react';
import { listModels, PROVIDERS, type Provider } from '@/lib/ai';
import { loadSettings, saveSettings, type Settings as S } from '@/lib/settings';
import { STT_PRESETS } from '@/lib/stt';
import { folderLabel, pickFolder } from '@/lib/vault';
import { engine } from './engine';
import { Icon } from './ui';

export default function Settings({ back }: { back: () => void }) {
  const [s, setS] = useState<S | null>(null);
  const [folder, setFolder] = useState<string | null>(null);

  const [live, setLive] = useState<string[]>([]);
  const [status, setStatus] = useState('');

  useEffect(() => {
    loadSettings().then(setS);
    folderLabel().then(setFolder);
  }, []);

  const provider = s?.provider;
  const key = provider ? s.keys[provider] ?? '' : '';
  const localUrl = s?.localUrl;
  useEffect(() => {
    if (!provider) return;
    setLive([]);
    const meta = PROVIDERS[provider];
    setStatus(key || meta.keyless ? 'Checking…' : '');
    if (!key && !meta.keyless) return;
    let stale = false;
    const t = setTimeout(() => {
      listModels({ provider, key, model: '', baseUrl: provider === 'local' ? localUrl || meta.baseUrl : meta.baseUrl })
        .then((ids) => {
          if (stale) return;
          setLive(ids);
          setStatus(`Connected to ${meta.label}. ${ids.length} models available.`);
        })
        // bad key or offline: keep the built-in list
        .catch((e) => !stale && setStatus(`Could not connect to ${meta.label} (${e.status ?? e.message}). Check the ${provider === 'local' ? 'server URL' : 'key'}.`));
    }, 500);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [provider, key, localUrl]);
  if (!s) return null;

  const update = (patch: Partial<S>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
  };
  const p = PROVIDERS[s.provider];
  const model = s.models[s.provider] || p.model;
  const modelOptions = [...new Set([model, ...(live.length ? live : p.models)])];

  return (
    <div className="screen">
      <header className="top">
        <button className="icon-btn" aria-label="Back" onClick={back}>
          <Icon name="back" />
        </button>
        <h1>Settings</h1>
      </header>
      <main className="content settings">
        <h2>Notes folder</h2>
        <div className="box row">
          <Icon name="folder" />
          <span className="grow">{folder ?? 'Not chosen'}</span>
          <button
            className="chip ok"
            onClick={async () => {
              setFolder(await pickFolder());
              engine.refreshVault();
            }}
          >
            {folder ? 'Change' : 'Choose'}
          </button>
        </div>

        <h2>While watching</h2>
        <div className="box">
          <label className="check">
            <input type="checkbox" checked={s.captureDiagrams} onChange={(e) => update({ captureDiagrams: e.target.checked })} />
            Capture diagrams as Excalidraw
          </label>
          <label className="check">
            <input type="checkbox" checked={s.captureCode} onChange={(e) => update({ captureCode: e.target.checked })} />
            Capture code with explanation
          </label>
        </div>

        <h2>AI</h2>
        <div className="grid3" role="radiogroup" aria-label="AI provider">
          {(Object.keys(PROVIDERS) as Provider[]).map((id) => (
            <button key={id} role="radio" aria-checked={s.provider === id} className={s.provider === id ? 'opt on' : 'opt'} onClick={() => update({ provider: id })}>
              {PROVIDERS[id].label}
            </button>
          ))}
        </div>
        {s.provider === 'local' ? (
          <input className="field" value={s.localUrl} onChange={(e) => update({ localUrl: e.target.value })} aria-label="Local server URL" placeholder={PROVIDERS.local.baseUrl} />
        ) : (
          <input
            className="field"
            type="password"
            autoComplete="off"
            value={s.keys[s.provider] ?? ''}
            onChange={(e) => update({ keys: { ...s.keys, [s.provider]: e.target.value.trim() } })}
            aria-label={`${p.label} API key`}
            placeholder={`${p.label} API key`}
          />
        )}
        <select className="field" value={model} onChange={(e) => update({ models: { ...s.models, [s.provider]: e.target.value } })} aria-label="Model">
          {modelOptions.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        {status && (
          <p className="small" role="status">
            {status}
          </p>
        )}
        <p className="muted small">Pick a model that reads images. Keys stay in this browser and go only to the provider you pick.</p>

        <h2>Speech to text (when a video has no captions)</h2>
        <div className="grid3">
          {Object.entries(STT_PRESETS).map(([name, preset]) => (
            <button key={name} className={s.stt.baseUrl === preset.baseUrl ? 'opt on' : 'opt'} onClick={() => update({ stt: { ...preset, key: s.stt.key } })}>
              {name}
            </button>
          ))}
        </div>
        <input className="field" value={s.stt.baseUrl} onChange={(e) => update({ stt: { ...s.stt, baseUrl: e.target.value.trim() } })} aria-label="Speech-to-text URL" />
        <input
          className="field"
          type="password"
          autoComplete="off"
          value={s.stt.key}
          onChange={(e) => update({ stt: { ...s.stt, key: e.target.value.trim() } })}
          aria-label="Speech-to-text API key"
          placeholder="Speech-to-text API key"
        />
        <input className="field" value={s.stt.model} onChange={(e) => update({ stt: { ...s.stt, model: e.target.value.trim() } })} aria-label="Speech-to-text model" />
      </main>
      <footer className="muted small center pad">Works on YouTube, Udemy, Coursera and any page with a video.</footer>
    </div>
  );
}
