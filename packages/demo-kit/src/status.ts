import type { ChangeOrigin } from '@mellowforge/stack-weaver-core';

/** The one-line status the demos show under the editor. */
export function statusLine(s: { problems: number; activeFormat: string | undefined; origin?: ChangeOrigin }): string {
  const problems = s.problems === 0 ? 'No problems' : s.problems === 1 ? '1 problem' : `${s.problems} problems`;
  const parts = [problems, s.activeFormat ?? 'no format yet'];
  if (s.origin !== undefined) parts.push(`last change: ${s.origin}`);
  return parts.join(' · ');
}
