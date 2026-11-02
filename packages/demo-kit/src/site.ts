export interface SiteConfig {
  name: 'stack-weaver';
  base: string;
  repoUrl: string;
  showNpm: boolean;
}

const DEFAULT_REPO_URL = 'https://github.com/mellowforge/stack-weaver';

/**
 * Base path is `/<repo>/` whenever GITHUB_REPOSITORY is `<owner>/<repo>`, else `/`.
 * `repoUrl` is always the project repository; `showNpm` is on only for `SHOW_NPM=1`.
 */
export function siteConfig(env: { GITHUB_REPOSITORY?: string; SHOW_NPM?: string }): SiteConfig {
  const [owner, repo] = (env.GITHUB_REPOSITORY ?? '').split('/');
  return {
    name: 'stack-weaver',
    base: owner && repo ? `/${repo}/` : '/',
    repoUrl: DEFAULT_REPO_URL,
    showNpm: env.SHOW_NPM === '1',
  };
}

/** Links to the three package READMEs on the default branch. */
export function docsLinks(repoUrl: string): { core: string; react: string; angular: string } {
  const blob = `${repoUrl}/blob/main`;
  return {
    core: `${blob}/packages/core/README.md`,
    react: `${blob}/packages/react/README.md`,
    angular: `${blob}/packages/angular/projects/stack-weaver-angular/README.md`,
  };
}
