import type { DiagramModel, Diagnostic, EditInfo } from './types';

export type SqlExportFormat = 'postgres' | 'mysql' | 'mssql' | 'oracle';
export type ImportFormat = 'postgres' | 'mysql' | 'mssql' | 'oracle' | 'snowflake' | 'schemarb' | 'json';

export type WorkerRequest =
  | { id: number; op: 'parse'; source: string }
  | { id: number; op: 'export'; source: string; format: SqlExportFormat | 'json' }
  | { id: number; op: 'import'; text: string; format: ImportFormat };

export type ParseResult = { model: DiagramModel; info: EditInfo };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; diagnostics: Diagnostic[] };
