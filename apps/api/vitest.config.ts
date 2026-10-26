import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Two projects. "shim": the Hono app on node:sqlite behind a D1-shaped shim, for the heavy
// checks over all 149 matches. "workerd": the real Worker entry inside the Workers runtime
// with a real (local) D1, which also proves the SQL dump loads into D1's engine.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shim', include: ['test/*.test.ts'], environment: 'node' } },
      {
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'workerd',
          include: ['test/workers/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
