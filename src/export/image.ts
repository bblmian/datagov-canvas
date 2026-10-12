import { getNodesBounds, type Node } from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';

export type ImageFormat = 'png' | 'svg';

const PADDING = 40;

/**
 * Renders the whole diagram (not just the visible part) by re-transforming React Flow's
 * viewport element to the nodes' bounding box, the approach recommended by React Flow.
 */
export async function renderImage(viewport: HTMLElement, nodes: Node[], format: ImageFormat) {
  const b = getNodesBounds(nodes);
  const width = Math.ceil(b.width + PADDING * 2);
  const height = Math.ceil(b.height + PADDING * 2);
  const options = {
    backgroundColor: '#ffffff',
    width,
    height,
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${PADDING - b.x}px, ${PADDING - b.y}px) scale(1)` },
  };
  const dataUrl = format === 'png' ? await toPng(viewport, { ...options, pixelRatio: 2 }) : await toSvg(viewport, options);
  return { dataUrl, width, height };
}

export async function imageToPdf(pngDataUrl: string, width: number, height: number): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: width >= height ? 'landscape' : 'portrait', unit: 'px', format: [width, height], hotfixes: ['px_scaling'], compress: true });
  pdf.addImage(pngDataUrl, 'PNG', 0, 0, width, height, undefined, 'FAST');
  return pdf.output('blob');
}
