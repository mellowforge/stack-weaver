import type { Guide } from '../types.js';

/** Curated compose guide: a single `services` group and hints for the service definition. */
export const composeGuide: Guide = {
  groups: [{ id: 'services', label: 'Services', order: 1 }],
  kinds: {},
  fields: {
    'service#image': { label: 'Image', order: 1, example: 'nginx:1.27' },
    'service#ports': { label: 'Ports', order: 2 },
    'service#environment': { label: 'Environment variables', order: 3 },
    'service#depends_on': { label: 'Starts after', order: 4 },
    'service#volumes': { label: 'Volumes', order: 5 },
    'service#healthcheck': { label: 'Health check', recommended: true, order: 6 },
  },
};
