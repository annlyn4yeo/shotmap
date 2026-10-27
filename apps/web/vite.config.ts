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

/**
 * A top-level 404.html turns Cloudflare Pages' automatic single-page fallback off (it answers
 * every unknown path with the app and a 200, /v1/* included); public/_redirects then names the
 * app's own paths. This is that page. It is made from the app's own stylesheet and classes, so
 * it has the same paper, rules and type and no colours of its own.
 */
function emitNotFoundPage(): Plugin {
  return {
    name: 'shotmap:not-found-page',
    generateBundle(_options, bundle) {
      const css = Object.keys(bundle).find((name) =>
        /^assets\/index-[\w-]+\.css$/.test(name),
      );
      if (!css) return;
      this.emitFile({
        type: 'asset',
        fileName: '404.html',
        source: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex" />
    <title>No such page | Shotmap</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/${css}" />
  </head>
  <body>
    <main class="main">
      <section class="state">
        <h1 class="state-title">No such page</h1>
        <p>Nothing lives at this address.</p>
        <div class="state-actions">
          <a class="state-button" data-primary href="/">The 2022 final</a>
          <a class="state-button" href="/matches">Browse the matches</a>
        </div>
      </section>
    </main>
  </body>
</html>
`,
      });
    },
  };
}

// /v1 is same-origin in production (a Worker route). Locally, dev and preview forward it to
// the Worker: `pnpm api` for the local one, or API_URL=https://... for another.
const api = {
  '/v1': { target: process.env.API_URL ?? 'http://127.0.0.1:8787', changeOrigin: true },
};

export default defineConfig({
  plugins: [preact(), preloadCriticalFont(), inlineHeroData(), emitNotFoundPage()],
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
