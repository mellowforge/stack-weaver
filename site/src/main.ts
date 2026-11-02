import '@mellowforge/stack-weaver-core/stack-weaver.css';
import './styles.css';
import { docsLinks, readTheme, applyPageTheme } from 'stack-weaver-demo-kit';
import { site } from './config.js';
import { copyButton, mountFooter } from './footer.js';
import { mountFrameworks } from './frameworks.js';
import { createThemeSwitch } from './theme-switch.js';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

byId('brand').textContent = site.name;
byId<HTMLAnchorElement>('nav-docs').href = docsLinks(site.repoUrl).core;
byId<HTMLAnchorElement>('nav-github').href = site.repoUrl;

// The theme: applied from the stored value, kept in step with the other frames (the iframes) and the switches.
applyPageTheme(document, readTheme());
const page = new AbortController();
byId('theme-slot').append(createThemeSwitch(page.signal));

const INSTALL = 'pnpm add @mellowforge/stack-weaver-core';
const hero = byId('demo');
const title = document.createElement('h1');
title.id = 'hero-title';
title.className = 'hero-title';
title.textContent = 'A visual and code editor for Kubernetes and Compose YAML';
const sub = document.createElement('p');
sub.className = 'hero-sub';
sub.textContent =
  'A schema-driven visual and code editor for Kubernetes and docker-compose YAML. A framework-agnostic core with React and Angular wrappers.';
const install = document.createElement('div');
install.className = 'install';
const code = document.createElement('code');
code.textContent = INSTALL;
install.append(code, copyButton(() => INSTALL, { name: 'install command', select: code }));
hero.append(title, sub, install);

mountFrameworks(byId('frameworks'), site);
mountFooter(byId('footer'), site);
