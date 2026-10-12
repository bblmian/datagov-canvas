// Finds where an element is declared in the DBML source, so clicking a table on the canvas can
// reveal its definition in the editor. A text search is enough: @dbml/core's normalized model
// carries no source positions.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ident = (name: string) => `(?:"${escape(name)}"|${escape(name)})`;

/** 0-based character offset of the `Table …` / `TableGroup …` / `Note …` line, or -1. */
export function locateDeclaration(source: string, kind: 'Table' | 'TableGroup' | 'Note' | 'Enum', name: string, schema?: string): number {
  const qualified = schema ? `${ident(schema)}\\s*\\.\\s*${ident(name)}` : `(?:${ident('public')}\\s*\\.\\s*)?${ident(name)}`;
  const re = new RegExp(`^[ \\t]*${kind}[ \\t]+${qualified}(?=[\\s\\[{]|$)`, 'im');
  const m = re.exec(source);
  return m ? m.index + (m[0].length - m[0].trimStart().length) : -1;
}
