import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://blog.kalevip.top',
  output: 'server',
  adapter: cloudflare({
    configPath: './wrangler.jsonc',
    persistState: { path: './.wrangler/state' },
    imageService: 'passthrough'
  }),
  integrations: [react()],
  vite: {
    // Keep browser-worker parser imports split; JSON should not download every formatter.
    worker: { format: 'es' },
    // Check/build must not invalidate optimized dependencies in a running dev server.
    cacheDir: process.argv.includes('dev') ? 'node_modules/.vite-dev' : 'node_modules/.vite-build',
    plugins: [tailwindcss()]
  },
  server: {
    host: true,
    port: 4321
  }
});
