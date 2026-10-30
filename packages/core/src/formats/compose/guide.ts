import { deepFreeze } from '../freeze.js';
import type { Guide } from '../types.js';

/**
 * Curated compose guide: a single `services` group and hints for the service definition and for
 * the top-level `network`, `volume`, `config` and `secret` definitions.
 */
export const composeGuide: Guide = deepFreeze<Guide>({
  groups: [{ id: 'services', label: 'Services', order: 1 }],
  kinds: {},
  fields: {
    'service#image': { label: 'Image', tier: 'recommended', order: 1, example: 'nginx:1.27', description: 'The container image to run, for example nginx:1.27.' },
    'service#ports': { label: 'Ports', tier: 'recommended', order: 2, description: 'Ports to open, as "host:container", for example "8080:80".' },
    'service#environment': { label: 'Environment variables', tier: 'recommended', order: 3 },
    'service#depends_on': { label: 'Starts after', order: 4, description: 'Services that must start before this one.' },
    'service#volumes': { label: 'Volumes', order: 5 },
    'service#healthcheck': { label: 'Health check', tier: 'recommended', order: 6 },
    'service#restart': {
      label: 'Restart policy',
      order: 7,
      description: 'When to restart the container: no, always, on-failure or unless-stopped.',
      options: ['no', 'always', 'on-failure', 'unless-stopped'],
    },
    'service#command': { label: 'Command', order: 8, description: "Replaces the image's start command." },
    'service#networks': { label: 'Networks', order: 9, description: 'The networks this service joins.' },
    'service#env_file': { label: 'Environment files', order: 10, description: 'Files to read environment variables from.' },
    'service#build': { label: 'Build', order: 11, description: 'Build the image from a folder with a Dockerfile instead of pulling it.' },
    'service#container_name': { label: 'Container name', order: 12, description: 'A fixed name for the container.' },

    'network#driver': { label: 'Driver', tier: 'recommended', order: 1, example: 'bridge', description: 'The kind of network, for example bridge or overlay.' },
    'network#name': { label: 'Name', order: 2, description: 'The real network name, when it should differ from the key.' },
    'network#external': { label: 'Already exists', order: 3, description: 'Use a network created outside this file instead of creating one.' },
    'network#labels': { label: 'Labels', order: 4 },

    'volume#driver': { label: 'Driver', tier: 'recommended', order: 1, example: 'local', description: 'The storage driver, usually local.' },
    'volume#name': { label: 'Name', order: 2, description: 'The real volume name, when it should differ from the key.' },
    'volume#external': { label: 'Already exists', order: 3, description: 'Use a volume created outside this file instead of creating one.' },
    'volume#labels': { label: 'Labels', order: 4 },

    'config#file': { label: 'File', tier: 'recommended', order: 1, description: 'A file whose content becomes the config.' },
    'config#content': { label: 'Content', order: 2, description: 'The config text written right here, instead of a file.' },
    'config#environment': { label: 'From environment variable', order: 3, description: 'Take the content from an environment variable.' },
    'config#external': { label: 'Already exists', order: 4, description: 'Use a config created outside this file.' },
    'config#name': { label: 'Name', order: 5 },

    'secret#file': { label: 'File', tier: 'recommended', order: 1, description: 'A file whose content becomes the secret.' },
    'secret#environment': { label: 'From environment variable', order: 2, description: 'Take the secret from an environment variable.' },
    'secret#external': { label: 'Already exists', order: 3, description: 'Use a secret created outside this file.' },
    'secret#name': { label: 'Name', order: 4 },
  },
});
