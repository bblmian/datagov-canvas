import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { XYPosition } from '@xyflow/react';
import { I18nProvider, detectLang, translate, type Lang, type MessageKey } from './i18n';
import { storage, newId, type DiagramDoc, type DiagramMeta, type DisplayMode, type Settings } from './storage';
import { DbmlError, exportDbml, importToDbml, parseDbml } from './dbml/client';
import type { DiagramModel, Diagnostic } from './dbml/types';
import type { SqlExportFormat } from './dbml/protocol';
import { sampleDbml } from './dbml/sample';
import { locateDeclaration } from './dbml/locate';
import { Editor, type EditorHandle } from './editor/Editor';
import { Canvas, type CanvasHandle } from './canvas/Canvas';
import { Dropdown } from './components/Dropdown';
import { DiagramList } from './components/DiagramList';
import { ImportDialog, type ImportSource } from './components/ImportDialog';
import { download, safeFileName } from './export/download';
import { imageToPdf } from './export/image';

const PARSE_DELAY = 250;
const SAVE_DELAY = 400;
const NEW_DIAGRAM_SOURCE = 'Table table_name {\n  id integer [pk, increment]\n  name varchar\n}\n';

type Toast = { text: string; kind: 'info' | 'error' };

export function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>({});
  const [diagrams, setDiagrams] = useState<DiagramMeta[]>([]);
  const [doc, setDoc] = useState<DiagramDoc | null>(null);
  const [model, setModel] = useState<DiagramModel | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [importing, setImporting] = useState(false);
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
  const source = doc?.source;
  const docId = doc?.id;
  useEffect(() => {
    if (source === undefined) return;
    const seq = ++parseSeq.current;
    const id = setTimeout(async () => {
      try {
        const m = await parseDbml(source);
        if (seq !== parseSeq.current) return;
        setModel(m);
        setDiagnostics([]);
      } catch (e) {
        if (seq !== parseSeq.current) return;
        setDiagnostics(e instanceof DbmlError ? e.diagnostics : [{ message: String(e), line: 1, column: 1, severity: 'error' }]);
      }
    }, model ? PARSE_DELAY : 0);
    return () => clearTimeout(id);
    // `model` only decides the delay for the first parse of a diagram
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, docId]);

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
        const img = await canvas.current.exportImage(kind === 'svg' ? 'svg' : 'png');
        if (kind === 'pdf') return download(`${fileBase}.pdf`, await imageToPdf(img.dataUrl, img.width, img.height));
        return download(`${fileBase}.${kind}`, img.dataUrl);
      }
      if (diagnostics.length) return showToast(t('export.fixErrors'), 'error');
      const text = await exportDbml(doc.source, kind);
      download(`${fileBase}${kind === 'json' ? '.json' : `.${kind}.sql`}`, text, kind === 'json' ? 'application/json' : 'text/plain;charset=utf-8');
    } catch (e) {
      showToast(t('export.failed', { msg: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }, [doc, model, diagnostics.length, fileBase, showToast, t]);

  const doImport = useCallback(async (text: string, format: ImportSource, asNew: boolean) => {
    try {
      const dbml = format === 'dbml' ? text : await importToDbml(text, format);
      if (asNew) await createDiagram(`${t('diagram.untitled')} (${format})`, dbml);
      else {
        setModel(null);
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
          {!settings.editorHidden && (
            <section className="editor-pane" style={{ width: editorWidth }}>
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
            model={model}
            stale={!!model && errors.length > 0}
            broken={!model && errors.length > 0}
            positions={doc.positions}
            onPositionsChange={onPositionsChange}
            displayMode={displayMode}
            onDisplayModeChange={(m) => updateSettings({ displayMode: m })}
            showMinimap={settings.showMinimap ?? false}
            onToggleMinimap={() => updateSettings({ showMinimap: !settings.showMinimap })}
            onElementClick={onElementClick}
          />
        </main>

        {importing && <ImportDialog onSubmit={doImport} onClose={() => setImporting(false)} />}
        {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
      </div>
    </I18nProvider>
  );
}
