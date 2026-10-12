import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, MiniMap, Panel, ReactFlow, ReactFlowProvider, applyNodeChanges,
  useNodesInitialized, useReactFlow, type NodeChange, type XYPosition,
} from '@xyflow/react';
import type { DiagramModel } from '../dbml/types';
import type { DisplayMode } from '../storage';
import { useI18n } from '../i18n';
import { buildEdges, buildNodes, sizeOfNode, syncGroups, type AnyNode } from './graph';
import { autoLayout, placeNew } from './layout';
import { CanvasContext, computeActive, type CanvasState, type Hover } from './highlight';
import { GroupNodeView, NoteNodeView, TableNodeView } from './nodes';
import { RelationEdgeView } from './RelationEdge';
import { renderImage, type ImageFormat } from '../export/image';

const nodeTypes = { table: TableNodeView, tablegroup: GroupNodeView, note: NoteNodeView };
const edgeTypes = { relation: RelationEdgeView };

export interface CanvasHandle {
  autoLayout(): void;
  /** data URL of the whole diagram */
  exportImage(format: ImageFormat): Promise<{ dataUrl: string; width: number; height: number }>;
}

interface Props {
  model: DiagramModel | null;
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
}

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
  const [hover, setHover] = useState<Hover>({});
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

  useEffect(() => {
    setNodes((prev) => (model ? buildNodes(model, positions, displayMode, prev) : []));
  }, [model, positions, displayMode]);

  // Fit once per diagram, after the first nodes have been measured.
  useEffect(() => {
    if (initialized && !fitted.current && nodes.length) {
      fitted.current = true;
      requestAnimationFrame(() => flow.fitView({ padding: 0.15, maxZoom: 1 }));
    }
  }, [initialized, nodes.length, flow]);

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
      const next = syncGroups(applyNodeChanges([...changes, ...extra], prev));
      // Persist once a drag ends.
      if (changes.some((c) => c.type === 'position' && c.dragging === false)) {
        const map = { ...positionsRef.current };
        for (const n of next) if (n.type !== 'tablegroup') map[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
        queueMicrotask(() => onPositionsChange(map));
      }
      return next;
    });
  }, [onPositionsChange]);

  const edges = useMemo(() => (model ? buildEdges(model, nodes, displayMode) : []), [model, nodes, displayMode]);

  const selectedTables = useMemo(
    () => new Set(nodes.filter((n) => n.selected && n.type === 'table').map((n) => n.id)),
    [nodes],
  );
  const ctx = useMemo<CanvasState>(() => {
    const active = model ? computeActive(model, hover, selectedTables) : { activeRefs: new Set<string>(), activeFields: new Set<string>(), focusing: false };
    return { enums: new Map((model?.enums ?? []).map((e) => [e.id, e])), hover, setHover, ...active };
  }, [model, hover, selectedTables]);

  const runAutoLayout = useCallback(() => {
    if (!model) return;
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
    onPositionsChange({ ...positionsRef.current, ...autoLayout(model, (id) => sizeOfNode(byId.get(id))) });
    setTimeout(() => flow.fitView({ padding: 0.15, maxZoom: 1, duration: 300 }), 50);
  }, [model, onPositionsChange, flow]);

  useImperativeHandle(ref, () => ({
    autoLayout: runAutoLayout,
    async exportImage(format) {
      setHover({});
      setNodes((prev) => prev.map((n) => (n.selected ? { ...n, selected: false } : n)));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const el = document.querySelector<HTMLElement>('.canvas .react-flow__viewport');
      if (!el) throw new Error('canvas not ready');
      return renderImage(el, flow.getNodes(), format);
    },
  }), [runAutoLayout, flow]);

  const empty = !model || (model.tables.length === 0 && model.notes.length === 0);

  return (
    <CanvasContext.Provider value={ctx}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => props.onElementClick(n.type === 'tablegroup' ? 'group' : (n.type as 'table' | 'note'), n.id)}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
        onlyRenderVisibleElements={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--grid)" />
        {showMinimap && <MiniMap pannable zoomable nodeStrokeWidth={2} nodeColor={(n) => (n.type === 'tablegroup' ? 'transparent' : n.type === 'note' ? '#fde68a' : '#93c5fd')} />}
        <Panel position="bottom-left" className="toolbar">
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
          <button title={t('canvas.minimap')} className={showMinimap ? 'on' : ''} onClick={props.onToggleMinimap}>
            <Icon d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15" />
          </button>
        </Panel>
        {stale && <Panel position="top-center" className="banner warn">{t('canvas.staleModel')}</Panel>}
        {broken && <Panel position="top-center" className="banner warn">{t('canvas.broken')}</Panel>}
        {empty && !broken && <Panel position="top-center" className="banner">{t('canvas.empty')}</Panel>}
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
