// Persistence. Inside the extension this is chrome.storage.local (with "unlimitedStorage");
// under `npm run dev` (a plain web page) it falls back to localStorage so the app still works.
//
// Layout:  dd:index          -> DiagramMeta[]
//          dd:doc:<id>       -> DiagramDoc
//          dd:settings       -> Settings
import type { Lang } from './i18n';
import type { XYPosition } from '@xyflow/react';

export type DisplayMode = 'all' | 'keys' | 'names';

export interface DiagramMeta {
  id: string;
  name: string;
  updatedAt: number;
}

export interface DiagramDoc extends DiagramMeta {
  source: string;
  /** keyed by DTable.id / DNote.id */
  positions: Record<string, XYPosition>;
}

export interface Settings {
  lang?: Lang;
  currentId?: string;
  editorWidth?: number;
  editorHidden?: boolean;
  displayMode?: DisplayMode;
  showMinimap?: boolean;
}

const hasChromeStorage = typeof chrome !== 'undefined' && !!chrome.storage?.local;

async function get<T>(key: string): Promise<T | undefined> {
  if (hasChromeStorage) return (await chrome.storage.local.get(key))[key] as T | undefined;
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

async function set(key: string, value: unknown) {
  if (hasChromeStorage) return chrome.storage.local.set({ [key]: value });
  localStorage.setItem(key, JSON.stringify(value));
}

async function remove(key: string) {
  if (hasChromeStorage) return chrome.storage.local.remove(key);
  localStorage.removeItem(key);
}

const INDEX = 'dd:index';
const SETTINGS = 'dd:settings';
const docKey = (id: string) => `dd:doc:${id}`;

// Index updates are read-modify-write, so all writes go through one queue.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
};

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const storage = {
  listDiagrams: async () => (await get<DiagramMeta[]>(INDEX)) ?? [],
  loadDiagram: (id: string) => get<DiagramDoc>(docKey(id)),

  saveDiagram: (doc: DiagramDoc) => serial(async () => {
    await set(docKey(doc.id), doc);
    const index = (await get<DiagramMeta[]>(INDEX)) ?? [];
    const meta: DiagramMeta = { id: doc.id, name: doc.name, updatedAt: doc.updatedAt };
    const i = index.findIndex((m) => m.id === doc.id);
    if (i >= 0) index[i] = meta;
    else index.unshift(meta);
    await set(INDEX, index);
  }),

  deleteDiagram: (id: string) => serial(async () => {
    await remove(docKey(id));
    const index = ((await get<DiagramMeta[]>(INDEX)) ?? []).filter((m) => m.id !== id);
    await set(INDEX, index);
  }),

  loadSettings: async () => (await get<Settings>(SETTINGS)) ?? {},
  saveSettings: (patch: Settings) => serial(async () => {
    const cur = (await get<Settings>(SETTINGS)) ?? {};
    await set(SETTINGS, { ...cur, ...patch });
  }),
};
