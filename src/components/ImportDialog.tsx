import { useRef, useState } from 'react';
import { useI18n } from '../i18n';
import type { ImportFormat } from '../dbml/protocol';

export type ImportSource = ImportFormat | 'dbml';

interface Props {
  onSubmit(text: string, format: ImportSource, asNew: boolean): Promise<void>;
  onClose(): void;
}

const FORMATS: { value: ImportSource; label: string; ext: string }[] = [
  { value: 'postgres', label: 'PostgreSQL', ext: '.sql' },
  { value: 'mysql', label: 'MySQL', ext: '.sql' },
  { value: 'mssql', label: 'SQL Server', ext: '.sql' },
  { value: 'oracle', label: 'Oracle', ext: '.sql' },
  { value: 'snowflake', label: 'Snowflake', ext: '.sql' },
  { value: 'schemarb', label: 'Rails schema.rb', ext: '.rb' },
  { value: 'dbml', label: 'DBML', ext: '.dbml' },
];

const guessFormat = (filename: string): ImportSource | null => {
  if (/\.dbml$/i.test(filename)) return 'dbml';
  if (/\.rb$/i.test(filename)) return 'schemarb';
  return null;
};

export function ImportDialog({ onSubmit, onClose }: Props) {
  const { t } = useI18n();
  const [format, setFormat] = useState<ImportSource>('postgres');
  const [text, setText] = useState('');
  const [asNew, setAsNew] = useState(true);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(text, format, asNew);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label={t('import.title')}>
        <h2>{t('import.title')}</h2>
        <div className="modal-row">
          <label>
            {t('import.format')}
            <select value={format} onChange={(e) => setFormat(e.target.value as ImportSource)}>
              {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          <button className="btn" onClick={() => file.current?.click()}>{t('import.file')}</button>
          <input
            ref={file}
            type="file"
            hidden
            accept=".sql,.dbml,.rb,.txt"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setText(await f.text());
              const g = guessFormat(f.name);
              if (g) setFormat(g);
              e.target.value = '';
            }}
          />
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t('import.placeholder')} spellCheck={false} />
        <div className="modal-row">
          <label className="radio"><input type="radio" checked={asNew} onChange={() => setAsNew(true)} /> {t('import.asNew')}</label>
          <label className="radio"><input type="radio" checked={!asNew} onChange={() => setAsNew(false)} /> {t('import.replace')}</label>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>{t('import.cancel')}</button>
          <button className="btn primary" disabled={!text.trim() || busy} onClick={submit}>{t('import.submit')}</button>
        </div>
      </div>
    </div>
  );
}
