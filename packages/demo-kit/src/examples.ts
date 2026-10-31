import type { EditorMode, VariableDecl, VariablesOption } from '@stack-weaver/core';

/** One sample document the demos offer. */
export interface DemoExample {
  readonly id: 'kubernetes' | 'compose' | 'compose-external' | 'empty' | 'broken';
  readonly label: string;
  readonly format: 'kubernetes' | 'compose' | 'auto';
  readonly value: string;
  readonly variables?: VariablesOption;
}

const K8S = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  labels:
    app: web
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
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 100m
              memory: 64Mi
            limits:
              cpu: 250m
              memory: 128Mi
---
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 80
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
spec:
  rules:
    - host: web.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 80
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

// An unclosed flow map: the YAML parser reports an error, so the broken-YAML banner shows.
const BROKEN = `apiVersion: apps/v1
kind: Deployment
metadata: { name: web
spec:
  replicas: 2
`;

/** The samples, in the order the demos list them. */
export const EXAMPLES: readonly DemoExample[] = [
  { id: 'kubernetes', label: 'Kubernetes web app', format: 'kubernetes', value: K8S },
  { id: 'compose', label: 'Compose with x-variables', format: 'compose', value: COMPOSE_VARS },
  {
    id: 'compose-external',
    label: 'Compose with external variables',
    format: 'compose',
    value: COMPOSE_VARS.replace(/^x-variables:\n(?:  .*\n)+/, ''),
    variables: { store: 'external', value: EXTERNAL_VARS },
  },
  { id: 'empty', label: 'Empty', format: 'auto', value: '' },
  { id: 'broken', label: 'Broken YAML', format: 'kubernetes', value: BROKEN },
];

/** The editor modes, in the order the demos list them. */
export const MODES: readonly { readonly mode: EditorMode; readonly label: string }[] = [
  { mode: 'visual', label: 'Visual' },
  { mode: 'split', label: 'Split' },
  { mode: 'code', label: 'Code' },
];
