import type { ImportFormat, ParseResult, SqlExportFormat, WorkerRequest, WorkerResponse } from './protocol';
import type { Diagnostic } from './types';

/** Rejection value of every client call: the diagnostics reported by @dbml/core. */
export class DbmlError extends Error {
  constructor(public diagnostics: Diagnostic[]) {
    super(diagnostics[0]?.message ?? 'DBML error');
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new DbmlError(e.data.diagnostics));
    };
  }
  return worker;
}

function call<T>(req: DistributiveOmit<WorkerRequest, 'id'>): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ ...req, id });
  });
}

export const parseDbml = (source: string) => call<ParseResult>({ op: 'parse', source });
export const exportDbml = (source: string, format: SqlExportFormat | 'json') => call<string>({ op: 'export', source, format });
export const importToDbml = (text: string, format: ImportFormat) => call<string>({ op: 'import', text, format });
