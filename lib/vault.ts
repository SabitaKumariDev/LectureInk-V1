// Writes notes into the user's markdown vault.
// A folder picked with the File System Access API (Chrome/Edge); the handle is kept in IndexedDB.
import { get, set } from 'idb-keyval';

type Dir = FileSystemDirectoryHandle & {
  queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
};

export async function pickFolder(): Promise<string> {
  const dir = (await (window as any).showDirectoryPicker({ mode: 'readwrite', id: 'lectureink-vault' })) as Dir;
  await set('vault', dir);
  return dir.name;
}

export async function folderLabel(): Promise<string | null> {
  return ((await get('vault')) as Dir | undefined)?.name ?? null;
}

/** 'granted' | 'prompt' (needs a click on Reconnect) | 'none' (no folder chosen). */
export async function vaultStatus(): Promise<'granted' | 'prompt' | 'none'> {
  const dir = (await get('vault')) as Dir | undefined;
  if (!dir) return 'none';
  return (await dir.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'granted' : 'prompt';
}

/** Must run inside a click handler. */
export async function reconnect(): Promise<boolean> {
  const dir = (await get('vault')) as Dir | undefined;
  return !!dir && (await dir.requestPermission({ mode: 'readwrite' })) === 'granted';
}

export async function writeFile(path: string, data: string | Blob): Promise<void> {
  const dir = (await get('vault')) as Dir | undefined;
  if (!dir) throw new Error('Choose a notes folder in Settings.');
  const parts = path.split('/');
  let cur: FileSystemDirectoryHandle = dir;
  for (const p of parts.slice(0, -1)) cur = await cur.getDirectoryHandle(p, { create: true });
  const file = await cur.getFileHandle(parts.at(-1)!, { create: true });
  const w = await file.createWritable();
  await w.write(data);
  await w.close();
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: head.slice(5).split(';')[0] });
}
