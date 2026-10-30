import type { Recipe } from '../types.js';

const WEB_APP = `services:
  web:
    image: nginx:1.27
    ports:
      - "8080:80"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/"]
      interval: 30s
      timeout: 5s
      retries: 3
`;

const APP_POSTGRES = `services:
  app:
    image: nginx:1.27
    ports:
      - "8080:80"
    environment:
      DATABASE_URL: postgres://app:change-me@db:5432/app
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: change-me
      POSTGRES_DB: app
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 10s
      timeout: 5s
      retries: 5
volumes:
  db-data:
`;

const APP_REDIS = `services:
  app:
    image: nginx:1.27
    ports:
      - "8080:80"
    environment:
      REDIS_URL: redis://cache:6379
    depends_on:
      - cache
  cache:
    image: redis:7
    volumes:
      - cache-data:/data
volumes:
  cache-data:
`;

/** The built-in Docker Compose starter recipes. */
export const composeRecipes: readonly Recipe[] = [
  {
    id: 'compose-web-app',
    format: 'compose',
    title: 'Web app',
    description: 'One web service with a published port and a health check.',
    yaml: WEB_APP,
    focus: { doc: 0, path: ['services', 'web', 'image'] },
  },
  {
    id: 'compose-app-postgres',
    format: 'compose',
    title: 'App with Postgres',
    description: 'An app and a Postgres database with a persistent volume.',
    yaml: APP_POSTGRES,
    focus: { doc: 0, path: ['services', 'app', 'image'] },
  },
  {
    id: 'compose-app-redis',
    format: 'compose',
    title: 'App with Redis',
    description: 'An app and a Redis cache with a persistent volume.',
    yaml: APP_REDIS,
    focus: { doc: 0, path: ['services', 'app', 'image'] },
  },
];
