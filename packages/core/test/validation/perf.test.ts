import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseText } from '../../src/document/parse.js';
import type { ParsedText } from '../../src/document/types.js';
import { composeFormat } from '../../src/formats/compose/index.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import type { FormatDefinition } from '../../src/formats/types.js';
import type { Problem } from '../../src/validation/problems.js';
import { validateText } from '../../src/validation/validate.js';

/** How many problems of each code. */
const tally = (ps: readonly Problem[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const p of ps) out[p.code] = (out[p.code] ?? 0) + 1;
  return out;
};

/** Validates once to warm up (schema chunks load), then times the best of 3 runs; each run must give `expected`. */
async function bestOf3(p: ParsedText, format: FormatDefinition, expected: Record<string, number>): Promise<number> {
  expect(tally(await validateText(p, format))).toEqual(expected); // warm-up
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const problems = await validateText(p, format);
    best = Math.min(best, performance.now() - t0);
    expect(tally(problems)).toEqual(expected);
  }
  return best;
}

it('1000-line doc validates under 50ms warm (best of 3), rules included', async () => {
  const web = readFileSync(new URL('../fixtures/corpus/k8s-web-app.yaml', import.meta.url), 'utf8');
  // Deployments with their own app label and a named container port.
  const dep = web.split(/^---$/m)[0]!.trim().replace('- containerPort: 80', '- name: http\n              containerPort: 80');
  const deployments = Array.from({ length: 32 }, (_, i) => dep.replaceAll('app: web', `app: web-${i}`));
  // Services: 8 select a workload (half of them name a port it has), 4 select none.
  const services = Array.from({ length: 12 }, (_, i) =>
    [
      'apiVersion: v1',
      'kind: Service',
      'metadata:',
      `  name: svc-${i}`,
      'spec:',
      `  selector: { app: ${i < 8 ? `web-${i}` : `none-${i}`} }`,
      '  ports:',
      '    - port: 80',
      `      targetPort: ${i % 2 === 0 ? 'http' : 'metrics'}`,
    ].join('\n'),
  );
  const text = [...deployments, ...services].join('\n---\n') + '\n';
  const p = parseText(text);
  const lines = text.split('\n').length;
  console.log(`perf input: ${lines} lines, ${p.docCount} docs`);
  expect(p.ok).toBe(true);
  expect(p.docCount).toBe(44);
  expect(lines).toBeGreaterThanOrEqual(950);

  // service-selector: svc-8..11; target-port: the odd matched ones (svc-1, 3, 5, 7).
  const best = await bestOf3(p, kubernetesFormat, { 'rule.service-selector': 4, 'rule.target-port': 4 });
  console.log(`perf warm validate (best of 3): ${best.toFixed(1)}ms`);
  expect(best).toBeLessThan(50);
});

it('1000-line compose file with many placeholders validates under 50ms warm (best of 3), rules included', async () => {
  const block = [
    'x-variables:',
    '  TAG:\n    type: string\n    default: latest',
    '  HOST:\n    type: string\n    default: localhost',
    '  FLAG:\n    type: boolean',
    '  MODE:\n    type: enum\n    enum: [debug, info]',
    ...Array.from({ length: 10 }, (_, i) => `  P${i}:\n    type: port\n    default: ${8000 + i}`),
    ...Array.from({ length: 5 }, (_, i) => `  N${i}:\n    type: number`),
  ];
  // Every tenth service uses an undeclared variable.
  const services = Array.from({ length: 78 }, (_, i) =>
    [
      `  s${i}:`,
      '    image: "nginx:${TAG}"',
      `    scale: \${N${i % 5}}`,
      `    hostname: ${i % 10 === 0 ? `\${HN_${i}}` : `host-${i}`}`,
      '    ports:',
      `      - "\${P${i % 10}}:80"`,
      '    environment:',
      '      LOG: ${MODE}',
      '      DEBUG: "${FLAG}"',
      `      URL: "http://\${HOST:-localhost}:\${P${i % 10}}/x"`,
      '    labels:',
      `      index: "${i}"`,
    ].join('\n'),
  );
  const text = [...block, 'services:', ...services].join('\n') + '\n';
  const p = parseText(text);
  const lines = text.split('\n').length;
  console.log(`compose perf input: ${lines} lines`);
  expect(p.ok).toBe(true);
  expect(lines).toBeGreaterThanOrEqual(950);

  const best = await bestOf3(p, composeFormat, { 'rule.undeclared-variable': 8 });
  console.log(`compose perf warm validate (best of 3): ${best.toFixed(1)}ms`);
  expect(best).toBeLessThan(50);
});
