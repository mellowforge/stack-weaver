import { createManifestEditor, type EditorMode, type ManifestEditor, type ManifestEditorOptions, type VariableDecl } from '../src/index.ts';
import '../src/styles/stack-weaver.css';

const K8S = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.27
---
apiVersion: v1
kind: Secret
metadata:
  name: creds
type: Opaque
data:
  password: aHVudGVyMg==
`;

const COMPOSE = `services:
  web:
    image: nginx:1.27
    ports:
      - "8080:80"
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: example
`;

// Uses ${WEB_PORT} and ${TAG}, declared in the x-variables block (the default store).
const COMPOSE_VARS = `x-variables:
  WEB_PORT: { type: port, default: 8080, description: Public port }
  TAG: { type: string, default: "1.27" }
services:
  web:
    image: nginx:\${TAG}
    ports:
      - "\${WEB_PORT}:80"
  db:
    image: postgres:16
`;

// The same declarations for the external store, where the host owns them.
const EXTERNAL_VARS: readonly VariableDecl[] = [
  { name: 'WEB_PORT', type: 'port', default: 8080, description: 'Public port' },
  { name: 'TAG', type: 'string', default: '1.27' },
];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const logEl = $('log');
const log = (line: string): void => {
  logEl.textContent += `${new Date().toLocaleTimeString()} ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
};

const variablesLogEl = $('variables-log');
const logVariables = (decls: readonly VariableDecl[]): void => {
  variablesLogEl.textContent = `${new Date().toLocaleTimeString()} onVariablesChange ${JSON.stringify(decls)}`;
};
const store = (): 'x-variables' | 'external' => $<HTMLSelectElement>('variables-store').value as 'x-variables' | 'external';

let theme: 'light' | 'dark' = 'light';
let readOnly = false;
let editor: ManifestEditor | undefined;

function mount(format: string, value: string): void {
  const opts: ManifestEditorOptions = {
    format,
    value,
    mode: $<HTMLSelectElement>('mode').value as EditorMode,
    theme,
    readOnly,
    variables: store() === 'external' ? { store: 'external', value: editor?.getVariables() ?? EXTERNAL_VARS } : { store: 'x-variables' },
    onVariablesChange: (decls) => {
      logVariables(decls);
      log(`onVariablesChange count=${decls.length}`);
    },
    onChange: (v, { origin }) => log(`onChange origin=${origin} length=${v.length}`),
    onProblemsChange: (p) => log(`onProblemsChange count=${p.length}`),
    onModeChange: (m) => {
      $<HTMLSelectElement>('mode').value = m;
      log(`onModeChange ${m}`);
    },
  };
  editor?.destroy();
  editor = createManifestEditor($('editor'), opts);
  editor.ready.then(
    () => log('ready'),
    (err: unknown) => log(`ready rejected: ${String(err)}`),
  );
  (window as unknown as { editor: ManifestEditor }).editor = editor;
}

$<HTMLSelectElement>('mode').addEventListener('change', (e) => editor?.setMode((e.target as HTMLSelectElement).value as EditorMode));
$<HTMLSelectElement>('format').addEventListener('change', (e) => mount((e.target as HTMLSelectElement).value, editor?.getValue() ?? ''));
// A store is fixed when the editor is created, so changing it recreates the editor over the same text.
$<HTMLSelectElement>('variables-store').addEventListener('change', () => mount($<HTMLSelectElement>('format').value, editor?.getValue() ?? ''));
$('theme').addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  document.body.dataset.theme = theme;
  editor?.setTheme(theme);
});
$('sample-k8s').addEventListener('click', () => editor?.setValue(K8S));
$('sample-compose').addEventListener('click', () => editor?.setValue(COMPOSE));
$('sample-compose-vars').addEventListener('click', () => editor?.setValue(COMPOSE_VARS));
$('clear').addEventListener('click', () => editor?.setValue(''));
$('readonly').addEventListener('click', () => {
  readOnly = !readOnly;
  editor?.setReadOnly(readOnly);
  log(`readOnly=${readOnly}`);
});

mount('auto', K8S);
