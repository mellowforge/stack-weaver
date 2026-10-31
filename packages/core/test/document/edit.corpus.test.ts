import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAlias, isMap, isNode, isScalar, isSeq, visit } from 'yaml';
import type { Node, YAMLMap, YAMLSeq } from 'yaml';
import { applyEdit, canEdit, isOneLineFlowMap } from '../../src/document/edit.js';
import type { ScalarValue } from '../../src/document/edit.js';
import { parseText } from '../../src/document/parse.js';
import { getNode, getPairKey } from '../../src/document/paths.js';
import type { NodeRef, ParsedText } from '../../src/document/types.js';

const corpusDir = join(import.meta.dirname, '..', 'fixtures', 'corpus');
const files = readdirSync(corpusDir).filter((f) => f.endsWith('.yaml'));

interface Entry {
  ref: NodeRef;
  node: Node;
  parent: YAMLMap | YAMLSeq | null;
}

/** Every node reachable by a path (aliases are leaves), with its parent collection. */
function collect(p: ParsedText): Entry[] {
  const out: Entry[] = [];
  p.docs.forEach((d, doc) => {
    const rec = (node: unknown, path: (string | number)[], parent: Entry['parent']): void => {
      if (!isNode(node)) return;
      out.push({ ref: { doc, path }, node, parent });
      if (isMap(node)) {
        for (const pr of node.items) {
          const k = isScalar(pr.key) ? pr.key.value : undefined;
          if (typeof k !== 'string' && typeof k !== 'number') continue;
          rec(pr.value, [...path, String(k)], node); // map keys are string segments
        }
      } else if (isSeq(node)) {
        node.items.forEach((it, i) => rec(it, [...path, i], node));
      }
    };
    rec(d.contents, [], null);
  });
  return out;
}

/** True when the deleted subtree (pair key and value) holds an anchor aliased outside it. */
function anchorStillUsed(p: ParsedText, doc: number, parent: YAMLMap | YAMLSeq, node: Node): boolean {
  const pair = isMap(parent) ? parent.items.find((pr) => pr.value === node) : undefined;
  const anchors = new Set<string>();
  const inner = new Set<unknown>();
  for (const root of [pair?.key, node]) {
    if (!isNode(root)) continue;
    visit(root, {
      Node(_, n) {
        if (n.anchor) anchors.add(n.anchor);
        if (isAlias(n)) inner.add(n);
      },
    });
  }
  let used = false;
  visit(p.docs[doc]!, {
    Alias(_, a) {
      if (!inner.has(a) && anchors.has(a.source)) used = true;
    },
  });
  return used;
}

/** Every alias in every document resolves, and every document converts to JS. */
function expectAliasesResolve(q: ParsedText, label: string): void {
  for (const d of q.docs) {
    visit(d, {
      Alias(_, a) {
        expect(a.resolve(d), `${label}: *${a.source}`).toBeDefined();
      },
    });
    expect(() => d.toJS(), label).not.toThrow();
  }
}

const lineOf = (text: string, offset: number): number => text.slice(0, offset).split('\n').length - 1;

/** Line index range [start, end) of `before` lines that differ from `after`. */
function changedLines(before: string, after: string): [number, number] {
  const a = before.split('\n');
  const b = after.split('\n');
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  )
    suf++;
  return [pre, a.length - suf];
}

function nextValue(v: unknown): ScalarValue {
  if (typeof v === 'string') return `new-${v}`;
  if (typeof v === 'number') return v + 1;
  if (typeof v === 'boolean') return !v;
  return null;
}

/**
 * Scalars whose identity `set` (to the value they already hold) does not reproduce the source
 * bytes, keyed `"<file> <path>"`, with the reason. Every other scalar must round-trip exactly.
 */
const IDENTITY_EXCEPTIONS: Record<string, string> = {
  'compose-env-placeholders.yaml 0:volumes.db-data': 'an empty value is written as `null`',
  'compose-networks-healthcheck.yaml 0:networks.backend': 'an empty value is written as `null`',
  'k8s-configmap-block-scalars.yaml 0:data.description': 'a multi-line `>-` folded scalar is rewritten as literal `|-`',
  'k8s-helm-empty-docs.yaml 0:': 'an empty document is written as `null`',
  'k8s-helm-empty-docs.yaml 2:': 'an empty document is written as `null`',
  'k8s-helm-empty-docs.yaml 4:': 'an empty document is written as `null`',
};

describe.each(files)('corpus %s', (file) => {
  const text = readFileSync(join(corpusDir, file), 'utf8');
  const p = parseText(text);
  const entries = collect(p);

  it('set on every editable scalar changes only its own lines and re-parses to the value', () => {
    for (const { ref, node } of entries) {
      if (!isScalar(node) || canEdit(p, ref) !== undefined) continue;
      const value = nextValue(node.value);
      const r = applyEdit(p, { op: 'set', at: ref, value });
      expect(r.ok, `${file} ${ref.path.join('.')}`).toBe(true);
      if (!r.ok) continue;
      const q = parseText(r.text);
      expect(q.ok).toBe(true);
      const n = getNode(q, ref);
      expect(isScalar(n) ? n.value : undefined).toEqual(value);
      const [start, end] = node.range!;
      const lastLine = text[end - 1] === '\n' ? lineOf(text, end - 1) : lineOf(text, end);
      const [from, to] = changedLines(text, r.text);
      expect(from, `${file} ${ref.path.join('.')}`).toBeGreaterThanOrEqual(lineOf(text, start));
      expect(to, `${file} ${ref.path.join('.')}`).toBeLessThanOrEqual(lastLine + 1);
      expect(r.change.from, `${file} ${ref.path.join('.')}`).toBeGreaterThanOrEqual(start);
      expect(r.change.to, `${file} ${ref.path.join('.')}`).toBeLessThanOrEqual(end);
    }
  });

  it('set of every editable scalar to its current value keeps the text byte-identical', () => {
    const changed: string[] = [];
    for (const { ref, node } of entries) {
      if (!isScalar(node) || canEdit(p, ref) !== undefined) continue;
      const label = `${file} ${ref.doc}:${ref.path.join('.')}`;
      const r = applyEdit(p, { op: 'set', at: ref, value: node.value as ScalarValue });
      expect(r.ok, label).toBe(true);
      if (r.ok && r.text !== text) changed.push(label);
    }
    expect(changed).toEqual(Object.keys(IDENTITY_EXCEPTIONS).filter((k) => k.startsWith(`${file} `)));
  });

  it('add on every single-line flow map is a pure insertion on its own line; other flow maps refuse', () => {
    for (const { ref, node } of entries) {
      if (!isMap(node) || !node.flow || node.items.length === 0) continue;
      const label = `${file} ${ref.path.join('.')}`;
      const r = applyEdit(p, { op: 'add', at: ref, key: 'zz-added', value: 'v' });
      if (!isOneLineFlowMap(p, ref)) {
        expect(r, label).toEqual({ ok: false, reason: 'flow' });
        continue;
      }
      expect(r.ok, label).toBe(true);
      if (!r.ok) continue;
      expect(r.change.from, label).toBe(r.change.to);
      expect(r.change.insert, label).toBe(', zz-added: v');
      const line = lineOf(text, node.range![0]);
      expect(changedLines(text, r.text), label).toEqual([line, line + 1]);
      const added = getNode(parseText(r.text), { doc: ref.doc, path: [...ref.path, 'zz-added'] });
      expect(isScalar(added) ? added.value : undefined, label).toBe('v');
    }
  });

  it('add / push on every non-empty block collection is a pure insertion', () => {
    for (const { ref, node } of entries) {
      if ((!isMap(node) && !isSeq(node)) || node.flow || node.items.length === 0) continue;
      if (canEdit(p, ref) !== undefined) continue;
      const label = `${file} ${ref.path.join('.')}`;
      const op = isMap(node)
        ? ({ op: 'add', at: ref, key: 'zz-added', value: 'v' } as const)
        : ({ op: 'push', at: ref, value: 'zz-added' } as const);
      const r = applyEdit(p, op);
      expect(r.ok, label).toBe(true);
      if (!r.ok) continue;
      expect(r.change.from, label).toBe(r.change.to);
      if (p.eol === '\r\n') expect(r.change.insert.replace(/\r\n/g, ''), label).not.toContain('\n');
      const q = parseText(r.text);
      const added = isMap(node)
        ? getNode(q, { doc: ref.doc, path: [...ref.path, 'zz-added'] })
        : getNode(q, { doc: ref.doc, path: [...ref.path, node.items.length] });
      expect(isScalar(added) ? added.value : undefined, label).toBe(isMap(node) ? 'v' : 'zz-added');
    }
  });

  /*
   * Line span of an entry: from its first line (the key line for a pair, the dash line for an
   * item) up to, but excluding, the next sibling's line. Two widenings are inherent to the
   * algorithm: an only child turns its parent into `{}`/`[]` on the holding key's line, so the
   * span starts there; and the first pair of a sequence-item map shares the `- ` line, so the
   * next sibling is pulled onto that line and its line is included.
   */
  it('delete on every pair and item changes only lines inside its span', () => {
    for (const { ref, node, parent } of entries) {
      if (!parent) continue;
      const r = applyEdit(p, { op: 'delete', at: ref });
      const parentRef = { doc: ref.doc, path: ref.path.slice(0, -1) };
      // A pair whose value is a flow collection is deletable; only the parent being flow blocks.
      const own = canEdit(p, ref);
      const label = `${file} ${ref.path.join('.')}`;
      const inOneLineFlowMap = isOneLineFlowMap(p, parentRef);
      if (inOneLineFlowMap && (own === undefined || own === 'flow') && !anchorStillUsed(p, ref.doc, parent, node)) {
        // A pair of a single-line flow map is spliced out of that line; no other line changes.
        expect(r.ok, label).toBe(true);
        if (!r.ok) continue;
        const q = parseText(r.text);
        expect(q.ok, label).toBe(true);
        expect((getNode(q, parentRef) as YAMLMap).items.length, label).toBe(parent.items.length - 1);
        const line = lineOf(text, parent.range![0]);
        expect(changedLines(text, r.text), label).toEqual([line, line + 1]);
        continue;
      }
      const blocked = (own !== undefined && own !== 'flow') || canEdit(p, parentRef) === 'flow';
      if (blocked) {
        expect(r.ok, `${file} ${ref.path.join('.')}`).toBe(false);
        continue;
      }
      if (anchorStillUsed(p, ref.doc, parent, node)) {
        expect(r, `${file} ${ref.path.join('.')}`).toEqual({ ok: false, reason: 'alias' });
        continue;
      }
      expect(r.ok, `${file} ${ref.path.join('.')}`).toBe(true);
      if (!r.ok) continue;
      const q = parseText(r.text);
      expect(q.ok).toBe(true);
      expectAliasesResolve(q, `${file} ${ref.path.join('.')}`);
      const after = getNode(q, parentRef) as YAMLMap | YAMLSeq;
      expect(after.items.length).toBe(parent.items.length - 1);

      const idx = isMap(parent)
        ? parent.items.findIndex((pr) => pr.value === node)
        : (ref.path[ref.path.length - 1] as number);
      const startNode = isMap(parent) ? (parent.items[idx]!.key as Node) : node;
      const startOff = startNode.range![0];
      let startLine = lineOf(text, startOff);
      const holder = getPairKey(p, parentRef);
      if (parent.items.length === 1 && holder) startLine = lineOf(text, holder.range![0]);
      const sib: unknown = parent.items[idx + 1];
      const sibNode: Node | undefined =
        sib === undefined ? undefined : isMap(parent) ? (sib as { key: Node }).key : (sib as Node);
      let endLine: number;
      if (sibNode) {
        const midLine = text.slice(text.lastIndexOf('\n', startOff - 1) + 1, startOff).trim() !== '';
        endLine = lineOf(text, sibNode.range![0]) + (midLine && idx === 0 ? 1 : 0);
      } else {
        const end = parent.range![2];
        endLine = text[end - 1] === '\n' ? lineOf(text, end - 1) + 1 : lineOf(text, end) + 1;
      }
      const [from, to] = changedLines(text, r.text);
      expect(from, `${file} ${ref.path.join('.')}`).toBeGreaterThanOrEqual(startLine);
      expect(to, `${file} ${ref.path.join('.')}`).toBeLessThanOrEqual(endLine);
    }
  });

  it('a no-op parse keeps the text byte-identical', () => {
    expect(parseText(text).text).toBe(text);
  });
});

describe('corpus fallback ratio', () => {
  it('canEdit refuses under 5% of all scalar nodes', () => {
    let total = 0;
    let refused = 0;
    for (const file of files) {
      const p = parseText(readFileSync(join(corpusDir, file), 'utf8'));
      for (const { ref, node } of collect(p)) {
        if (!isScalar(node) && !isAlias(node)) continue;
        total++;
        if (canEdit(p, ref) !== undefined) refused++;
      }
    }
    console.log(`fallback ratio: ${refused}/${total} = ${((refused / total) * 100).toFixed(2)}%`);
    expect(total).toBeGreaterThan(200);
    expect(refused / total).toBeLessThan(0.05);
  });
});
