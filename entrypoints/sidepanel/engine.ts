// Capture loop. Lives in the side panel: while the panel is open it watches the
// active tab's video, keeps the transcript, sends keyframes + speech to the model
// and saves notes to IndexedDB and the vault.
import { get, set } from 'idb-keyval';
import { chat, parseJson, type Msg } from '@/lib/ai';
import { toElements } from '@/lib/excalidraw';
import { diagramPath, mergeBlocks, notePath, screenshotPath, sessionKey, toMarkdown, type Block, type Session } from '@/lib/notes';
import { THUMB_H, THUMB_W, SceneDetector, isBlack, toGray } from '@/lib/scene';
import { aiConfig, loadSettings, type Settings } from '@/lib/settings';
import { ASK_SYSTEM, NOTES_SYSTEM, askContext, notesPrompt, type NotesReply } from '@/lib/prompts';
import { transcribe } from '@/lib/stt';
import { dataUrlToBlob, vaultStatus, writeFile } from '@/lib/vault';
import { toExcalidrawMd } from '@/lib/excalidraw';
import type { Platform } from '@/lib/platforms';

export interface State {
  session?: Session;
  status: 'listening' | 'video-paused' | 'paused' | 'no-video';
  time: number;
  busy: boolean;
  error?: string;
  notice?: string;
  vault: 'granted' | 'prompt' | 'none';
  settings?: Settings;
}

interface VideoInfo {
  playing: boolean;
  time: number;
  area: number;
  rect: { x: number; y: number; w: number; h: number } | null;
  at: number;
}

const TICK_MS = 3000;
const MIN_GAP_MS = 20_000;
const NO_CAPTIONS_MS = 20_000;

export class Engine {
  state: State = { status: 'no-video', time: 0, busy: false, vault: 'none' };
  private listeners = new Set<() => void>();
  private tabId?: number;
  private windowId?: number;
  private pageWidth = 0;
  private videos = new Map<number, VideoInfo>(); // by frameId
  private detector = new SceneDetector();
  private pending?: { jpeg: string; ts: number };
  private lastIdx = 0;
  private lastCall = 0;
  private lastCaptionAt = 0;
  private lastLineAt = 0;
  private playingSince = 0;
  private audioOn = false;
  private written = new Set<string>();
  private saveTimer?: ReturnType<typeof setTimeout>;
  private userPaused = false;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;

  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  private updateSession(fn: (s: Session) => Session) {
    if (!this.state.session) return;
    this.set({ session: fn(this.state.session) });
    this.scheduleSave();
  }

  async start() {
    this.set({ settings: await loadSettings(), vault: await vaultStatus() });
    this.windowId = (await browser.windows.getCurrent()).id;
    await this.retarget();
    browser.tabs.onActivated.addListener(({ windowId }) => windowId === this.windowId && this.retarget());
    browser.runtime.onMessage.addListener((msg: any, sender) => {
      if (sender.tab?.id === this.tabId) this.onMessage(msg, sender.frameId ?? 0);
    });
    // New settings (e.g. a key just added) may fix the last error; the next call re-reports it if not.
    browser.storage.onChanged.addListener(async () => this.set({ settings: await loadSettings(), error: undefined }));
    setInterval(() => this.tick().catch((e) => this.set({ error: String(e.message ?? e) })), TICK_MS);
  }

  private async retarget() {
    const [tab] = await browser.tabs.query({ active: true, windowId: this.windowId });
    if (tab?.id === this.tabId) return;
    await this.flush();
    this.stopAudio();
    this.tabId = tab?.id;
    this.videos.clear();
    this.detector.reset();
    this.pending = undefined;
    this.set({ session: undefined, status: 'no-video', notice: undefined, error: undefined });
  }

  private opening: Promise<void> = Promise.resolve();

  private async onMessage(msg: any, frameId: number) {
    // Speech that arrives while a session loads belongs to it, so wait for the load.
    if (msg.type !== 'page') await this.opening;
    switch (msg.type) {
      case 'page':
        this.pageWidth = msg.width;
        this.opening = this.opening.then(() => this.openSession(msg.url, msg.platform));
        await this.opening;
        break;
      case 'video':
        this.videos.set(frameId, { ...msg, at: Date.now() });
        break;
      case 'caption':
        this.lastCaptionAt = Date.now();
        this.addLine(msg.ts, msg.text, msg.replace, 'captions');
        break;
      case 'audio': {
        const s = this.state.settings!;
        try {
          const text = await transcribe(s.stt, dataUrlToBlob(msg.data));
          if (text) this.addLine(msg.ts, text, false, 'audio');
        } catch (e: any) {
          this.set({ error: e.message });
        }
        break;
      }
      case 'audio-unavailable':
        this.set({ notice: 'No captions and the video blocks audio capture. Notes use the picture only.' });
        break;
    }
  }

  private async openSession(url: string, platform: Platform) {
    const key = sessionKey(url);
    const cur = this.state.session;
    if (cur?.url === key) {
      // Titles often render after the video; fill them in while the note is empty.
      if (!cur.blocks.length && (cur.lesson !== platform.lesson || cur.course !== platform.course))
        this.set({ session: { ...cur, lesson: platform.lesson, course: platform.course } });
      return;
    }
    await this.flush();
    const saved = (await get(`session:${key}`)) as Session | undefined;
    this.lastIdx = saved?.transcript.length ?? 0;
    this.detector.reset();
    this.written.clear();
    this.set({
      session: saved ?? {
        url: key,
        platform: platform.badge,
        course: platform.course,
        lesson: platform.lesson,
        blocks: [],
        transcript: [],
        source: 'none',
        startedAt: Date.now(),
      },
    });
  }

  private addLine(ts: number, text: string, replace: boolean, source: Session['source']) {
    this.lastLineAt = Date.now();
    this.updateSession((s) => {
      const transcript = [...s.transcript];
      // Only replace a line that has not been sent to the model yet.
      if (replace && transcript.length > this.lastIdx) transcript[transcript.length - 1] = { ts: transcript.at(-1)!.ts, text };
      else transcript.push({ ts, text });
      return { ...s, transcript, source };
    });
  }

  private video(): [number, VideoInfo] | undefined {
    return [...this.videos].filter(([, v]) => Date.now() - v.at < 3000).sort((a, b) => b[1].area - a[1].area)[0];
  }

  private async tick() {
    const found = this.video();
    if (!found || !this.state.session) return this.set({ status: 'no-video' });
    const [frameId, v] = found;
    if (this.userPaused) return this.set({ status: 'paused', time: v.time });
    this.set({ status: v.playing ? 'listening' : 'video-paused', time: v.time });
    if (!v.playing) {
      this.playingSince = 0;
      return;
    }
    this.playingSince ||= Date.now();

    const shot = await this.capture(v, 1280);
    if (shot) {
      if (isBlack(shot.gray)) this.set({ notice: 'This player hides its picture from screen capture (DRM). Notes use speech only.' });
      else if (this.detector.push(shot.gray)) this.pending = { jpeg: shot.jpeg, ts: v.time };
    }

    const s = this.state.settings!;
    const silentFor = Date.now() - Math.max(this.lastCaptionAt, this.playingSince);
    if (!this.audioOn && silentFor > NO_CAPTIONS_MS && (s.stt.key || !s.stt.baseUrl.startsWith('https://api.'))) {
      this.audioOn = true;
      browser.tabs.sendMessage(this.tabId!, { type: 'audio', on: true }, { frameId }).catch(() => {});
    }

    const lines = this.state.session.transcript.slice(this.lastIdx);
    const chars = lines.reduce((n, l) => n + l.text.length, 0);
    const since = Date.now() - this.lastCall;
    if (this.state.busy || since < MIN_GAP_MS) return;
    // Speech can stop mid-lesson (captions switched off, no STT key): new frames still get notes.
    const noSpeech = Date.now() - Math.max(this.lastLineAt, this.playingSince) > NO_CAPTIONS_MS;
    if ((this.pending && (chars > 150 || noSpeech)) || chars > 1500 || (chars > 0 && since > 90_000)) await this.summarize(v.time);
  }

  /** Crops the visible tab to the video and returns a jpeg plus a tiny grayscale thumb. */
  private async capture(v: VideoInfo, maxW: number) {
    let dataUrl: string;
    try {
      dataUrl = await browser.tabs.captureVisibleTab(this.windowId!, { format: 'jpeg', quality: 85 });
    } catch {
      return null; // tab not capturable (browser pages, minimized window)
    }
    const img = await createImageBitmap(dataUrlToBlob(dataUrl));
    const k = this.pageWidth ? img.width / this.pageWidth : 1;
    const r = v.rect ? { x: v.rect.x * k, y: v.rect.y * k, w: v.rect.w * k, h: v.rect.h * k } : { x: 0, y: 0, w: img.width, h: img.height };
    const sx = Math.max(0, r.x);
    const sy = Math.max(0, r.y);
    const sw = Math.min(img.width - sx, r.w);
    const sh = Math.min(img.height - sy, r.h);
    if (sw < 10 || sh < 10) return null;
    const scale = Math.min(1, maxW / sw);
    const c = new OffscreenCanvas(Math.round(sw * scale), Math.round(sh * scale));
    c.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const t = new OffscreenCanvas(THUMB_W, THUMB_H);
    const tc = t.getContext('2d')!;
    tc.drawImage(c, 0, 0, THUMB_W, THUMB_H);
    return { jpeg: await blobToDataUrl(await c.convertToBlob({ type: 'image/jpeg', quality: 0.7 })), gray: toGray(tc.getImageData(0, 0, THUMB_W, THUMB_H).data) };
  }

  private async summarize(now: number, focusCode = false, frame = this.pending) {
    const s = this.state.session!;
    const settings = this.state.settings!;
    const from = this.lastIdx;
    const lines = s.transcript.slice(from);
    this.pending = undefined;
    this.lastIdx = s.transcript.length;
    this.lastCall = Date.now();
    this.set({ busy: true, error: undefined });
    const msgs: Msg[] = [
      {
        role: 'user',
        text: notesPrompt(s, lines, now, { frame: !!frame, code: settings.captureCode || focusCode, diagrams: settings.captureDiagrams, focusCode }),
        images: frame ? [frame.jpeg] : [],
      },
    ];
    try {
      let reply: NotesReply;
      try {
        reply = parseJson(await chat(aiConfig(settings), NOTES_SYSTEM, msgs));
      } catch (e) {
        if (!(e instanceof SyntaxError) && !String(e).includes('No JSON')) throw e;
        reply = parseJson(await chat(aiConfig(settings), NOTES_SYSTEM, msgs)); // one retry on malformed output
      }
      this.apply(reply, lines[0]?.ts ?? now, now, frame);
    } catch (e: any) {
      this.lastIdx = Math.min(this.lastIdx, from); // retry these lines next time
      this.set({ error: e.message ?? String(e) });
    } finally {
      this.set({ busy: false });
    }
  }

  private apply(r: NotesReply, start: number, now: number, frame?: { jpeg: string; ts: number }) {
    // Models misjudge times; keep each block inside the stretch of video it was given.
    const ts = (x: unknown) => (Number.isFinite(Number(x)) ? Math.min(Math.max(Number(x), Math.floor(start)), now) : start);
    const blocks: Block[] = [];
    for (const sec of Array.isArray(r.sections) ? r.sections : [])
      if (sec?.heading) blocks.push({ kind: 'section', ts: ts(sec.ts), heading: String(sec.heading), bullets: (sec.bullets ?? []).map(String) });
    if (r.code?.source) blocks.push({ kind: 'code', ts: ts(r.code.ts), lang: r.code.lang || 'text', source: r.code.source, explanation: r.code.explanation ?? '' });
    if (r.diagram?.shapes?.length)
      blocks.push({
        kind: 'diagram',
        id: crypto.randomUUID(),
        ts: ts(r.diagram.ts),
        title: r.diagram.title || 'Diagram',
        caption: r.diagram.caption ?? '',
        confidence: Number(r.diagram.confidence) || 0,
        elements: toElements({ ...r.diagram, arrows: r.diagram.arrows ?? [] }),
        frame: frame?.jpeg,
      });
    // The model chose to keep this frame. Skipped when it already became code or a diagram, which keep the frame themselves.
    if (r.screenshot === true && frame && !r.code?.source && !r.diagram?.shapes?.length) blocks.push({ kind: 'screenshot', ts: frame.ts, image: frame.jpeg });
    if (blocks.length) this.updateSession((s) => ({ ...s, blocks: mergeBlocks(s.blocks, blocks) }));
  }

  // --- user actions ----------------------------------------------------

  togglePause() {
    this.userPaused = !this.userPaused;
    if (this.userPaused) this.stopAudio();
    this.set({ status: this.userPaused ? 'paused' : 'listening' });
  }

  async screenshot() {
    const v = this.video()?.[1];
    const shot = v && (await this.capture(v, 1600));
    if (shot) this.updateSession((s) => ({ ...s, blocks: [...s.blocks, { kind: 'screenshot', ts: v.time, image: shot.jpeg }] }));
  }

  flag() {
    const s = this.state.session;
    if (!s) return;
    // Captions break mid-sentence; two lines usually carry the whole thought.
    const text = s.transcript.slice(-2).map((l) => l.text).join(' ') || 'Flagged for review';
    this.updateSession((x) => ({ ...x, blocks: [...x.blocks, { kind: 'flag', ts: this.state.time, text }] }));
  }

  async captureCode() {
    const v = this.video()?.[1];
    const shot = v && (await this.capture(v, 1600));
    if (shot) await this.summarize(v.time, true, { jpeg: shot.jpeg, ts: v.time });
  }

  seek(ts: number) {
    const frameId = this.video()?.[0] ?? 0;
    browser.tabs.sendMessage(this.tabId!, { type: 'seek', ts }, { frameId }).catch(() => {});
  }

  updateDiagram(id: string, elements: unknown[], caption: string) {
    this.updateSession((s) => ({
      ...s,
      blocks: s.blocks.map((b) => (b.kind === 'diagram' && b.id === id ? { ...b, elements, caption } : b)),
    }));
  }

  addAnswer(question: string, answer: string) {
    this.updateSession((s) => ({ ...s, blocks: [...s.blocks, { kind: 'section', ts: this.state.time, heading: `Q: ${question}`, bullets: [answer] }] }));
  }

  async ask(history: Msg[]): Promise<string> {
    const s = this.state.session;
    if (!s) throw new Error('Open a lecture video first.');
    const [first, ...rest] = history;
    return chat(aiConfig(this.state.settings!), ASK_SYSTEM, [{ ...first, text: `${askContext(s)}\n\nQuestion: ${first.text}` }, ...rest]);
  }

  private stopAudio() {
    if (this.audioOn && this.tabId) browser.tabs.sendMessage(this.tabId, { type: 'audio', on: false }).catch(() => {});
    this.audioOn = false;
  }

  // --- persistence ------------------------------------------------------

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 5000);
  }

  async flush() {
    clearTimeout(this.saveTimer);
    const s = this.state.session;
    if (!s) return;
    await set(`session:${s.url}`, s);
    if ((await vaultStatus()) === 'granted') await this.exportVault().catch((e) => this.vaultError(e));
  }

  /** Writes the note, its diagrams and screenshots into the vault. */
  async exportVault() {
    const s = this.state.session;
    if (!s) return;
    const dir = notePath(s).replace(/[^/]+$/, '');
    await writeFile(notePath(s), toMarkdown(s));
    for (const b of s.blocks) {
      if (b.kind === 'diagram') await writeFile(dir + diagramPath(b), toExcalidrawMd(b.elements as any[]));
      if (b.kind !== 'screenshot') continue;
      const shot = dir + screenshotPath(b);
      if (!this.written.has(shot)) {
        await writeFile(shot, dataUrlToBlob(b.image));
        this.written.add(shot);
      }
    }
    const cur = this.state.session;
    if (cur?.url === s.url) this.set({ session: { ...cur, savedAt: Date.now() } });
  }

  // Folder access lost mid-session: show the reconnect banner instead of the raw browser error.
  private vaultError(e: any) {
    if (e?.name === 'NotAllowedError') this.set({ vault: 'prompt' });
    else this.set({ error: e.message });
  }

  async refreshVault() {
    this.set({ vault: await vaultStatus() });
    await this.flush();
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.readAsDataURL(blob);
  });
}

export const engine = new Engine();
