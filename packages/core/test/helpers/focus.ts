import { expect } from 'vitest';

/**
 * The focused element, asserted live: connected and not inside a hidden subtree (happy-dom keeps
 * `document.activeElement` on removed or hidden nodes).
 */
export const focused = (): HTMLElement => {
  const a = document.activeElement as HTMLElement;
  expect(a.isConnected).toBe(true);
  expect(a.closest('[hidden]')).toBeNull();
  return a;
};
