import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyEdit, canEdit } from '../../src/document/edit.js';
import type { EditOp, EditResult } from '../../src/document/edit.js';
import { parseText } from '../../src/document/parse.js';
import { getNode } from '../../src/document/paths.js';

const corpus = (name: string): string =>
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'corpus', name), 'utf8');

/** Applies `op` to `text` and returns the new text, failing the test on a refusal. */
function edit(text: string, op: EditOp): string {
  const r: EditResult = applyEdit(parseText(text), op);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  expect(r.text).toBe(text.slice(0, r.change.from) + r.change.insert + text.slice(r.change.to));
  expect(parseText(r.text).ok).toBe(true);
  return r.text;
}

function refusal(text: string, op: EditOp): string {
  const r = applyEdit(parseText(text), op);
  return r.ok ? 'ok' : r.reason;
}

const at = (...path: (string | number)[]) => ({ doc: 0, path });

describe('applyEdit: set', () => {
  it('set replaces image only', () => {
    const text = corpus('k8s-web-app.yaml');
    const r = applyEdit(parseText(text), {
      op: 'set',
      at: at('spec', 'template', 'spec', 'containers', 0, 'image'),
      value: 'nginx:1.28',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe(text.replace('image: nginx:1.27 # pinned', 'image: nginx:1.28 # pinned'));
    const from = text.indexOf('nginx:1.27');
    expect(r.change).toEqual({ from, to: from + 'nginx:1.27'.length, insert: 'nginx:1.28' });
  });

  it('set keeps trailing comment', () => {
    expect(edit('a: 1 # one\nb: 2\n', { op: 'set', at: at('a'), value: 5 })).toBe(
      'a: 5 # one\nb: 2\n',
    );
  });

  it('set quotes "8080" string', () => {
    expect(edit('port: 80\n', { op: 'set', at: at('port'), value: '8080' })).toBe(
      'port: "8080"\n',
    );
    expect(edit('flag: x\n', { op: 'set', at: at('flag'), value: 'true' })).toBe(
      'flag: "true"\n',
    );
  });

  it('set quotes strings that YAML 1.1 consumers would re-type', () => {
    expect(edit('a: x\n', { op: 'set', at: at('a'), value: 'yes' })).toBe('a: "yes"\n');
    expect(edit('a: x\n', { op: 'set', at: at('a'), value: '0o14' })).toBe('a: "0o14"\n');
  });

  it('set keeps the original quote style for strings', () => {
    expect(edit('a: "info"\n', { op: 'set', at: at('a'), value: 'debug' })).toBe('a: "debug"\n');
    expect(edit("a: 'info'\n", { op: 'set', at: at('a'), value: 'debug' })).toBe("a: 'debug'\n");
  });

  it('set multi-line string on a plain scalar double-quotes on one line', () => {
    expect(edit('a: x\nb: 1\n', { op: 'set', at: at('a'), value: 'l1\nl2' })).toBe(
      'a: "l1\\nl2"\nb: 1\n',
    );
  });

  it('set on an empty null value adds the separating space', () => {
    expect(edit('a:\nb: 1\n', { op: 'set', at: at('a'), value: 'x' })).toBe('a: x\nb: 1\n');
    expect(edit('a: # c\nb: 1\n', { op: 'set', at: at('a'), value: 'x' })).toBe(
      'a: x # c\nb: 1\n',
    );
  });

  it('set on a block scalar rewrites its body at the same indentation', () => {
    const text = 'data:\n  conf: | # cfg\n    a=1\n    b=2\n  mode: x\n';
    expect(edit(text, { op: 'set', at: at('data', 'conf'), value: 'a=3\n' })).toBe(
      'data:\n  conf: | # cfg\n    a=3\n  mode: x\n',
    );
    expect(edit(text, { op: 'set', at: at('data', 'conf'), value: 'a=3\nb=4' })).toBe(
      'data:\n  conf: |- # cfg\n    a=3\n    b=4\n  mode: x\n',
    );
  });

  it('set on a folded block scalar keeps folding for single-line values', () => {
    const text = 'd: >-\n  long\n  text\nm: x\n';
    expect(edit(text, { op: 'set', at: at('d'), value: 'short' })).toBe('d: >-\n  short\nm: x\n');
  });

  it('set inside flow map keeps other entries', () => {
    const text = 'labels: { app: web, tier: fe }\n';
    expect(edit(text, { op: 'set', at: at('labels', 'app'), value: 'api' })).toBe(
      'labels: { app: api, tier: fe }\n',
    );
  });

  it('set inside flow quotes comma/colon values', () => {
    const text = 'labels: { app: web, tier: fe }\n';
    expect(edit(text, { op: 'set', at: at('labels', 'app'), value: 'a,b' })).toBe(
      'labels: { app: "a,b", tier: fe }\n',
    );
    expect(edit(text, { op: 'set', at: at('labels', 'tier'), value: 'x:y' })).toBe(
      'labels: { app: web, tier: "x:y" }\n',
    );
    expect(edit('v: [a, b]\n', { op: 'set', at: at('v', 1), value: '{x}' })).toBe(
      'v: [a, "{x}"]\n',
    );
  });

  it('offsets after emoji', () => {
    const text = corpus('k8s-unicode-values.yaml');
    const out = edit(text, { op: 'set', at: at('data', 'japanese'), value: 'さようなら' });
    expect(out).toBe(text.replace('japanese: こんにちは世界', 'japanese: さようなら'));
    const out2 = edit(text, { op: 'set', at: at('data', 'mixed'), value: 'thé 🍵' });
    expect(out2).toBe(text.replace('mixed: café ☕ naïve', 'mixed: thé 🍵'));
  });
});

describe('applyEdit: add', () => {
  it('add appends env entry', () => {
    const text = corpus('compose-basic.yaml');
    const out = edit(text, {
      op: 'add',
      at: at('services', 'api', 'environment'),
      key: 'LOG_LEVEL',
      value: 'debug',
    });
    expect(out).toBe(text.replace('      PORT: 3000\n', '      PORT: 3000\n      LOG_LEVEL: debug\n'));
  });

  it('add renders a nested block value one level deeper', () => {
    const out = edit('a:\n  b: 1\nz: 2\n', {
      op: 'add',
      at: at('a'),
      key: 'c',
      value: { d: [1, 2], e: 'x' },
    });
    expect(out).toBe('a:\n  b: 1\n  c:\n    d:\n      - 1\n      - 2\n    e: x\nz: 2\n');
  });

  it('add after a last child with a trailing comment and deeper comment lines', () => {
    const out = edit('a:\n  b: 1 # c\n    # deep\nz: 2\n', {
      op: 'add',
      at: at('a'),
      key: 'extra',
      value: 'v',
    });
    expect(out).toBe('a:\n  b: 1 # c\n    # deep\n  extra: v\nz: 2\n');
  });

  it('add into empty map {}', () => {
    const text = corpus('compose-basic.yaml');
    const out = edit(text, { op: 'add', at: at('volumes', 'data'), key: 'driver', value: 'local' });
    expect(out).toBe(text.replace('  data: {}\n', '  data:\n    driver: local\n'));
    expect(edit('a: {} # empty\nb: 1\n', { op: 'add', at: at('a'), key: 'k', value: 'v' })).toBe(
      'a: # empty\n  k: v\nb: 1\n',
    );
  });

  it('add into a null value', () => {
    const text = corpus('compose-env-placeholders.yaml');
    const out = edit(text, {
      op: 'add',
      at: at('volumes', 'db-data'),
      key: 'driver',
      value: 'local',
    });
    expect(out).toBe(text.replace('  db-data:\n', '  db-data:\n    driver: local\n'));
  });

  it('add into an empty map in a sequence item stays inline', () => {
    expect(edit('l:\n  - {}\n', { op: 'add', at: at('l', 0), key: 'a', value: 1 })).toBe(
      'l:\n  - a: 1\n',
    );
  });

  it('add refuses an existing key and non-map targets', () => {
    expect(refusal('a:\n  b: 1\n', { op: 'add', at: at('a'), key: 'b', value: 2 })).toBe(
      'unsupported',
    );
    expect(refusal('a: 1\n', { op: 'add', at: at('a'), key: 'b', value: 2 })).toBe('unsupported');
    expect(refusal('a:\n  - 1\n', { op: 'add', at: at('a'), key: 'b', value: 2 })).toBe(
      'unsupported',
    );
  });
});

describe('applyEdit: push', () => {
  it('push into containers', () => {
    const text = corpus('k8s-multi-container-pod.yaml');
    const out = edit(text, {
      op: 'push',
      at: at('spec', 'containers'),
      value: { name: 'metrics', image: 'example/metrics:1' },
    });
    expect(out).toBe(
      text.replace(
        '          mountPath: /logs\n',
        '          mountPath: /logs\n    - name: metrics\n      image: example/metrics:1\n',
      ),
    );
  });

  it('push into an empty [] and a null value', () => {
    expect(edit('a: []\nb: 1\n', { op: 'push', at: at('a'), value: 'x' })).toBe(
      'a:\n  - x\nb: 1\n',
    );
    expect(edit('a:\nb: 1\n', { op: 'push', at: at('a'), value: 'x' })).toBe('a:\n  - x\nb: 1\n');
  });

  it('push into flow seq refuses flow', () => {
    expect(refusal('v: [a, b]\n', { op: 'push', at: at('v'), value: 'c' })).toBe('flow');
  });
});

describe('applyEdit: delete', () => {
  it('delete pair removes its comment lines', () => {
    const text = [
      'metadata:',
      '  name: web',
      '  annotations: # notes',
      '    team: core # owner',
      '    # deeper comment',
      '  # sibling comment',
      '  labels:',
      '    app: web',
      '',
    ].join('\n');
    expect(edit(text, { op: 'delete', at: at('metadata', 'annotations') })).toBe(
      ['metadata:', '  name: web', '  # sibling comment', '  labels:', '    app: web', ''].join(
        '\n',
      ),
    );
  });

  it('delete last item leaves []', () => {
    expect(edit('args:\n  - --verbose # flag\nname: x\n', { op: 'delete', at: at('args', 0) })).toBe(
      'args: []\nname: x\n',
    );
    expect(edit('labels:\n  app: web\nz: 1\n', { op: 'delete', at: at('labels', 'app') })).toBe(
      'labels: {}\nz: 1\n',
    );
    expect(edit('env: # vars\n  - a\n', { op: 'delete', at: at('env', 0) })).toBe(
      'env: [] # vars\n',
    );
  });

  it('delete the first pair of a sequence-item map keeps the dash', () => {
    const text = 'c:\n  - name: web\n    image: x\n  - name: db\n';
    expect(edit(text, { op: 'delete', at: at('c', 0, 'name') })).toBe(
      'c:\n  - image: x\n  - name: db\n',
    );
    expect(edit(text, { op: 'delete', at: at('c', 1, 'name') })).toBe(
      'c:\n  - name: web\n    image: x\n  - {}\n',
    );
  });

  it('delete a middle sequence item', () => {
    expect(edit('l:\n  - a\n  - b\n  - c\n', { op: 'delete', at: at('l', 1) })).toBe(
      'l:\n  - a\n  - c\n',
    );
  });

  it('delete the last line of a file without trailing newline', () => {
    const text = corpus('k8s-no-trailing-newline.yaml');
    expect(edit(text, { op: 'delete', at: at('kind') })).toBe(text.replace('kind: Namespace\n', ''));
    expect(edit('a: 1\nb: 2', { op: 'delete', at: at('b') })).toBe('a: 1');
  });

  it('delete refuses the document root', () => {
    expect(refusal('a: 1\n', { op: 'delete', at: at() })).toBe('unsupported');
  });
});

describe('applyEdit: addDocument', () => {
  it('addDocument after doc without trailing newline', () => {
    const text = corpus('k8s-no-trailing-newline.yaml');
    expect(edit(text, { op: 'addDocument', yaml: 'kind: X\n' })).toBe(`${text}\n---\nkind: X\n`);
  });

  it('addDocument after a trailing ... goes after the end marker', () => {
    const text = corpus('k8s-leading-marker-and-end.yaml');
    expect(text.endsWith('...\n')).toBe(true);
    const out = edit(text, { op: 'addDocument', yaml: 'kind: X' });
    expect(out).toBe(`${text}---\nkind: X\n`);
    expect(parseText(out).docs).toHaveLength(2);
  });
});

describe('applyEdit: formatting', () => {
  it('preserves CRLF', () => {
    const text = corpus('k8s-web-app-crlf.yaml');
    const p = parseText(text);
    expect(p.eol).toBe('\r\n');
    const added = edit(text, { op: 'add', at: at('metadata'), key: 'namespace', value: 'prod' });
    expect(added).toBe(
      text.replace(
        '  labels: { app: web, tier: frontend }\r\n',
        '  labels: { app: web, tier: frontend }\r\n  namespace: prod\r\n',
      ),
    );
    const pushed = edit(text, {
      op: 'push',
      at: at('spec', 'template', 'spec', 'containers'),
      value: { name: 'side', image: 'busybox', args: ['a', 'b'] },
    });
    expect(pushed.replace(/\r\n/g, '').includes('\n')).toBe(false);
    expect(pushed).toContain(
      '        - name: side\r\n          image: busybox\r\n          args:\r\n            - a\r\n            - b\r\n',
    );
    const deleted = edit(text, { op: 'delete', at: at('spec', 'replicas') });
    expect(deleted).toBe(text.replace('  replicas: 3\r\n', ''));
    const doc = edit(text, { op: 'addDocument', yaml: 'a: 1\nb: 2\n' });
    expect(doc).toBe(`${text}---\r\na: 1\r\nb: 2\r\n`);
  });

  it('matches 4-space indent', () => {
    const text = corpus('k8s-four-space-indent.yaml');
    const added = edit(text, { op: 'add', at: at('metadata'), key: 'namespace', value: 'prod' });
    expect(added).toBe(
      text.replace('        app: api\nspec:', '        app: api\n    namespace: prod\nspec:'),
    );
    const pushed = edit(text, {
      op: 'push',
      at: at('spec', 'template', 'spec', 'containers'),
      value: { name: 'side', image: 'busybox' },
    });
    expect(pushed).toBe(
      `${text}                -   name: side\n                    image: busybox\n`,
    );
  });

  it('matches non-indented sequences', () => {
    const text = corpus('k8s-nonindented-sequences.yaml');
    const args = edit(text, {
      op: 'push',
      at: at('spec', 'template', 'spec', 'containers', 0, 'args'),
      value: '--verbose',
    });
    expect(args).toBe(text.replace('        - jobs\n', '        - jobs\n        - --verbose\n'));
    const containers = edit(text, {
      op: 'push',
      at: at('spec', 'template', 'spec', 'containers'),
      value: { name: 'side', image: 'busybox' },
    });
    expect(containers).toBe(`${text}      - name: side\n        image: busybox\n`);
  });

  it('appends at EOF without trailing newline', () => {
    const text = corpus('k8s-no-trailing-newline.yaml');
    const out = edit(text, { op: 'add', at: at('metadata'), key: 'labels', value: { app: 'x' } });
    expect(out).toBe(`${text}\n  labels:\n    app: x`);
    const root = edit(text, { op: 'add', at: at(), key: 'data', value: 1 });
    expect(root).toBe(`${text}\ndata: 1`);
  });

  it('appends to a root map that ends before ...', () => {
    const text = corpus('k8s-leading-marker-and-end.yaml');
    const out = edit(text, { op: 'add', at: at(), key: 'data', value: 1 });
    expect(out).toBe(text.replace('  name: staging\n...', '  name: staging\ndata: 1\n...'));
  });
});

describe('applyEdit: edge cases', () => {
  it('set on a keep-chomping block scalar reproduces trailing line breaks', () => {
    const text = 'a: |+\n  x\n\n\nb: 1\n';
    expect(edit(text, { op: 'set', at: at('a'), value: 'y\n\n' })).toBe('a: |+\n  y\n\nb: 1\n');
    expect(edit(text, { op: 'set', at: at('a'), value: 'y' })).toBe('a: |-\n  y\nb: 1\n');
  });

  it('set on a block scalar falls back to a quoted scalar when block style cannot hold it', () => {
    expect(edit('a: |\n  x\nb: 1\n', { op: 'set', at: at('a'), value: ' lead\n' })).toBe(
      'a: " lead\\n"\nb: 1\n',
    );
    expect(edit('a: | # c\n  x\nb: 1\n', { op: 'set', at: at('a'), value: 5 })).toBe(
      'a: 5 # c\nb: 1\n',
    );
  });

  it('add after a keep-chomping block scalar keeps its trailing blank line', () => {
    expect(edit('m:\n  a: |+\n    x\n\n', { op: 'add', at: at('m'), key: 'k', value: 1 })).toBe(
      'm:\n  a: |+\n    x\n\n  k: 1\n',
    );
  });

  it('add and push render multi-line strings as block scalars', () => {
    expect(edit('m:\n  a: 1\n', { op: 'add', at: at('m'), key: 'k', value: 'l1\nl2' })).toBe(
      'm:\n  a: 1\n  k: |-\n    l1\n    l2\n',
    );
    expect(edit('l:\n  - a\n', { op: 'push', at: at('l'), value: 'l1\nl2' })).toBe(
      'l:\n  - a\n  - |-\n    l1\n    l2\n',
    );
    expect(edit('l:\n  - a\n', { op: 'push', at: at('l'), value: [1, 2] })).toBe(
      'l:\n  - a\n  - - 1\n    - 2\n',
    );
  });

  it('add quotes keys and values that YAML 1.1 would re-type', () => {
    expect(edit('m:\n  a: 1\n', { op: 'add', at: at('m'), key: 'yes', value: 'on' })).toBe(
      'm:\n  a: 1\n  "yes": "on"\n',
    );
  });

  it('push into a later document uses that document', () => {
    const text = corpus('k8s-web-app.yaml');
    const out = edit(text, {
      op: 'push',
      at: { doc: 2, path: ['spec', 'rules'] },
      value: { host: 'b.example.com' },
    });
    expect(out).toBe(`${text}    - host: b.example.com\n`);
  });

  it('delete keeps anchors and tags on the holding key', () => {
    expect(edit('x: &a\n  k: 1\n', { op: 'delete', at: at('x', 'k') })).toBe('x: &a {}\n');
    expect(edit('x: &a\n  k: 1\n  j: 2\n', { op: 'delete', at: at('x', 'k') })).toBe(
      'x: &a\n  j: 2\n',
    );
  });

  it('delete in nested sequences', () => {
    expect(edit('- - a\n  - b\n', { op: 'delete', at: at(0, 0) })).toBe('- - b\n');
    expect(edit('- - a\n', { op: 'delete', at: at(0, 0) })).toBe('- []\n');
    expect(edit('- a\n- b\n', { op: 'delete', at: at(0) })).toBe('- b\n');
  });

  it('addDocument into empty text and after an unterminated ...', () => {
    expect(edit('', { op: 'addDocument', yaml: 'a: 1' })).toBe('---\na: 1\n');
    expect(edit('a: 1\n...', { op: 'addDocument', yaml: 'b: 1' })).toBe('a: 1\n...\n---\nb: 1\n');
  });
});

describe('refusals and canEdit', () => {
  it('refuses flow', () => {
    const text = corpus('k8s-web-app.yaml');
    expect(refusal(text, { op: 'add', at: at('metadata', 'labels'), key: 'x', value: 'y' })).toBe(
      'flow',
    );
    expect(refusal(text, { op: 'delete', at: at('metadata', 'labels', 'app') })).toBe('flow');
    expect(refusal('v: [a, b]\n', { op: 'delete', at: at('v', 0) })).toBe('flow');
    expect(refusal('v: { a: {} }\n', { op: 'add', at: at('v', 'a'), key: 'k', value: 1 })).toBe(
      'flow',
    );
    const p = parseText(text);
    expect(canEdit(p, at('metadata', 'labels'))).toBe('flow');
    expect(canEdit(p, at('metadata', 'labels', 'app'))).toBe(true);
  });

  it('refuses alias', () => {
    const text = corpus('compose-anchors.yaml');
    const p = parseText(text);
    const env = at('services', 'worker', 'environment');
    expect(refusal(text, { op: 'set', at: env, value: 'x' })).toBe('alias');
    expect(refusal(text, { op: 'set', at: at('services', 'worker', 'environment', 'TZ'), value: 'x' })).toBe(
      'alias',
    );
    expect(refusal(text, { op: 'set', at: at('services', 'api', 'restart'), value: 'no' })).toBe(
      'alias',
    );
    expect(canEdit(p, env)).toBe('alias');
    expect(canEdit(p, at('services', 'api', '<<'))).toBe('alias');
    expect(canEdit(p, at('services', 'api', 'image'))).toBe(true);
  });

  it('refuses parse-error', () => {
    const p = parseText('a: [\n');
    expect(p.ok).toBe(false);
    expect(applyEdit(p, { op: 'set', at: at('a'), value: 1 })).toEqual({
      ok: false,
      reason: 'parse-error',
    });
    expect(canEdit(p, at('a'))).toBe('parse-error');
  });

  it('refuses block scalars with an indentation indicator', () => {
    const text = 'a: |2\n   lead\nb: 1\n';
    expect(refusal(text, { op: 'set', at: at('a'), value: 'x' })).toBe('block-scalar');
    expect(canEdit(parseText(text), at('a'))).toBe('block-scalar');
  });

  it('returns not-found for missing paths', () => {
    expect(refusal('a: 1\n', { op: 'set', at: at('b'), value: 1 })).toBe('not-found');
    expect(canEdit(parseText('a: 1\n'), { doc: 3, path: [] })).toBe('not-found');
  });

  it('set result re-parses to the new value', () => {
    const out = edit('a:\n  b: old\n', { op: 'set', at: at('a', 'b'), value: 42 });
    const n = getNode(parseText(out), at('a', 'b')) as { value: unknown };
    expect(n.value).toBe(42);
  });
});
