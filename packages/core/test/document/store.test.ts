import { describe, expect, it } from 'vitest';
import type { EditOp } from '../../src/document/edit.js';
import { DocumentStore, type StoreEvent } from '../../src/document/store.js';

const setA = (value: number): EditOp => ({ op: 'set', at: { doc: 0, path: ['a'] }, value });

const setup = (text = 'a: 1\nb: 2\n', opts: { groupMs?: number; historyLimit?: number } = {}) => {
  let t = 0;
  const clock = { advance: (ms: number) => (t += ms) };
  const store = new DocumentStore(text, { now: () => t, ...opts });
  const events: StoreEvent[] = [];
  store.subscribe((e) => events.push(e));
  return { store, events, clock };
};

describe('DocumentStore', () => {
  it('setText equal is a no-op (no event)', () => {
    const { store, events } = setup();
    store.setText('a: 1\nb: 2\n', 'code');
    expect(events).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  it('edit emits visual event with minimal change', () => {
    const { store, events } = setup();
    const r = store.edit(setA(9));
    expect(r.ok).toBe(true);
    expect(store.text).toBe('a: 9\nb: 2\n');
    expect(events).toHaveLength(1);
    expect(events[0]!.origin).toBe('visual');
    expect(events[0]!.change).toEqual({ from: 3, to: 4, insert: '9' });
    expect(events[0]!.parsed).toBe(store.parsed);
  });

  it('edit refuses while parse is broken', () => {
    const { store, events } = setup();
    store.setText('a: [1\n', 'code');
    events.length = 0;
    const r = store.edit(setA(9));
    expect(r).toEqual({ ok: false, reason: 'parse-error' });
    expect(store.text).toBe('a: [1\n');
    expect(events).toHaveLength(0);
  });

  it('lastGood survives a broken parse', () => {
    const { store } = setup();
    const good = store.parsed;
    store.setText('a: [1\n', 'code');
    expect(store.parsed.ok).toBe(false);
    expect(store.lastGood).toBe(good);
    store.setText('c: 3\n', 'code');
    expect(store.lastGood).toBe(store.parsed);
  });

  it('code typing within 500ms groups into one undo', () => {
    const { store, clock } = setup('');
    store.setText('a', 'code');
    clock.advance(400);
    store.setText('a:', 'code');
    clock.advance(400);
    store.setText('a: 1', 'code');
    expect(store.undo()).toBe(true);
    expect(store.text).toBe('');
    expect(store.canUndo).toBe(false);
  });

  it('code changes further apart than groupMs are separate steps', () => {
    const { store, clock } = setup('');
    store.setText('a', 'code');
    clock.advance(501);
    store.setText('ab', 'code');
    store.undo();
    expect(store.text).toBe('a');
  });

  it('visual edit is its own undo step', () => {
    const { store } = setup();
    store.setText('a: 1\nb: 3\n', 'code');
    store.edit(setA(9));
    store.setText('a: 9\nb: 4\n', 'code');
    store.undo();
    expect(store.text).toBe('a: 9\nb: 3\n');
    store.undo();
    expect(store.text).toBe('a: 1\nb: 3\n');
    store.undo();
    expect(store.text).toBe('a: 1\nb: 2\n');
  });

  it('api changes are always their own entry', () => {
    const { store } = setup('');
    store.setText('a', 'api');
    store.setText('ab', 'api');
    store.undo();
    expect(store.text).toBe('a');
  });

  it("undo/redo restore exact text and emit origin 'history'", () => {
    const { store, events } = setup();
    store.setText('x: 1\n', 'api');
    events.length = 0;
    expect(store.undo()).toBe(true);
    expect(store.text).toBe('a: 1\nb: 2\n');
    expect(events[0]!.origin).toBe('history');
    expect(events[0]!.text).toBe('a: 1\nb: 2\n');
    expect(events[0]!.change).toEqual({ from: 0, to: 4, insert: 'a: 1\nb: 2' });
    expect(store.canRedo).toBe(true);
    expect(store.redo()).toBe(true);
    expect(store.text).toBe('x: 1\n');
    expect(events[1]!.origin).toBe('history');
    expect(store.canRedo).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it('undo returns false when empty', () => {
    const { store } = setup();
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it('code change after undo does not merge into the undone entry', () => {
    const { store } = setup('');
    store.setText('a', 'code');
    store.undo();
    store.setText('b', 'code');
    store.undo();
    expect(store.text).toBe('');
  });

  it('new change clears redo', () => {
    const { store } = setup();
    store.setText('x: 1\n', 'api');
    store.undo();
    expect(store.canRedo).toBe(true);
    store.setText('y: 1\n', 'api');
    expect(store.canRedo).toBe(false);
  });

  it('historyLimit drops oldest', () => {
    const { store } = setup('0', { historyLimit: 2 });
    store.setText('1', 'api');
    store.setText('2', 'api');
    store.setText('3', 'api');
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(false);
    expect(store.text).toBe('1');
  });
});
