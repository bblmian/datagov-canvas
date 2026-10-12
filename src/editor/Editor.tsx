import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab, redo, undo } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { autocompletion, type CompletionContext, type Completion } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
import { dbml } from './dbmlLanguage';
import type { Diagnostic } from '../dbml/types';

export interface EditorHandle {
  /**
   * Selects the line at `offset` and scrolls it into view, without taking focus: keys pressed
   * next (Delete, ⌘ for multi-select) must still reach the canvas.
   */
  reveal(offset: number): void;
  revealLine(line: number, column?: number): void;
  undo(): void;
  redo(): void;
}

interface Props {
  value: string;
  onChange(value: string): void;
  diagnostics: Diagnostic[];
  /** names offered by autocompletion (tables, `table.column`, enums) */
  getCompletions(): string[];
}

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#7c3aed', fontWeight: '600' },
  { tag: tags.comment, color: '#94a3b8', fontStyle: 'italic' },
  { tag: tags.string, color: '#059669' },
  { tag: tags.special(tags.string), color: '#b45309' },
  { tag: tags.number, color: '#c2410c' },
  { tag: tags.atom, color: '#db2777' },
  { tag: tags.typeName, color: '#2563eb' },
  { tag: tags.operator, color: '#dc2626', fontWeight: '600' },
  { tag: tags.special(tags.variableName), color: '#0f766e' },
  { tag: tags.variableName, color: '#1e293b' },
]);

const KEYWORDS: Completion[] = [
  ...['Table', 'Ref', 'Enum', 'TableGroup', 'Project', 'Note', 'Indexes', 'TablePartial'].map((label) => ({ label, type: 'keyword' })),
  ...['pk', 'not null', 'null', 'unique', 'increment', 'default: ', 'note: ', 'ref: > ', 'ref: < ', 'ref: - ', 'headercolor: ', 'delete: cascade', 'update: cascade']
    .map((label) => ({ label, type: 'property' })),
  ...['integer', 'int', 'bigint', 'varchar', 'text', 'boolean', 'timestamp', 'date', 'decimal', 'float', 'uuid', 'json']
    .map((label) => ({ label, type: 'type' })),
];

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-gutters': { background: 'var(--panel-2)', borderRight: '1px solid var(--border)', color: 'var(--muted)' },
  '.cm-activeLineGutter': { background: 'var(--accent-soft)' },
  '.cm-activeLine': { background: 'rgba(37, 99, 235, 0.04)' },
});

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ value, onChange, diagnostics, getCompletions }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const completionsRef = useRef(getCompletions);
  completionsRef.current = getCompletions;

  useEffect(() => {
    const complete = (ctx: CompletionContext) => {
      const word = ctx.matchBefore(/[\w."]+/);
      if (!word || (word.from === word.to && !ctx.explicit)) return null;
      const names = completionsRef.current().map((label) => ({ label, type: label.includes('.') ? 'variable' : 'class' }));
      return { from: word.from, options: [...KEYWORDS, ...names], validFor: /^[\w."]*$/ };
    };
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          dbml,
          syntaxHighlighting(highlight),
          autocompletion({ override: [complete] }),
          theme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // created once; external value changes are synced below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply changes made outside the editor (graphical edits, switching diagrams, import). Only the
  // differing middle part is replaced, so scroll position survives and Cmd+Z undoes it as one step.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur === value) return;
    let a = 0;
    const max = Math.min(cur.length, value.length);
    while (a < max && cur.charCodeAt(a) === value.charCodeAt(a)) a++;
    let b = 0;
    while (b < max - a && cur.charCodeAt(cur.length - 1 - b) === value.charCodeAt(value.length - 1 - b)) b++;
    v.dispatch({ changes: { from: a, to: cur.length - b, insert: value.slice(a, value.length - b) } });
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const doc = v.state.doc;
    const offset = (line: number, col: number) => {
      const l = doc.line(Math.min(Math.max(line, 1), doc.lines));
      return Math.min(l.from + Math.max(col - 1, 0), l.to);
    };
    const cm: CmDiagnostic[] = diagnostics.map((d) => {
      const from = offset(d.line, d.column);
      let to = d.endLine ? offset(d.endLine, d.endColumn ?? d.column) : from;
      if (to <= from) to = Math.min(from + 1, doc.length);
      return { from, to: Math.max(to, from), severity: d.severity, message: d.message };
    });
    v.dispatch(setDiagnostics(v.state, cm));
  }, [diagnostics]);

  useImperativeHandle(ref, () => ({
    reveal(offset: number) {
      const v = view.current;
      if (!v) return;
      const line = v.state.doc.lineAt(Math.min(offset, v.state.doc.length));
      v.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 48 }) });
    },
    revealLine(line: number, column = 1) {
      const v = view.current;
      if (!v) return;
      const l = v.state.doc.line(Math.min(Math.max(line, 1), v.state.doc.lines));
      const pos = Math.min(l.from + column - 1, l.to);
      v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
      v.focus();
    },
    undo() { if (view.current) undo(view.current); },
    redo() { if (view.current) redo(view.current); },
  }));

  return <div className="editor-host" ref={host} />;
});
