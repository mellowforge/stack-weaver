/**
 * Recursively freezes plain data (objects and arrays) in place and returns it. Functions and
 * already-frozen values are left alone, so shared and cyclic structures are safe.
 * @param value - The value to freeze.
 * @returns `value`, typed as deeply readonly.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const v of Object.values(value)) deepFreeze(v);
  return value;
}
