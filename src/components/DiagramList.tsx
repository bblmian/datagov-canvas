import { useState } from 'react';
import { useI18n } from '../i18n';
import type { DiagramMeta } from '../storage';

interface Props {
  diagrams: DiagramMeta[];
  currentId?: string;
  onOpen(id: string): void;
  onNew(): void;
  onRename(id: string, name: string): void;
  onDuplicate(id: string): void;
  onDelete(id: string): void;
  close(): void;
}

export function DiagramList({ diagrams, currentId, onOpen, onNew, onRename, onDuplicate, onDelete, close }: Props) {
  const { t, lang } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const fmt = new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' });
  const sorted = [...diagrams].sort((a, b) => b.updatedAt - a.updatedAt);

  const commit = (id: string) => {
    if (draft.trim()) onRename(id, draft.trim());
    setEditing(null);
  };

  return (
    <div className="dlist">
      <button className="menu-item strong" onClick={() => { onNew(); close(); }}>＋ {t('diagram.new')}</button>
      <div className="menu-sep" />
      <div className="dlist-items">
        {sorted.map((d) => (
          <div key={d.id} className={`dlist-item${d.id === currentId ? ' current' : ''}`}>
            {editing === d.id ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commit(d.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(d.id); if (e.key === 'Escape') setEditing(null); }}
              />
            ) : (
              <button className="dlist-open" onClick={() => { onOpen(d.id); close(); }}>
                <span className="dlist-name">{d.name}</span>
                <span className="dlist-time">{t('diagram.updated', { time: fmt.format(d.updatedAt) })}</span>
              </button>
            )}
            <div className="dlist-actions">
              <button title={t('diagram.rename')} onClick={() => { setEditing(d.id); setDraft(d.name); }}>✎</button>
              <button title={t('diagram.duplicate')} onClick={() => onDuplicate(d.id)}>⧉</button>
              <button title={t('diagram.delete')} className="danger" onClick={() => onDelete(d.id)}>🗑</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
