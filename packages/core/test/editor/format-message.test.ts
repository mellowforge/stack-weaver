import { describe, expect, it } from 'vitest';
import { formatMessage, formatPlural } from '../../src/editor/format-message.js';
import type { PluralMessage } from '../../src/editor/format-message.js';
import { defaultUiMessages } from '../../src/editor/messages.js';

describe('formatMessage', () => {
  it('fills every occurrence of a parameter', () => {
    expect(formatMessage('Remove {label} ({label})', { label: 'port' })).toBe('Remove port (port)');
  });

  it('inserts parameter text literally (no re-expansion)', () => {
    expect(formatMessage('{a} and {b}', { a: '{b}', b: '{name}', name: 'x' })).toBe('{b} and {name}');
    expect(formatMessage('Hello {name}', { name: '{name}' })).toBe('Hello {name}');
    expect(formatMessage('{a}', { a: '$&' })).toBe('$&');
  });

  it('leaves unknown placeholders as written', () => {
    expect(formatMessage('{a} {missing} {}', { a: 1 })).toBe('1 {missing} {}');
    expect(formatMessage('no params {x}')).toBe('no params {x}');
  });

  it('does not read inherited properties as parameters', () => {
    expect(formatMessage('{toString} {constructor}', {})).toBe('{toString} {constructor}');
  });
});

describe('formatPlural', () => {
  const ru: PluralMessage = { one: '{count} файл', few: '{count} файла', many: '{count} файлов', other: '{count} файла' };

  it.each([
    [1, '1 файл'],
    [3, '3 файла'],
    [5, '5 файлов'],
    [21, '21 файл'],
  ])('ru: %i picks %s', (n, text) => {
    expect(formatPlural(ru, n, 'ru')).toBe(text);
  });

  it('an invalid locale tag falls back to English rules', () => {
    const m: PluralMessage = { one: 'one', other: 'other' };
    expect(formatPlural(m, 1, 'x')).toBe('one');
    expect(formatPlural(m, 2, '')).toBe('other');
  });

  it('uses other when the category is missing', () => {
    expect(formatPlural({ other: '{count} items' }, 1)).toBe('1 items');
  });

  it('none is used for 0 when given (R11)', () => {
    const m: PluralMessage = { none: 'None', one: '{count} problem', other: '{count} problems' };
    expect(formatPlural(m, 0)).toBe('None');
    expect(formatPlural({ one: '{count} problem', other: '{count} problems' }, 0)).toBe('0 problems');
  });

  it('zero is only the CLDR category: English never selects it, so 0 without none is other (R11)', () => {
    expect(formatPlural({ zero: 'Zero', other: '{count} problems' }, 0)).toBe('0 problems');
  });

  it.each([
    [0, 'nav'],
    [10, '10 zero'],
    [1, '1 one'],
    [2, '2 other'],
    [21, '21 one'],
  ])('lv with none and zero: %i picks %s (R11)', (n, text) => {
    const lv: PluralMessage = { none: 'nav', zero: '{count} zero', one: '{count} one', other: '{count} other' };
    expect(formatPlural(lv, n, 'lv')).toBe(text);
  });

  it('lv without none: 0 takes the CLDR zero category', () => {
    expect(formatPlural({ zero: '{count} zero', other: '{count} other' }, 0, 'lv')).toBe('0 zero');
  });

  it('the default problemCount reads No problems / 1 problem / 2 problems in English', () => {
    expect([0, 1, 2].map((n) => formatPlural(defaultUiMessages.problemCount, n))).toEqual(['No problems', '1 problem', '2 problems']);
  });

  it('passes extra params and lets count win', () => {
    expect(formatPlural({ other: '{count} of {total}' }, 2, 'en', { total: 5, count: 99 })).toBe('2 of 5');
  });
});
