import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

// UI strings. The extension name/description shown by Chrome itself live in public/_locales/
// instead, because chrome.i18n cannot switch language at runtime and this UI can.

export type Lang = 'en' | 'zh';

const en = {
  'app.title': 'DBML Studio',
  'diagram.untitled': 'Untitled diagram',
  'diagram.list': 'My diagrams',
  'diagram.new': 'New diagram',
  'diagram.open': 'Open',
  'diagram.rename': 'Rename',
  'diagram.duplicate': 'Duplicate',
  'diagram.delete': 'Delete',
  'diagram.deleteConfirm': 'Delete “{name}”? This cannot be undone.',
  'diagram.copySuffix': '(copy)',
  'diagram.updated': 'Updated {time}',
  'diagram.saved': 'Saved',
  'diagram.saving': 'Saving…',
  'menu.import': 'Import',
  'menu.export': 'Export',
  'menu.help': 'DBML syntax',
  'menu.language': '中文',
  'export.png': 'PNG image',
  'export.svg': 'SVG image',
  'export.pdf': 'PDF document',
  'export.dbml': 'DBML file',
  'export.postgres': 'PostgreSQL',
  'export.mysql': 'MySQL',
  'export.mssql': 'SQL Server',
  'export.oracle': 'Oracle',
  'export.json': 'JSON',
  'export.images': 'Image',
  'export.code': 'Code',
  'export.failed': 'Export failed: {msg}',
  'export.fixErrors': 'Fix the DBML errors before exporting.',
  'import.title': 'Import into DBML',
  'import.format': 'Source format',
  'import.placeholder': 'Paste SQL DDL (CREATE TABLE …) here, or choose a file.',
  'import.file': 'Choose file…',
  'import.asNew': 'Create a new diagram',
  'import.replace': 'Replace current diagram',
  'import.submit': 'Import',
  'import.cancel': 'Cancel',
  'import.failed': 'Import failed: {msg}',
  'import.done': 'Imported',
  'import.dbmlFile': 'DBML file',
  'editor.errors': '{count} error(s)',
  'editor.ok': 'No errors',
  'editor.line': 'Line {line}',
  'editor.collapse': 'Hide editor',
  'editor.expand': 'Show editor',
  'canvas.zoomIn': 'Zoom in',
  'canvas.zoomOut': 'Zoom out',
  'canvas.fit': 'Fit to screen',
  'canvas.autoLayout': 'Auto-arrange',
  'canvas.minimap': 'Mini map',
  'canvas.display': 'Show',
  'canvas.display.all': 'All fields',
  'canvas.display.keys': 'Key fields only',
  'canvas.display.names': 'Table names only',
  'canvas.empty': 'Define a table in the editor to start drawing, e.g. Table users { id int [pk] }',
  'canvas.staleModel': 'Showing the last valid version — fix the errors to update the diagram.',
  'canvas.broken': 'The DBML has errors — fix them (see the bottom of the editor) to draw the diagram.',
  'table.pk': 'Primary key',
  'table.notNull': 'Not null',
  'table.unique': 'Unique',
  'table.increment': 'Auto increment',
  'table.default': 'Default',
  'table.enumValues': 'Enum values',
  'table.fields': '{count} fields',
  'loading': 'Loading…',
};

export type MessageKey = keyof typeof en;

const zh: Record<MessageKey, string> = {
  'app.title': 'DBML Studio',
  'diagram.untitled': '未命名关系图',
  'diagram.list': '我的关系图',
  'diagram.new': '新建关系图',
  'diagram.open': '打开',
  'diagram.rename': '重命名',
  'diagram.duplicate': '复制',
  'diagram.delete': '删除',
  'diagram.deleteConfirm': '确定删除“{name}”吗？删除后无法恢复。',
  'diagram.copySuffix': '（副本）',
  'diagram.updated': '更新于 {time}',
  'diagram.saved': '已保存',
  'diagram.saving': '保存中…',
  'menu.import': '导入',
  'menu.export': '导出',
  'menu.help': 'DBML 语法',
  'menu.language': 'EN',
  'export.png': 'PNG 图片',
  'export.svg': 'SVG 矢量图',
  'export.pdf': 'PDF 文档',
  'export.dbml': 'DBML 文件',
  'export.postgres': 'PostgreSQL',
  'export.mysql': 'MySQL',
  'export.mssql': 'SQL Server',
  'export.oracle': 'Oracle',
  'export.json': 'JSON',
  'export.images': '图片',
  'export.code': '代码',
  'export.failed': '导出失败：{msg}',
  'export.fixErrors': '请先修正 DBML 中的错误再导出。',
  'import.title': '导入为 DBML',
  'import.format': '来源格式',
  'import.placeholder': '在此粘贴 SQL 建表语句（CREATE TABLE …），或选择文件。',
  'import.file': '选择文件…',
  'import.asNew': '新建一个关系图',
  'import.replace': '替换当前关系图',
  'import.submit': '导入',
  'import.cancel': '取消',
  'import.failed': '导入失败：{msg}',
  'import.done': '导入成功',
  'import.dbmlFile': 'DBML 文件',
  'editor.errors': '{count} 个错误',
  'editor.ok': '没有错误',
  'editor.line': '第 {line} 行',
  'editor.collapse': '隐藏编辑器',
  'editor.expand': '显示编辑器',
  'canvas.zoomIn': '放大',
  'canvas.zoomOut': '缩小',
  'canvas.fit': '适应屏幕',
  'canvas.autoLayout': '自动排列',
  'canvas.minimap': '小地图',
  'canvas.display': '显示',
  'canvas.display.all': '全部字段',
  'canvas.display.keys': '仅键字段',
  'canvas.display.names': '仅表名',
  'canvas.empty': '在左侧编辑器里定义一张表即可开始绘图，例如 Table users { id int [pk] }',
  'canvas.staleModel': '当前显示的是上一个有效版本，修正错误后关系图会自动更新。',
  'canvas.broken': 'DBML 中有错误（见编辑器底部），修正后即可绘图。',
  'table.pk': '主键',
  'table.notNull': '非空',
  'table.unique': '唯一',
  'table.increment': '自增',
  'table.default': '默认值',
  'table.enumValues': '枚举值',
  'table.fields': '{count} 个字段',
  'loading': '加载中…',
};

export const messages: Record<Lang, Record<MessageKey, string>> = { en, zh };

export function detectLang(): Lang {
  const l = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase();
  return l.startsWith('zh') ? 'zh' : 'en';
}

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>) {
  let s = messages[lang][key] ?? messages.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;
const I18nContext = createContext<{ lang: Lang; t: Translate }>({ lang: 'en', t: (k, v) => translate('en', k, v) });

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const t = useCallback<Translate>((k, v) => translate(lang, k, v), [lang]);
  const value = useMemo(() => ({ lang, t }), [lang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
