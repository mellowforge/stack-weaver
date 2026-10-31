import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
copyFileSync('src/theme.css', 'dist/theme.css');
copyFileSync('src/controls.css', 'dist/controls.css');
