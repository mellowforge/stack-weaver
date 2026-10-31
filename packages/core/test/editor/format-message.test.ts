import { describe, expect, it } from 'vitest';
import { formatMessage, formatPlural } from '../../src/editor/format-message.js';
import type { PluralMessage } from '../../src/editor/format-message.js';

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

  it('uses other when the category is missing', () => {
    expect(formatPlural({ other: '{count} items' }, 1)).toBe('1 items');
  });

  it('zero is used for 0 when given', () => {
    const m: PluralMessage = { zero: 'None', one: '{count} problem', other: '{count} problems' };
    expect(formatPlural(m, 0)).toBe('None');
    expect(formatPlural({ one: '{count} problem', other: '{count} problems' }, 0)).toBe('0 problems');
  });

  it('passes extra params and lets count win', () => {
    expect(formatPlural({ other: '{count} of {total}' }, 2, 'en', { total: 5, count: 99 })).toBe('2 of 5');
  });
});
