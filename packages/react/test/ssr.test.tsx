// @vitest-environment node
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { ManifestEditor } from '../src/index.js';

let errors: MockInstance<typeof console.error>;

beforeEach(() => {
  errors = vi.spyOn(console, 'error');
});

afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

it('renders to a string without touching the DOM', () => {
  // The node environment has no DOM at all: any access to `document` would throw.
  expect(typeof document).toBe('undefined');
  expect(renderToString(<ManifestEditor value="a: 1" />)).toBe('<div></div>');
  expect(renderToString(<ManifestEditor value="a: 1" className="host" />)).toBe('<div class="host"></div>');
});
