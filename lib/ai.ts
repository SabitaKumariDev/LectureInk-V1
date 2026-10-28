// Model calls. Claude goes through the Anthropic SDK; every other provider
// exposes an OpenAI-compatible /chat/completions endpoint.
import Anthropic from '@anthropic-ai/sdk';

export type Provider = 'claude' | 'openai' | 'gemini' | 'grok' | 'kimi' | 'local';

// Model names change often; users can override any of them in Settings.
// `models` is the offline fallback; listModels() fetches the live list once a key is set.
export const PROVIDERS: Record<Provider, { label: string; baseUrl: string; model: string; models: string[]; keyless?: boolean }> = {
  claude: { label: 'Claude', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'] },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini', models: ['gpt-5.5', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano'] },
  gemini: { label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash', models: ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview'] },
  grok: { label: 'Grok', baseUrl: 'https://api.x.ai/v1', model: 'grok-4.3', models: ['grok-4.7', 'grok-4.3'] },
  kimi: { label: 'Kimi', baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k2.6', models: ['kimi-k3', 'kimi-k2.6'] },
  local: { label: 'Local', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2-vision', models: ['llama3.2-vision', 'gemma3', 'qwen2.5vl'], keyless: true },
};

// Drops embedding/audio/image-generation models that /models also returns.
const NOT_CHAT = /embed|tts|whisper|transcribe|dall-e|gpt-image|imagen|audio|realtime|moderation|search|aqa/i;

/** Model ids the provider currently offers. */
export async function listModels(cfg: AiConfig): Promise<string[]> {
  const ids =
    cfg.provider === 'claude'
      ? (await new Anthropic({ apiKey: cfg.key, baseURL: cfg.baseUrl, dangerouslyAllowBrowser: true }).models.list({ limit: 100 })).data.map((m) => m.id)
      : await fetch(`${cfg.baseUrl}/models`, { headers: cfg.key ? { authorization: `Bearer ${cfg.key}` } : {} })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
          .then((j) => (j.data ?? []).map((m: { id: string }) => m.id.replace(/^models\//, '')));
  return ids.filter((id: string) => !NOT_CHAT.test(id)).sort();
}

export interface AiConfig {
  provider: Provider;
  key: string;
  model: string;
  baseUrl: string;
}

export interface Msg {
  role: 'user' | 'assistant';
  text: string;
  images?: string[]; // jpeg data URLs
}

export async function chat(cfg: AiConfig, system: string, msgs: Msg[]): Promise<string> {
  if (!cfg.key && !PROVIDERS[cfg.provider].keyless) throw new Error('Add your API key in Settings.');
  return cfg.provider === 'claude' ? claude(cfg, system, msgs) : openaiCompatible(cfg, system, msgs);
}

// Models that accept the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = /^claude-(opus-5|sonnet-5-5|fable-5-1)/;

async function claude(cfg: AiConfig, system: string, msgs: Msg[]): Promise<string> {
  const client = new Anthropic({ apiKey: cfg.key, baseURL: cfg.baseUrl, dangerouslyAllowBrowser: true });
  const res = await client.beta.messages.create({
    model: cfg.model,
    max_tokens: 16000,
    system,
    messages: msgs.map((m) => ({
      role: m.role,
      content: [
        ...(m.images ?? []).map((img) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: img.split(',')[1] },
        })),
        { type: 'text' as const, text: m.text },
      ],
    })),
    ...(FALLBACK_MODELS.test(cfg.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  });
  if (res.stop_reason === 'refusal') throw new Error('The model declined this request.');
  return res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
}

// Overloaded / rate-limited: worth a retry. Gemini returns 503 during demand spikes.
const BUSY = new Set([429, 500, 502, 503]);

async function openaiCompatible(cfg: AiConfig, system: string, msgs: Msg[]): Promise<string> {
  let res = await post(cfg, system, msgs);
  for (const wait of [2000, 6000]) {
    if (!BUSY.has(res.status)) break;
    await new Promise((r) => setTimeout(r, wait));
    res = await post(cfg, system, msgs);
  }
  if (!res.ok) {
    // Show the provider's own message, not the raw JSON. Gemini wraps it in an array.
    let msg = await res.text();
    try {
      const j = JSON.parse(msg);
      msg = (Array.isArray(j) ? j[0] : j)?.error?.message ?? msg;
    } catch {}
    throw new Error(`${PROVIDERS[cfg.provider].label} ${res.status}: ${msg.split('\n')[0].slice(0, 200)}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? '';
}

function post(cfg: AiConfig, system: string, msgs: Msg[]): Promise<Response> {
  return fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}) },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: system },
        ...msgs.map((m) => ({
          role: m.role,
          content: m.images?.length
            ? [{ type: 'text', text: m.text }, ...m.images.map((url) => ({ type: 'image_url', image_url: { url } }))]
            : m.text,
        })),
      ],
    }),
  });
}

/** Pulls the JSON object out of a reply that may be fenced or wrapped in prose. */
export function parseJson<T>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in model reply');
  return JSON.parse(text.slice(start, end + 1));
}
