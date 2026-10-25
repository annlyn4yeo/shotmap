/**
 * Golden master for the generated data.
 *
 * docs/golden/manifest.json holds the SHA-256 of the canonical JSON (object keys
 * sorted at every level, no whitespace) of every file in public/data. It is the
 * oracle the API must match during the migration, and it is kept permanently.
 * Hashing the parsed content, not the bytes, means formatting never matters.
 *
 *   pnpm exec tsx scripts/golden.ts check   verify public/data against the manifest
 *   pnpm exec tsx scripts/golden.ts write   create the manifest (refuses to replace one)
 *
 * Run from the package that owns public/data.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DATA = join('public', 'data');

export interface Manifest {
  about: string;
  algorithm: 'sha256';
  canonicalisation: string;
  fileCount: number;
  /** Path relative to public/data -> hex digest. */
  files: Record<string, string>;
}

/** JSON with object keys sorted at every level and no whitespace. Arrays keep their order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const pairs = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`);
    return `{${pairs.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Digest of a JSON document's canonical form. */
export const hashJson = (text: string): string =>
  createHash('sha256')
    .update(canonical(JSON.parse(text) as unknown), 'utf8')
    .digest('hex');

/** The nearest ancestor of `from` that contains `name`, or undefined. */
function findUp(name: string, from = process.cwd()): string | undefined {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, name))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function goldenDir(): string {
  const root = findUp(join('docs', 'golden'));
  if (!root) throw new Error('docs/golden not found in any parent directory');
  return join(root, 'docs', 'golden');
}

export const loadManifest = (): Manifest =>
  JSON.parse(readFileSync(join(goldenDir(), 'manifest.json'), 'utf8')) as Manifest;

/** Every data file, relative to public/data, in a fixed order. */
export function dataFiles(): string[] {
  const matches = readdirSync(join(DATA, 'matches'))
    .sort()
    .map((name) => `matches/${name}`);
  return ['index.json', ...matches];
}

export const digestOf = (file: string): string =>
  hashJson(readFileSync(join(DATA, file), 'utf8'));

function write(): void {
  const root = findUp('.git');
  if (!root) throw new Error('Not inside a git repository');
  const dir = join(root, 'docs', 'golden');
  const target = join(dir, 'manifest.json');
  if (existsSync(target)) {
    throw new Error(
      `${target} already exists. It is the golden master: delete it by hand if you really mean to replace it.`,
    );
  }
  const files = Object.fromEntries(dataFiles().map((file) => [file, digestOf(file)]));
  const manifest: Manifest = {
    about:
      'Golden master for public/data: the data the app shipped before the move to an API. Kept permanently; the API must reproduce it.',
    algorithm: 'sha256',
    canonicalisation:
      'JSON.parse the file, then serialise with object keys sorted at every level (UTF-16 order), arrays in order, no whitespace; hash the UTF-8 bytes. See scripts/golden.ts.',
    fileCount: Object.keys(files).length,
    files,
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${target} (${manifest.fileCount} files)`);
}

function check(): void {
  const manifest = loadManifest();
  const expected = Object.keys(manifest.files);
  const actual = dataFiles();
  const problems = [
    ...actual.filter((f) => !(f in manifest.files)).map((f) => `not in manifest: ${f}`),
    ...expected.filter((f) => !actual.includes(f)).map((f) => `missing: ${f}`),
    ...expected
      .filter((f) => actual.includes(f) && digestOf(f) !== manifest.files[f])
      .map((f) => `content differs: ${f}`),
  ];
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`public/data matches the golden master (${expected.length} files)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const mode = process.argv[2];
  try {
    if (mode === 'write') write();
    else if (mode === 'check') check();
    else throw new Error('Usage: tsx scripts/golden.ts check|write');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
