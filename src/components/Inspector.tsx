// The property panel of the graphical editor: edits the selected table (columns, indexes, checks,
// partials, sample data), relationship, sticky note, table group, and the document's enums, table
// partials and Project settings. Every change goes through `run`, which turns it into a DBML text
// edit (src/dbml/edit.ts).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import * as E from '../dbml/edit';
import { literalDisplay, literalFor, type ColumnHint } from '../dbml/text';
import type { DDep, DDepEnd, DEndpoint, DField, DiagramModel, DTable, DView, EditInfo, ViewSelection } from '../dbml/types';

export type InspectTarget = { kind: 'table' | 'ref' | 'dep' | 'note' | 'group' | 'enums' | 'partials' | 'project' | 'views'; id?: string };
export type RunEdit = (fn: (c: E.EditCtx) => E.EditResult, opts?: { then?: (r: E.EditResult) => void }) => void;

interface Props {
  target: InspectTarget;
  model: DiagramModel;
  info: EditInfo | null;
  run: RunEdit;
  /** id of a column (or 'name') whose input should take focus */
  focus: string | null;
  setFocus(id: string | null): void;
  onSelect(t: InspectTarget): void;
  /** the DiagramView shown on the canvas, and how to switch it */
  activeView: string | null;
  onShowView(id: string | null): void;
  onClose(): void;
}
type PanelProps = Omit<Props, 'target'>;

const TYPES = ['integer', 'bigint', 'smallint', 'serial', 'bigserial', 'decimal(10,2)', 'numeric', 'float', 'double precision', 'boolean',
  'varchar', 'varchar(255)', 'char(10)', 'text', 'uuid', 'date', 'time', 'timestamp', 'timestamptz', 'json', 'jsonb', 'bytea', 'blob'];
const COLORS = ['#334155', '#2563eb', '#0891b2', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#9333ea', '#db2777'];
const NOTE_COLORS = ['#fef9c3', '#fde68a', '#dcfce7', '#dbeafe', '#fce7f3', '#ede9fe', '#f1f5f9'];

/** Text input that commits on blur / Enter and reverts on Escape. */
function Input(props: {
  value: string;
  onCommit(v: string): void;
  placeholder?: string;
  multiline?: boolean;
  autoFocus?: boolean;
  list?: string;
  className?: string;
  label?: string;
}) {
  const { value, onCommit, multiline, autoFocus } = props;
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (autoFocus) { ref.current?.focus(); ref.current?.select(); }
  }, [autoFocus]);
  const commit = () => { if (v !== value) onCommit(v); };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { setV(value); e.stopPropagation(); requestAnimationFrame(() => ref.current?.blur()); }
    else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); ref.current?.blur(); }
  };
  const common = {
    ref, value: v, placeholder: props.placeholder, className: props.className, 'aria-label': props.label, title: props.label,
    onChange: (e: { target: { value: string } }) => setV(e.target.value), onBlur: commit, onKeyDown, spellCheck: false,
  };
  return multiline ? <textarea rows={3} {...common} /> : <input {...common} list={props.list} />;
}

/** Colour swatches plus a custom picker; `''` clears. `allowNone` adds the `none` colour (no fill). */
function ColorPick({ value, colors, onChange, allowNone }: { value?: string; colors: string[]; onChange(c: string): void; allowNone?: boolean }) {
  const { t } = useI18n();
  const custom = useRef<HTMLInputElement>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const el = custom.current;
    if (!el) return;
    // 'change' fires once when the picker closes ('input' would fire on every move)
    const h = () => cb.current(el.value);
    el.addEventListener('change', h);
    return () => el.removeEventListener('change', h);
  }, []);
  return (
    <div className="ins-colors">
      <button className={`swatch none${!value ? ' on' : ''}`} title={t('ins.color.none')} onClick={() => value && onChange('')} />
      {allowNone && <button className={`swatch clear${value === 'none' ? ' on' : ''}`} title={t('ins.color.noFill')} onClick={() => onChange('none')} />}
      {colors.map((c) => (
        <button key={c} className={`swatch${value?.toLowerCase() === c ? ' on' : ''}`} style={{ background: c }} title={c} onClick={() => onChange(c)} />
      ))}
      <input ref={custom} type="color" className="swatch-custom" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#334155'} onChange={() => undefined} title={t('ins.color.custom')} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ins-row">
      <span className="ins-label">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="ins-section">
      <div className="ins-section-head"><span>{title}</span>{extra}</div>
      {children}
    </section>
  );
}

/** Custom `key: value` properties (Metadata blocks, Project and Dep entries). */
function PropsEditor({ values, onCommit }: { values: Record<string, string>; onCommit(v: Record<string, string>): void }) {
  const { t } = useI18n();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const entries = Object.entries(values);
  const valid = /^[A-Za-z_]\w*$/.test(key.trim()) && !(key.trim() in values);
  const add = () => { if (!valid) return; onCommit({ ...values, [key.trim()]: value }); setKey(''); setValue(''); };
  return (
    <div className="ins-props">
      {entries.map(([k, v]) => (
        <div key={k} className="ins-check">
          <Input className="mono" value={k} label={t('ins.prop.key')} onCommit={(nk) => /^[A-Za-z_]\w*$/.test(nk.trim()) && onCommit(Object.fromEntries(entries.map(([a, b]) => (a === k ? [nk.trim(), b] : [a, b]))))} />
          <Input value={v} label={t('ins.prop.value')} onCommit={(nv) => onCommit({ ...values, [k]: nv })} />
          <button className="icon-btn danger" title={t('ins.prop.delete')} onClick={() => onCommit(Object.fromEntries(entries.filter(([a]) => a !== k)))}>×</button>
        </div>
      ))}
      <div className="ins-check">
        <input className="mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('ins.prop.key')} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('ins.prop.value')} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="icon-btn" title={t('ins.prop.add')} disabled={!valid} onClick={add}>+</button>
      </div>
    </div>
  );
}

/** `schema.enum` / `enum` id as the parts `tableRefText` expects. */
const parseEnumName = (id: string) => (id.includes('.') ? { schema: id.slice(0, id.indexOf('.')), name: id.slice(id.indexOf('.') + 1) } : { name: id });

const colName = (fieldId: string, tableId: string) => fieldId.slice(tableId.length + 1);
const endText = (e: DEndpoint) => `${e.tableId}.${e.fieldIds.length === 1 ? colName(e.fieldIds[0], e.tableId) : `(${e.fieldIds.map((f) => colName(f, e.tableId)).join(', ')})`}`;
/** Splits `a, \`f(x, y)\`, b` at top-level commas. */
const splitColumns = (s: string) => (s.match(/`[^`]*`|[^,]+/g) ?? []).map((x) => x.trim()).filter(Boolean);

// ---- columns ------------------------------------------------------------------------------

type DefaultKind = NonNullable<E.FieldPatch['defaultKind']>;
/** The kind of a default as the model shows it (`'x'`, `` `f()` ``, 12, true). */
const defaultKindOf = (v?: string): DefaultKind => (!v ? 'string' : v.startsWith("'") ? 'string' : v.startsWith('`') ? 'expression' : /^(true|false)$/i.test(v) ? 'boolean' : /^null$/i.test(v) ? 'null' : /^-?[\d.]+$/.test(v) ? 'number' : 'string');
const unwrapDefault = (v?: string) => (v ? v.replace(/^'(.*)'$/s, '$1').replace(/^`(.*)`$/s, '$1') : '');

/** Editable list of check expressions (a column may have several). */
function ChecksList({ checks, onCommit }: { checks: string[]; onCommit(c: string[]): void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  return (
    <div className="ins-props">
      {checks.map((c, i) => (
        <div key={i} className="ins-check two">
          <Input className="mono" value={c} label={t('ins.check')} onCommit={(v) => onCommit(v.trim() ? checks.map((x, j) => (j === i ? v : x)) : checks.filter((_, j) => j !== i))} />
          <button className="icon-btn danger" title={t('ins.check.delete')} onClick={() => onCommit(checks.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div className="ins-check two">
        <input className="mono" value={draft} placeholder={t('ins.check.hint')} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { onCommit([...checks, draft]); setDraft(''); } }} />
        <button className="icon-btn" title={t('ins.check.add')} disabled={!draft.trim()} onClick={() => { onCommit([...checks, draft]); setDraft(''); }}>+</button>
      </div>
    </div>
  );
}

const REF_OPS: E.RefOp[] = ['>', '<', '-', '<>'];

/** The inline `ref:` of a partial column: every table including the partial gets this relationship. */
function InlineRefEditor({ value, model, onCommit }: { value?: string; model: DiagramModel; onCommit(r: { op: E.RefOp; target: string } | null): void }) {
  const { t } = useI18n();
  const m = value ? /^(<>|>|<|-)\s*(.+)$/.exec(value.trim()) : null;
  const op = (m?.[1] as E.RefOp) ?? '>';
  const target = m?.[2] ?? '';
  const targets = model.tables.flatMap((tb) => tb.fields.map((f) => `${E.tableRefText(tb)}.${E.ident(f.name)}`));
  return (
    <div className="ins-inline-ref">
      <select value={value ? op : ''} onChange={(e) => onCommit(e.target.value ? { op: e.target.value as E.RefOp, target: target || targets[0] } : null)}>
        <option value="">{t('ins.ref.noneInline')}</option>
        {REF_OPS.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {value && (
        <select value={target} onChange={(e) => onCommit({ op, target: e.target.value })}>
          {!targets.includes(target) && <option value={target}>{target}</option>}
          {targets.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      )}
    </div>
  );
}

function FieldEditor({ f, first, last, run, focus, info, model, partial }: { f: DField; first: boolean; last: boolean; run: RunEdit; focus: boolean; info: EditInfo | null; model: DiagramModel; partial: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const checks = info?.fieldChecks[f.id] ?? [];
  const custom = info?.fieldCustom[f.id] ?? {};
  const meta = info?.metadata[`Column:${f.id}`]?.custom ?? {};
  const kind = defaultKindOf(f.defaultValue);
  const setDefault = (v: string, k: DefaultKind) => run((c) => E.updateField(c, f.id, { defaultValue: v, defaultKind: k }));
  const flag = (key: 'pk' | 'notNull' | 'unique' | 'increment', label: string, title: MessageKey) => (
    <button className={`chip${f[key] ? ' on' : ''}`} title={t(title)} onClick={() => run((c) => E.updateField(c, f.id, { [key]: !f[key] }))}>{label}</button>
  );
  const busy = open || f.defaultValue || f.note || checks.length || Object.keys(custom).length || Object.keys(meta).length || info?.fieldRef[f.id];
  return (
    <div className="ins-field">
      <div className="ins-field-main">
        <Input className="f-name" value={f.name} label={t('ins.column.name')} autoFocus={focus} onCommit={(v) => v.trim() && run((c) => E.updateField(c, f.id, { name: v }))} />
        <Input className="f-type" value={f.type} label={t('ins.column.type')} list="dbml-types" onCommit={(v) => v.trim() && run((c) => E.updateField(c, f.id, { type: v }))} />
      </div>
      <div className="ins-field-tools">
        {flag('pk', 'PK', 'table.pk')}
        {flag('notNull', 'NN', 'table.notNull')}
        {flag('unique', 'UQ', 'table.unique')}
        {flag('increment', 'AI', 'table.increment')}
        <span className="grow" />
        <button className={`icon-btn${busy ? ' on' : ''}`} title={t('ins.column.more')} onClick={() => setOpen(!open)}>⋯</button>
        <button className="icon-btn" title={t('ins.moveUp')} disabled={first} onClick={() => run((c) => E.moveField(c, f.id, -1))}>↑</button>
        <button className="icon-btn" title={t('ins.moveDown')} disabled={last} onClick={() => run((c) => E.moveField(c, f.id, 1))}>↓</button>
        <button className="icon-btn danger" title={t('ins.column.delete')} onClick={() => run((c) => E.deleteField(c, f.id))}>×</button>
      </div>
      {open && (
        <div className="ins-field-more">
          <Row label={t('table.default')}>
            <div className="ins-default">
              <select value={f.defaultValue ? kind : ''} title={t('ins.column.defaultKind')} onChange={(e) => (e.target.value ? setDefault(unwrapDefault(f.defaultValue), e.target.value as DefaultKind) : run((c) => E.updateField(c, f.id, { defaultValue: '' })))}>
                <option value="">{t('ins.column.noDefault')}</option>
                <option value="string">{t('ins.kind.string')}</option>
                <option value="number">{t('ins.kind.number')}</option>
                <option value="boolean">{t('ins.kind.boolean')}</option>
                <option value="null">null</option>
                <option value="expression">{t('ins.kind.expression')}</option>
              </select>
              {kind !== 'null' && (
                <Input value={unwrapDefault(f.defaultValue)} placeholder={t('ins.column.defaultHint')} label={t('table.default')}
                  onCommit={(v) => setDefault(v, f.defaultValue ? kind : defaultKindOf(literalFor(v)))} />
              )}
            </div>
          </Row>
          <Row label={t('ins.note')}>
            <Input multiline value={f.note ?? ''} onCommit={(v) => run((c) => E.updateField(c, f.id, { note: v }))} />
          </Row>
          <Row label={t('ins.check')}>
            <ChecksList checks={checks} onCommit={(v) => run((c) => E.updateField(c, f.id, { checks: v }))} />
          </Row>
          {partial && (
            <Row label={t('ins.ref.inline')}>
              <InlineRefEditor value={info?.fieldRef[f.id]} model={model} onCommit={(r) => run((c) => E.updateField(c, f.id, { ref: r }))} />
            </Row>
          )}
          {/* custom settings written on the column itself; for table columns, Metadata blocks too */}
          {(partial || Object.keys(custom).length > 0) && (
            <Row label={partial ? t('ins.props') : t('ins.props.inline')}>
              <PropsEditor values={Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, literalDisplay(v)]))}
                onCommit={(v) => run((c) => E.updateField(c, f.id, { custom: v }))} />
            </Row>
          )}
          {!partial && (
            <Row label={t('ins.props')}>
              <PropsEditor values={meta} onCommit={(v) => run((c) => E.setMetadata(c, 'Column', f.id, v))} />
            </Row>
          )}
        </div>
      )}
    </div>
  );
}

function FieldList({ blockId, model, info, run, focus, setFocus }: { blockId: string } & Pick<PanelProps, 'model' | 'info' | 'run' | 'focus' | 'setFocus'>) {
  const { t } = useI18n();
  const fields = info ? E.ownFields({ model, info }, blockId) : [];
  return (
    <Section title={t('ins.columns')} extra={<button className="link" onClick={() => run((c) => E.addField(c, blockId), { then: (r) => setFocus(r.created ?? null) })}>+ {t('ins.column.add')}</button>}>
      {fields.map((f, i) => (
        <FieldEditor key={f.id} f={f} first={i === 0} last={i === fields.length - 1} run={run} focus={focus === f.id} info={info} model={model} partial={blockId.startsWith('partial:')} />
      ))}
    </Section>
  );
}

// ---- indexes & checks ---------------------------------------------------------------------

function IndexEditor({ blockId, columns, info, run }: { blockId: string; columns: string[]; info: EditInfo | null; run: RunEdit }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [cols, setCols] = useState<string[]>([]);
  const [exprText, setExprText] = useState('');
  const [unique, setUnique] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const b = info ? (blockId.startsWith('partial:') ? info.partials[blockId.slice(8)] : info.tables[blockId]) : undefined;
  const indexes = b?.indexes ?? [];
  const toggleCol = (n: string) => setCols(cols.includes(n) ? cols.filter((c) => c !== n) : [...cols, n]);
  const add = () => {
    const all = [...cols, ...(exprText.trim() ? [`\`${exprText.trim().replace(/^`|`$/g, '')}\``] : [])];
    run((c) => E.addIndex(c, blockId, { columns: all, unique }));
    setAdding(false);
  };
  return (
    <Section title={t('ins.indexes')} extra={!adding && <button className="link" onClick={() => { setAdding(true); setCols([]); setExprText(''); setUnique(false); }}>+ {t('ins.index.add')}</button>}>
      {indexes.length === 0 && !adding && <div className="ins-empty">{t('ins.index.none')}</div>}
      {indexes.map((ix, i) => (
        <div key={i} className="ins-index-wrap">
          <div className="ins-index">
            <code>{ix.columns.join(', ')}</code>
            {ix.name && <span className="ins-tag">{ix.name}</span>}
            <span className="grow" />
            <button className={`chip${ix.unique ? ' on' : ''}`} title={t('table.unique')} onClick={() => run((c) => E.updateIndex(c, blockId, i, { unique: !ix.unique }))}>UQ</button>
            <button className={`chip${ix.pk ? ' on' : ''}`} title={t('table.pk')} onClick={() => run((c) => E.updateIndex(c, blockId, i, { pk: !ix.pk }))}>PK</button>
            <button className={`icon-btn${open === i ? ' on' : ''}`} title={t('ins.index.more')} onClick={() => setOpen(open === i ? null : i)}>⋯</button>
            <button className="icon-btn danger" title={t('ins.index.delete')} onClick={() => run((c) => E.deleteIndex(c, blockId, i))}>×</button>
          </div>
          {open === i && (
            <div className="ins-field-more">
              <Row label={t('ins.index.columns')}>
                <Input value={ix.columns.join(', ')} placeholder="a, b, `lower(c)`" onCommit={(v) => run((c) => E.updateIndex(c, blockId, i, { columns: splitColumns(v) }))} />
              </Row>
              <Row label={t('ins.name')}>
                <Input value={ix.name ?? ''} onCommit={(v) => run((c) => E.updateIndex(c, blockId, i, { name: v }))} />
              </Row>
              <Row label={t('ins.index.type')}>
                <Input value={ix.type ?? ''} list="dbml-index-types" placeholder="btree" onCommit={(v) => run((c) => E.updateIndex(c, blockId, i, { type: v.trim() }))} />
              </Row>
              <Row label={t('ins.note')}>
                <Input multiline value={ix.note ?? ''} onCommit={(v) => run((c) => E.updateIndex(c, blockId, i, { note: v }))} />
              </Row>
            </div>
          )}
        </div>
      ))}
      {adding && (
        <div className="ins-index-form">
          <div className="ins-index-cols">
            {columns.map((n) => (
              <label key={n} className="check"><input type="checkbox" checked={cols.includes(n)} onChange={() => toggleCol(n)} /> {n}</label>
            ))}
          </div>
          <input value={exprText} onChange={(e) => setExprText(e.target.value)} placeholder={t('ins.index.exprHint')} />
          <label className="check"><input type="checkbox" checked={unique} onChange={() => setUnique(!unique)} /> {t('table.unique')}</label>
          <div className="ins-actions">
            <button className="btn" onClick={() => setAdding(false)}>{t('import.cancel')}</button>
            <button className="btn primary" disabled={!cols.length && !exprText.trim()} onClick={add}>{t('ins.index.add')}</button>
          </div>
        </div>
      )}
    </Section>
  );
}

function ChecksEditor({ blockId, info, run }: { blockId: string; info: EditInfo | null; run: RunEdit }) {
  const { t } = useI18n();
  const [expression, setExpression] = useState('');
  const [name, setName] = useState('');
  const b = info ? (blockId.startsWith('partial:') ? info.partials[blockId.slice(8)] : info.tables[blockId]) : undefined;
  const checks = b?.checks ?? [];
  const add = () => {
    run((c) => E.addCheck(c, blockId, { expression, name }));
    setExpression('');
    setName('');
  };
  return (
    <Section title={t('ins.checks')}>
      {checks.map((ck, i) => (
        <div key={i} className="ins-check">
          <Input className="mono" value={ck.expression} label={t('ins.check')} onCommit={(v) => v.trim() && run((c) => E.updateCheck(c, blockId, i, { expression: v }))} />
          <Input value={ck.name ?? ''} placeholder={t('ins.name')} onCommit={(v) => run((c) => E.updateCheck(c, blockId, i, { name: v }))} />
          <button className="icon-btn danger" title={t('ins.check.delete')} onClick={() => run((c) => E.deleteCheck(c, blockId, i))}>×</button>
        </div>
      ))}
      <div className="ins-check">
        <input className="mono" value={expression} onChange={(e) => setExpression(e.target.value)} placeholder={t('ins.check.hint')} onKeyDown={(e) => e.key === 'Enter' && expression.trim() && add()} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('ins.name')} onKeyDown={(e) => e.key === 'Enter' && expression.trim() && add()} />
        <button className="icon-btn" title={t('ins.check.add')} disabled={!expression.trim()} onClick={add}>+</button>
      </div>
    </Section>
  );
}

// ---- relationships ------------------------------------------------------------------------

/** Column pairs of a (possibly composite) ref: own column → referenced column. */
function PairsEditor({ model, fromTable, toTable, pairs, setPairs }: {
  model: DiagramModel; fromTable: string; toTable: string; pairs: [string, string][]; setPairs(p: [string, string][]): void;
}) {
  const { t } = useI18n();
  const cols = (tid: string) => model.tables.find((x) => x.id === tid)?.fields ?? [];
  const set = (i: number, side: 0 | 1, v: string) => setPairs(pairs.map((p, j) => (j === i ? (side ? [p[0], v] : [v, p[1]]) as [string, string] : p)));
  return (
    <div className="ins-pairs">
      {pairs.map((p, i) => (
        <div key={i} className="ins-pair">
          <select value={p[0]} onChange={(e) => set(i, 0, e.target.value)}>{cols(fromTable).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          <span>→</span>
          <select value={p[1]} onChange={(e) => set(i, 1, e.target.value)}>{cols(toTable).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          <button className="icon-btn danger" disabled={pairs.length <= 1} title={t('ins.ref.removePair')} onClick={() => setPairs(pairs.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button className="link" onClick={() => setPairs([...pairs, [cols(fromTable)[0]?.id ?? '', cols(toTable)[0]?.id ?? '']])}>+ {t('ins.ref.addPair')}</button>
    </div>
  );
}

const OPS: { op: E.RefOp; key: MessageKey }[] = [
  { op: '>', key: 'ins.ref.manyToOne' },
  { op: '<', key: 'ins.ref.oneToMany' },
  { op: '-', key: 'ins.ref.oneToOne' },
  { op: '<>', key: 'ins.ref.manyToMany' },
];

function NewRefForm({ table, model, run, onDone }: { table: DTable; model: DiagramModel; run: RunEdit; onDone(): void }) {
  const { t } = useI18n();
  const others = model.tables;
  const [target, setTarget] = useState(others.find((x) => x.id !== table.id)?.id ?? table.id);
  const first = (tid: string) => model.tables.find((x) => x.id === tid)?.fields[0]?.id ?? '';
  const [pairs, setPairs] = useState<[string, string][]>([[table.fields[0]?.id ?? '', first(target)]]);
  const [op, setOp] = useState<E.RefOp>('>');
  const [name, setName] = useState('');
  return (
    <div className="ins-index-form">
      <Row label={t('ins.ref.target')}>
        <select value={target} onChange={(e) => { setTarget(e.target.value); setPairs(pairs.map((p) => [p[0], first(e.target.value)])); }}>
          {others.map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}
        </select>
      </Row>
      <PairsEditor model={model} fromTable={table.id} toTable={target} pairs={pairs} setPairs={setPairs} />
      <Row label={t('ins.ref.type')}>
        <select value={op} onChange={(e) => setOp(e.target.value as E.RefOp)}>
          {OPS.map((o) => <option key={o.op} value={o.op}>{o.op} {t(o.key)}</option>)}
        </select>
      </Row>
      <Row label={t('ins.name')}><input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('ins.optional')} /></Row>
      <div className="ins-actions">
        <button className="btn" onClick={onDone}>{t('import.cancel')}</button>
        <button className="btn primary" onClick={() => { run((c) => E.addRef(c, pairs.map((p) => p[0]), pairs.map((p) => p[1]), op, name)); onDone(); }}>{t('ins.ref.create')}</button>
      </div>
    </div>
  );
}

function RefPanel({ refId, ...props }: { refId: string } & PanelProps) {
  const { model, info, run, onClose } = props;
  const { t } = useI18n();
  const ref = model.refs.find((r) => r.id === refId);
  const [pairs, setPairs] = useState<[string, string][]>(() => (ref ? ref.from.fieldIds.map((f, i) => [f, ref.to.fieldIds[i]]) : []));
  if (!ref) return null;
  const ri = info?.refs[refId];
  const op = E.refOp(ref.from.relation, ref.to.relation);
  const action = (key: 'onDelete' | 'onUpdate') => (
    <select value={ri?.[key] ?? ''} onChange={(e) => run((c) => E.updateRef(c, refId, { [key]: e.target.value }))}>
      <option value="">{t('ins.ref.noAction')}</option>
      {E.REF_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
    </select>
  );
  const changed = pairs.some((p, i) => p[0] !== ref.from.fieldIds[i] || p[1] !== ref.to.fieldIds[i]) || pairs.length !== ref.from.fieldIds.length;
  const fromPartial = ri?.ownerFieldId?.startsWith('partial:') ? ri.ownerFieldId.slice(8).split('.')[0] : undefined;
  if (fromPartial) {
    return (
      <>
        <div className="ins-ref-ends"><code>{endText(ref.from)}</code><b>{op}</b><code>{endText(ref.to)}</code></div>
        <div className="ins-empty">{t('ins.ref.fromPartial', { name: fromPartial })}</div>
        <button className="btn" onClick={() => props.onSelect({ kind: 'partials', id: fromPartial })}>~{fromPartial}</button>
      </>
    );
  }
  return (
    <>
      <div className="ins-ref-ends">
        <code>{endText(ref.from)}</code>
        <b>{op}</b>
        <code>{endText(ref.to)}</code>
      </div>
      <Row label={t('ins.name')}><Input value={ref.name ?? ''} placeholder={t('ins.optional')} onCommit={(v) => run((c) => E.updateRef(c, refId, { name: v }))} /></Row>
      <Section title={t('ins.ref.type')}>
        <div className="ins-ops">
          {OPS.map((o) => (
            <label key={o.op} className={`ins-op${op === o.op ? ' on' : ''}`}>
              <input type="radio" name="ref-op" checked={op === o.op} onChange={() => run((c) => E.updateRef(c, refId, { op: o.op }))} />
              <code>{o.op}</code> {t(o.key)}
            </label>
          ))}
        </div>
      </Section>
      <Row label={t('ins.ref.onDelete')}>{action('onDelete')}</Row>
      <Row label={t('ins.ref.onUpdate')}>{action('onUpdate')}</Row>
      <Row label={t('ins.color')}><ColorPick value={ri?.color ?? ref.color} colors={COLORS} onChange={(v) => run((c) => E.updateRef(c, refId, { color: v }))} /></Row>
      <label className="check"><input type="checkbox" checked={!!ref.inactive} onChange={() => run((c) => E.updateRef(c, refId, { inactive: !ref.inactive }))} /> {t('ins.ref.inactive')}</label>
      <Section title={t('ins.ref.columns')}>
        <PairsEditor model={model} fromTable={ref.from.tableId} toTable={ref.to.tableId} pairs={pairs} setPairs={setPairs} />
        {changed && (
          <div className="ins-actions">
            <button className="btn primary" onClick={() => run((c) => E.updateRef(c, refId, { from: pairs.map((p) => p[0]), to: pairs.map((p) => p[1]) }))}>{t('ins.apply')}</button>
          </div>
        )}
      </Section>
      <div className="ins-footer">
        <button className="btn" onClick={() => run((c) => E.updateRef(c, refId, { swap: true }))}>{t('ins.ref.swap')}</button>
        <button className="btn danger" onClick={() => { run((c) => E.deleteRef(c, refId)); onClose(); }}>{t('ins.ref.delete')}</button>
      </div>
    </>
  );
}

// ---- table --------------------------------------------------------------------------------

/**
 * Sample data. Cells are kept as the DBML literals they were written as: only the edited cell is
 * rewritten (`literalFor` keeps its kind), so `'123'` stays text and enum values stay references.
 */
function RecordsEditor({ table, info, run, model }: { table: DTable; info: EditInfo | null; run: RunEdit; model: DiagramModel }) {
  const { t } = useI18n();
  /** what each column's type says about the values typed into it */
  const hint = (col: string): ColumnHint | undefined => {
    const f = table.fields.find((x) => x.name === col);
    if (!f) return undefined;
    const en = f.enumId ? model.enums.find((e) => e.id === f.enumId) : undefined;
    return { type: f.type, enumName: en ? E.tableRefText(parseEnumName(en.id)) : undefined, enumValues: en?.values.map((v) => v.name) };
  };
  const blocks = info?.tables[table.id]?.records ?? [];
  const all = table.fields.map((f) => f.name);
  const [picking, setPicking] = useState(false);
  const [cols, setCols] = useState<string[]>(all);
  const save = (i: number, columns: string[], raw: string[][], example?: boolean) => run((c) => E.setRecords(c, table.id, i, { columns, rows: raw, example }));
  return (
    // one Records block per table (DBML rule)
    <Section title={t('ins.records')} extra={!picking && !blocks.length && <button className="link" onClick={() => { setCols(all); setPicking(true); }}>+ {t('ins.records.add')}</button>}>
      {blocks.length === 0 && !picking && <div className="ins-empty">{t('ins.records.none')}</div>}
      {picking && (
        <div className="ins-index-form">
          <div className="ins-sub-head">{t('ins.records.columns')}</div>
          <div className="ins-index-cols">
            {all.map((n) => (
              <label key={n} className="check"><input type="checkbox" checked={cols.includes(n)} onChange={() => setCols(cols.includes(n) ? cols.filter((x) => x !== n) : all.filter((x) => x === n || cols.includes(x)))} /> {n}</label>
            ))}
          </div>
          <div className="ins-actions">
            <button className="btn" onClick={() => setPicking(false)}>{t('import.cancel')}</button>
            <button className="btn primary" disabled={!cols.length} onClick={() => { save(-1, cols, [cols.map(() => 'null')]); setPicking(false); }}>{t('ins.ref.create')}</button>
          </div>
        </div>
      )}
      {blocks.map((b, i) => {
        const missing = all.filter((n) => !b.columns.includes(n));
        return (
          <div key={i} className="ins-records">
            <div className="ins-grid-wrap">
              <table className="ins-grid">
                <thead>
                  <tr>
                    {b.columns.map((c, ci) => (
                      <th key={c}>
                        {c}
                        {b.columns.length > 1 && (
                          <button className="icon-btn danger" title={t('ins.records.removeColumn')}
                            onClick={() => save(i, b.columns.filter((_, x) => x !== ci), b.raw.map((r) => r.filter((_, x) => x !== ci)))}>×</button>
                        )}
                      </th>
                    ))}
                    <th>
                      {missing.length > 0 && (
                        <select value="" title={t('ins.records.addColumn')} onChange={(e) => e.target.value && save(i, [...b.columns, e.target.value], b.raw.map((r) => [...r, 'null']))}>
                          <option value="">+</option>
                          {missing.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, r) => (
                    <tr key={r}>
                      {b.columns.map((_, ci) => (
                        <td key={ci}>
                          <Input value={row[ci] ?? ''} placeholder="null" label={b.columns[ci]}
                            onCommit={(v) => save(i, b.columns, b.raw.map((x, xi) => (xi === r ? x.map((y, yi) => (yi === ci ? literalFor(v, y === 'null' ? undefined : y, hint(b.columns[ci])) : y)) : x)))} />
                        </td>
                      ))}
                      <td><button className="icon-btn danger" title={t('ins.records.deleteRow')} onClick={() => save(i, b.columns, b.raw.filter((_, xi) => xi !== r))}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ins-actions left">
              <label className="check"><input type="checkbox" checked={b.example} onChange={() => save(i, b.columns, b.raw, !b.example)} /> {t('ins.records.example')}</label>
              <button className="link" onClick={() => save(i, b.columns, [...b.raw, b.columns.map(() => 'null')])}>+ {t('ins.records.addRow')}</button>
              <span className="grow" />
              <button className="link danger" onClick={() => run((c) => E.deleteRecords(c, table.id, i))}>{t('ins.records.delete')}</button>
            </div>
          </div>
        );
      })}
    </Section>
  );
}

function PartialChips({ table, info, run, onSelect }: { table: DTable } & Pick<PanelProps, 'info' | 'run' | 'onSelect'>) {
  const { t } = useI18n();
  const used = info?.tables[table.id]?.partials.map((p) => p.name) ?? [];
  const available = Object.keys(info?.partials ?? {}).filter((p) => !used.includes(p));
  if (!used.length && !available.length) return null;
  return (
    <Row label={t('ins.partials')}>
      <div className="ins-chips">
        {used.map((p) => (
          <span key={p} className="ins-chip">
            <button className="link" onClick={() => onSelect({ kind: 'partials', id: p })}>~{p}</button>
            <button className="icon-btn" title={t('ins.partial.moveUp')} onClick={() => run((c) => E.moveInjection(c, table.id, p, -1))}>↑</button>
            <button className="icon-btn" title={t('ins.partial.moveDown')} onClick={() => run((c) => E.moveInjection(c, table.id, p, 1))}>↓</button>
            <button className="icon-btn danger" title={t('ins.partial.remove')} onClick={() => run((c) => E.removePartialFromTable(c, table.id, p))}>×</button>
          </span>
        ))}
        {available.length > 0 && (
          <select value="" onChange={(e) => e.target.value && run((c) => E.addPartialToTable(c, table.id, e.target.value))}>
            <option value="">+ {t('ins.partial.include')}</option>
            {available.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
      </div>
    </Row>
  );
}

/**
 * A column a table gets from a partial: edited in the partial, but custom properties belong to
 * the table's copy (`Metadata Column table.column` — the grammar has no Metadata for partials).
 */
function InjectedField({ f, partial, info, run, onSelect }: { f: DField; partial: string } & PanelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const meta = info?.metadata[`Column:${f.id}`]?.custom ?? {};
  return (
    <div className="ins-field injected">
      <div className="ins-field-tools">
        <b>{f.name}</b>&nbsp;<code>{f.type}</code>
        <span className="grow" />
        <button className="link" title={t('ins.partial.editIn')} onClick={() => onSelect({ kind: 'partials', id: partial })}>~{partial}</button>
        <button className={`icon-btn${open || Object.keys(meta).length ? ' on' : ''}`} title={t('ins.props')} onClick={() => setOpen(!open)}>⋯</button>
      </div>
      {open && <PropsEditor values={meta} onCommit={(v) => run((c) => E.setMetadata(c, 'Column', f.id, v))} />}
    </div>
  );
}

function TablePanel({ table, ...props }: { table: DTable } & PanelProps) {
  const { model, info, run, focus, onSelect, onClose } = props;
  const { t } = useI18n();
  const [newRef, setNewRef] = useState(false);
  const refs = model.refs.filter((r) => r.from.tableId === table.id || r.to.tableId === table.id);
  const injected = table.fields.filter((f) => info?.injected[f.id]);
  return (
    <>
      <Row label={t('ins.name')}>
        <Input value={table.schema ? `${table.schema}.${table.name}` : table.name} autoFocus={focus === 'name'} label={t('ins.name')}
          onCommit={(v) => v.trim() && run((c) => E.updateTable(c, table.id, { name: v }))} />
      </Row>
      <Row label={t('ins.alias')}>
        <Input value={table.alias ?? ''} placeholder={t('ins.optional')} onCommit={(v) => run((c) => E.updateTable(c, table.id, { alias: v }))} />
      </Row>
      <Row label={t('ins.note')}>
        <Input multiline value={table.note ?? ''} onCommit={(v) => run((c) => E.updateTable(c, table.id, { note: v }))} />
      </Row>
      <Row label={t('ins.headerColor')}>
        <ColorPick value={table.headerColor} colors={COLORS} onChange={(v) => run((c) => E.updateTable(c, table.id, { headerColor: v }))} />
      </Row>
      <PartialChips table={table} {...props} />
      <Section title={t('ins.props')}>
        <PropsEditor values={info?.metadata[`Table:${table.id}`]?.custom ?? {}} onCommit={(v) => run((c) => E.setMetadata(c, 'Table', table.id, v))} />
      </Section>
      <FieldList blockId={table.id} {...props} />
      {injected.length > 0 && (
        <Section title={t('ins.partial.injected')}>
          {injected.map((f) => <InjectedField key={f.id} f={f} partial={info!.injected[f.id]} {...props} />)}
        </Section>
      )}
      <IndexEditor blockId={table.id} columns={table.fields.map((f) => f.name)} info={info} run={run} />
      <ChecksEditor blockId={table.id} info={info} run={run} />
      <Section title={t('ins.relationships')} extra={!newRef && <button className="link" onClick={() => setNewRef(true)}>+ {t('ins.ref.new')}</button>}>
        {refs.length === 0 && !newRef && <div className="ins-empty">{t('ins.ref.noneHint')}</div>}
        {refs.map((r) => (
          <button key={r.id} className="ins-link-row" onClick={() => onSelect({ kind: 'ref', id: r.id })}>
            <code>{endText(r.from)}</code> <b>{E.refOp(r.from.relation, r.to.relation)}</b> <code>{endText(r.to)}</code>
          </button>
        ))}
        {newRef && <NewRefForm table={table} model={model} run={run} onDone={() => setNewRef(false)} />}
      </Section>
      <DepsSection table={table} {...props} />
      <RecordsEditor table={table} info={info} run={run} model={model} />
      <div className="ins-footer">
        <button className="btn danger" onClick={() => { run((c) => E.deleteTable(c, table.id)); onClose(); }}>{t('ins.table.delete')}</button>
      </div>
    </>
  );
}

// ---- sticky note, group -------------------------------------------------------------------

function NotePanel({ noteId, ...props }: { noteId: string } & PanelProps) {
  const { model, run, onSelect, onClose } = props;
  const { t } = useI18n();
  const n = model.notes.find((x) => x.id === noteId);
  if (!n) return null;
  const rename = (v: string) => run((c) => E.updateNote(c, noteId, { name: v }), { then: (r) => r.renamed && onSelect({ kind: 'note', id: r.renamed[noteId] }) });
  return (
    <>
      <Row label={t('ins.name')}><Input value={n.name} onCommit={(v) => v.trim() && rename(v)} /></Row>
      <Row label={t('ins.content')}><Input multiline value={n.content} onCommit={(v) => run((c) => E.updateNote(c, noteId, { content: v }))} /></Row>
      <Row label={t('ins.color')}><ColorPick value={n.color} colors={NOTE_COLORS} allowNone onChange={(v) => run((c) => E.updateNote(c, noteId, { color: v }))} /></Row>
      <Section title={t('ins.props')}>
        <PropsEditor values={props.info?.metadata[`Note:${noteId}`]?.custom ?? {}} onCommit={(v) => run((c) => E.setMetadata(c, 'Note', noteId, v))} />
      </Section>
      <div className="ins-footer">
        <button className="btn danger" onClick={() => { run((c) => E.deleteNote(c, noteId)); onClose(); }}>{t('ins.note.delete')}</button>
      </div>
    </>
  );
}

function GroupPanel({ groupId, ...props }: { groupId: string } & PanelProps) {
  const { model, run, onSelect, onClose } = props;
  const { t } = useI18n();
  const g = model.groups.find((x) => x.id === groupId);
  if (!g) return null;
  const toggle = (id: string) => run((c) => E.updateGroup(c, groupId, { tableIds: g.tableIds.includes(id) ? g.tableIds.filter((x) => x !== id) : [...g.tableIds, id] }));
  return (
    <>
      <Row label={t('ins.name')}>
        <Input value={g.name} onCommit={(v) => v.trim() && run((c) => E.updateGroup(c, groupId, { name: v }), { then: () => onSelect({ kind: 'group', id: `group:${v.trim()}` }) })} />
      </Row>
      <Row label={t('ins.color')}><ColorPick value={g.color} colors={COLORS} onChange={(v) => run((c) => E.updateGroup(c, groupId, { color: v }))} /></Row>
      <Row label={t('ins.note')}><Input multiline value={g.note ?? ''} onCommit={(v) => run((c) => E.updateGroup(c, groupId, { note: v }))} /></Row>
      <Section title={t('ins.props')}>
        <PropsEditor values={props.info?.metadata[`TableGroup:${groupId}`]?.custom ?? {}} onCommit={(v) => run((c) => E.setMetadata(c, 'TableGroup', groupId, v))} />
      </Section>
      <Section title={t('ins.group.members')}>
        <div className="ins-members">
          {model.tables.map((tb) => (
            <label key={tb.id} className="check">
              <input type="checkbox" checked={g.tableIds.includes(tb.id)} onChange={() => toggle(tb.id)} /> {tb.id}
            </label>
          ))}
        </div>
      </Section>
      <div className="ins-footer">
        <button className="btn danger" onClick={() => { run((c) => E.deleteGroup(c, groupId)); onClose(); }}>{t('ins.group.delete')}</button>
      </div>
    </>
  );
}

// ---- document-wide: enums, partials, project ----------------------------------------------

function EnumsPanel({ model, run }: PanelProps) {
  const { t } = useI18n();
  return (
    <>
      {model.enums.length === 0 && <div className="ins-empty">{t('ins.enum.none')}</div>}
      {model.enums.map((e) => {
        const setValues = (values: E.EnumValue[]) => run((c) => E.updateEnum(c, e.id, { values }));
        return (
          <section key={e.id} className="ins-enum">
            <div className="ins-enum-head">
              <Input value={e.id} label={t('ins.name')} onCommit={(v) => v.trim() && run((c) => E.updateEnum(c, e.id, { name: v }))} />
              <button className="icon-btn danger" title={t('ins.enum.delete')} onClick={() => run((c) => E.deleteEnum(c, e.id))}>×</button>
            </div>
            {e.values.map((v, i) => (
              <div key={`${i}:${v.name}`} className="ins-enum-value">
                <Input value={v.name} label={t('ins.enum.value')} onCommit={(name) => name.trim() && setValues(e.values.map((x, j) => (j === i ? { ...x, name } : x)))} />
                <Input multiline value={v.note ?? ''} placeholder={t('ins.note')} onCommit={(note) => setValues(e.values.map((x, j) => (j === i ? { ...x, note } : x)))} />
                <span className="ins-mini-tools">
                  <button className="icon-btn" title={t('ins.moveUp')} disabled={i === 0} onClick={() => setValues(e.values.map((x, j) => (j === i - 1 ? e.values[i] : j === i ? e.values[i - 1] : x)))}>↑</button>
                  <button className="icon-btn" title={t('ins.moveDown')} disabled={i === e.values.length - 1} onClick={() => setValues(e.values.map((x, j) => (j === i + 1 ? e.values[i] : j === i ? e.values[i + 1] : x)))}>↓</button>
                  <button className="icon-btn danger" title={t('ins.enum.deleteValue')} disabled={e.values.length <= 1} onClick={() => setValues(e.values.filter((_, j) => j !== i))}>×</button>
                </span>
              </div>
            ))}
            <button className="link" onClick={() => setValues([...e.values, { name: `value_${e.values.length + 1}` }])}>+ {t('ins.enum.addValue')}</button>
          </section>
        );
      })}
      <div className="ins-footer">
        <button className="btn" onClick={() => run((c) => E.addEnum(c))}>+ {t('ins.enum.add')}</button>
      </div>
    </>
  );
}

function PartialsPanel(props: PanelProps & { open?: string }) {
  const { info, run, onSelect } = props;
  const { t } = useI18n();
  const partials = Object.values(info?.partials ?? {});
  return (
    <>
      <div className="ins-empty">{t('ins.partial.hint')}</div>
      {partials.map((p) => {
        const id = E.partialId(p.name);
        const users = Object.entries(info?.tables ?? {}).filter(([, tb]) => tb.partials.some((x) => x.name === p.name)).map(([tid]) => tid);
        return (
          <section key={p.name} className={`ins-enum${props.open === p.name ? ' focus' : ''}`}>
            <Row label={t('ins.name')}>
              <Input value={p.name} onCommit={(v) => v.trim() && run((c) => E.updatePartial(c, p.name, { name: v }))} />
            </Row>
            <Row label={t('ins.note')}><Input multiline value={p.note ?? ''} onCommit={(v) => run((c) => E.updatePartial(c, p.name, { note: v }))} /></Row>
            <Row label={t('ins.headerColor')}><ColorPick value={p.headerColor} colors={COLORS} onChange={(v) => run((c) => E.updatePartial(c, p.name, { headerColor: v }))} /></Row>
            <FieldList blockId={id} {...props} />
            <IndexEditor blockId={id} columns={p.fields.map((f) => f.name)} info={info} run={run} />
            <ChecksEditor blockId={id} info={info} run={run} />
            <div className="ins-empty">
              {t('ins.partial.usedBy')}{' '}
              {users.length ? users.map((u) => <button key={u} className="link" onClick={() => onSelect({ kind: 'table', id: u })}>{u} </button>) : '—'}
            </div>
            <div className="ins-actions left">
              <button className="btn danger" onClick={() => run((c) => E.deletePartial(c, p.name))}>{t('ins.partial.delete')}</button>
            </div>
          </section>
        );
      })}
      <div className="ins-footer">
        <button className="btn" onClick={() => run((c) => E.addPartial(c))}>+ {t('ins.partial.add')}</button>
      </div>
    </>
  );
}

function ProjectPanel({ model, info, run }: PanelProps) {
  const { t } = useI18n();
  const p = model.project ?? {};
  return (
    <>
      <div className="ins-empty">{t('ins.project.hint')}</div>
      <Row label={t('ins.name')}><Input value={p.name ?? ''} placeholder="project" onCommit={(v) => run((c) => E.setProject(c, { name: v }))} /></Row>
      <Row label={t('ins.project.dbType')}>
        <Input value={p.databaseType ?? ''} list="dbml-dbtypes" placeholder="PostgreSQL" onCommit={(v) => run((c) => E.setProject(c, { databaseType: v }))} />
      </Row>
      <Row label={t('ins.note')}><Input multiline value={p.note ?? ''} onCommit={(v) => run((c) => E.setProject(c, { note: v }))} /></Row>
      <datalist id="dbml-dbtypes">{E.DATABASE_TYPES.map((x) => <option key={x} value={x} />)}</datalist>
      <Section title={t('ins.props')}>
        <PropsEditor values={info?.projectCustom ?? {}} onCommit={(v) => run((c) => E.setProject(c, { custom: v }))} />
      </Section>
      {info?.project && (
        <div className="ins-footer">
          <button className="btn danger" onClick={() => run((c) => E.deleteProject(c))}>{t('ins.project.delete')}</button>
        </div>
      )}
    </>
  );
}

function ViewEditor({ v, model, run, activeView, onShowView }: { v: DView } & PanelProps) {
  const { t } = useI18n();
  const set = (patch: Partial<Pick<DView, 'tables' | 'groups' | 'schemas' | 'notes'>>) => run((c) => E.updateView(c, v.id, patch));
  const toggle = (list: string[] | null | 'all', id: string) => {
    const cur = Array.isArray(list) ? list : [];
    return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  };
  const schemas = [...new Set(model.tables.map((tb) => tb.schema ?? 'public'))];
  const mode = (sel: ViewSelection) => (sel === 'all' ? 'all' : Array.isArray(sel) ? 'some' : 'none');
  const shown = activeView === v.id;
  return (
    <section className={`ins-enum${shown ? ' focus' : ''}`}>
      <div className="ins-enum-head">
        <Input value={v.name} label={t('ins.name')} onCommit={(name) => name.trim() && run((c) => E.updateView(c, v.id, { name }))} />
        <button className="icon-btn danger" title={t('ins.view.delete')} onClick={() => { if (shown) onShowView(null); run((c) => E.deleteView(c, v.id)); }}>×</button>
      </div>
      <button className={`btn${shown ? ' on' : ''}`} onClick={() => onShowView(shown ? null : v.id)}>{shown ? t('ins.view.hide') : t('ins.view.show')}</button>
      <div className="ins-sub-head">{t('ins.view.tables')}</div>
      <div className="ins-modes">
        <label className="check"><input type="radio" checked={v.tables === 'all'} onChange={() => set({ tables: 'all', groups: [], schemas: [] })} /> {t('ins.view.allTables')}</label>
        <label className="check"><input type="radio" checked={v.tables !== 'all'} onChange={() => v.tables === 'all' && set({ tables: [] })} /> {t('ins.view.someTables')}</label>
      </div>
      {v.tables !== 'all' && (
        <>
          <div className="ins-members">
            {model.tables.map((tb) => (
              <label key={tb.id} className="check"><input type="checkbox" checked={Array.isArray(v.tables) && v.tables.includes(tb.id)} onChange={() => set({ tables: toggle(v.tables, tb.id) })} /> {tb.id}</label>
            ))}
          </div>
          {model.groups.length > 0 && (
            <>
              <div className="ins-sub-head">{t('ins.view.groups')}</div>
              <div className="ins-members">
                {model.groups.map((g) => (
                  <label key={g.id} className="check"><input type="checkbox" checked={!!v.groups?.includes(g.id)} onChange={() => set({ groups: toggle(v.groups, g.id) })} /> {g.name}</label>
                ))}
              </div>
            </>
          )}
          {schemas.length > 1 && (
            <>
              <div className="ins-sub-head">{t('ins.view.schemas')}</div>
              <div className="ins-members">
                {schemas.map((sc) => (
                  <label key={sc} className="check"><input type="checkbox" checked={!!v.schemas?.includes(sc)} onChange={() => set({ schemas: toggle(v.schemas, sc) })} /> {sc}</label>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {model.notes.length > 0 && (
        <>
          <div className="ins-sub-head">{t('ins.view.notes')}</div>
          <div className="ins-modes">
            <label className="check"><input type="radio" checked={mode(v.notes) === 'none'} onChange={() => set({ notes: [] })} /> {t('ins.view.notesNone')}</label>
            <label className="check"><input type="radio" checked={mode(v.notes) === 'all'} onChange={() => set({ notes: 'all' })} /> {t('ins.view.notesAll')}</label>
            <label className="check"><input type="radio" checked={mode(v.notes) === 'some'} onChange={() => mode(v.notes) !== 'some' && set({ notes: [model.notes[0].id] })} /> {t('ins.view.notesSome')}</label>
          </div>
          {Array.isArray(v.notes) && (
            <div className="ins-members">
              {model.notes.map((n) => (
                <label key={n.id} className="check"><input type="checkbox" checked={(v.notes as string[]).includes(n.id)} onChange={() => set({ notes: toggle(v.notes, n.id) })} /> {n.name}</label>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ViewsPanel(props: PanelProps) {
  const { model, run, onShowView } = props;
  const { t } = useI18n();
  return (
    <>
      <div className="ins-empty">{t('ins.view.hint')}</div>
      {model.views.length === 0 && <div className="ins-empty">{t('ins.view.none')}</div>}
      {model.views.map((v) => <ViewEditor key={v.id} v={v} {...props} />)}
      <div className="ins-footer">
        <button className="btn" onClick={() => run((c) => E.addView(c), { then: (r) => r.created && onShowView(r.created) })}>+ {t('ins.view.add')}</button>
      </div>
    </>
  );
}

// ---- dependencies (Dep) ---------------------------------------------------------------------

const depEnd = (e: DDepEnd) => (e.fieldIds.length ? e.fieldIds.join(', ') : e.tableId);

/** Edge rows of a dep: upstream table[.column] → downstream table[.column]. */
function DepEdgesEditor({ model, edges, setEdges }: { model: DiagramModel; edges: DDep['edges']; setEdges(e: DDep['edges']): void }) {
  const { t } = useI18n();
  const cols = (tid: string) => model.tables.find((x) => x.id === tid)?.fields ?? [];
  const end = (e: DDepEnd, set: (n: DDepEnd) => void) => (
    <>
      <select value={e.tableId} onChange={(ev) => set({ tableId: ev.target.value, fieldIds: e.fieldIds.length ? [cols(ev.target.value)[0]?.id ?? ''] : [] })}>
        {model.tables.map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}
      </select>
      <select value={e.fieldIds[0] ?? ''} onChange={(ev) => set({ tableId: e.tableId, fieldIds: ev.target.value ? [ev.target.value] : [] })}>
        <option value="">{t('ins.dep.wholeTable')}</option>
        {cols(e.tableId).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
    </>
  );
  return (
    <div className="ins-pairs">
      {edges.map((e, i) => (
        <div key={i} className="ins-dep-edge">
          {end(e.up, (n) => setEdges(edges.map((x, j) => (j === i ? { ...x, up: n } : x))))}
          <span>→</span>
          {end(e.down, (n) => setEdges(edges.map((x, j) => (j === i ? { ...x, down: n } : x))))}
          <button className="icon-btn danger" disabled={edges.length <= 1} title={t('ins.dep.removeEdge')} onClick={() => setEdges(edges.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button className="link" onClick={() => setEdges([...edges, { up: { ...edges[0].up }, down: { ...edges[0].down } }])}>+ {t('ins.dep.addEdge')}</button>
    </div>
  );
}

function DepPanel({ depId, model, info, run, onClose }: { depId: string } & PanelProps) {
  const { t } = useI18n();
  const dep = model.deps.find((d) => d.id === depId);
  const [edges, setEdges] = useState<DDep['edges']>(() => dep?.edges ?? []);
  if (!dep) return null;
  const changed = JSON.stringify(edges) !== JSON.stringify(dep.edges);
  return (
    <>
      <div className="ins-empty">{t('ins.dep.hint')}</div>
      <Row label={t('ins.name')}><Input value={dep.name ?? ''} placeholder={t('ins.optional')} onCommit={(v) => run((c) => E.updateDep(c, depId, { name: v }))} /></Row>
      <Row label={t('ins.color')}><ColorPick value={dep.color} colors={COLORS} onChange={(v) => run((c) => E.updateDep(c, depId, { color: v }))} /></Row>
      <Row label={t('ins.note')}><Input multiline value={dep.note ?? ''} onCommit={(v) => run((c) => E.updateDep(c, depId, { note: v }))} /></Row>
      <Section title={t('ins.dep.edges')}>
        <DepEdgesEditor model={model} edges={edges} setEdges={setEdges} />
        {changed && (
          <div className="ins-actions">
            <button className="btn" onClick={() => setEdges(dep.edges)}>{t('import.cancel')}</button>
            <button className="btn primary" onClick={() => run((c) => E.updateDep(c, depId, { edges }))}>{t('ins.apply')}</button>
          </div>
        )}
      </Section>
      <Section title={t('ins.props')}>
        {/* values may be strings, numbers, booleans or null: each keeps its kind (see literalFor) */}
        <PropsEditor values={Object.fromEntries(Object.entries(info?.deps[depId]?.metadata ?? {}).map(([k, v]) => [k, literalDisplay(v)]))}
          onCommit={(v) => {
            const prev = info?.deps[depId]?.metadata ?? {};
            run((c) => E.updateDep(c, depId, { metadata: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, literalFor(x, prev[k])])) }));
          }} />
      </Section>
      <div className="ins-footer">
        <button className="btn danger" onClick={() => { run((c) => E.deleteDep(c, depId)); onClose(); }}>{t('ins.dep.delete')}</button>
      </div>
    </>
  );
}

function DepsSection({ table, model, run, onSelect }: { table: DTable } & PanelProps) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const other = model.tables.find((x) => x.id !== table.id)?.id ?? table.id;
  const [dir, setDir] = useState<'up' | 'down'>('up');
  const [otherTable, setOtherTable] = useState(other);
  const deps = model.deps.filter((d) => d.edges.some((e) => e.up.tableId === table.id || e.down.tableId === table.id));
  const create = () => {
    const me: DDepEnd = { tableId: table.id, fieldIds: [] };
    const them: DDepEnd = { tableId: otherTable, fieldIds: [] };
    run((c) => (dir === 'up' ? E.addDep(c, them, me) : E.addDep(c, me, them)));
    setAdding(false);
  };
  return (
    <Section title={t('ins.deps')} extra={!adding && <button className="link" onClick={() => setAdding(true)}>+ {t('ins.dep.new')}</button>}>
      {deps.length === 0 && !adding && <div className="ins-empty">{t('ins.dep.noneHint')}</div>}
      {deps.map((d) => (
        <button key={d.id} className="ins-link-row" onClick={() => onSelect({ kind: 'dep', id: d.id })}>
          {d.name && <span className="ins-tag">{d.name}</span>}
          <code>{d.edges.map((e) => `${depEnd(e.up)} → ${depEnd(e.down)}`).join('; ')}</code>
        </button>
      ))}
      {adding && (
        <div className="ins-index-form">
          <Row label={t('ins.dep.direction')}>
            <select value={dir} onChange={(e) => setDir(e.target.value as 'up' | 'down')}>
              <option value="up">{t('ins.dep.fedBy')}</option>
              <option value="down">{t('ins.dep.feeds')}</option>
            </select>
          </Row>
          <Row label={t('ins.dep.other')}>
            <select value={otherTable} onChange={(e) => setOtherTable(e.target.value)}>
              {model.tables.filter((x) => x.id !== table.id).map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}
            </select>
          </Row>
          <div className="ins-empty">{t('ins.dep.columnsHint')}</div>
          <div className="ins-actions">
            <button className="btn" onClick={() => setAdding(false)}>{t('import.cancel')}</button>
            <button className="btn primary" disabled={otherTable === table.id} onClick={create}>{t('ins.ref.create')}</button>
          </div>
        </div>
      )}
    </Section>
  );
}

// ---- panel ------------------------------------------------------------------------------

const TITLES: Record<InspectTarget['kind'], MessageKey> = {
  table: 'ins.title.table', ref: 'ins.title.ref', note: 'ins.title.note', group: 'ins.title.group', enums: 'ins.title.enums',
  partials: 'ins.title.partials', project: 'ins.title.project', views: 'ins.title.views', dep: 'ins.title.dep',
};

export function Inspector(props: Props) {
  const { t } = useI18n();
  const { target, model } = props;
  const table = target.kind === 'table' ? model.tables.find((x) => x.id === target.id) : undefined;
  let body: ReactNode = null;
  if (target.kind === 'table' && table) body = <TablePanel table={table} {...props} />;
  else if (target.kind === 'ref') body = <RefPanel refId={target.id!} {...props} />;
  else if (target.kind === 'dep') body = <DepPanel depId={target.id!} {...props} />;
  else if (target.kind === 'note') body = <NotePanel noteId={target.id!} {...props} />;
  else if (target.kind === 'group') body = <GroupPanel groupId={target.id!} {...props} />;
  else if (target.kind === 'enums') body = <EnumsPanel {...props} />;
  else if (target.kind === 'partials') body = <PartialsPanel {...props} open={target.id} />;
  else if (target.kind === 'project') body = <ProjectPanel {...props} />;
  else if (target.kind === 'views') body = <ViewsPanel {...props} />;

  return (
    <aside className="inspector" onKeyDown={(e) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) props.onClose(); }}>
      <header className="ins-head">
        <span>{t(TITLES[target.kind])}</span>
        {table && <code className="ins-sub">{table.id}</code>}
        <button className="icon-btn" title={t('ins.close')} onClick={props.onClose}>×</button>
      </header>
      <div className="ins-body">
        {body ?? <div className="ins-empty">{t('ins.updating')}</div>}
      </div>
      <datalist id="dbml-index-types">{E.INDEX_TYPES.map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id="dbml-types">
        {[...model.enums.map((e) => e.id), ...TYPES].map((x) => <option key={x} value={x} />)}
      </datalist>
    </aside>
  );
}
