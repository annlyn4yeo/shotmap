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

export default defineConfig({
  plugins: [preact(), preloadCriticalFont()],
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
