import { describe, expect, it } from 'vitest';
import { messages, translate } from './i18n';

describe('i18n', () => {
  it('has the same keys and placeholders in every language', () => {
    const keys = Object.keys(messages.en);
    expect(Object.keys(messages.zh).sort()).toEqual([...keys].sort());
    for (const k of keys as (keyof typeof messages.en)[]) {
      const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(vars(messages.zh[k]), k).toEqual(vars(messages.en[k]));
    }
  });

  it('interpolates variables', () => {
    expect(translate('zh', 'editor.line', { line: 3 })).toBe('第 3 行');
  });
});
