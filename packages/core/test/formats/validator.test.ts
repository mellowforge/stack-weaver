import { describe, expect, it, vi } from 'vitest';
import { cachedLoad } from '../../src/formats/validator.js';

describe('cachedLoad', () => {
  it('evicts a rejected load, so the next call loads again', async () => {
    const cache = new Map<string, Promise<number>>();
    const load = vi.fn<() => Promise<number>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(7);
    await expect(cachedLoad(cache, 'k', load)).rejects.toThrow('offline');
    expect(cache.has('k')).toBe(false);
    await expect(cachedLoad(cache, 'k', load)).resolves.toBe(7);
    expect(load).toHaveBeenCalledTimes(2);
    await expect(cachedLoad(cache, 'k', load)).resolves.toBe(7);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('two concurrent calls share one promise and one load', async () => {
    const cache = new Map<string, Promise<number>>();
    let resolve!: (n: number) => void;
    const load = vi.fn(() => new Promise<number>((r) => (resolve = r)));
    const a = cachedLoad(cache, 'k', load);
    const b = cachedLoad(cache, 'k', load);
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
    resolve(1);
    await expect(Promise.all([a, b])).resolves.toEqual([1, 1]);
  });
});
