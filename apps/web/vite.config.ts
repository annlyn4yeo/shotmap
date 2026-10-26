import { existsSync, readFileSync } from 'node:fs';
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
 * Inline the index and the hero match into the page as JSON, so the first view
 * renders with no request. The loader reads it back (see seedFromDocument).
 */
function inlineHeroData(): Plugin {
  return {
    name: 'shotmap:inline-hero-data',
    transformIndexHtml() {
      const dir = 'public/data';
      if (!existsSync(`${dir}/index.json`)) return [];
      const index = JSON.parse(readFileSync(`${dir}/index.json`, 'utf8')) as {
        hero: number;
      };
      // The hero match comes from the committed fixture, and the release it was built from
      // from the fixture of the same match as /v1 answers it: never a live API (R14).
      const golden = `../../docs/golden/final-${index.hero}`;
      const match = JSON.parse(readFileSync(`${golden}.json`, 'utf8')) as {
        meta: { id: number };
      };
      const { release } = JSON.parse(readFileSync(`${golden}.api.json`, 'utf8')) as {
        release: string;
      };
      if (match.meta.id !== index.hero)
        throw new Error(`the hero fixture is match ${match.meta.id}, not ${index.hero}`);
      const json = JSON.stringify({ release, index, match }).replaceAll(
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
