import { getNodesBounds, type Node } from '@xyflow/react';

/** `a4`: the whole diagram fitted on one A4 page; `visible`: what the canvas currently shows. */
export type PdfLayout = 'a4' | 'visible';

const MM = 96 / 25.4; // CSS px per mm
const A4 = { short: 210 * MM, long: 297 * MM };
const A4_MARGIN = 10 * MM;

function cleanup() {
  document.getElementById('print-root')?.remove();
  document.getElementById('print-page')?.remove();
}

/**
 * Vector PDF: prints a copy of the diagram on a single page through Chrome's print dialog
 * ("Save as PDF"). Text stays text and Chrome embeds the fonts it used (CJK included) — drawing
 * the PDF ourselves would mean bundling large font files. The copy is shown only in print media
 * (see `#print-root` in styles.css), so one left behind if `afterprint` never fires is harmless.
 */
export function printDiagram(viewport: HTMLElement, nodes: Node[], title: string, layout: PdfLayout) {
  cleanup();
  const copy = viewport.cloneNode(true) as HTMLElement;
  let pageSize: string;
  if (layout === 'visible') {
    // keep the on-screen pan/zoom transform; the page is the size of the canvas
    const canvas = viewport.closest<HTMLElement>('.react-flow') ?? viewport;
    pageSize = `${canvas.clientWidth}px ${canvas.clientHeight}px`;
  } else {
    const b = getNodesBounds(nodes);
    const landscape = b.width >= b.height;
    const pw = landscape ? A4.long : A4.short;
    const ph = landscape ? A4.short : A4.long;
    // shrink to fit, but don't blow small diagrams up; centered on the page
    const scale = Math.min(1, (pw - A4_MARGIN * 2) / b.width, (ph - A4_MARGIN * 2) / b.height);
    const tx = (pw - b.width * scale) / 2 - b.x * scale;
    const ty = (ph - b.height * scale) / 2 - b.y * scale;
    copy.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    pageSize = `A4 ${landscape ? 'landscape' : 'portrait'}`;
  }

  const root = document.createElement('div');
  root.id = 'print-root';
  // React Flow's stylesheet scopes its variables to .react-flow
  root.className = 'react-flow';
  root.append(copy);
  const page = document.createElement('style');
  page.id = 'print-page';
  page.textContent = `@page { size: ${pageSize}; margin: 0; }`;
  document.head.append(page);
  document.body.append(root);

  // the print dialog suggests the document title as the file name
  const prevTitle = document.title;
  document.title = title;
  window.addEventListener('afterprint', () => { cleanup(); document.title = prevTitle; }, { once: true });
  window.print();
}
