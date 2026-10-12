import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { XYPosition } from '@xyflow/react';
import { I18nProvider, detectLang, translate, type Lang, type MessageKey } from './i18n';
import { storage, newId, type DiagramDoc, type DiagramMeta, type DisplayMode, type Settings } from './storage';
import { DbmlError, exportDbml, importToDbml, parseDbml } from './dbml/client';
import type { DDepEnd, DiagramModel, Diagnostic, EditInfo } from './dbml/types';
import { EditError, type EditCtx, type EditResult } from './dbml/edit';
import * as E from './dbml/edit';
import { reuseUnchanged } from './dbml/model';
import type { SqlExportFormat } from './dbml/protocol';
import { sampleDbml } from './dbml/sample';
import { applyView } from './dbml/views';
import { locateDeclaration } from './dbml/locate';
import { Editor, type EditorHandle } from './editor/Editor';
import { Canvas, type CanvasHandle } from './canvas/Canvas';
import { Dropdown } from './components/Dropdown';
import { DiagramList } from './components/DiagramList';
import { ImportDialog, type ImportSource } from './components/ImportDialog';
import { PdfExportDialog } from './components/PdfExportDialog';
import { Inspector, type InspectTarget, type RunEdit } from './components/Inspector';
import type { PdfLayout } from './export/print';
import { download, safeFileName } from './export/download';

// Parsing runs in the worker and takes ~10–60 ms even for large documents, so the diagram can
// follow the text closely. Errors wait a little longer: mid-word states are usually invalid, and
// flashing them on every pause while typing is noisy.
const PARSE_DELAY = 100;
const ERROR_DELAY = 400;
const SAVE_DELAY = 400;
const NEW_DIAGRAM_SOURCE = 'Table table_name {\n  id integer [pk, increment]\n  name varchar\n}\n';

type Toast = { text: string; kind: 'info' | 'error' };

export function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>({});
  const [diagrams, setDiagrams] = useState<DiagramMeta[]>([]);
  const [doc, setDoc] = useState<DiagramDoc | null>(null);
  const [model, setModel] = useState<DiagramModel | null>(null);
  const [info, setInfo] = useState<EditInfo | null>(null);
  const [inspect, setInspect] = useState<InspectTarget | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const inspectRef = useRef(inspect);
  inspectRef.current = inspect;
  useEffect(() => { if (inspect) setInfo(parsed.current?.info ?? null); }, [inspect]);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const diagnosticsRef = useRef(diagnostics);
  diagnosticsRef.current = diagnostics;
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [importing, setImporting] = useState(false);
  const [pdfDialog, setPdfDialog] = useState(false);
  /** the DiagramView shown on the canvas (null: everything) */
  const [activeView, setActiveView] = useState<string | null>(null);
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;
  const editor = useRef<EditorHandle>(null);
  const canvas = useRef<CanvasHandle>(null);

  const lang: Lang = settings.lang ?? detectLang();
  const t = useCallback((k: MessageKey, v?: Record<string, string | number>) => translate(lang, k, v), [lang]);
  const displayMode: DisplayMode = settings.displayMode ?? 'all';
  const editorWidth = settings.editorWidth ?? 420;

  const updateSettings = useCallback((patch: Settings) => {
    setSettings((s) => ({ ...s, ...patch }));
    void storage.saveSettings(patch);
  }, []);

  const showToast = useCallback((text: string, kind: Toast['kind'] = 'info') => setToast({ text, kind }), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.kind === 'error' ? 6000 : 2500);
    return () => clearTimeout(id);
  }, [toast]);

  // ---- loading & saving ---------------------------------------------------------------

  const docRef = useRef(doc);
  docRef.current = doc;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const flush = useCallback(async () => {
    const d = docRef.current;
    if (!d || !dirtyRef.current) return;
    setDirty(false);
    await storage.saveDiagram(d);
    setDiagrams(await storage.listDiagrams());
  }, []);

  const openDiagram = useCallback(async (id: string) => {
    await flush();
    const d = await storage.loadDiagram(id);
    if (!d) return;
    setModel(null);
    resetEditing();
    setDiagnostics([]);
    setDoc(d);
    updateSettings({ currentId: id });
  }, [flush, updateSettings]);

  const createDiagram = useCallback(async (name: string, source: string) => {
    await flush();
    const d: DiagramDoc = { id: newId(), name, source, positions: {}, updatedAt: Date.now() };
    await storage.saveDiagram(d);
    setDiagrams(await storage.listDiagrams());
    setModel(null);
    resetEditing();
    setDiagnostics([]);
    setDoc(d);
    updateSettings({ currentId: d.id });
    return d;
  }, [flush, updateSettings]);

  useEffect(() => {
    (async () => {
      const s = await storage.loadSettings();
      setSettings(s);
      const list = await storage.listDiagrams();
      setDiagrams(list);
      const l = s.lang ?? detectLang();
      const id = s.currentId && list.some((m) => m.id === s.currentId) ? s.currentId : list[0]?.id;
      const d = id ? await storage.loadDiagram(id) : undefined;
      if (d) setDoc(d);
      else {
        const first: DiagramDoc = { id: newId(), name: translate(l, 'diagram.untitled'), source: sampleDbml(l), positions: {}, updatedAt: Date.now() };
        await storage.saveDiagram(first);
        setDiagrams(await storage.listDiagrams());
        setDoc(first);
        void storage.saveSettings({ currentId: first.id });
      }
      setReady(true);
    })();
  }, []);

  const patchDoc = useCallback((patch: Partial<DiagramDoc>) => {
    setDoc((d) => (d ? { ...d, ...patch, updatedAt: Date.now() } : d));
    setDirty(true);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const id = setTimeout(() => void flush(), SAVE_DELAY);
    return () => clearTimeout(id);
  }, [doc, dirty, flush]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('beforeunload', onHide); };
  }, [flush]);

  // ---- parsing ------------------------------------------------------------------------

  const parseSeq = useRef(0);
  const modelRef = useRef(model);
  modelRef.current = model;
  /** the last successful parse: the model and source map belong to exactly this text */
  const parsed = useRef<{ source: string; model: DiagramModel; info: EditInfo } | null>(null);
  /** set by graphical edits, which want the diagram updated without the typing delay */
  const parseNow = useRef(false);
  const source = doc?.source;
  const docId = doc?.id;
  useEffect(() => {
    if (source === undefined) return;
    const seq = ++parseSeq.current;
    const delay = model && !parseNow.current ? PARSE_DELAY : 0;
    parseNow.current = false;
    const id = setTimeout(async () => {
      try {
        const r = await parseDbml(source);
        if (seq !== parseSeq.current) return;
        const m = reuseUnchanged(modelRef.current, r.model);
        parsed.current = { source, model: m, info: r.info };
        modelRef.current = m;
        setModel(m);
        // offsets change on every keystroke; only the open inspector needs them re-rendered
        if (inspectRef.current) setInfo(r.info);
        setDiagnostics((d) => (d.length ? [] : d));
        drainEdits.current();
      } catch (e) {
        if (seq !== parseSeq.current) return;
        const diags: Diagnostic[] = e instanceof DbmlError ? e.diagnostics : [{ message: String(e), line: 1, column: 1, severity: 'error' }];
        if (pendingEdits.current.length) {
          pendingEdits.current = [];
          showToast(t('edit.fixErrors'), 'error');
        }
        // with nothing on screen yet, show the errors right away
        if (!modelRef.current) setDiagnostics(diags);
        else setTimeout(() => { if (seq === parseSeq.current) setDiagnostics(diags); }, ERROR_DELAY);
      }
    }, delay);
    return () => clearTimeout(id);
    // `model` only decides the delay for the first parse of a diagram
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, docId]);

  // ---- graphical editing -------------------------------------------------------------
  // Each edit rewrites the DBML text using the source map of the last parse, so edits wait in a
  // queue until the text on screen has been parsed (normally a few ms after the previous edit).

  type Pending = { fn: (c: EditCtx) => EditResult; then?: (r: EditResult) => void; place?: XYPosition };
  const pendingEdits = useRef<Pending[]>([]);
  const drainEdits = useRef(() => {});
  drainEdits.current = () => {
    for (;;) {
      const d = docRef.current;
      const p = parsed.current;
      if (!pendingEdits.current.length || !d || !p || p.source !== d.source) return;
      const { fn, then, place } = pendingEdits.current.shift()!;
      let r: EditResult;
      try {
        r = fn({ source: d.source, model: p.model, info: p.info });
      } catch (e) {
        pendingEdits.current = [];
        const msg = e instanceof EditError ? t(`edit.error.${e.code}` as MessageKey, { name: e.detail }) : e instanceof Error ? e.message : String(e);
        showToast(msg, 'error');
        return;
      }
      if (r.source !== d.source) {
        const positions = { ...d.positions };
        for (const [from, to] of Object.entries(r.renamed ?? {})) {
          if (positions[from]) { positions[to] = positions[from]; delete positions[from]; }
        }
        for (const id of r.removed ?? []) delete positions[id];
        if (place && r.created) positions[r.created] = place;
        const next = { ...d, source: r.source, positions, updatedAt: Date.now() };
        docRef.current = next;
        parseNow.current = true;
        setDoc(next);
        setDirty(true);
        if (r.renamed) {
          setInspect((cur) => (cur?.id && r.renamed![cur.id] ? { ...cur, id: r.renamed![cur.id] } : cur));
          setActiveView((cur) => (cur && r.renamed![cur]) || cur);
        }
      }
      then?.(r);
    }
  };

  function resetEditing() {
    parsed.current = null;
    setActiveView(null);
    pendingEdits.current = [];
    setInspect(null);
  }

  const runEdit = useCallback<RunEdit>((fn, opts) => {
    if (diagnosticsRef.current.length) return showToast(t('edit.fixErrors'), 'error');
    pendingEdits.current.push({ fn, then: opts?.then });
    drainEdits.current();
  }, [showToast, t]);

  const editAt = useCallback((fn: (c: EditCtx) => EditResult, place: XYPosition, then?: (r: EditResult) => void) => {
    if (diagnosticsRef.current.length) return showToast(t('edit.fixErrors'), 'error');
    pendingEdits.current.push({ fn, place, then });
    drainEdits.current();
  }, [showToast, t]);

  /** Something created while a view that lists its members is shown joins that view, so it stays visible. */
  const addToActiveView = useCallback((kind: 'tables' | 'notes', id: string) => {
    const viewId = activeViewRef.current;
    if (!viewId) return;
    runEdit((c) => {
      const v = c.model.views.find((x) => x.id === viewId);
      const list = v?.[kind];
      return v && Array.isArray(list) && !list.includes(id) ? E.updateView(c, v.id, { [kind]: [...list, id] }) : { source: c.source };
    });
  }, [runEdit]);
  const onAddTable = useCallback((at: XYPosition) => editAt((c) => E.addTable(c), at, (r) => {
    if (r.created) addToActiveView('tables', r.created);
    setInspect({ kind: 'table', id: r.created });
    setFocus('name');
  }), [editAt, addToActiveView]);
  const onAddNote = useCallback((at: XYPosition) => editAt((c) => E.addNote(c, t('ins.note.placeholder')), at, (r) => {
    if (r.created) addToActiveView('notes', r.created);
    setInspect({ kind: 'note', id: r.created });
  }), [editAt, t, addToActiveView]);
  const onShowView = useCallback((id: string | null) => setActiveView(id), []);
  const view = model?.views.find((v) => v.id === activeView);
  const shownModel = useMemo(() => (model ? applyView(model, view) : null), [model, view]);
  const onConnectFields = useCallback((from: string, to: string) => runEdit((c) => {
    // dragging from a key to a non-key column: the other column is the one that references
    const f = (id: string) => c.model.tables.flatMap((x) => x.fields).find((x) => x.id === id);
    return f(from)?.pk && !f(to)?.pk ? E.addRef(c, to, from) : E.addRef(c, from, to);
  }), [runEdit]);
  const onConnectDep = useCallback((up: DDepEnd, down: DDepEnd) => runEdit((c) => E.addDep(c, up, down)), [runEdit]);
  const onDeleteElements = useCallback((ids: { tables: string[]; notes: string[] }) => {
    for (const id of ids.tables) runEdit((c) => (c.model.tables.some((x) => x.id === id) ? E.deleteTable(c, id) : { source: c.source }));
    for (const id of ids.notes) runEdit((c) => (c.model.notes.some((x) => x.id === id) ? E.deleteNote(c, id) : { source: c.source }));
    setInspect(null);
  }, [runEdit]);
  const onGroupTables = useCallback((tableIds: string[]) => runEdit((c) => E.addGroup(c, tableIds), { then: (r) => setInspect({ kind: 'group', id: r.created }) }), [runEdit]);
  const onInspect = useCallback((target: InspectTarget | null) => { setFocus(null); setInspect(target); }, []);

  // ⌘Z / ⇧⌘Z outside text fields undo graphical edits too (the editor's own history)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      if (e.shiftKey) editor.current?.redo();
      else editor.current?.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- actions ------------------------------------------------------------------------

  const onPositionsChange = useCallback((positions: Record<string, XYPosition>) => patchDoc({ positions }), [patchDoc]);

  const onElementClick = useCallback((kind: 'table' | 'note' | 'group', id: string) => {
    const src = docRef.current?.source ?? '';
    let offset = -1;
    if (kind === 'table') {
      const tbl = model?.tables.find((x) => x.id === id);
      if (tbl) offset = locateDeclaration(src, 'Table', tbl.name, tbl.schema);
    } else if (kind === 'note') {
      offset = locateDeclaration(src, 'Note', id.replace(/^note:/, ''));
    } else {
      const grp = model?.groups.find((g) => g.id === id);
      if (grp) offset = locateDeclaration(src, 'TableGroup', grp.name);
    }
    if (offset >= 0 && !settings.editorHidden) editor.current?.reveal(offset);
  }, [model, settings.editorHidden]);

  const completions = useCallback(() => {
    if (!model) return [];
    return [
      ...model.tables.flatMap((tb) => [tb.id, ...tb.fields.map((f) => `${tb.id}.${f.name}`)]),
      ...model.enums.map((e) => e.id),
    ];
  }, [model]);

  const fileBase = safeFileName(doc?.name ?? 'diagram');

  const exportAs = useCallback(async (kind: 'png' | 'svg' | 'pdf' | 'dbml' | SqlExportFormat | 'json') => {
    if (!doc) return;
    try {
      if (kind === 'dbml') return download(`${fileBase}.dbml`, doc.source);
      if (kind === 'png' || kind === 'svg' || kind === 'pdf') {
        if (!model || !canvas.current) return showToast(t('export.fixErrors'), 'error');
        if (kind === 'pdf') return setPdfDialog(true);
        const img = await canvas.current.exportImage(kind);
        return download(`${fileBase}.${kind}`, img.dataUrl);
      }
      if (diagnostics.length) return showToast(t('export.fixErrors'), 'error');
      const text = await exportDbml(doc.source, kind);
      download(`${fileBase}${kind === 'json' ? '.json' : `.${kind}.sql`}`, text, kind === 'json' ? 'application/json' : 'text/plain;charset=utf-8');
    } catch (e) {
      showToast(t('export.failed', { msg: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }, [doc, model, diagnostics.length, fileBase, showToast, t]);

  const exportPdf = useCallback(async (layout: PdfLayout) => {
    setPdfDialog(false);
    updateSettings({ pdfLayout: layout });
    try {
      await canvas.current?.printPdf(fileBase, layout);
    } catch (e) {
      showToast(t('export.failed', { msg: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }, [fileBase, updateSettings, showToast, t]);

  const doImport = useCallback(async (text: string, format: ImportSource, asNew: boolean) => {
    try {
      const dbml = format === 'dbml' ? text : await importToDbml(text, format);
      if (asNew) await createDiagram(`${t('diagram.untitled')} (${format})`, dbml);
      else {
        setModel(null);
        resetEditing();
        patchDoc({ source: dbml, positions: {} });
      }
      setImporting(false);
      showToast(t('import.done'));
    } catch (e) {
      const msg = e instanceof DbmlError
        ? e.diagnostics.slice(0, 3).map((d) => `${t('editor.line', { line: d.line })}: ${d.message}`).join('; ')
        : e instanceof Error ? e.message : String(e);
      showToast(t('import.failed', { msg }), 'error');
    }
  }, [createDiagram, patchDoc, showToast, t]);

  const deleteDiagram = useCallback(async (id: string) => {
    const meta = diagrams.find((d) => d.id === id);
    if (!meta || !window.confirm(t('diagram.deleteConfirm', { name: meta.name }))) return;
    await storage.deleteDiagram(id);
    const rest = await storage.listDiagrams();
    setDiagrams(rest);
    if (doc?.id === id) {
      // the deleted doc must not be re-saved by the flush inside open/create
      setDirty(false);
      dirtyRef.current = false;
      if (rest[0]) {
        await openDiagram(rest[0].id);
      } else await createDiagram(t('diagram.untitled'), sampleDbml(lang));
    }
  }, [diagrams, doc?.id, t, openDiagram, createDiagram, lang]);

  const renameDiagram = useCallback(async (id: string, name: string) => {
    if (doc?.id === id) return patchDoc({ name });
    const d = await storage.loadDiagram(id);
    if (!d) return;
    await storage.saveDiagram({ ...d, name, updatedAt: Date.now() });
    setDiagrams(await storage.listDiagrams());
  }, [doc?.id, patchDoc]);

  const duplicateDiagram = useCallback(async (id: string) => {
    await flush();
    const d = await storage.loadDiagram(id);
    if (!d) return;
    await storage.saveDiagram({ ...d, id: newId(), name: `${d.name} ${t('diagram.copySuffix')}`, updatedAt: Date.now() });
    setDiagrams(await storage.listDiagrams());
  }, [flush, t]);

  // ---- editor/canvas splitter ------------------------------------------------------------

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = editorWidth;
    let w = startW;
    const move = (ev: MouseEvent) => {
      w = Math.min(Math.max(260, startW + ev.clientX - startX), window.innerWidth * 0.7);
      setSettings((s) => ({ ...s, editorWidth: w }));
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing');
      void storage.saveSettings({ editorWidth: w });
    };
    document.body.classList.add('resizing');
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const errors = useMemo(() => diagnostics.filter((d) => d.severity === 'error'), [diagnostics]);

  if (!ready || !doc) return <div className="loading">{translate(lang, 'loading')}</div>;

  return (
    <I18nProvider lang={lang}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <img src="icons/icon32.png" width="22" height="22" alt="" />
            <span>{t('app.title')}</span>
          </div>
          <Dropdown label={t('diagram.list')}>
            {(close) => (
              <DiagramList
                diagrams={diagrams}
                currentId={doc.id}
                close={close}
                onOpen={(id) => void openDiagram(id)}
                onNew={() => void createDiagram(t('diagram.untitled'), NEW_DIAGRAM_SOURCE)}
                onRename={(id, name) => void renameDiagram(id, name)}
                onDuplicate={(id) => void duplicateDiagram(id)}
                onDelete={(id) => void deleteDiagram(id)}
              />
            )}
          </Dropdown>
          <input
            className="doc-name"
            value={doc.name}
            onChange={(e) => patchDoc({ name: e.target.value })}
            onBlur={(e) => { if (!e.target.value.trim()) patchDoc({ name: t('diagram.untitled') }); }}
            aria-label={t('diagram.rename')}
          />
          <span className="save-state">{dirty ? t('diagram.saving') : t('diagram.saved')}</span>
          <div className="spacer" />
          <button className="btn" onClick={() => setImporting(true)}>{t('menu.import')}</button>
          <Dropdown label={t('menu.export')} align="right">
            {(close) => (
              <>
                <div className="menu-label">{t('export.images')}</div>
                {(['png', 'svg', 'pdf'] as const).map((k) => (
                  <button key={k} className="menu-item" onClick={() => { close(); void exportAs(k); }}>{t(`export.${k}`)}</button>
                ))}
                <div className="menu-sep" />
                <div className="menu-label">{t('export.code')}</div>
                {(['dbml', 'postgres', 'mysql', 'mssql', 'oracle', 'json'] as const).map((k) => (
                  <button key={k} className="menu-item" onClick={() => { close(); void exportAs(k); }}>{t(`export.${k}`)}</button>
                ))}
              </>
            )}
          </Dropdown>
          <a className="btn" href="https://dbml.dbdiagram.io/docs" target="_blank" rel="noreferrer">{t('menu.help')}</a>
          <button className="btn lang" onClick={() => updateSettings({ lang: lang === 'zh' ? 'en' : 'zh' })}>{t('menu.language')}</button>
        </header>

        <main className="workspace">
          {/* stays mounted when collapsed: graphical edits go through its undo history */}
          {(
            <section className="editor-pane" style={{ width: editorWidth, display: settings.editorHidden ? 'none' : undefined }}>
              <Editor
                ref={editor}
                value={doc.source}
                onChange={(source) => patchDoc({ source })}
                diagnostics={diagnostics}
                getCompletions={completions}
              />
              <div className={`status${errors.length ? ' has-errors' : ''}`}>
                {errors.length ? (
                  <ul>
                    {errors.slice(0, 5).map((d, i) => (
                      <li key={i}>
                        <button onClick={() => editor.current?.revealLine(d.line, d.column)}>
                          <b>{t('editor.line', { line: d.line })}</b> {d.message}
                        </button>
                      </li>
                    ))}
                    {errors.length > 5 && <li className="more">{t('editor.errors', { count: errors.length })}</li>}
                  </ul>
                ) : (
                  <span>✓ {t('editor.ok')}</span>
                )}
              </div>
            </section>
          )}
          <div className="splitter" onMouseDown={settings.editorHidden ? undefined : startResize}>
            <button
              className="collapse"
              title={settings.editorHidden ? t('editor.expand') : t('editor.collapse')}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => updateSettings({ editorHidden: !settings.editorHidden })}
            >
              {settings.editorHidden ? '›' : '‹'}
            </button>
          </div>
          <Canvas
            key={doc.id}
            ref={canvas}
            model={shownModel}
            views={model?.views ?? []}
            activeView={view ? view.id : null}
            onActiveViewChange={onShowView}
            hiddenTables={model && view ? model.tables.length - (shownModel?.tables.length ?? 0) : 0}
            stale={!!model && errors.length > 0}
            broken={!model && errors.length > 0}
            positions={doc.positions}
            onPositionsChange={onPositionsChange}
            displayMode={displayMode}
            onDisplayModeChange={(m) => updateSettings({ displayMode: m })}
            showMinimap={settings.showMinimap ?? false}
            onToggleMinimap={() => updateSettings({ showMinimap: !settings.showMinimap })}
            onElementClick={onElementClick}
            inspecting={!!inspect}
            onInspect={onInspect}
            onAddTable={onAddTable}
            onAddNote={onAddNote}
            onConnectFields={onConnectFields}
            onConnectDep={onConnectDep}
            onDeleteElements={onDeleteElements}
            onGroupTables={onGroupTables}
            onUndo={() => editor.current?.undo()}
            onRedo={() => editor.current?.redo()}
          />
          {inspect && model && (
            <Inspector
              key={`${inspect.kind}:${inspect.id ?? ''}`}
              target={inspect}
              model={model}
              info={info}
              run={runEdit}
              focus={focus}
              setFocus={setFocus}
              onSelect={onInspect}
              activeView={view ? view.id : null}
              onShowView={onShowView}
              onClose={() => setInspect(null)}
            />
          )}
        </main>

        {importing && <ImportDialog onSubmit={doImport} onClose={() => setImporting(false)} />}
        {pdfDialog && <PdfExportDialog initial={settings.pdfLayout ?? 'a4'} onSubmit={(l) => void exportPdf(l)} onClose={() => setPdfDialog(false)} />}
        {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
      </div>
    </I18nProvider>
  );
}
