// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// TODO : remplacer par le domaine définitif quand il sera choisi
export default defineConfig({
  site: 'https://af.damien.asia',
  integrations: [sitemap()],
});
