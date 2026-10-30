import { describe, expect, it } from 'vitest';
import { describeNode } from '../../src/document/describe.js';
import { parseText } from '../../src/document/parse.js';
import { composeFormat } from '../../src/formats/compose/index.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import type { Recipe } from '../../src/formats/types.js';
import { validateText } from '../../src/validation/validate.js';

const formats = [kubernetesFormat, composeFormat];
const all: Recipe[] = formats.flatMap((f) => [...(f.recipes ?? [])]);

describe('built-in recipes', () => {
  it('ship the documented ids', () => {
    expect(all.map((r) => r.id).sort()).toEqual(
      ['compose-app-postgres', 'compose-app-redis', 'compose-web-app', 'k8s-config', 'k8s-scheduled-job', 'k8s-web-app', 'k8s-worker'].sort(),
    );
  });

  it('every built-in recipe validates with zero errors', async () => {
    for (const r of all) {
      const format = formats.find((f) => f.id === r.format)!;
      const problems = await validateText(parseText(r.yaml), format);
      expect(problems.filter((p) => p.severity === 'error'), r.id).toEqual([]);
    }
  });

  it('every recipe is detected as its format', () => {
    for (const r of all) {
      const detected = formats.find((f) => f.detect(parseText(r.yaml)));
      expect(detected?.id, r.id).toBe(r.format);
    }
  });

  it('every recipe is listed on its own format', () => {
    for (const f of formats) for (const r of f.recipes ?? []) expect(r.format).toBe(f.id);
  });

  it('every focus ref resolves to a scalar', () => {
    for (const r of all) {
      expect(r.focus, r.id).toBeDefined();
      expect(describeNode(parseText(r.yaml), r.focus!)?.type, r.id).toBe('scalar');
    }
  });

  it('recipe ids are unique', () => {
    const ids = all.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
