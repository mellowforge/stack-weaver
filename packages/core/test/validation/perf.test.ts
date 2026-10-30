import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseText } from '../../src/document/parse.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import { validateText } from '../../src/validation/validate.js';

it('1000-line doc validates under 50ms warm (best of 3)', async () => {
  const web = readFileSync(new URL('../fixtures/corpus/k8s-web-app.yaml', import.meta.url), 'utf8');
  const dep = web.split(/^---$/m)[0]!.trim();
  const text = Array.from({ length: 38 }, () => dep).join('\n---\n') + '\n';
  const p = parseText(text);
  const lines = text.split('\n').length;
  console.log(`perf input: ${lines} lines, ${p.docs.length} docs`);
  expect(p.ok).toBe(true);
  expect(p.docs).toHaveLength(38);
  expect(lines).toBeGreaterThanOrEqual(950);
  expect(await validateText(p, kubernetesFormat)).toEqual([]); // warm-up: loads the Deployment chunk

  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const problems = await validateText(p, kubernetesFormat);
    best = Math.min(best, performance.now() - t0);
    expect(problems).toEqual([]);
  }
  console.log(`perf warm validate (best of 3): ${best.toFixed(1)}ms`);
  expect(best).toBeLessThan(50);
});
