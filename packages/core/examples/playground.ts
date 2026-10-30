import { createManifestEditor, type EditorMode, type ManifestEditor, type ManifestEditorOptions } from '../src/index.ts';
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

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const logEl = $('log');
const log = (line: string): void => {
  logEl.textContent += `${new Date().toLocaleTimeString()} ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
};

let theme: 'light' | 'dark' = 'light';
let readOnly = false;
let editor: ManifestEditor | undefined;

function mount(format: string, value: string): void {
  editor?.destroy();
  const opts: ManifestEditorOptions = {
    format,
    value,
    mode: $<HTMLSelectElement>('mode').value as EditorMode,
    theme,
    readOnly,
    onChange: (v, { origin }) => log(`onChange origin=${origin} length=${v.length}`),
    onProblemsChange: (p) => log(`onProblemsChange count=${p.length}`),
    onModeChange: (m) => {
      $<HTMLSelectElement>('mode').value = m;
      log(`onModeChange ${m}`);
    },
  };
  editor = createManifestEditor($('editor'), opts);
  void editor.ready.then(() => log('ready'));
  (window as unknown as { editor: ManifestEditor }).editor = editor;
}

$<HTMLSelectElement>('mode').addEventListener('change', (e) => editor?.setMode((e.target as HTMLSelectElement).value as EditorMode));
$<HTMLSelectElement>('format').addEventListener('change', (e) => mount((e.target as HTMLSelectElement).value, editor?.getValue() ?? ''));
$('theme').addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  document.body.dataset.theme = theme;
  mount($<HTMLSelectElement>('format').value, editor?.getValue() ?? '');
});
$('sample-k8s').addEventListener('click', () => editor?.setValue(K8S));
$('sample-compose').addEventListener('click', () => editor?.setValue(COMPOSE));
$('clear').addEventListener('click', () => editor?.setValue(''));
$('readonly').addEventListener('click', () => {
  readOnly = !readOnly;
  editor?.setReadOnly(readOnly);
  log(`readOnly=${readOnly}`);
});

mount('auto', K8S);
