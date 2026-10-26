/** Writes docs/openapi.json (committed) and docs/API.md (generated prose). Run from anywhere in the repo. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApiMarkdown, buildOpenApi } from '../src/openapi';

const docs = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs');
mkdirSync(docs, { recursive: true });
writeFileSync(join(docs, 'openapi.json'), `${JSON.stringify(buildOpenApi(), null, 2)}\n`);
writeFileSync(join(docs, 'API.md'), buildApiMarkdown());
console.log(`wrote ${join(docs, 'openapi.json')} and ${join(docs, 'API.md')}`);
