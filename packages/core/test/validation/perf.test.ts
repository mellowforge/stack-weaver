import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseText } from '../../src/document/parse.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import { validateText } from '../../src/validation/validate.js';

it('1000-line doc validates under 50ms warm', async () => {
  const web = readFileSync(new URL('../fixtures/corpus/k8s-web-app.yaml', import.meta.url), 'utf8');
  const dep = web.split(/^---$/m)[0]!.trim();
  const text = Array.from({ length: 38 }, () => dep).join('\n---\n') + '\n';
  const p = parseText(text);
  console.log(`perf input: ${text.split('\n').length} lines, ${p.docs.length} docs`);
  await validateText(p, kubernetesFormat);
  const t0 = performance.now();
  await validateText(p, kubernetesFormat);
  const ms = performance.now() - t0;
  console.log(`perf warm validate: ${ms.toFixed(1)}ms`);
  expect(ms).toBeLessThan(50);
});
