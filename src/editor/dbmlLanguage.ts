import { StreamLanguage, type StringStream } from '@codemirror/language';

// Lightweight DBML highlighter. Parsing/validation is done by @dbml/core in the worker;
// this only colors tokens.

const BLOCK_KEYWORDS = new Set(['table', 'ref', 'enum', 'tablegroup', 'project', 'note', 'indexes', 'tablepartial', 'records', 'checks']);
const SETTINGS = new Set([
  'pk', 'primary', 'key', 'null', 'not', 'unique', 'increment', 'default', 'note', 'ref', 'as', 'headercolor', 'color',
  'name', 'type', 'delete', 'update', 'cascade', 'restrict', 'set', 'action', 'no', 'database_type', 'true', 'false',
]);

interface State {
  inBlockComment: boolean;
  inTripleString: boolean;
  /** inside [ ... ] settings */
  bracketDepth: number;
}

export const dbml = StreamLanguage.define<State>({
  name: 'dbml',
  startState: () => ({ inBlockComment: false, inTripleString: false, bracketDepth: 0 }),
  token(stream: StringStream, state: State) {
    if (state.inBlockComment) {
      if (stream.skipTo('*/')) {
        stream.match('*/');
        state.inBlockComment = false;
      } else stream.skipToEnd();
      return 'comment';
    }
    if (state.inTripleString) {
      if (stream.skipTo("'''")) {
        stream.match("'''");
        state.inTripleString = false;
      } else stream.skipToEnd();
      return 'string';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('/*')) {
      state.inBlockComment = true;
      return 'comment';
    }
    if (stream.match("'''")) {
      state.inTripleString = true;
      return 'string';
    }
    if (stream.match(/^'(?:[^'\\]|\\.)*'?/)) return 'string';
    if (stream.match(/^`[^`]*`?/)) return 'string.special';
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'variableName.special';
    if (stream.match(/^#[0-9a-fA-F]{3,8}\b/)) return 'atom';
    if (stream.match(/^-?\d+(\.\d+)?/)) return 'number';
    if (stream.match(/^(<>|[<>-])/)) return 'operator';
    const ch = stream.peek();
    if (ch === '[') {
      stream.next();
      state.bracketDepth++;
      return 'bracket';
    }
    if (ch === ']') {
      stream.next();
      state.bracketDepth = Math.max(0, state.bracketDepth - 1);
      return 'bracket';
    }
    if (stream.match(/^[A-Za-z_][\w]*/)) {
      const word = stream.current().toLowerCase();
      if (state.bracketDepth > 0) return SETTINGS.has(word) ? 'keyword' : 'variableName';
      // block keywords only count at the start of a line (column 0 after indentation)
      if (BLOCK_KEYWORDS.has(word) && stream.start === stream.indentation()) return 'keyword';
      if (word === 'as') return 'keyword';
      // second word on a column line is its type
      const before = stream.string.slice(0, stream.start).trim();
      if (before && /^[\w"]+$/.test(before) && stream.indentation() > 0) return 'typeName';
      return 'variableName';
    }
    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '[', '{', "'", '"', '`'] },
  },
});
