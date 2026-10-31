import { describe, expect, it } from 'vitest';
import { parseText } from '../../src/document/parse.js';
import { sameProblem } from '../../src/validation/problems.js';
import type { Problem, ProblemCode } from '../../src/validation/problems.js';
import { validateText } from '../../src/validation/validate.js';
import { composeFormat } from '../../src/formats/compose/index.js';

const UNDECLARED = 'services:\n  web:\n    image: nginx\n    ports:\n      - "${PORT}:80"\n';
const problems = async (text: string): Promise<Problem[]> => validateText(parseText(text), composeFormat);

describe('sameProblem', () => {
  it('is true for equal problems from two validations and false when only the fix action differs', async () => {
    const [a] = await problems(UNDECLARED);
    const [b] = await problems(UNDECLARED);
    expect(a!.fix).toBeDefined();
    expect(a).not.toBe(b);
    expect(sameProblem(a!, b!)).toBe(true);
    const other = { ...a!, fix: { ...a!.fix!, action: { kind: 'declareVariable', decl: { name: 'PORT', type: 'number' } } } } as Problem;
    expect(sameProblem(a!, other)).toBe(false);
    expect(sameProblem(a!, { ...a!, fix: { ...a!.fix!, id: 'fix.other' } })).toBe(false);
    expect(sameProblem(a!, { ...a!, fix: undefined })).toBe(false);
  });

  it.each([['severity', 'info'], ['code', 'rule.x'], ['message', 'm'], ['doc', 1], ['from', 0], ['to', 0]] as const)('compares %s', async (key, value) => {
    const [a] = await problems(UNDECLARED);
    expect(sameProblem(a!, { ...a!, [key]: value } as Problem)).toBe(false);
  });
});

describe('ProblemCode', () => {
  it("rejects 'foo' at compile time", () => {
    const ok: ProblemCode[] = ['yaml.syntax', 'schema.required', 'kind.unknown', 'format.extraDocument', 'rule.anything'];
    // @ts-expect-error not a problem code
    const bad: ProblemCode = 'foo';
    expect([ok.length, bad]).toEqual([5, 'foo']);
  });
});
