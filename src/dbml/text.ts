// Small DBML lexing helpers shared by the source map (editinfo.ts) and the editor (edit.ts).

/** Index just past the string/comment starting at `i`, or `i + 1` for any other character. */
export function skip(text: string, i: number): number {
  if (text.startsWith("'''", i)) {
    const e = text.indexOf("'''", i + 3);
    return e < 0 ? text.length : e + 3;
  }
  const c = text[i];
  if (c === "'" || c === '"' || c === '`') {
    let j = i + 1;
    while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
    return j + 1;
  }
  if (text.startsWith('//', i)) {
    const e = text.indexOf('\n', i);
    return e < 0 ? text.length : e;
  }
  if (text.startsWith('/*', i)) {
    const e = text.indexOf('*/', i + 2);
    return e < 0 ? text.length : e + 2;
  }
  return i + 1;
}

/** First `ch` at or after `from` outside strings, comments and ()/[] nesting; -1 if none. */
export function findTop(text: string, ch: string, from = 0, to = text.length): number {
  let depth = 0;
  for (let i = from; i < to;) {
    const c = text[i];
    if (depth === 0 && c === ch) return i;
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    i = skip(text, i);
  }
  return -1;
}

export function splitTop(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (;;) {
    const i = findTop(text, ',', start);
    parts.push(text.slice(start, i < 0 ? text.length : i).trim());
    if (i < 0) break;
    start = i + 1;
  }
  return parts.filter(Boolean);
}

/** Top-level statements of a block body (one per line, a multi-line string counting as one). */
export function bodyStatements(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i <= text.length;) {
    if (i === text.length || text[i] === '\n') {
      if (text.slice(start, i).trim()) out.push({ text: text.slice(start, i), start, end: i });
      start = i + 1;
      i++;
    } else i = skip(text, i);
  }
  return out;
}


/** A column definition: `name type [settings]`. */
export interface FieldParts {
  name: string;
  type: string;
  settings: string[];
}

export function parseField(text: string): FieldParts {
  let i = 0;
  if (text[0] === '"') i = skip(text, 0);
  else while (i < text.length && !/\s/.test(text[i])) i++;
  const b = findTop(text, '[', i);
  const close = b < 0 ? -1 : findTop(text, ']', b + 1);
  return {
    name: text.slice(0, i),
    type: text.slice(i, b < 0 ? text.length : b).trim(),
    settings: b < 0 ? [] : splitTop(text.slice(b + 1, close < 0 ? text.length : close)),
  };
}


/** A DBML string literal ('…', or '''…''' when it spans lines). */
export function str(s: string): string {
  if (s.includes('\n')) return `'''${s.replace(/\\/g, '\\\\').replace(/'''/g, "\\'''")}'''`;
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}


/** Settings of a column that are DBML built-ins; anything else is a custom `key: value`. */
export const BUILTIN_COLUMN_SETTINGS = ['pk', 'primary key', 'unique', 'ref', 'dep', 'not null', 'null', 'increment', 'default', 'note', 'check'];

/** `key: value` of one setting (key lower-cased), or the bare flag as key. */
export function splitSetting(s: string): { key: string; value: string } {
  const colon = findTop(s, ':');
  return colon < 0 ? { key: s.trim().toLowerCase().replace(/\s+/g, ' '), value: '' } : { key: s.slice(0, colon).trim().toLowerCase().replace(/\s+/g, ' '), value: s.slice(colon + 1).trim() };
}

/** A literal as the user sees it: strings unquoted, null as empty, everything else as written. */
export function literalDisplay(raw: string): string {
  const v = raw.trim();
  if (v === 'null') return '';
  if (v.startsWith("'''")) return v.slice(3, -3);
  if (/^'.*'$/s.test(v)) return v.slice(1, -1).replace(/\\(['\\])/g, '$1');
  return v;
}

/** What a column's type says about its values, for writing record cells. */
export interface ColumnHint {
  type: string;
  /** the column's enum (its DBML name, e.g. `status` or `s.status`) and its value names */
  enumName?: string;
  enumValues?: string[];
}

const NUMERIC = /^(tiny|small|medium|big)?int(eger)?\d*\b|^(serial|bigserial|smallserial|decimal|numeric|float\d*|double|real|money|number)\b/i;
const BOOLEAN = /^bool(ean)?\b/i;

/**
 * The literal for text typed into a cell / value box. Quoted text and `expressions` are taken as
 * written, empty is null. Otherwise the kind comes from the previous value (a string stays a
 * string even when it looks like a number), then from the column's type (number / boolean /
 * enum value / text), and only then from the text's look.
 */
export function literalFor(text: string, prevRaw?: string, column?: ColumnHint): string {
  const t = text.trim();
  if (!t) return 'null';
  if (/^['"`]/.test(t)) return t;
  if (/^null$/i.test(t)) return 'null';
  const prev = prevRaw?.trim() ?? '';
  const isNum = /^-?\d+(\.\d+)?$/.test(t);
  const isBool = /^(true|false)$/i.test(t);
  if (prev.startsWith("'")) return str(text);
  if (column?.enumValues) {
    // an enum column takes `enum.value`; a bare value name is qualified
    const name = t.includes('.') ? t.slice(t.lastIndexOf('.') + 1) : t;
    if (column.enumValues.includes(name)) return `${column.enumName}.${name}`;
    return str(text);
  }
  if (column && NUMERIC.test(column.type.trim())) return isNum ? t : str(text);
  if (column && BOOLEAN.test(column.type.trim())) return isBool ? t.toLowerCase() : str(text);
  if (column) return str(text);
  if (isNum || isBool) return t;
  // an enum value reference (`status.active`) stays a reference
  if (/^[A-Za-z_][\w.]*$/.test(t) && prev && /^[A-Za-z_][\w.]*$/.test(prev) && !/^(true|false|null)$/i.test(prev)) return t;
  return str(text);
}
