/// <reference lib="webworker" />
// All @dbml/core work happens here: the library is ~20 MB unminified (it bundles every SQL
// dialect parser), so keeping it off the main thread keeps typing and dragging smooth.
import { Parser, exporter, importer } from '@dbml/core';
import { toDiagramModel, toDiagnostics } from './model';
import type { ParseResult, WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

function handle(req: WorkerRequest): unknown {
  switch (req.op) {
    case 'parse': {
      const db = Parser.parse(req.source, 'dbmlv2');
      const result: ParseResult = { model: toDiagramModel(db.normalize() as never) };
      return result;
    }
    case 'export':
      return exporter.export(req.source, req.format);
    case 'import':
      return importer.import(req.text, req.format);
  }
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  let res: WorkerResponse;
  try {
    res = { id: req.id, ok: true, result: handle(req) };
  } catch (err) {
    res = { id: req.id, ok: false, diagnostics: toDiagnostics(err) };
  }
  self.postMessage(res);
};
