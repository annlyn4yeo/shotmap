import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

/** Preload only the critical font: the Latin Archivo file used by the first paint. */
function preloadCriticalFont(): Plugin {
  return {
    name: 'shotmap:preload-critical-font',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const file = Object.keys(ctx.bundle ?? {}).find((name) =>
          /archivo-latin-[\w-]+\.woff2$/.test(name),
        );
        if (!file) return [];
        return [
          {
            tag: 'link',
            attrs: {
              rel: 'preload',
              as: 'font',
              type: 'font/woff2',
              href: `/${file}`,
              crossorigin: '',
            },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}

/**
 * Inline the hero match into the page as JSON, so the first view renders with no
 * request. It is the committed fixture of the 2022 final as /v1 answers it, with the
 * data release it was built from, and never a live API's answer (MIGRATION.md R14);
 * a test keeps the fixture equal to the database. The loader reads it back (see
 * seedFromDocument).
 */
function inlineHeroData(): Plugin {
  return {
    name: 'shotmap:inline-hero-data',
    transformIndexHtml() {
      // HERO_MATCH_ID in @shotmap/schema; seed.test.ts checks they agree.
      const fixture = JSON.parse(
        readFileSync('../../docs/golden/final-3869685.api.json', 'utf8'),
      ) as object;
      const json = JSON.stringify(fixture).replaceAll(
        '<',
        `${String.fromCharCode(92)}u003c`,
      );
      return [
        {
          tag: 'script',
          attrs: { type: 'application/json', id: 'seed' },
          children: json,
          injectTo: 'body',
        },
      ];
    },
  };
}

// /v1 is same-origin in production (a Worker route). Locally, dev and preview forward it to
// the Worker: `pnpm api` for the local one, or API_URL=https://... for another.
const api = {
  '/v1': { target: process.env.API_URL ?? 'http://127.0.0.1:8787', changeOrigin: true },
};

export default defineConfig({
  plugins: [preact(), preloadCriticalFont(), inlineHeroData()],
  server: { proxy: api },
  preview: { proxy: api },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    assetsInlineLimit: 0,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
