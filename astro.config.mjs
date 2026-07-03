// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://af.damien.asia',
  integrations: [sitemap()],
  vite: {
    build: {
      // aucun script inliné dans le HTML : la CSP de prod est stricte
      // (script-src 'self', sans 'unsafe-inline') — cf. deploy/Caddyfile.web
      assetsInlineLimit: 0,
    },
  },
});
