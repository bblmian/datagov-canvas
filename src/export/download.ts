/** Saves a file via a temporary <a download> — works in extension pages without the downloads permission. */
export function download(filename: string, data: Blob | string, mime = 'text/plain;charset=utf-8') {
  const isDataUrl = typeof data === 'string' && data.startsWith('data:');
  const url = isDataUrl ? (data as string) : URL.createObjectURL(typeof data === 'string' ? new Blob([data], { type: mime }) : data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (!isDataUrl) setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** File-system-safe version of a diagram name. */
export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'diagram';
