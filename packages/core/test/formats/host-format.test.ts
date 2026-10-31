// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseText } from '../../src/document/parse.js';
import { loaders } from '../../src/editor/context.js';
import { createManifestEditor } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import { detectFormat } from '../../src/formats/registry.js';
import type { FormatDefinition, Rule, SchemaBundle } from '../../src/formats/types.js';
import { validateText } from '../../src/validation/validate.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const TEXT = 'pipeline:\n  name: build\n  steps:\n    - run: make\n';
const bundle: SchemaBundle = { id: 'pipeline', schema: {}, validate: () => [] };

/** Written with the public API only: no yaml, no ParsedText reads. */
const stepsRule: Rule = {
  id: 'steps',
  messages: { 'rule.steps': () => 'Check the step.' },
  check(input) {
    const pipeline = isRecord(input.data[0]) ? input.data[0]['pipeline'] : undefined;
    if (!isRecord(pipeline) || !Array.isArray(pipeline['steps'])) return [];
    const range = input.locate(0, ['pipeline', 'steps', 0]);
    return range ? [{ severity: 'warning', doc: 0, path: ['pipeline', 'steps', 0], range }] : [];
  },
};

const pipelineFormat: FormatDefinition = {
  id: 'pipeline',
  label: 'Pipeline',
  version: '1',
  rootModel: 'mapping',
  detect: (input) => input.docs.some((d) => isRecord(d) && 'pipeline' in d),
  kinds: () => [],
  loadSchema: async () => bundle,
  guide: { groups: [], kinds: {}, fields: {} },
  rules: [stepsRule],
};

describe('a host format written with the public API only', () => {
  it('detects, validates and ranges a rule finding', async () => {
    const p = parseText(TEXT);
    expect(detectFormat(p, [kubernetesFormat, pipelineFormat])).toBe(pipelineFormat);
    const problems = await validateText(p, pipelineFormat);
    expect(problems.map((x) => x.code)).toEqual(['rule.steps']);
    expect(TEXT.slice(problems[0]!.from, problems[0]!.to).trimEnd()).toBe('run: make');
  });
});

describe('a host format in the editor, end to end (B7)', () => {
  async function editorWith(options: ManifestEditorOptions) {
    const el = document.createElement('div');
    document.body.append(el);
    const onProblemsChange = vi.fn();
    const editor = createManifestEditor(el, { codeEditor: createFakeAdapter(), formats: [pipelineFormat], value: TEXT, onProblemsChange, ...options });
    await editor.ready;
    return { el, editor, onProblemsChange };
  }

  it('format "auto": the host format is detected first, badged and validated', async () => {
    const builtins = vi.spyOn(loaders, 'loadBuiltinFormats');
    const { el, editor } = await editorWith({ format: 'auto' });
    expect(editor.getFormat()).toBe('auto');
    expect(editor.getActiveFormat()).toBe('pipeline');
    expect(el.querySelector('.sw-format-badge')!.textContent).toBe('Pipeline 1');
    expect(editor.getProblems().map((p) => p.code)).toEqual(['rule.steps']);
    // 'auto' may detect a built-in format too, so it loads them (behind the host formats).
    expect(builtins).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it('format "pipeline": resolves without loading the built-in formats', async () => {
    const builtins = vi.spyOn(loaders, 'loadBuiltinFormats');
    const { el, editor, onProblemsChange } = await editorWith({ format: 'pipeline' });
    expect(editor.getActiveFormat()).toBe('pipeline');
    expect(el.querySelector('.sw-format-badge')!.textContent).toBe('Pipeline 1');
    expect(editor.getProblems().map((p) => p.code)).toEqual(['rule.steps']);
    expect(onProblemsChange).toHaveBeenCalledWith(editor.getProblems());
    expect(builtins).not.toHaveBeenCalled();
    editor.destroy();
  });
});

describe('detect and loadSchema receive plain data', () => {
  it('detect receives undefined for an empty or unbuildable document', () => {
    const seen: unknown[][] = [];
    const f: FormatDefinition = { ...pipelineFormat, detect: (input) => (seen.push([...input.docs]), false) };
    detectFormat(parseText('---\n# nothing\n---\nx: {<<: 5}\n---\npipeline: {}\n'), [f]);
    expect(seen[0]).toEqual([undefined, undefined, { pipeline: {} }]);
  });

  it('loadSchema receives the document data', async () => {
    const seen: unknown[] = [];
    const f: FormatDefinition = { ...kubernetesFormat, loadSchema: async (d) => (seen.push(d), undefined) };
    await validateText(parseText('apiVersion: apps/v1\nkind: Deployment\n'), f);
    expect(seen).toEqual([{ apiVersion: 'apps/v1', kind: 'Deployment' }]);
  });
});

describe('locate', () => {
  const run = async (at: 'key' | 'value' | undefined, path: (string | number)[]) => {
    let got: { from: number; to: number } | undefined;
    const rule: Rule = { id: 'probe', messages: {}, check: (input) => ((got = input.locate(0, path, at)), []) };
    await validateText(parseText(TEXT), { ...pipelineFormat, rules: [rule] });
    return got && TEXT.slice(got.from, got.to).trimEnd();
  };

  it('defaults to the value and can point at the key', async () => {
    expect(await run(undefined, ['pipeline', 'name'])).toBe('build');
    expect(await run('value', ['pipeline', 'name'])).toBe('build');
    expect(await run('key', ['pipeline', 'name'])).toBe('name');
  });

  it('returns undefined for a document the text does not have', async () => {
    let got: unknown;
    const rule: Rule = { id: 'probe', messages: {}, check: (input) => ((got = [input.locate(1, []), input.locate(-1, []), input.locate(0, [])]), []) };
    await validateText(parseText(TEXT), { ...pipelineFormat, rules: [rule] });
    expect(got).toEqual([undefined, undefined, expect.objectContaining({ from: expect.any(Number) })]);
  });

  it('maps a missing path to the nearest existing ancestor', async () => {
    expect(await run(undefined, ['pipeline', 'steps', 0, 'nope', 'deeper'])).toBe('run: make');
    expect(await run('key', ['pipeline', 'name', 'x'])).toBe('build');
  });
});

describe('sources', () => {
  it('kubernetes/rules.ts does not import yaml', () => {
    const src = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'formats', 'kubernetes', 'rules.ts'), 'utf8');
    expect(src).not.toMatch(/from\s+['"]yaml['"]/);
  });
});
