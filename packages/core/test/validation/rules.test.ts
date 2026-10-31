import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseText } from '../../src/document/parse.js';
import type {
  FormatDefinition,
  FormatVariables,
  Rule,
  RuleInput,
  SchemaBundle,
  SchemaError,
  VariableDecl,
} from '../../src/formats/types.js';
import { validateText } from '../../src/validation/validate.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A bundle whose validator reports `type` errors for `integer` properties holding non-integers. */
function bundle(schema: Record<string, unknown> = {}): SchemaBundle {
  const props = (schema['properties'] ?? {}) as Record<string, { type?: string }>;
  return {
    id: 'fake',
    schema,
    validate: (data) => {
      const errors: SchemaError[] = [];
      for (const [k, def] of Object.entries(props)) {
        const v = (data as Record<string, unknown> | undefined)?.[k];
        if (def.type === 'integer' && v !== undefined && !Number.isInteger(v)) {
          errors.push({ instancePath: `/${k}`, keyword: 'type', params: { type: 'integer' } });
        }
      }
      return errors;
    },
  };
}

function fake(extra: Partial<FormatDefinition> = {}, rootModel: 'mapping' | 'documents' = 'mapping', b = bundle()): FormatDefinition {
  return {
    id: 'fake',
    label: 'Fake',
    version: '0',
    rootModel,
    detect: () => true,
    kinds: () => [],
    loadSchema: async () => b,
    guide: { groups: [], kinds: {}, fields: {} },
    ...extra,
  };
}

const rule = (check: Rule['check'], messages: Rule['messages'] = { 'rule.demo': (e) => `bad ${String(e.params['x'])}` }): Rule => ({
  id: 'demo',
  messages,
  check,
});

describe('rules in validateText', () => {
  it('maps a value finding to the value range, with code rule.<id> and source rule', async () => {
    const r = rule(() => [{ severity: 'warning', doc: 0, path: ['a'], params: { x: 1 } }]);
    const probs = await validateText(parseText('a: 5\n'), fake({ rules: [r] }));
    expect(probs).toEqual([
      expect.objectContaining({ source: 'rule', code: 'rule.demo', message: 'bad 1', from: 3, to: 4, severity: 'warning', doc: 0, path: ['a'], line: 1, col: 4 }),
    ]);
  });

  it("at: 'key' points at the key", async () => {
    const r = rule(() => [{ severity: 'error', doc: 0, path: ['a'], at: 'key', params: { x: 1 } }]);
    const [p] = await validateText(parseText('a: 5\n'), fake({ rules: [r] }));
    expect([p!.from, p!.to]).toEqual([0, 1]);
  });

  it('range wins over path', async () => {
    const r = rule(() => [{ severity: 'error', doc: 0, path: ['a'], at: 'key', range: { from: 2, to: 4 }, params: { x: 1 } }]);
    const [p] = await validateText(parseText('a: 5\n'), fake({ rules: [r] }));
    expect([p!.from, p!.to]).toEqual([2, 4]);
  });

  it('a missing path maps to the nearest existing ancestor', async () => {
    const r = rule(() => [{ severity: 'error', doc: 0, path: ['a', 'b', 'c'], params: { x: 1 } }]);
    const text = 'a:\n  k: 1\n';
    const [p] = await validateText(parseText(text), fake({ rules: [r] }));
    const from = text.indexOf('k: 1');
    expect([p!.from, p!.to]).toEqual([from, text.length]);
    expect(p!.path).toEqual(['a', 'b', 'c']);
  });

  it('host messages override rule defaults by code', async () => {
    const r = rule(() => [{ severity: 'error', doc: 0, path: ['a'], params: { x: 1 } }]);
    const opts = { messages: { 'rule.demo': (e: SchemaError) => `host ${String(e.params['x'])}` } };
    const [p] = await validateText(parseText('a: 5\n'), fake({ rules: [r] }), opts);
    expect(p!.message).toBe('host 1');
    const [q] = await validateText(parseText('a: 5\n'), fake({ rules: [r] }), {
      messages: {
        'rule.demo': () => {
          throw new Error('boom');
        },
      },
    });
    expect(q!.message).toBe('bad 1'); // a throwing override falls back to the rule default
  });

  it('turns fix into Problem.fix with a label from the fix key', async () => {
    const action = { kind: 'edit', ops: [] } as const;
    const r = rule(
      () => [{ severity: 'error', doc: 0, path: ['a'], params: { x: 1 }, fix: { key: 'fix.demo', params: { n: 'X' }, action } }],
      { 'rule.demo': () => 'bad', 'fix.demo': (e) => `Fix ${String(e.params['n'])}` },
    );
    const [p] = await validateText(parseText('a: 5\n'), fake({ rules: [r] }));
    expect(p!.fix).toEqual({ label: 'Fix X', action });
  });

  it('a throwing rule becomes one rule.failed error, logged with its stack, and other rules still run', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('nope');
    const boom: Rule = {
      id: 'boom',
      messages: {},
      check: () => {
        throw err;
      },
    };
    const ok = rule(() => [{ severity: 'info', doc: 0, path: ['a'], params: { x: 2 } }]);
    const probs = await validateText(parseText('a: 5\n'), fake({ rules: [boom, ok] }));
    expect(probs.filter((x) => x.code === 'rule.failed')).toEqual([
      expect.objectContaining({ severity: 'error', source: 'rule', doc: 0, message: 'The “boom” check failed to run: nope' }),
    ]);
    expect(probs.some((x) => x.code === 'rule.demo')).toBe(true);
    expect(log.mock.calls).toEqual([['stack-weaver: rule "boom" failed', err]]);
  });

  it('rules do not run while the text does not parse', async () => {
    let ran = false;
    const r = rule(() => {
      ran = true;
      return [];
    });
    const probs = await validateText(parseText('a: [1\n'), fake({ rules: [r] }));
    expect(ran).toBe(false);
    expect(probs.length).toBeGreaterThan(0);
  });

  it('rules see data for every non-empty document and the loaded bundles', async () => {
    const b = bundle({ properties: {} });
    let seen: RuleInput | undefined;
    const r = rule((i) => {
      seen = i;
      return [];
    });
    const fmt = fake({ rules: [r] }, 'documents', b);
    await validateText(parseText('a: 1\n---\n---\nb: 2\n'), fmt);
    expect(seen!.data).toEqual([{ a: 1 }, undefined, { b: 2 }]);
    expect(seen!.bundles).toEqual([b, undefined, b]);
    expect(seen!.parsed.ok).toBe(true);
    expect(seen!.variables).toEqual([]);
    expect(seen!.variableSource).toBe('document');
  });

  it('data and bundles are dense: one entry per document, undefined for empty ones at either end', async () => {
    const b = bundle({ properties: {} });
    let seen: RuleInput | undefined;
    const r = rule((i) => {
      seen = i;
      return [];
    });
    const p = parseText('---\n---\na: 1\n---\n');
    expect(p.docs).toHaveLength(3);
    await validateText(p, fake({ rules: [r] }, 'documents', b));
    expect(seen!.data).toStrictEqual([undefined, { a: 1 }, undefined]);
    expect(seen!.bundles).toStrictEqual([undefined, b, undefined]);
  });

  describe('variables', () => {
    const schema = { properties: { n: { type: 'integer' } } };
    const vars = (substitute: FormatVariables['substitute'], read: FormatVariables['read'] = () => []): FormatVariables => ({
      key: 'x-variables',
      read,
      writeOps: () => undefined,
      removeOps: () => [],
      referenceOf: () => undefined,
      reference: (n) => `\${${n}}`,
      substitute,
    });

    it('variables.substitute data reaches the validator; errors at skip paths are dropped', async () => {
      const text = 'n: ${N}\n';
      const base = { loadSchema: async () => bundle(schema) };
      const sub = vars((d) => ({ data: { ...(d as object), n: 7 }, skip: [] }));
      expect(await validateText(parseText(text), fake({ ...base, variables: sub }))).toEqual([]);

      const skip = vars((d) => ({ data: d, skip: [['n']] }));
      expect(await validateText(parseText(text), fake({ ...base, variables: skip }))).toEqual([]);

      const none = vars((d) => ({ data: d, skip: [] }));
      const probs = await validateText(parseText(text), fake({ ...base, variables: none }));
      expect(probs.map((x) => x.code)).toEqual(['schema.type']);
    });

    it('skip paths drop errors beneath them too', async () => {
      const deep: SchemaBundle = {
        id: 'deep',
        schema: {},
        validate: () => [{ instancePath: '/n/0', keyword: 'type', params: { type: 'integer' } }],
      };
      const skip = vars((d) => ({ data: d, skip: [['n']] }));
      const fmt = fake({ loadSchema: async () => deep, variables: skip });
      expect(await validateText(parseText('n: [x]\n'), fmt)).toEqual([]);
    });

    it('decls come from opts.variables (variableSource host) or format.variables.read (document)', async () => {
      const decl: VariableDecl = { name: 'A', type: 'string' };
      const inDoc: VariableDecl = { name: 'B', type: 'number' };
      const seen: RuleInput[] = [];
      const r = rule((i) => {
        seen.push(i);
        return [];
      });
      const subs: VariableDecl[][] = [];
      const v = vars(
        (d, decls) => {
          subs.push([...decls]);
          return { data: d, skip: [] };
        },
        () => [inDoc],
      );
      const fmt = fake({ rules: [r], variables: v });
      await validateText(parseText('a: 1\n'), fmt);
      await validateText(parseText('a: 1\n'), fmt, { variables: [decl] });
      expect(seen.map((i) => [i.variables, i.variableSource])).toEqual([
        [[inDoc], 'document'],
        [[decl], 'host'],
      ]);
      expect(subs).toEqual([[inDoc], [decl]]);
    });
  });

  it('problems from rules sort with the others by offset then severity', async () => {
    const schemaFmt = fake({ loadSchema: async () => bundle({ properties: { n: { type: 'integer' } } }) });
    const r = rule(() => [
      { severity: 'info', doc: 0, path: ['n'], params: { x: 1 } },
      { severity: 'warning', doc: 0, path: ['n'], params: { x: 2 } },
      { severity: 'error', doc: 0, path: [], range: { from: 0, to: 1 }, params: { x: 3 } },
    ]);
    const probs = await validateText(parseText('n: s\n'), { ...schemaFmt, rules: [r] });
    expect(probs.map((x) => [x.from, x.code, x.severity])).toEqual([
      [0, 'rule.demo', 'error'],
      [3, 'schema.type', 'error'],
      [3, 'rule.demo', 'warning'],
      [3, 'rule.demo', 'info'],
    ]);
  });
});

describe('RuleInput.message', () => {
  const probe = async (messages?: Record<string, () => string>) => {
    const seen: string[] = [];
    const r: Rule = {
      id: 'demo',
      messages: { 'rule.demo': () => 'x', 'demo.part': (e) => `default ${String(e.params['v'])}` },
      check: (input) => {
        seen.push(input.message('demo.part', { v: 1 }), input.message('demo.missing'));
        return [];
      },
    };
    await validateText(parseText('a: 1\n'), fake({ rules: [r] }), messages ? { messages } : {});
    return seen;
  };

  it('uses the rule default, and an unknown key gives the key', async () => {
    expect(await probe()).toEqual(['default 1', 'demo.missing']);
  });

  it('a host override wins', async () => {
    expect(await probe({ 'demo.part': () => 'host' })).toEqual(['host', 'demo.missing']);
  });
});
