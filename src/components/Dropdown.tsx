import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Button + popover menu that closes on outside click or Escape. */
export function Dropdown({ label, title, children, align = 'left', className = '' }: {
  label: ReactNode;
  title?: string;
  align?: 'left' | 'right';
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className={`dropdown ${className}`} ref={root}>
      <button className={`btn${open ? ' on' : ''}`} title={title} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {label}
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
      </button>
      {open && <div className={`menu ${align}`} role="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}
