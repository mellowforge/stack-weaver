import { deepFreeze } from '../freeze.js';
import type { Guide } from '../types.js';

const V1 = 'io.k8s.api.core.v1.';
const META = 'io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta';
const CONTAINER = `${V1}Container`;
const SECRET_KEY = `${V1}SecretKeySelector`;
const CONFIG_KEY = `${V1}ConfigMapKeySelector`;

/**
 * Curated Kubernetes guide: intent groups, plain-language kind cards, and field hints for the
 * v1 kinds (Deployment, StatefulSet, Job, CronJob, Service, Ingress, ConfigMap, Secret,
 * HorizontalPodAutoscaler, PersistentVolumeClaim) and the shared definitions they use. Special
 * widgets (`ref`, `ref-key`, `secret-data`) are selected here. Fields without an entry fall back
 * to the schema's own descriptions and count as advanced.
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
    // Shared: metadata.
    [`${META}#name`]: { label: 'Name', tier: 'recommended', order: 1, description: 'The name of this resource. It must be unique among resources of the same kind in the namespace.' },
    [`${META}#namespace`]: { label: 'Namespace', order: 2, description: 'The group of resources this one lives in. Leave it out to use the default namespace.' },
    [`${META}#labels`]: { label: 'Labels', order: 3, description: 'Key-value tags used to find and group resources, for example app: web.' },
    [`${META}#annotations`]: { label: 'Annotations', order: 4, description: 'Free-form notes that tools can read. They are not used to select resources.' },

    // Shared: pod template and pod.
    [`${V1}PodTemplateSpec#metadata`]: { label: 'Pod labels', order: 1, description: 'Labels given to every pod. A selector uses them to find the pods.' },
    [`${V1}PodTemplateSpec#spec`]: { label: 'Pod', tier: 'recommended', order: 2, description: 'What each pod runs: its containers, volumes and settings.' },
    [`${V1}PodSpec#containers`]: { tier: 'recommended', order: 1, description: 'The programs the pod runs, each from a container image.' },
    [`${V1}PodSpec#initContainers`]: { label: 'Init containers', order: 2, description: 'Containers that run to completion, one after another, before the main containers start.' },
    [`${V1}PodSpec#volumes`]: { label: 'Volumes', order: 3, description: 'Storage and files the containers can mount.' },
    [`${V1}PodSpec#restartPolicy`]: {
      label: 'Restart policy',
      order: 4,
      description: 'When to restart containers that stop: Always, OnFailure or Never.',
      options: ['Always', 'OnFailure', 'Never'],
    },
    [`${V1}PodSpec#serviceAccountName`]: { label: 'Service account', order: 5, description: 'The identity the pod uses when it talks to the Kubernetes API.' },
    [`${V1}PodSpec#imagePullSecrets`]: { label: 'Image pull secrets', order: 6, description: 'Secrets holding the credentials for a private image registry.' },
    [`${V1}PodSpec#nodeSelector`]: { label: 'Node selector', order: 7, description: 'Only run on nodes that have all of these labels.' },

    // Shared: container.
    [`${CONTAINER}#name`]: { label: 'Name', order: 1 },
    [`${CONTAINER}#image`]: { label: 'Image', tier: 'recommended', order: 2, example: 'nginx:1.27', description: 'The container image to run, for example nginx:1.27.' },
    [`${CONTAINER}#ports`]: { label: 'Ports', order: 3 },
    [`${CONTAINER}#env`]: { label: 'Environment variables', order: 4 },
    [`${CONTAINER}#resources`]: { label: 'CPU & memory', tier: 'recommended', order: 5 },
    [`${CONTAINER}#readinessProbe`]: { label: 'Readiness check', tier: 'recommended', order: 6 },
    [`${CONTAINER}#livenessProbe`]: { label: 'Liveness check', tier: 'recommended', order: 7 },
    [`${CONTAINER}#command`]: { label: 'Command', order: 8, description: "Replaces the image's start command." },
    [`${CONTAINER}#args`]: { label: 'Arguments', order: 9, description: 'Arguments passed to the start command.' },
    [`${CONTAINER}#envFrom`]: { label: 'Environment from ConfigMap or Secret', order: 10, description: 'Add every key of a ConfigMap or Secret as an environment variable.' },
    [`${CONTAINER}#volumeMounts`]: { label: 'Volume mounts', order: 11, description: "Where to mount the pod's volumes inside this container." },
    [`${CONTAINER}#imagePullPolicy`]: {
      label: 'Image pull policy',
      order: 12,
      description: 'When to download the image: Always, IfNotPresent (only if it is not on the node) or Never.',
      options: ['Always', 'IfNotPresent', 'Never'],
    },
    [`${V1}ContainerPort#containerPort`]: { label: 'Container port', tier: 'recommended', order: 1, description: 'The port your app listens on inside the container.' },
    [`${V1}ContainerPort#name`]: { label: 'Name', order: 2, description: 'A short name for the port, so other settings can refer to it.' },
    [`${V1}ContainerPort#protocol`]: { label: 'Protocol', order: 3, options: ['TCP', 'UDP', 'SCTP'] },
    [`${V1}EnvVar#name`]: { label: 'Name', order: 1 },
    [`${V1}EnvVar#value`]: { label: 'Value', tier: 'recommended', order: 2, description: 'The value of the variable. To read it from a Secret or ConfigMap instead, use "Value from".' },
    [`${V1}EnvVar#valueFrom`]: { label: 'Value from', order: 3, description: 'Read the value from a Secret, a ConfigMap or the pod itself.' },
    [`${V1}EnvVarSource#secretKeyRef`]: { label: 'From a Secret', order: 1, description: 'Use one key of a Secret as the value.' },
    [`${V1}EnvVarSource#configMapKeyRef`]: { label: 'From a ConfigMap', order: 2, description: 'Use one key of a ConfigMap as the value.' },
    [`${V1}EnvFromSource#secretRef`]: { label: 'Secret', order: 1, description: 'A Secret whose keys all become environment variables.' },
    [`${V1}EnvFromSource#configMapRef`]: { label: 'ConfigMap', order: 2, description: 'A ConfigMap whose keys all become environment variables.' },
    [`${V1}Volume#name`]: { label: 'Name', order: 1 },
    [`${V1}Volume#secret`]: { label: 'Secret', order: 2, description: 'Mount the keys of a Secret as files.' },
    [`${V1}Volume#configMap`]: { label: 'ConfigMap', order: 3, description: 'Mount the keys of a ConfigMap as files.' },
    [`${V1}Volume#persistentVolumeClaim`]: { label: 'Persistent volume claim', order: 4, description: 'Mount disk space requested with a PersistentVolumeClaim.' },
    [`${V1}Volume#emptyDir`]: { label: 'Scratch space', order: 5, description: 'An empty folder that lives as long as the pod.' },

    // References to Secrets and ConfigMaps: pickers over the documents in the same text.
    [`${SECRET_KEY}#name`]: { label: 'Secret', tier: 'recommended', order: 1, widget: 'ref:Secret', description: 'The name of the Secret.' },
    [`${SECRET_KEY}#key`]: { label: 'Key', tier: 'recommended', order: 2, widget: 'ref-key:Secret', description: 'Which key of the Secret to use.' },
    [`${V1}SecretEnvSource#name`]: { label: 'Secret', tier: 'recommended', order: 1, widget: 'ref:Secret', description: 'The name of the Secret.' },
    [`${V1}SecretVolumeSource#secretName`]: { label: 'Secret', tier: 'recommended', order: 1, widget: 'ref:Secret', description: 'The name of the Secret.' },
    [`${CONFIG_KEY}#name`]: { label: 'ConfigMap', tier: 'recommended', order: 1, widget: 'ref:ConfigMap', description: 'The name of the ConfigMap.' },
    [`${CONFIG_KEY}#key`]: { label: 'Key', tier: 'recommended', order: 2, widget: 'ref-key:ConfigMap', description: 'Which key of the ConfigMap to use.' },
    [`${V1}ConfigMapEnvSource#name`]: { label: 'ConfigMap', tier: 'recommended', order: 1, widget: 'ref:ConfigMap', description: 'The name of the ConfigMap.' },
    [`${V1}ConfigMapVolumeSource#name`]: { label: 'ConfigMap', tier: 'recommended', order: 1, widget: 'ref:ConfigMap', description: 'The name of the ConfigMap.' },

    // Deployment.
    'io.k8s.api.apps.v1.DeploymentSpec#replicas': { label: 'Replicas', tier: 'recommended', order: 1, example: 1, description: 'How many copies (pods) of your app to run.' },
    'io.k8s.api.apps.v1.DeploymentSpec#selector': { order: 2 },
    'io.k8s.api.apps.v1.DeploymentSpec#template': { label: 'Pod template', order: 3, description: 'The blueprint every pod is created from.' },
    'io.k8s.api.apps.v1.DeploymentSpec#strategy': { label: 'Update strategy', order: 4, description: 'How to replace old pods when the template changes.' },
    'io.k8s.api.apps.v1.DeploymentStrategy#type': {
      label: 'Strategy',
      order: 1,
      description: 'RollingUpdate replaces pods gradually; Recreate stops all old pods first.',
      options: ['RollingUpdate', 'Recreate'],
    },

    // StatefulSet.
    'io.k8s.api.apps.v1.StatefulSetSpec#serviceName': { label: 'Service name', tier: 'recommended', order: 1, description: 'The name of the headless Service that gives each pod a stable network name.' },
    'io.k8s.api.apps.v1.StatefulSetSpec#replicas': { label: 'Replicas', tier: 'recommended', order: 2, example: 1, description: 'How many pods to run.' },
    'io.k8s.api.apps.v1.StatefulSetSpec#selector': { order: 3 },
    'io.k8s.api.apps.v1.StatefulSetSpec#template': { label: 'Pod template', order: 4, description: 'The blueprint every pod is created from.' },
    'io.k8s.api.apps.v1.StatefulSetSpec#volumeClaimTemplates': { label: 'Storage per pod', order: 5, description: 'A disk that is created for each pod and kept when the pod is replaced.' },

    // Job and CronJob.
    'io.k8s.api.batch.v1.JobSpec#template': { label: 'Pod template', tier: 'recommended', order: 1, description: 'The blueprint for the pod that does the work.' },
    'io.k8s.api.batch.v1.JobSpec#backoffLimit': { label: 'Retries', order: 2, example: 6, description: 'How many times to retry before the Job is marked failed.' },
    'io.k8s.api.batch.v1.JobSpec#completions': { label: 'Completions', order: 3, description: 'How many pods must finish successfully.' },
    'io.k8s.api.batch.v1.JobSpec#parallelism': { label: 'Parallelism', order: 4, description: 'How many pods may run at the same time.' },
    'io.k8s.api.batch.v1.CronJobSpec#schedule': { label: 'Schedule', tier: 'recommended', order: 1, example: '0 * * * *', description: 'When to run, in cron format: minute hour day month weekday. 0 * * * * is every hour.' },
    'io.k8s.api.batch.v1.CronJobSpec#jobTemplate': { label: 'Job template', tier: 'recommended', order: 2, description: 'The Job to create on every run.' },
    'io.k8s.api.batch.v1.CronJobSpec#concurrencyPolicy': {
      label: 'If a run is still going',
      order: 3,
      description: 'Allow starts another run, Forbid skips the new run, Replace stops the old run.',
      options: ['Allow', 'Forbid', 'Replace'],
    },
    'io.k8s.api.batch.v1.CronJobSpec#suspend': { label: 'Paused', order: 4, description: 'Stop creating new runs.' },
    'io.k8s.api.batch.v1.JobTemplateSpec#spec': { label: 'Job', order: 1 },

    // Service.
    [`${V1}ServiceSpec#type`]: {
      label: 'Type',
      tier: 'recommended',
      order: 1,
      description: 'ClusterIP is reachable inside the cluster only; NodePort and LoadBalancer also open it to the outside; ExternalName is a DNS alias.',
      options: ['ClusterIP', 'NodePort', 'LoadBalancer', 'ExternalName'],
    },
    [`${V1}ServiceSpec#selector`]: { label: 'Pod selector', tier: 'recommended', order: 2, description: 'Send traffic to the pods that have all of these labels.' },
    [`${V1}ServiceSpec#ports`]: { label: 'Ports', tier: 'recommended', order: 3 },
    [`${V1}ServicePort#port`]: { label: 'Port', tier: 'recommended', order: 1, description: 'The port this Service listens on.' },
    [`${V1}ServicePort#targetPort`]: { label: 'Target port', order: 2, description: 'The port on the pods to send traffic to. Defaults to the same as Port.' },
    [`${V1}ServicePort#name`]: { label: 'Name', order: 3 },
    [`${V1}ServicePort#protocol`]: { label: 'Protocol', order: 4, options: ['TCP', 'UDP', 'SCTP'] },

    // Ingress.
    'io.k8s.api.networking.v1.IngressSpec#rules': { label: 'Rules', tier: 'recommended', order: 1, description: 'Which host names and paths go to which Service.' },
    'io.k8s.api.networking.v1.IngressSpec#ingressClassName': { label: 'Ingress class', order: 2, description: 'Which ingress controller handles this Ingress, for example nginx.' },
    'io.k8s.api.networking.v1.IngressSpec#tls': { label: 'HTTPS (TLS)', order: 3, description: 'Host names to serve over HTTPS and the Secret with their certificate.' },
    'io.k8s.api.networking.v1.IngressSpec#defaultBackend': { label: 'Default backend', order: 4, description: 'Where to send requests that match no rule.' },

    // ConfigMap and Secret.
    [`${V1}ConfigMap#data`]: { tier: 'recommended', order: 1, description: 'Settings or config files as text. Each key can be an environment variable or a file.' },
    [`${V1}ConfigMap#binaryData`]: { label: 'Binary data', order: 2, description: 'Binary content, written as base64 text.' },
    [`${V1}Secret#stringData`]: { label: 'String data', tier: 'recommended', order: 1, description: 'Secret values as plain text. Kubernetes encodes them for you when the Secret is saved.' },
    [`${V1}Secret#data`]: { label: 'Data (shown decoded)', order: 2, widget: 'secret-data', description: 'Existing values. They are stored as base64; here you see and edit the decoded text.' },
    [`${V1}Secret#type`]: { label: 'Type', order: 3, description: 'What the Secret is for, for example Opaque or kubernetes.io/tls.' },

    // HorizontalPodAutoscaler.
    'io.k8s.api.autoscaling.v2.HorizontalPodAutoscalerSpec#scaleTargetRef': { label: 'Scale this', tier: 'recommended', order: 1, description: 'The Deployment or StatefulSet to scale: its apiVersion, kind and name.' },
    'io.k8s.api.autoscaling.v2.HorizontalPodAutoscalerSpec#minReplicas': { label: 'Minimum pods', tier: 'recommended', order: 2, example: 1 },
    'io.k8s.api.autoscaling.v2.HorizontalPodAutoscalerSpec#maxReplicas': { label: 'Maximum pods', tier: 'recommended', order: 3, example: 5 },
    'io.k8s.api.autoscaling.v2.HorizontalPodAutoscalerSpec#metrics': { label: 'Scale on', order: 4, description: 'The measurements to follow, such as average CPU use.' },

    // PersistentVolumeClaim.
    [`${V1}PersistentVolumeClaimSpec#accessModes`]: {
      label: 'Access modes',
      tier: 'recommended',
      order: 1,
      description: 'ReadWriteOnce: one node reads and writes. ReadOnlyMany: many nodes read. ReadWriteMany: many nodes read and write. ReadWriteOncePod: one pod reads and writes.',
      options: ['ReadWriteOnce', 'ReadOnlyMany', 'ReadWriteMany', 'ReadWriteOncePod'],
    },
    [`${V1}PersistentVolumeClaimSpec#resources`]: { label: 'Size', tier: 'recommended', order: 2, description: 'How much space to request, under requests: storage, for example 10Gi.' },
    [`${V1}PersistentVolumeClaimSpec#storageClassName`]: { label: 'Storage class', order: 3, description: 'The kind of disk to use. Leave it out for the cluster default.' },
  },
});
