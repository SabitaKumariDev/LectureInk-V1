import { browser } from 'wxt/browser';
import { PROVIDERS, type AiConfig, type Provider } from './ai';
import type { SttConfig } from './stt';

export interface Settings {
  provider: Provider;
  keys: Partial<Record<Provider, string>>;
  models: Partial<Record<Provider, string>>;
  localUrl: string;
  captureDiagrams: boolean;
  captureCode: boolean;
  stt: SttConfig;
}

export const DEFAULTS: Settings = {
  provider: 'claude',
  keys: {},
  models: {},
  localUrl: PROVIDERS.local.baseUrl,
  captureDiagrams: true,
  captureCode: true,
  stt: { baseUrl: 'https://api.openai.com/v1', key: '', model: 'whisper-1' },
};

// storage.local, never sync: API keys stay on this device.
export async function loadSettings(): Promise<Settings> {
  const { settings } = await browser.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings as Partial<Settings>) };
}

export const saveSettings = (settings: Settings) => browser.storage.local.set({ settings });

export function aiConfig(s: Settings): AiConfig {
  const p = PROVIDERS[s.provider];
  return {
    provider: s.provider,
    key: s.keys[s.provider] ?? '',
    model: s.models[s.provider] || p.model,
    baseUrl: s.provider === 'local' ? s.localUrl : p.baseUrl,
  };
}
