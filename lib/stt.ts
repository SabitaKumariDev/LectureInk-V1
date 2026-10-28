// Speech-to-text for lectures without captions. Any OpenAI-compatible
// /audio/transcriptions endpoint works: OpenAI, Groq, or a local server.

export interface SttConfig {
  baseUrl: string;
  key: string;
  model: string;
}

export const STT_PRESETS: Record<string, SttConfig> = {
  OpenAI: { baseUrl: 'https://api.openai.com/v1', key: '', model: 'whisper-1' },
  Groq: { baseUrl: 'https://api.groq.com/openai/v1', key: '', model: 'whisper-large-v3-turbo' },
  Local: { baseUrl: 'http://localhost:8000/v1', key: '', model: 'Systran/faster-whisper-small' },
};

export async function transcribe(cfg: SttConfig, audio: Blob): Promise<string> {
  const form = new FormData();
  form.append('file', audio, 'chunk.webm');
  form.append('model', cfg.model);
  const res = await fetch(`${cfg.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: cfg.key ? { authorization: `Bearer ${cfg.key}` } : {},
    body: form,
  });
  if (!res.ok) throw new Error(`Transcription ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()).text ?? '').trim();
}
