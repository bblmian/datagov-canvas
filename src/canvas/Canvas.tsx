import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, MiniMap, Panel, ReactFlow, ReactFlowProvider, applyNodeChanges,
  useNodesInitialized, useReactFlow, useUpdateNodeInternals, type NodeChange, type OnConnectEnd, type XYPosition,
} from '@xyflow/react';
import type { InspectTarget } from '../components/Inspector';
import type { DDepEnd, DiagramModel, DView } from '../dbml/types';
import type { DisplayMode } from '../storage';
import { useI18n } from '../i18n';
import { buildEdges, buildNodes, sizeOfNode, syncGroups, type AnyEdge, type AnyNode } from './graph';
import { autoLayout, placeNew } from './layout';
import { CanvasContext, HighlightStore, type CanvasState } from './highlight';
import { GroupNodeView, NoteNodeView, TableNodeView } from './nodes';
import { DepEdgeView, RelationEdgeView } from './RelationEdge';
import { renderImage, type ImageFormat } from '../export/image';
import { printDiagram, type PdfLayout } from '../export/print';

const nodeTypes = { table: TableNodeView, tablegroup: GroupNodeView, note: NoteNodeView };
const edgeTypes = { relation: RelationEdgeView, dep: DepEdgeView };

export interface CanvasHandle {
  autoLayout(): void;
  /** data URL of the whole diagram */
  exportImage(format: ImageFormat): Promise<{ dataUrl: string; width: number; height: number }>;
  /** opens the print dialog with the diagram on one page (vector PDF via "Save as PDF") */
  printPdf(title: string, layout: PdfLayout): Promise<void>;
}

interface Props {
  /** what to draw: the whole model, or the part the active view shows */
  model: DiagramModel | null;
  views: DView[];
  activeView: string | null;
  onActiveViewChange(id: string | null): void;
  /** tables the active view leaves out */
  hiddenTables: number;
  stale: boolean;
  /** the source has errors and nothing has parsed yet */
  broken: boolean;
  positions: Record<string, XYPosition>;
  /** called with the complete position map whenever tables are moved or placed */
  onPositionsChange(positions: Record<string, XYPosition>): void;
  displayMode: DisplayMode;
  onDisplayModeChange(mode: DisplayMode): void;
  showMinimap: boolean;
  onToggleMinimap(): void;
  onElementClick(kind: 'table' | 'note' | 'group', id: string): void;
  // graphical editing (see App)
  inspecting: boolean;
  onInspect(target: InspectTarget | null): void;
  onAddTable(at: XYPosition): void;
  onAddNote(at: XYPosition): void;
  /** a column was dragged onto another column */
  onConnectFields(fromFieldId: string, toFieldId: string): void;
  /** in dependency mode: a column or table header was dragged onto another (up feeds down) */
  onConnectDep(up: DDepEnd, down: DDepEnd): void;
  onDeleteElements(ids: { tables: string[]; notes: string[] }): void;
  onGroupTables(tableIds: string[]): void;
  onUndo(): void;
  onRedo(): void;
}

const CONNECTION_LINE = { stroke: 'var(--accent)', strokeWidth: 2, strokeDasharray: '6 4' };
const DELETE_KEYS = ['Delete', 'Backspace'];
const PRO_OPTIONS = { hideAttribution: true };
const minimapColor = (n: { type?: string }) => (n.type === 'tablegroup' ? 'transparent' : n.type === 'note' ? '#fde68a' : '#93c5fd');

const kindOf = (n: { type?: string }) => (n.type === 'tablegroup' ? 'group' : n.type === 'note' ? 'note' : 'table');

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

const CanvasInner = forwardRef<CanvasHandle, Props>(function CanvasInner(props, ref) {
  const { model, stale, broken, positions, onPositionsChange, displayMode, showMinimap } = props;
  const { t } = useI18n();
  const flow = useReactFlow();
  const initialized = useNodesInitialized();
  const [nodes, setNodes] = useState<AnyNode[]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const [highlight] = useState(() => new HighlightStore());
  // Handlers given to React Flow must keep their identity: it copies each changed one into its
  // store separately, and every store update re-runs the selectors of every node and edge.
  const propsRef = useRef(props);
  propsRef.current = props;
  const fitted = useRef(false);

  // Give every table/note that has no saved position one, then report the full map upward.
  useEffect(() => {
    if (!model) return;
    const ids = [...model.tables.map((t) => t.id), ...model.notes.map((n) => n.id)];
    const missing = ids.filter((id) => !positions[id]);
    if (!missing.length) return;
    const draft = buildNodes(model, positions, displayMode, nodesRef.current);
    const byId = new Map(draft.map((n) => [n.id, n]));
    const sizeOf = (id: string) => sizeOfNode(byId.get(id));
    const known = ids.filter((id) => positions[id]);
    // nothing placed yet (new or freshly imported diagram): lay out everything and refit
    if (known.length === 0) fitted.current = false;
    const placed = known.length === 0
      ? autoLayout(model, sizeOf)
      : placeNew(missing, Object.fromEntries(known.map((id) => [id, positions[id]])), sizeOf);
    onPositionsChange({ ...positions, ...placed });
  }, [model, positions, displayMode, onPositionsChange]);

  // React Flow measures handle positions only when a node resizes. A renamed column keeps the
  // table's size but changes its handle ids, so those tables are re-measured explicitly — otherwise
  // edges can't find their handles and new connections can't start.
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    const prev = nodesRef.current;
    const next = model ? buildNodes(model, positions, displayMode, prev) : [];
    setNodes(next);
    const handles = (n: AnyNode | undefined) => (n?.type === 'table' ? n.data.table.fields.map((f) => f.id).join('\n') : '');
    const before = new Map(prev.map((n) => [n.id, handles(n)]));
    const changed = next.filter((n) => n.type === 'table' && before.has(n.id) && before.get(n.id) !== handles(n)).map((n) => n.id);
    if (changed.length) requestAnimationFrame(() => updateNodeInternals(changed));
  }, [model, positions, displayMode, updateNodeInternals]);

  // Race: if a rebuild hands React Flow a table with a `measured` size before React Flow has
  // recorded its handle positions, it keeps the size, never re-measures (the size didn't change)
  // and every edge of that table stays invisible. Re-measure such tables explicitly.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const stuck = nodesRef.current.filter((n) => n.type === 'table' && n.measured && !flow.getInternalNode(n.id)?.internals.handleBounds).map((n) => n.id);
      if (stuck.length) updateNodeInternals(stuck);
    });
    return () => cancelAnimationFrame(id);
  }, [nodes, flow, updateNodeInternals]);

  // Focusing a node near the edge (click, Tab) makes the browser scroll React Flow's overflow:hidden
  // container, which shifts the whole canvas and its toolbars sideways. Undo that at once.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.canvas .react-flow');
    if (!el) return;
    const reset = () => { if (el.scrollLeft || el.scrollTop) el.scrollTo(0, 0); };
    el.addEventListener('scroll', reset);
    return () => el.removeEventListener('scroll', reset);
  }, []);

  // Switching views: fit the new selection once its nodes are measured.
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    fitted.current = false;
  }, [props.activeView]);

  // Fit once per diagram (and per view switch), after the first nodes have been measured.
  useEffect(() => {
    if (initialized && !fitted.current && nodes.length && nodes.every((n) => n.measured)) {
      fitted.current = true;
      requestAnimationFrame(() => flow.fitView({ padding: 0.15, maxZoom: 1 }));
    }
  }, [initialized, nodes, flow]);

  const onNodesChange = useCallback((changes: NodeChange<AnyNode>[]) => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      const extra: NodeChange<AnyNode>[] = [];
      // Dragging a group moves its member tables by the same delta.
      for (const c of changes) {
        if (c.type !== 'position' || !c.position) continue;
        const g = byId.get(c.id);
        if (g?.type !== 'tablegroup') continue;
        const dx = c.position.x - g.position.x;
        const dy = c.position.y - g.position.y;
        for (const tid of g.data.group.tableIds) {
          const tn = byId.get(tid);
          if (tn) extra.push({ type: 'position', id: tid, position: { x: tn.position.x + dx, y: tn.position.y + dy }, dragging: c.dragging });
        }
      }
      return syncGroups(applyNodeChanges([...changes, ...extra], prev));
    });
    // Persisted after the drag has rendered (effect below), never from inside the updater above:
    // React may re-run an updater whenever it rebases state, and a side effect there once looped
    // forever (save → rebuild → re-run → save …) and froze the page on drag end.
    if (changes.some((c) => c.type === 'position' && c.dragging === false)) persistDrag.current = true;
  }, []);

  const persistDrag = useRef(false);
  useEffect(() => {
    if (!persistDrag.current) return;
    persistDrag.current = false;
    const map = { ...positionsRef.current };
    for (const n of nodes) if (n.type !== 'tablegroup') map[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    onPositionsChange(map);
  }, [nodes, onPositionsChange]);

  // Unchanged edges keep their identity (see buildEdges), so a drag only re-renders the moved table's edges.
  const prevEdges = useRef<AnyEdge[]>([]);
  const edges = useMemo(
    () => (prevEdges.current = model ? buildEdges(model, nodes, displayMode, prevEdges.current) : []),
    [model, nodes, displayMode],
  );

  // `nodes` changes on every drag frame; only push the selection when it actually changed.
  const selectedKey = nodes.filter((n) => n.selected && n.type === 'table').map((n) => n.id).join('\n');
  useEffect(() => { highlight.setSelected(new Set(selectedKey ? selectedKey.split('\n') : [])); }, [highlight, selectedKey]);
  useEffect(() => { highlight.setModel(model); }, [highlight, model]);

  /** what dragging from a dot creates: a relationship (Ref) or a dependency (Dep) */
  const [connectKind, setConnectKind] = useState<'ref' | 'dep'>('ref');
  const ctx = useMemo<CanvasState>(
    () => ({ enums: new Map((model?.enums ?? []).map((e) => [e.id, e])), highlight, connectKind }),
    [model?.enums, highlight, connectKind],
  );

  const runAutoLayout = useCallback(() => {
    if (!model) return;
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
    onPositionsChange({ ...positionsRef.current, ...autoLayout(model, (id) => sizeOfNode(byId.get(id))) });
    setTimeout(() => flow.fitView({ padding: 0.15, maxZoom: 1, duration: 300 }), 50);
  }, [model, onPositionsChange, flow]);

  /** Clears hover/selection highlighting, then returns the viewport element to export. */
  const prepareExport = useCallback(async () => {
    highlight.setHover({});
    setNodes((prev) => prev.map((n) => (n.selected ? { ...n, selected: false } : n)));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const el = document.querySelector<HTMLElement>('.canvas .react-flow__viewport');
    if (!el) throw new Error('canvas not ready');
    return el;
  }, [highlight]);

  useImperativeHandle(ref, () => ({
    autoLayout: runAutoLayout,
    async exportImage(format) {
      return renderImage(await prepareExport(), flow.getNodes(), format);
    },
    async printPdf(title, layout) {
      printDiagram(await prepareExport(), flow.getNodes(), title, layout);
    },
  }), [runAutoLayout, flow, prepareExport]);

  const empty = !model || (model.tables.length === 0 && model.notes.length === 0);
  const selectedTables = selectedKey ? selectedKey.split('\n') : [];

  /** Where toolbar-created items go: near the middle of the visible area, moved right past anything already there. */
  const centre = () => {
    const r = document.querySelector('.canvas .react-flow')?.getBoundingClientRect();
    const p = flow.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? 0) / 2 - 110, y: (r?.top ?? 0) + (r?.height ?? 0) / 2 - 80 });
    const box = { x: Math.round(p.x), y: Math.round(p.y), w: 240, h: 160 };
    const taken = nodesRef.current.filter((n) => n.type !== 'tablegroup').map((n) => ({ ...n.position, ...sizeOfNode(n) }));
    for (let i = 0; i < 100; i++) {
      const hit = taken.find((o) => box.x < o.x + o.width + 40 && o.x < box.x + box.w + 40 && box.y < o.y + o.height + 40 && o.y < box.y + box.h + 40);
      if (!hit) break;
      box.x = Math.round(hit.x + hit.width + 60);
    }
    return { x: box.x, y: box.y };
  };

  // Drag from a column's dot and drop anywhere on another column (or on a table: its key column).
  const onConnectEnd = useCallback<OnConnectEnd>((event, state) => {
    const hid = state.fromHandle?.id;
    if (!hid || !model) return;
    const from = hid.slice(0, -4); // strip `|s|l` / `|s|r`
    const pt = 'changedTouches' in event ? event.changedTouches[0] : event;
    const el = document.elementFromPoint(pt.clientX, pt.clientY);
    const toField = el?.closest<HTMLElement>('[data-field-id]')?.dataset.fieldId;
    const toTable = el?.closest<HTMLElement>('[data-table-id]')?.dataset.tableId;
    if (connectKind === 'dep') {
      // column → column makes a column-level dep; anything involving a table header is table-level
      const tableOf = (id: string) => model.tables.find((x) => x.id === id || x.fields.some((f) => f.id === id))?.id;
      const fromIsTable = model.tables.some((x) => x.id === from);
      const upTable = tableOf(from);
      if (!upTable || !toTable) return;
      if (!fromIsTable && toField) propsRef.current.onConnectDep({ tableId: upTable, fieldIds: [from] }, { tableId: toTable, fieldIds: [toField] });
      else if (upTable !== toTable) propsRef.current.onConnectDep({ tableId: upTable, fieldIds: [] }, { tableId: toTable, fieldIds: [] });
      return;
    }
    let to = toField;
    if (!to) {
      const tid = el?.closest<HTMLElement>('[data-table-id]')?.dataset.tableId;
      const tb = model.tables.find((x) => x.id === tid);
      to = (tb?.fields.find((f) => f.pk) ?? tb?.fields[0])?.id;
    }
    if (to && to !== from) propsRef.current.onConnectFields(from, to);
  }, [model, connectKind]);

  const onNodeClick = useCallback((_: unknown, n: AnyNode) => {
    const p = propsRef.current;
    p.onElementClick(kindOf(n), n.id);
    if (p.inspecting) p.onInspect({ kind: kindOf(n), id: n.id });
  }, []);
  const onNodeDoubleClick = useCallback((_: unknown, n: AnyNode) => propsRef.current.onInspect({ kind: kindOf(n), id: n.id }), []);
  const onEdgeClick = useCallback((_: unknown, e: AnyEdge) => propsRef.current.onInspect(e.type === 'dep' ? { kind: 'dep', id: e.data!.dep.id } : { kind: 'ref', id: e.id }), []);
  // double-click on empty canvas: new table there
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return;
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    propsRef.current.onAddTable({ x: Math.round(p.x), y: Math.round(p.y) });
  }, [flow]);
  // deleting edits the DBML text; the canvas then follows the new model
  const onBeforeDelete = useCallback(async ({ nodes: gone }: { nodes: AnyNode[] }) => {
    propsRef.current.onDeleteElements({ tables: gone.filter((n) => n.type === 'table').map((n) => n.id), notes: gone.filter((n) => n.type === 'note').map((n) => n.id) });
    return false;
  }, []);

  // Trash: while a table or sticky note is dragged, a bin replaces the bottom-left toolbar;
  // dropping onto it deletes what is being dragged (⌘Z or the toast's Undo brings it back).
  const [trash, setTrash] = useState<null | { over: boolean }>(null);
  const trashRef = useRef<HTMLDivElement>(null);
  const overTrash = (e: { clientX: number; clientY: number }) => {
    const r = trashRef.current?.getBoundingClientRect();
    // a little slack around the bin, so a hurried drop still lands
    return !!r && e.clientX >= r.left - 12 && e.clientX <= r.right + 12 && e.clientY >= r.top - 12 && e.clientY <= r.bottom + 12;
  };
  const onNodeDragStart = useCallback((_: unknown, n: AnyNode) => { if (n.type !== 'tablegroup') setTrash({ over: false }); }, []);
  const onNodeDrag = useCallback((e: React.MouseEvent) => {
    const over = overTrash(e);
    setTrash((cur) => (cur && cur.over !== over ? { over } : cur));
  }, []);
  const onNodeDragStop = useCallback((e: React.MouseEvent, _n: AnyNode, dragged: AnyNode[]) => {
    if (overTrash(e)) {
      propsRef.current.onDeleteElements({
        tables: dragged.filter((n) => n.type === 'table').map((n) => n.id),
        notes: dragged.filter((n) => n.type === 'note').map((n) => n.id),
      });
    }
    setTrash(null);
  }, []);
  // clicking empty canvas puts the property panel away
  const onPaneClick = useCallback(() => { if (propsRef.current.inspecting) propsRef.current.onInspect(null); }, []);

  return (
    <CanvasContext.Provider value={ctx}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeClick={onEdgeClick}
        onDoubleClick={onDoubleClick}
        zoomOnDoubleClick={false}
        nodesConnectable
        onConnectEnd={onConnectEnd}
        connectionLineStyle={CONNECTION_LINE}
        connectionRadius={0}
        edgesFocusable={false}
        elementsSelectable
        minZoom={0.1}
        maxZoom={2}
        proOptions={PRO_OPTIONS}
        deleteKeyCode={DELETE_KEYS}
        onBeforeDelete={onBeforeDelete}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={onPaneClick}
        onlyRenderVisibleElements={false}
      >
        <Panel position="top-left" className="toolbar edit-tools">
          <button className="labeled" title={t('canvas.addTableHint')} onClick={() => props.onAddTable(centre())}>
            <Icon d="M3 5h18v14H3zM3 10h18M9 10v9M12 2v0" />
            <span>{t('canvas.addTable')}</span>
          </button>
          <button className="labeled" title={t('canvas.addNote')} onClick={() => props.onAddNote(centre())}>
            <Icon d="M5 3h10l4 4v14H5zM15 3v4h4M9 12h6M9 16h4" />
            <span>{t('canvas.addNote')}</span>
          </button>
          <button className="labeled" title={t('canvas.enums')} onClick={() => props.onInspect({ kind: 'enums' })}>
            <Icon d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
            <span>{t('canvas.enums')}</span>
          </button>
          <button className="labeled" title={t('ins.partial.hint')} onClick={() => props.onInspect({ kind: 'partials' })}>
            <Icon d="M4 4h16v5H4zM4 13h7v7H4zM15 13h5v7h-5z" />
            <span>{t('canvas.partials')}</span>
          </button>
          <button className="labeled" title={t('ins.project.hint')} onClick={() => props.onInspect({ kind: 'project' })}>
            <Icon d="M12 3l9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4" />
            <span>{t('canvas.project')}</span>
          </button>
          <button className="labeled" title={t('canvas.viewsHint')} onClick={() => props.onInspect({ kind: 'views' })}>
            <Icon d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
            <span>{t('canvas.views')}</span>
          </button>
          <button className="labeled" title={t('canvas.groupHint')} disabled={!selectedTables.length} onClick={() => props.onGroupTables(selectedTables)}>
            <Icon d="M3 3h7v7H3zM14 14h7v7h-7zM3 14h7v7H3zM14 3h7v7h-7z" />
            <span>{t('canvas.group')}</span>
          </button>
          <span className="sep" />
          <span className="seg" title={t('canvas.connectHint')}>
            <button className={connectKind === 'ref' ? 'on' : ''} onClick={() => setConnectKind('ref')}>{t('canvas.connect.ref')}</button>
            <button className={connectKind === 'dep' ? 'on' : ''} onClick={() => setConnectKind('dep')}>{t('canvas.connect.dep')}</button>
          </span>
          <span className="sep" />
          <button title={t('canvas.undo')} onClick={props.onUndo}><Icon d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" /></button>
          <button title={t('canvas.redo')} onClick={props.onRedo}><Icon d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" /></button>
        </Panel>
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--grid)" />
        {showMinimap && <MiniMap pannable zoomable nodeStrokeWidth={2} nodeColor={minimapColor} />}
        {trash && (
          <Panel position="bottom-left" className="trash-panel">
            <div ref={trashRef} className={`trash-zone${trash.over ? ' over' : ''}`} role="status">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
              </svg>
              <span>{trash.over ? t('canvas.trash.release') : t('canvas.trash.drop')}</span>
            </div>
          </Panel>
        )}
        <Panel position="bottom-left" className={`toolbar view-tools${trash ? ' hidden' : ''}`}>
          <button title={t('canvas.zoomIn')} onClick={() => flow.zoomIn({ duration: 150 })}><Icon d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3M11 8v6M8 11h6" /></button>
          <button title={t('canvas.zoomOut')} onClick={() => flow.zoomOut({ duration: 150 })}><Icon d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3M8 11h6" /></button>
          <button title={t('canvas.fit')} onClick={() => flow.fitView({ padding: 0.15, maxZoom: 1, duration: 300 })}><Icon d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></button>
          <span className="sep" />
          <button title={t('canvas.autoLayout')} onClick={runAutoLayout} className="labeled">
            <Icon d="M4 4h6v6H4zM14 14h6v6h-6zM7 10v4a3 3 0 0 0 3 3h4" />
            <span>{t('canvas.autoLayout')}</span>
          </button>
          <span className="sep" />
          <label className="select" title={t('canvas.display')}>
            <select value={displayMode} onChange={(e) => props.onDisplayModeChange(e.target.value as DisplayMode)}>
              <option value="all">{t('canvas.display.all')}</option>
              <option value="keys">{t('canvas.display.keys')}</option>
              <option value="names">{t('canvas.display.names')}</option>
            </select>
          </label>
          {props.views.length > 0 && (
            <label className="select" title={t('canvas.view')}>
              <select value={props.activeView ?? ''} onChange={(e) => props.onActiveViewChange(e.target.value || null)}>
                <option value="">{t('canvas.view.all')}</option>
                {props.views.map((v) => <option key={v.id} value={v.id}>{t('canvas.view.named', { name: v.name })}</option>)}
              </select>
            </label>
          )}
          <button title={t('canvas.minimap')} className={showMinimap ? 'on' : ''} onClick={props.onToggleMinimap}>
            <Icon d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15" />
          </button>
        </Panel>
        {stale && <Panel position="top-center" className="banner warn">{t('canvas.staleModel')}</Panel>}
        {!stale && props.activeView && (
          <Panel position="top-center" className="banner view-banner">
            {t('canvas.view.banner', { name: props.views.find((v) => v.id === props.activeView)?.name ?? '', hidden: props.hiddenTables })}
            <button className="link" onClick={() => props.onActiveViewChange(null)}>{t('canvas.view.showAll')}</button>
          </Panel>
        )}
        {broken && <Panel position="top-center" className="banner warn">{t('canvas.broken')}</Panel>}
        {empty && !broken && !props.activeView && <Panel position="top-center" className="banner">{t('canvas.empty')}</Panel>}
      </ReactFlow>
    </CanvasContext.Provider>
  );
});

export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(props, ref) {
  return (
    <div className="canvas">
      <ReactFlowProvider>
        <CanvasInner {...props} ref={ref} />
      </ReactFlowProvider>
    </div>
  );
});
