export type Framework = 'vanilla' | 'react' | 'angular';
export type Lang = 'html' | 'ts' | 'tsx';

/** Short quickstarts. Each uses the same API as its demo. */
export const SNIPPETS: Record<Framework, string> = {
  vanilla: `import { createManifestEditor } from '@stack-weaver/core';
import '@stack-weaver/core/stack-weaver.css';

// Needs a bundler such as Vite. CodeMirror is a peer dependency, loaded on demand.
const editor = createManifestEditor(document.getElementById('editor'), {
  format: 'auto', // or 'kubernetes' | 'compose'
  value: 'services:\\n  web:\\n    image: nginx:1.27\\n',
  mode: 'split',
  onChange: (value) => localStorage.setItem('manifest', value),
  onProblemsChange: (problems) => console.log(problems.length, 'problems'),
});

editor.update({ readOnly: true });`,
  react: `import { useState } from 'react';
import { ManifestEditor } from '@stack-weaver/react';
import '@stack-weaver/core/stack-weaver.css';

export function Editor() {
  const [value, setValue] = useState('services:\\n  web:\\n    image: nginx:1.27\\n');

  return (
    <ManifestEditor
      value={value}
      onChange={setValue}
      format="auto"
      onProblemsChange={(problems) => console.log(problems.length)}
    />
  );
}`,
  angular: `// imports: SwManifestEditor from '@stack-weaver/angular'
// Add '@stack-weaver/core/stack-weaver.css' to the styles of your app.
<sw-manifest-editor
  [(value)]="manifest"
  format="auto"
  [readOnly]="false"
  (problemsChange)="onProblems($event)"
/>`,
};

export const SNIPPET_LANG: Record<Framework, Lang> = { vanilla: 'ts', react: 'tsx', angular: 'html' };

export type TokenKind = 'comment' | 'string' | 'tag' | 'attr' | 'keyword';

/** A run of snippet text; `kind` is absent for plain text. */
export interface Token {
  readonly text: string;
  readonly kind?: TokenKind;
}

const KEYWORDS = 'import|from|export|function|const|let|return|new|type|as';

// Order matters: the first alternative that matches at a position wins.
const TOKEN = new RegExp(
  [
    String.raw`(?<comment><!--[\s\S]*?-->|\/\/[^\n]*|\/\*[\s\S]*?\*\/)`,
    String.raw`(?<string>'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|\x60(?:\\.|[^\x60\\])*\x60)`,
    String.raw`(?<tag><\/?[A-Za-z][\w.-]*)`,
    String.raw`(?<attr>[\[(]*[\w-]+[\])]*(?==["{]))`,
    String.raw`(?<keyword>\b(?:${KEYWORDS})\b)`,
  ].join('|'),
  'g',
);

/** A tiny tokenizer: splits `code` into plain runs and comments, strings, tags, attribute names and keywords. */
export function tokenize(code: string, lang: Lang): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    const kind = Object.entries(m.groups!).find(([, v]) => v !== undefined)![0] as TokenKind;
    if (kind === 'tag' && lang === 'ts') continue; // plain TypeScript has no tags (generics look like them)
    if (m.index! > last) out.push({ text: code.slice(last, m.index) });
    out.push({ text: m[0], kind });
    last = m.index! + m[0].length;
  }
  if (last < code.length) out.push({ text: code.slice(last) });
  return out;
}

/** Fills `target` with the highlighted code as text nodes and `<span class="tok-*">`; never parses HTML. */
export function highlightInto(target: HTMLElement, code: string, lang: Lang): void {
  const doc = target.ownerDocument;
  target.replaceChildren(
    ...tokenize(code, lang).map((t) => {
      if (!t.kind) return doc.createTextNode(t.text);
      const span = doc.createElement('span');
      span.className = `tok-${t.kind}`;
      span.textContent = t.text;
      return span;
    }),
  );
}
