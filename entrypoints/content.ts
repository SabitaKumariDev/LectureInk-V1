// Runs in every frame. Finds the lecture video, reports where it is, reads
// captions, seeks on request and records audio when the page has no captions.
import { detectPlatform, visible } from '@/lib/platforms';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    const top = window === window.top;
    const send = (msg: object) => browser.runtime.sendMessage(msg).catch(() => {}); // panel closed

    const findVideo = () =>
      [...document.querySelectorAll('video')]
        .map((v) => ({ v, r: v.getBoundingClientRect() }))
        .filter(({ r }) => r.width * r.height > 200 * 100)
        .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];

    // --- captions --------------------------------------------------------
    let last = '';
    const recent: string[] = [];
    const emit = (raw: string, ts: number) => {
      const text = raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (!text || recent.includes(text)) return;
      const replace = !!last && text.startsWith(last); // auto-captions grow word by word
      last = text;
      recent.push(text);
      if (recent.length > 20) recent.shift();
      send({ type: 'caption', text, ts, replace });
    };

    const watched = new WeakSet<TextTrack>();
    const watchTracks = (v: HTMLVideoElement) => {
      const tracks = [...v.textTracks].filter((t) => t.kind === 'captions' || t.kind === 'subtitles');
      // Read captions even when the learner keeps them hidden.
      if (tracks.length && !tracks.some((t) => t.mode !== 'disabled')) tracks[0].mode = 'hidden';
      for (const t of tracks) {
        if (watched.has(t)) continue;
        watched.add(t);
        t.addEventListener('cuechange', () => {
          if (t.mode === 'disabled') return;
          for (const cue of [...(t.activeCues ?? [])]) emit((cue as VTTCue).text ?? '', cue.startTime);
        });
      }
    };

    const platform = top ? detectPlatform() : undefined;
    const captionSel = platform?.captions;
    const isAd = () => !!platform?.ad && visible(platform.ad).length > 0;
    let ccCheckedFor = ''; // page URL; single-page sites swap videos without reloading
    let ccCheckedAt = 0;
    let ccClickAt = 0;
    let sawCaptions = false;
    const seen = new WeakMap<Element, string>(); // caption window -> text it showed last // this video has captions, so CC switched off means the learner did it
    const hideStyle = Object.assign(document.createElement('style'), { textContent: `${captionSel} { opacity: 0 !important; }` });
    const hideCaptions = (on: boolean) => (on ? document.head.append(hideStyle) : hideStyle.remove());
    // Some players only render captions while CC is on: switch it on, keep the text invisible.
    // Runs every second: switching CC off would otherwise stop the notes.
    const enableCaptions = () => {
      const b = platform?.ccButton && visible(platform.ccButton)[0];
      if (!b) return;
      if (ccCheckedFor !== location.href) [ccCheckedFor, ccCheckedAt, sawCaptions] = [location.href, Date.now(), false];
      // A player still loading ignores the click, so keep trying for 10s before deciding the video has no captions.
      const trying = Date.now() - ccCheckedAt < 10_000;
      if (b.getAttribute('aria-pressed') !== 'false' || !(trying || sawCaptions)) return; // already on, or the video has no captions
      if (Date.now() - ccClickAt < 3000) return; // give the last click time to land, or a second one turns CC back off
      ccClickAt = Date.now();
      hideCaptions(true);
      (b as HTMLElement).click();
    };
    // While captions run, the CC button only shows or hides their text; the notes keep reading them.
    if (platform?.ccButton)
      addEventListener(
        'click',
        (e) => {
          const b = e.isTrusted && (e.target as Element).closest?.(platform.ccButton!);
          if (!b || b.getAttribute('aria-pressed') !== 'true') return;
          e.preventDefault();
          e.stopImmediatePropagation();
          hideCaptions(!hideStyle.isConnected);
        },
        true,
      );

    // --- audio fallback --------------------------------------------------
    let recorder: MediaRecorder | null = null;
    let cycleTimer: ReturnType<typeof setInterval> | undefined;
    let stream: MediaStream | undefined;

    const startAudio = (v: HTMLVideoElement) => {
      if (recorder) return;
      if (!stream) {
        stream = (v as any).captureStream() as MediaStream;
      }
      // ponytail: element capture gets no audio from DRM or non-CORS cross-origin video; tabCapture is the upgrade.
      const audio = new MediaStream(stream.getAudioTracks());
      if (!audio.getAudioTracks().length) throw new Error('no audio track');
      const cycle = () => {
        const start = v.currentTime;
        const chunks: Blob[] = [];
        const r = new MediaRecorder(audio, { mimeType: 'audio/webm' });
        r.ondataavailable = (e) => chunks.push(e.data);
        r.onstop = () => {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          if (blob.size < 4000) return; // silence
          const fr = new FileReader();
          fr.onload = () => send({ type: 'audio', ts: start, data: fr.result });
          fr.readAsDataURL(blob);
        };
        r.start();
        if (v.paused) r.pause();
        recorder = r;
      };
      v.addEventListener('pause', () => recorder?.state === 'recording' && recorder.pause());
      v.addEventListener('play', () => recorder?.state === 'paused' && !isAd() && recorder.resume());
      cycle();
      cycleTimer = setInterval(() => {
        recorder?.stop();
        cycle();
      }, 30_000);
    };

    const stopAudio = () => {
      clearInterval(cycleTimer);
      recorder?.stop();
      recorder = null;
    };

    // --- reporting -------------------------------------------------------
    setInterval(() => {
      const found = findVideo();
      if (top) send({ type: 'page', url: location.href, platform: detectPlatform(), width: innerWidth });
      if (found) enableCaptions();
      const ad = isAd();
      if (recorder && ad && recorder.state === 'recording') recorder.pause();
      if (recorder && !ad && found && !found.v.paused && recorder.state === 'paused') recorder.resume();
      if (captionSel && found && !ad) {
        const lines = visible(captionSel);
        if (lines.length) {
          sawCaptions = true;
          // Group lines by caption window. A window whose text stopped changing is a leftover
          // (e.g. from a dubbed audio track's captions); only windows that changed are read.
          const windows = new Map<Element | null, string[]>();
          for (const e of lines) windows.set(e.parentElement, [...(windows.get(e.parentElement) ?? []), e.textContent ?? '']);
          const fresh: string[] = [];
          for (const [w, texts] of windows) {
            const t = texts.join(' ');
            if (w && seen.get(w) === t) continue;
            if (w) seen.set(w, t);
            fresh.push(t);
          }
          if (fresh.length) emit(fresh.join(' '), found.v.currentTime);
        }
      }
      if (!found) return;
      const { v, r } = found;
      watchTracks(v);
      send({
        type: 'video',
        playing: !ad && !v.paused && !v.ended && v.readyState > 2,
        time: v.currentTime,
        area: r.width * r.height,
        // Frames cannot see their offset inside the page, so only the top frame crops.
        rect: top ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
      });
    }, 1000);

    browser.runtime.onMessage.addListener((msg: any) => {
      const v = findVideo()?.v;
      if (!v) return;
      if (msg.type === 'seek') v.currentTime = msg.ts;
      if (msg.type === 'audio') {
        try {
          msg.on ? startAudio(v) : stopAudio();
        } catch {
          send({ type: 'audio-unavailable' });
        }
      }
    });
  },
});
