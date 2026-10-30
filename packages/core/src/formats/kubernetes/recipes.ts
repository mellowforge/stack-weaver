import type { Recipe } from '../types.js';

const WEB_APP = `apiVersion: apps/v1
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
              memory: 128Mi
            limits:
              memory: 256Mi
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 15
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

const WORKER = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
  labels:
    app: worker
spec:
  replicas: 1
  selector:
    matchLabels:
      app: worker
  template:
    metadata:
      labels:
        app: worker
    spec:
      containers:
        - name: worker
          image: busybox:1.37
          command: ["sh", "-c", "while true; do echo working; sleep 30; done"]
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
`;

const SCHEDULED_JOB = `apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: nightly
              image: busybox:1.37
              command: ["sh", "-c", "echo running the nightly job"]
`;

const CONFIG = `apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  LOG_LEVEL: info
---
apiVersion: v1
kind: Secret
metadata:
  name: app-secret
type: Opaque
stringData:
  DATABASE_PASSWORD: change-me
`;

/** The built-in Kubernetes starter recipes. */
export const kubernetesRecipes: readonly Recipe[] = [
  {
    id: 'k8s-web-app',
    format: 'kubernetes',
    title: 'Web app',
    description: 'A Deployment with probes and resource requests, a Service and an Ingress.',
    yaml: WEB_APP,
    focus: { doc: 0, path: ['spec', 'template', 'spec', 'containers', 0, 'image'] },
  },
  {
    id: 'k8s-worker',
    format: 'kubernetes',
    title: 'Background worker',
    description: 'A Deployment that runs a process with no network exposure.',
    yaml: WORKER,
    focus: { doc: 0, path: ['spec', 'template', 'spec', 'containers', 0, 'image'] },
  },
  {
    id: 'k8s-scheduled-job',
    format: 'kubernetes',
    title: 'Scheduled job',
    description: 'A CronJob that runs a container on a schedule.',
    yaml: SCHEDULED_JOB,
    focus: { doc: 0, path: ['spec', 'jobTemplate', 'spec', 'template', 'spec', 'containers', 0, 'image'] },
  },
  {
    id: 'k8s-config',
    format: 'kubernetes',
    title: 'Config and secret',
    description: 'A ConfigMap for settings and a Secret for credentials.',
    yaml: CONFIG,
    focus: { doc: 1, path: ['stringData', 'DATABASE_PASSWORD'] },
  },
];
