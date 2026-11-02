import { defineConfig } from 'vitest/config';
import { siteConfig } from 'stack-weaver-demo-kit';

export default defineConfig({
  define: { __SITE__: JSON.stringify(siteConfig({})) },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.{ts,tsx}'],
    // Iframes only need to exist in tests: let them "load" without navigating anywhere.
    environmentOptions: {
      happyDOM: {
        settings: { enableIframePageLoading: true, navigation: { disableChildFrameNavigation: true } },
      },
    },
  },
});
