// @vitest-environment happy-dom
import { createFakeAdapter, type FakeInstance } from '../helpers/fake-adapter.js';
import { runAdapterContract, type Mounted } from './adapter-contract.js';

const fake = (m: Mounted): FakeInstance => m.inst as FakeInstance;

runAdapterContract('fake adapter', () => ({
  adapter: createFakeAdapter(),
  type: (m, s) => fake(m).type(m.inst.getText() + s),
  setCaret: (m, offset) => fake(m).setCaret(offset),
  keyTarget: (m) => m.el.querySelector('textarea') as HTMLElement,
  diagnostics: (m) => [...fake(m).diagnostics],
  completions: (m) => fake(m).requestCompletions(),
  ariaLabel: (m) => m.el.querySelector('textarea')?.getAttribute('aria-label') ?? null,
}));
