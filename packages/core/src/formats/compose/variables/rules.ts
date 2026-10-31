import { isAlias, isMap, isScalar, isSeq } from 'yaml';
import { resolveAt } from '../../../engine/resolve.js';
import type { YamlPath } from '../../../document/types.js';
import { fieldTypes, fitsField, inferVariableType } from '../../../variables/fit.js';
import type { JsonSchema, Rule, RuleFinding, RuleInput, VariableDecl, VariableType } from '../../types.js';
import { VARIABLES_KEY, readBlock } from './block.js';
import { scanPlaceholders } from './syntax.js';
import type { Placeholder } from './syntax.js';

interface Site {
  readonly doc: number;
  readonly path: YamlPath;
  readonly value: string;
  readonly range: readonly [number, number];
  readonly holes: readonly Placeholder[];
}

/** Calls `visit` for every string scalar that holds a placeholder, skipping aliases and the variables block. */
function walk(input: RuleInput, visit: (site: Site) => void): void {
  const { parsed } = input;
  const go = (node: unknown, doc: number, path: YamlPath): void => {
    if (isAlias(node)) return;
    if (isScalar(node)) {
      if (typeof node.value !== 'string' || !node.range) return;
      const holes = scanPlaceholders(node.value);
      if (holes.length > 0) visit({ doc, path, value: node.value, range: [node.range[0], node.range[1]], holes });
    } else if (isMap(node)) {
      for (const pair of node.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : undefined;
        if (key === undefined || (path.length === 0 && key === VARIABLES_KEY)) continue;
        go(pair.value, doc, [...path, key]);
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, i) => go(item, doc, [...path, i]));
    }
  };
  for (let doc = 0; doc < parsed.docs.length; doc++) go(parsed.docs[doc]?.contents, doc, []);
}

interface Located {
  readonly ph: Placeholder;
  readonly range: { readonly from: number; readonly to: number };
}

/** The first index of `literal` from `from` that is not preceded by an odd run of `$` (an escaped `$`). */
function indexOfUnescaped(source: string, literal: string, from: number): number {
  for (let at = source.indexOf(literal, from); at >= 0; at = source.indexOf(literal, at + 1)) {
    let run = 0;
    while (at - run > 0 && source[at - run - 1] === '$') run++;
    if (run % 2 === 0) return at;
  }
  return -1;
}

/** Each placeholder of a site with its range in the source: its own text, else the whole scalar. */
function located(input: RuleInput, site: Site): Located[] {
  const source = input.parsed.text.slice(site.range[0], site.range[1]);
  let cursor = 0;
  return site.holes.map((ph) => {
    const literal = site.value.slice(ph.start, ph.end);
    const at = indexOfUnescaped(source, literal, cursor);
    if (at < 0) return { ph, range: { from: site.range[0], to: site.range[1] } };
    cursor = at + literal.length;
    return { ph, range: { from: site.range[0] + at, to: site.range[0] + cursor } };
  });
}

const isWhole = (site: Site, ph: Placeholder): boolean => ph.start === 0 && ph.end === site.value.length;

function fieldSchema(input: RuleInput, site: Site): JsonSchema | undefined {
  const bundle = input.bundles[site.doc];
  if (!bundle) return undefined;
  return resolveAt(bundle, site.path, input.data[site.doc])?.schema;
}

/** The inline default of a placeholder as the type the fix declares; `undefined` when there is none or it does not fit. */
function inlineDefault(ph: Placeholder, type: VariableType): string | number | boolean | undefined {
  if ((ph.op !== ':-' && ph.op !== '-') || ph.arg === undefined || ph.arg.includes('$')) return undefined;
  if (type === 'number') {
    const n = Number(ph.arg);
    return ph.arg.trim() !== '' && Number.isFinite(n) ? n : undefined;
  }
  if (type === 'boolean') return ph.arg === 'true' ? true : ph.arg === 'false' ? false : undefined;
  return ph.arg;
}

const byName = (decls: readonly VariableDecl[]): Map<string, VariableDecl> => new Map(decls.map((d) => [d.name, d]));

const undeclared: Rule = {
  id: 'undeclared-variable',
  messages: {
    'rule.undeclared-variable': (e) => `Variable "${String(e.params['name'])}" is not declared.`,
    'fix.declare-variable': (e) => `Declare variable ${String(e.params['name'])}`,
  },
  check(input) {
    const known = byName(input.variables);
    const out: RuleFinding[] = [];
    walk(input, (site) => {
      for (const { ph, range } of located(input, site)) {
        if (known.has(ph.name)) continue;
        const schema = isWhole(site, ph) ? fieldSchema(input, site) : undefined;
        const type = schema ? inferVariableType(schema) : 'string';
        const def = inlineDefault(ph, type);
        out.push({
          severity: 'warning',
          doc: site.doc,
          path: site.path,
          range,
          params: { name: ph.name },
          fix: {
            key: 'fix.declare-variable',
            params: { name: ph.name },
            action: {
              kind: 'declareVariable',
              decl: { name: ph.name, type, ...(def !== undefined ? { default: def as string } : {}) },
            },
          },
        });
      }
    });
    return out;
  },
};

const variableDefault: Rule = {
  id: 'variable-default',
  messages: {
    'rule.variable-default': (e) =>
      `The inline default "${String(e.params['inline'])}" differs from the declared default "${String(e.params['declared'])}" of ${String(e.params['name'])}.`,
  },
  check(input) {
    const known = byName(input.variables);
    const out: RuleFinding[] = [];
    walk(input, (site) => {
      for (const { ph, range } of located(input, site)) {
        const decl = known.get(ph.name);
        if (!decl || decl.default === undefined || ph.arg === undefined) continue;
        if (ph.op !== ':-' && ph.op !== '-') continue;
        if (String(decl.default) === ph.arg) continue;
        out.push({
          severity: 'warning',
          doc: site.doc,
          path: site.path,
          range,
          params: { inline: ph.arg, declared: String(decl.default), name: ph.name },
        });
      }
    });
    return out;
  },
};

const REASONS: Record<string, string> = {
  notMapping: 'must be a mapping',
  badName: 'invalid name',
  badType: 'unknown type',
  noEnumValues: 'an enum needs a list of values',
  badDefault: 'the default does not fit the type',
  badField: 'unknown or misplaced field',
};

const variableDeclaration: Rule = {
  id: 'variable-declaration',
  messages: {
    'rule.variable-declaration': (e) => `Invalid declaration of ${String(e.params['name'])}: ${String(e.params['reason'])}.`,
    ...Object.fromEntries(Object.entries(REASONS).map(([k, text]) => [`variable-declaration.${k}`, () => text])),
  },
  check(input) {
    if (input.variableSource !== 'document') return [];
    return readBlock(input.parsed).issues.map((issue) => ({
      severity: 'error' as const,
      doc: 0,
      path: issue.path,
      params: { name: issue.name, reason: input.message(`variable-declaration.${issue.reason}`) },
    }));
  },
};

const variableType: Rule = {
  id: 'variable-type',
  messages: {
    'rule.variable-type': (e) =>
      `${String(e.params['name'])} is a ${String(e.params['type'])} variable, but this field takes ${String(e.params['expected'])}.`,
  },
  check(input) {
    const known = byName(input.variables);
    const out: RuleFinding[] = [];
    walk(input, (site) => {
      const [ph] = site.holes;
      if (!ph || site.holes.length !== 1 || !isWhole(site, ph)) return;
      const decl = known.get(ph.name);
      const schema = decl ? fieldSchema(input, site) : undefined;
      if (!decl || !schema || fitsField(decl, schema)) return;
      const at = located(input, site)[0];
      if (!at) return;
      out.push({
        severity: 'error',
        doc: site.doc,
        path: site.path,
        range: at.range,
        params: { name: decl.name, type: decl.type, expected: [...fieldTypes(schema)].join(' or ') },
      });
    });
    return out;
  },
};

/** The semantic rules of compose variables: undeclared use, default clashes, bad declarations, type misfits. */
export const composeRules: readonly Rule[] = [undeclared, variableDefault, variableDeclaration, variableType];
