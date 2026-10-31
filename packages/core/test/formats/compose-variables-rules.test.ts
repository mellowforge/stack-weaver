import { describe, expect, it } from 'vitest';
import { parseText } from '../../src/document/parse.js';
import { composeFormat } from '../../src/formats/compose/index.js';
import type { Problem } from '../../src/validation/problems.js';
import { validateText } from '../../src/validation/validate.js';

const run = async (text: string, variables?: Parameters<typeof validateText>[2]): Promise<Problem[]> =>
  validateText(parseText(text), composeFormat, variables);
const rules = (ps: readonly Problem[], id?: string) =>
  ps.filter((p) => p.source === 'rule' && (id === undefined || p.code === `rule.${id}`));
const slice = (text: string, p: Problem): string => text.slice(p.from, p.to);

describe('undeclared-variable', () => {
  it('warns with the exact range and a declareVariable fix typed from the field', async () => {
    const text = 'services:\n  web:\n    image: nginx\n    ports:\n      - "${WEB_PORT}:80"\n    scale: ${N}\n';
    const ps = rules(await run(text));
    expect(ps.map((p) => [p.code, p.severity, p.message, slice(text, p)])).toEqual([
      ['rule.undeclared-variable', 'warning', 'Variable "WEB_PORT" is not declared.', '${WEB_PORT}'],
      ['rule.undeclared-variable', 'warning', 'Variable "N" is not declared.', '${N}'],
    ]);
    expect(ps[0]?.fix).toEqual({
      label: 'Declare variable WEB_PORT',
      action: { kind: 'declareVariable', decl: { name: 'WEB_PORT', type: 'string' } },
    });
    expect(ps[1]?.fix?.action).toEqual({ kind: 'declareVariable', decl: { name: 'N', type: 'number' } });
  });

  it('${X:-a} undeclared still warns; the fix carries default a', async () => {
    const text = 'services:\n  web:\n    image: ${IMG:-a}\n    scale: ${N:-3}\n';
    const ps = rules(await run(text), 'undeclared-variable');
    expect(ps.map((p) => p.fix?.action)).toEqual([
      { kind: 'declareVariable', decl: { name: 'IMG', type: 'string', default: 'a' } },
      { kind: 'declareVariable', decl: { name: 'N', type: 'number', default: 3 } },
    ]);
  });

  it('$$ and $${X} produce nothing', async () => {
    const ps = await run('services:\n  web:\n    image: nginx\n    command: echo $$HOME $${X}\n');
    expect(rules(ps)).toEqual([]);
  });

  it('CRLF text: the range covers exactly ${NAME}, plain and double-quoted', async () => {
    const text = 'services:\r\n  web:\r\n    image: nginx\r\n    command: a ${ONE} b\r\n    hostname: "x-${TWO}"\r\n';
    const ps = rules(await run(text), 'undeclared-variable');
    expect(ps.map((p) => slice(text, p))).toEqual(['${ONE}', '${TWO}']);
  });

  it('CRLF text: two placeholders in one single-quoted scalar each get their exact range', async () => {
    const text = "services:\r\n  web:\r\n    image: nginx\r\n    command: 'run ${A} with ''${B}'''\r\n";
    const ps = rules(await run(text), 'undeclared-variable');
    expect(ps.map((p) => slice(text, p))).toEqual(['${A}', '${B}']);
    expect(ps.map((p) => p.from)).toEqual([text.indexOf('${A}'), text.indexOf('${B}')]);
  });

  it.each([
    ['plain', 'echo $${X} ${X}', '${X}'],
    ['plain', 'echo $$HOME $HOME', '$HOME'],
    ['double-quoted', '"echo $${X} ${X}"', '${X}'],
    ['double-quoted', '"echo $$HOME $HOME"', '$HOME'],
  ])('%s: an escaped placeholder before a real one does not steal the range (%s)', async (_k, value, want) => {
    const text = `services:\n  web:\n    image: nginx\n    command: ${value}\n`;
    const ps = rules(await run(text), 'undeclared-variable');
    expect(ps.map((p) => slice(text, p))).toEqual([want]);
    expect(ps[0]?.from).toBe(text.indexOf(value) + value.lastIndexOf(want));
  });

  it('a placeholder inside x-variables is never reported', async () => {
    const text = 'x-variables:\n  A:\n    type: string\n    description: "use ${B}"\nservices:\n  web:\n    image: ${A}\n';
    expect(rules(await run(text))).toEqual([]);
  });

  it('is silent while the document cannot be read (a bad merge): only the yaml.data error shows', async () => {
    const text = 'x-base: &b 5\nservices:\n  web:\n    <<: *b\n    image: ${IMG}\n';
    const ps = await run(text);
    expect(ps.map((p) => p.code)).toEqual(['yaml.data']);
    // declarations from the host do not depend on the block: the warning stays
    expect(rules(await run(text, { variables: [] }), 'undeclared-variable')).toHaveLength(1);
  });

  it('falls back to the scalar range when the literal text is escaped away', async () => {
    const text = 'services:\n  web:\n    image: nginx\n    hostname: "\\x24{ESC}"\n';
    // "\x24{ESC}" has the value ${ESC} but the source never holds that text.
    const ps = rules(await run(text), 'undeclared-variable');
    expect(ps.map((p) => slice(text, p))).toEqual(['"\\x24{ESC}"']);
  });
});

describe('variable-default', () => {
  const doc = (inline: string) =>
    `x-variables:\n  TAG:\n    type: string\n    default: latest\nservices:\n  web:\n    image: nginx:\${TAG:-${inline}}\n`;

  it('an inline default that differs from the declared default warns; equal does not', async () => {
    const text = doc('1.0');
    const ps = rules(await run(text));
    expect(ps.map((p) => [p.code, p.severity, p.message, slice(text, p)])).toEqual([
      ['rule.variable-default', 'warning', 'The inline default "1.0" differs from the declared default "latest" of TAG.', '${TAG:-1.0}'],
    ]);
    expect(rules(await run(doc('latest')))).toEqual([]);
  });
});

describe('variable-declaration', () => {
  const text = [
    'x-variables:',
    '  OK:',
    '    type: string',
    '  BAD:',
    '    type: colour',
    '  S: 5',
    'services:',
    '  web:',
    '    image: ${OK}',
    '',
  ].join('\n');

  it('malformed block entries: one error each, at the node; valid ones still declare', async () => {
    const ps = rules(await run(text));
    expect(ps.map((p) => [p.code, p.severity, p.message, slice(text, p)])).toEqual([
      ['rule.variable-declaration', 'error', 'Invalid declaration of BAD: unknown type.', 'colour'],
      ['rule.variable-declaration', 'error', 'Invalid declaration of S: must be a mapping.', '5'],
    ]);
  });

  it('an enum without values (at the entry) and a default of the wrong type (at the default); valid siblings declare', async () => {
    const text = [
      'x-variables:',
      '  E:',
      '    type: enum',
      '  N:',
      '    type: number',
      '    default: abc',
      '  OK:',
      '    type: string',
      'services:',
      '  web:',
      '    image: ${OK}',
      '    hostname: ${E}',
      '',
    ].join('\n');
    const ps = rules(await run(text));
    expect(ps.map((p) => [p.code, p.message, slice(text, p)])).toEqual([
      ['rule.variable-declaration', 'Invalid declaration of E: an enum needs a list of values.', 'type: enum\n'],
      ['rule.variable-declaration', 'Invalid declaration of N: the default does not fit the type.', 'abc'],
      // E is not declared (it is malformed); OK is
      ['rule.undeclared-variable', 'Variable "E" is not declared.', '${E}'],
    ]);
  });

  it('a block that is not a mapping is one error at the block, and declares nothing', async () => {
    const text = 'x-variables: 5\nservices:\n  web:\n    image: ${A}\n';
    const ps = rules(await run(text));
    expect(ps.map((p) => [p.code, p.message, slice(text, p)])).toEqual([
      ['rule.variable-declaration', 'Invalid declaration of x-variables: must be a mapping.', '5'],
      ['rule.undeclared-variable', 'Variable "A" is not declared.', '${A}'],
    ]);
  });

  it('is silent when variables come from the host', async () => {
    const ps = rules(await run(text, { variables: [{ name: 'OK', type: 'string' }] }));
    expect(ps).toEqual([]);
  });

  it('reason texts are translatable through the reason keys', async () => {
    const ps = rules(await validateText(parseText(text), composeFormat, { messages: { 'variable-declaration.badType': () => 'Typ unbekannt' } }));
    expect(ps.map((p) => p.message)).toEqual([
      'Invalid declaration of BAD: Typ unbekannt.',
      'Invalid declaration of S: must be a mapping.',
    ]);
  });
});

describe('variable-type', () => {
  const doc = (type: string) => `x-variables:\n  V:\n    type: ${type}\nservices:\n  web:\n    image: nginx\n    scale: \${V}\n`;

  it('a boolean variable in scale is an error; a number variable is fine', async () => {
    const text = doc('boolean');
    const ps = rules(await run(text), 'variable-type');
    expect(ps.map((p) => [p.severity, p.message, slice(text, p)])).toEqual([
      ['error', 'V is a boolean variable, but this field takes integer.', '${V}'],
    ]);
    expect(rules(await run(doc('number')))).toEqual([]);
  });
});
