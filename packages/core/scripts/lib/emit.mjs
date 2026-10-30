// Compiles a JSON Schema into two ESM modules: the schema, and a precompiled ajv standalone
// validator (no `new Function` at runtime, so it works under a strict CSP).
import { gzipSync } from 'node:zlib';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import addFormats from 'ajv-formats';

/** Formats Kubernetes uses that ajv-formats does not define; accepted without checks. */
export const NOOP_FORMATS = ['int32', 'int64', 'double', 'byte'];

/** Creates the ajv instance used for one compiled module. Warnings (e.g. unknown formats) go to `warnings`. */
export function createAjv(warnings = []) {
  const ajv = new Ajv2020({
    code: { source: true, esm: true, optimize: true },
    strict: false,
    allErrors: true,
    inlineRefs: false, // one function per $def instead of inlining PodSpec everywhere
    messages: false, // messages are generated from keyword + params by the core
    logger: { log() {}, warn: (...m) => warnings.push(m.join(' ')), error: (...m) => warnings.push(m.join(' ')) },
  });
  addFormats(ajv);
  for (const f of NOOP_FORMATS) ajv.addFormat(f, true); // after ajv-formats, which defines checking versions
  return ajv;
}

/**
 * Compiles `schema` into two ESM modules, so each lazy chunk stays small:
 * - `schemaJs`: `export const schema` (the JSON Schema, descriptions included);
 * - `validateJs`: `export const validate` and `export default validate`, the precompiled ajv
 *   validator. CommonJS `require()` calls that ajv emits for its runtime helpers and for
 *   ajv-formats are rewritten into static ESM imports.
 * @param {Record<string, unknown>} schema
 * @param {{ header?: string }} [options]
 * @returns {{ schemaJs: string, schemaDts: string, validateJs: string, validateDts: string, warnings: string[] }}
 */
export function emitSchemaModules(schema, { header = '' } = {}) {
  const warnings = [];
  const ajv = createAjv(warnings);
  const validate = ajv.compile(schema);
  const code = dropUnusedSchemaConsts(standaloneCode(ajv, validate).replace(/^"use strict";\s*/, ''));
  const standalone = toEsmImports(code);
  return {
    schemaJs: `${header}export const schema = ${JSON.stringify(schema)};\n`,
    schemaDts: `${header}${SCHEMA_DTS}`,
    validateJs: `${header}${standalone.imports}${standalone.code}\n`,
    validateDts: `${header}${VALIDATE_DTS}`,
    warnings,
  };
}

/** Declarations of an emitted schema module. */
export const SCHEMA_DTS = `/** JSON Schema 2020-12 root, with \`$defs\`. */
export declare const schema: Record<string, unknown>;
`;

/** Declarations of an emitted validator module. */
export const VALIDATE_DTS = `/** Precompiled ajv validator; \`errors\` holds the last call's errors. */
export declare const validate: ((data: unknown) => boolean) & { errors?: unknown[] | null };
export default validate;
`;

/**
 * Removes `const schemaN = {…};` declarations that nothing references. ajv's standalone output
 * always serializes each compiled schema (for `$data`/`verbose`, which are off), duplicating the
 * exported `schema` several times over.
 * @param {string} code
 */
export function dropUnusedSchemaConsts(code) {
  let out = '';
  let pos = 0;
  const decl = /const (schema\d+) = /g;
  for (let m = decl.exec(code); m; m = decl.exec(code)) {
    const end = jsonLiteralEnd(code, m.index + m[0].length);
    if (code[end] !== ';') throw new Error(`emit: unexpected token after ${m[1]}`);
    const uses = code.match(new RegExp(`\\b${m[1]}\\b`, 'g'))?.length ?? 0;
    if (uses === 1) {
      out += code.slice(pos, m.index);
      pos = end + 1;
    }
    decl.lastIndex = end;
  }
  return out + code.slice(pos);
}

/** Index just past the JSON value starting at `start` (strings and nesting aware). */
function jsonLiteralEnd(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (c === '"') {
      for (i++; code[i] !== '"'; i++) if (code[i] === '\\') i++;
    } else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      if (--depth === 0) return i + 1;
    } else if (depth === 0 && (c === ';' || c === ',')) return i;
  }
  throw new Error('emit: unterminated literal');
}

/**
 * Hoists `require("m").prop` expressions into `import * as` statements with CJS interop.
 * `.default` is resolved for both Node (namespace `default` is `module.exports`) and bundlers
 * (namespace `default` is `exports.default` when `__esModule` is set).
 * @param {string} code
 */
export function toEsmImports(code) {
  /** @type {Map<string, string>} */
  const modules = new Map();
  /** @type {Map<string, string>} */
  const bindings = new Map();
  let imports = '';
  const out = code.replace(/require\("([^"]+)"\)(?:\.([A-Za-z_$][\w$]*))?/g, (_m, spec, prop) => {
    if (!prop) throw new Error(`emit: bare require("${spec}") in standalone code`);
    const key = `${spec}#${prop}`;
    let binding = bindings.get(key);
    if (!binding) {
      let ns = modules.get(spec);
      if (!ns) {
        ns = `__m${modules.size}`;
        modules.set(spec, ns);
        imports += `import * as ${ns} from ${JSON.stringify(withJsExtension(spec))};\n`;
      }
      binding = `__r${bindings.size}`;
      bindings.set(key, binding);
      imports +=
        prop === 'default'
          ? `const ${binding} = ${ns}.default && ${ns}.default.__esModule ? ${ns}.default.default : ${ns}.default;\n`
          : `const ${binding} = ${ns}.${prop};\n`;
    }
    return binding;
  });
  if (/\brequire\(/.test(out)) throw new Error('emit: unresolved require() left in standalone code');
  return { imports, code: out };
}

function withJsExtension(spec) {
  return /\.[cm]?js$/.test(spec) ? spec : `${spec}.js`;
}

/** Gzipped byte size of `text` (level 9), as used by the per-kind budget. */
export function gzipSize(text) {
  return gzipSync(text, { level: 9 }).length;
}
