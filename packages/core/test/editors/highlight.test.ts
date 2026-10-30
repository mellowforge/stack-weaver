import { expect, it } from 'vitest';
import { swHighlightStyle } from '../../src/editors/codemirror/highlight.js';

it('syntax colours come from the --sw tokens, so they follow the dark theme', () => {
  // Found in the browser: the default highlight style drew keys as #00f on the dark background.
  const colours = swHighlightStyle.specs.map((s) => s.color).filter((c) => c !== undefined);
  expect(colours.length).toBeGreaterThan(0);
  for (const c of colours) expect(c).toMatch(/^var\(--sw-(accent|info|warning|muted)\)$/);
});
