import { memo, useState, type CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useI18n } from '../i18n';
import type { DField } from '../dbml/types';
import { handleId, type GroupNode, type NoteNode, type TableNode } from './graph';
import { visibleFields } from './geometry';
import { useCanvas } from './highlight';

/** Invisible connection points on both sides of a row; edges choose a side at build time. */
function SideHandles({ owner }: { owner: string }) {
  return (
    <>
      <Handle type="source" id={handleId(owner, 's', 'l')} position={Position.Left} isConnectable={false} className="hd" />
      <Handle type="target" id={handleId(owner, 't', 'l')} position={Position.Left} isConnectable={false} className="hd" />
      <Handle type="source" id={handleId(owner, 's', 'r')} position={Position.Right} isConnectable={false} className="hd" />
      <Handle type="target" id={handleId(owner, 't', 'r')} position={Position.Right} isConnectable={false} className="hd" />
    </>
  );
}

const KeyIcon = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
    <circle cx="5" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M8 8h6.5M12 8v2.6M14.2 8v2" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
  </svg>
);

/** Picks black or white text for a header color. */
function readableOn(hex: string | undefined) {
  if (!hex) return undefined;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length < 6) return undefined;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#0f172a' : '#ffffff';
}

function FieldTip({ field }: { field: DField }) {
  const { t } = useI18n();
  const { enums } = useCanvas();
  const en = field.enumId ? enums.get(field.enumId) : undefined;
  const flags = [field.pk && t('table.pk'), field.notNull && t('table.notNull'), field.unique && t('table.unique'), field.increment && t('table.increment')].filter(Boolean);
  return (
    <div className="tip">
      <div className="tip-title">
        <b>{field.name}</b> <span className="tip-type">{field.type}</span>
      </div>
      {flags.length > 0 && <div className="tip-flags">{flags.map((f) => <span key={f as string}>{f}</span>)}</div>}
      {field.defaultValue && <div className="tip-row">{t('table.default')}: <code>{field.defaultValue}</code></div>}
      {field.note && <div className="tip-note">{field.note}</div>}
      {en && (
        <div className="tip-row">
          {t('table.enumValues')}:
          <ul>{en.values.map((v) => <li key={v.name}><code>{v.name}</code>{v.note ? ` — ${v.note}` : ''}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

export const TableNodeView = memo(function TableNodeView({ data, selected }: NodeProps<TableNode>) {
  const { table, mode } = data;
  const { t } = useI18n();
  const { setHover, activeFields, focusing, hover } = useCanvas();
  const [tipField, setTipField] = useState<string | null>(null);
  const fields = visibleFields(table, mode);
  const touched = table.fields.some((f) => activeFields.has(f.id)) || hover.tableId === table.id || selected;
  const style = { '--hc': table.headerColor, '--hc-text': readableOn(table.headerColor) } as CSSProperties;

  return (
    <div
      className={`tbl${selected ? ' sel' : ''}${focusing && !touched ? ' dim' : ''}`}
      style={style}
      onMouseEnter={() => setHover({ tableId: table.id })}
      onMouseLeave={() => { setHover({}); setTipField(null); }}
    >
      <div className="tbl-head" title={table.note}>
        <SideHandles owner={table.id} />
        <span className="tbl-name">
          {table.schema && <span className="tbl-schema">{table.schema}.</span>}
          {table.name}
        </span>
        {table.alias && <span className="tbl-alias">{table.alias}</span>}
        {table.note && <span className="tbl-note-dot" aria-hidden>i</span>}
        {mode === 'names' && <span className="tbl-count">{t('table.fields', { count: table.fields.length })}</span>}
      </div>
      {fields.length > 0 && (
        <div className="tbl-body">
          {fields.map((f) => (
            <div
              key={f.id}
              className={`row${activeFields.has(f.id) ? ' hl' : ''}`}
              onMouseEnter={() => { setHover({ tableId: table.id, fieldId: f.id }); setTipField(f.id); }}
              onMouseLeave={() => { setHover({ tableId: table.id }); setTipField(null); }}
            >
              <SideHandles owner={f.id} />
              <span className="row-icon">{f.pk ? <KeyIcon /> : f.isRef ? <span className="fk">FK</span> : null}</span>
              <span className={`row-name${f.pk ? ' pk' : ''}`}>{f.name}</span>
              <span className="row-type">
                {f.type}
                {f.notNull && !f.pk && <span className="nn" title={t('table.notNull')}>NN</span>}
              </span>
              {f.note && <span className="row-note" aria-hidden />}
              {tipField === f.id && <FieldTip field={f} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export const GroupNodeView = memo(function GroupNodeView({ data }: NodeProps<GroupNode>) {
  const { group } = data;
  return (
    <div className="grp" style={{ '--gc': group.color ?? '#64748b' } as CSSProperties} title={group.note}>
      <div className="grp-head">{group.name}</div>
    </div>
  );
});

export const NoteNodeView = memo(function NoteNodeView({ data }: NodeProps<NoteNode>) {
  const { note } = data;
  return (
    <div className="sticky" style={note.color ? ({ '--nc': note.color } as CSSProperties) : undefined}>
      <div className="sticky-head">{note.name}</div>
      <div className="sticky-body">{note.content}</div>
    </div>
  );
});
