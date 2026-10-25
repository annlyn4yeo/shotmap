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
      const index = readFileSync(`${dir}/index.json`, 'utf8');
      const hero = (JSON.parse(index) as { hero: number }).hero;
      const match = readFileSync(`${dir}/matches/${hero}.json`, 'utf8');
      const json = `{"index":${index},"match":${match}}`.replaceAll(
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

export default defineConfig({
  plugins: [preact(), preloadCriticalFont(), inlineHeroData()],
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
