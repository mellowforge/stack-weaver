import { deepFreeze } from '../freeze.js';
import type { Guide } from '../types.js';

const CONTAINER = 'io.k8s.api.core.v1.Container';

/**
 * Curated Kubernetes guide: intent groups, plain-language kind cards and container field hints.
 * Fields without an entry fall back to the schema's own descriptions and count as advanced.
 */
export const kubernetesGuide: Guide = deepFreeze<Guide>({
  groups: [
    { id: 'run', label: 'Run your app', order: 1 },
    { id: 'expose', label: 'Expose it', order: 2 },
    { id: 'configure', label: 'Configure it', order: 3 },
    { id: 'scale', label: 'Scale & protect', order: 4 },
    { id: 'storage', label: 'Storage', order: 5 },
  ],
  kinds: {
    'apps/v1/Deployment': { label: 'Deployment', description: 'Long-running stateless app', group: 'run', order: 1 },
    'apps/v1/StatefulSet': {
      label: 'StatefulSet',
      description: 'App with stable identity & storage',
      group: 'run',
      order: 2,
    },
    'batch/v1/Job': { label: 'Job', description: 'Run a task once until it finishes', group: 'run', order: 3 },
    'batch/v1/CronJob': { label: 'CronJob', description: 'Run a task on a schedule', group: 'run', order: 4 },
    'v1/Service': { label: 'Service', description: 'Stable network address for your pods', group: 'expose', order: 1 },
    'networking.k8s.io/v1/Ingress': {
      label: 'Ingress',
      description: 'HTTP(S) routing from outside the cluster',
      group: 'expose',
      order: 2,
    },
    'v1/ConfigMap': { label: 'ConfigMap', description: 'Non-secret settings & config files', group: 'configure', order: 1 },
    'v1/Secret': { label: 'Secret', description: 'Passwords, tokens, keys', group: 'configure', order: 2 },
    'autoscaling/v2/HorizontalPodAutoscaler': {
      label: 'HorizontalPodAutoscaler',
      description: 'Add/remove pods based on load',
      group: 'scale',
      order: 1,
    },
    'v1/PersistentVolumeClaim': {
      label: 'PersistentVolumeClaim',
      description: 'Request disk space that outlives your pods',
      group: 'storage',
      order: 1,
    },
  },
  fields: {
    [`${CONTAINER}#name`]: { label: 'Name', order: 1 },
    [`${CONTAINER}#image`]: { label: 'Image', order: 2, example: 'nginx:1.27' },
    [`${CONTAINER}#ports`]: { label: 'Ports', order: 3 },
    [`${CONTAINER}#env`]: { label: 'Environment variables', order: 4 },
    [`${CONTAINER}#resources`]: { label: 'CPU & memory', tier: 'recommended', order: 5 },
    [`${CONTAINER}#readinessProbe`]: { label: 'Readiness check', tier: 'recommended', order: 6 },
    [`${CONTAINER}#livenessProbe`]: { label: 'Liveness check', tier: 'recommended', order: 7 },
  },
});
