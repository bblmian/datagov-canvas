import { useState } from 'react';
import { useI18n } from '../i18n';
import type { PdfLayout } from '../export/print';

interface Props {
  initial: PdfLayout;
  onSubmit(layout: PdfLayout): void;
  onClose(): void;
}

export function PdfExportDialog({ initial, onSubmit, onClose }: Props) {
  const { t } = useI18n();
  const [layout, setLayout] = useState<PdfLayout>(initial);
  const options: { value: PdfLayout; title: string; desc: string }[] = [
    { value: 'a4', title: t('pdf.a4'), desc: t('pdf.a4Desc') },
    { value: 'visible', title: t('pdf.visible'), desc: t('pdf.visibleDesc') },
  ];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal narrow" role="dialog" aria-label={t('pdf.title')}>
        <h2>{t('pdf.title')}</h2>
        <div className="choices">
          {options.map((o) => (
            <label key={o.value} className={`choice${layout === o.value ? ' on' : ''}`}>
              <input type="radio" name="pdf-layout" checked={layout === o.value} onChange={() => setLayout(o.value)} />
              <span>
                <b>{o.title}</b>
                <small>{o.desc}</small>
              </span>
            </label>
          ))}
        </div>
        <p className="modal-hint">{t('export.pdfHint')}</p>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>{t('import.cancel')}</button>
          <button className="btn primary" onClick={() => onSubmit(layout)} autoFocus>{t('pdf.submit')}</button>
        </div>
      </div>
    </div>
  );
}
