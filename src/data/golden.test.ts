import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dataFiles,
  digestOf,
  goldenDir,
  hashJson,
  loadManifest,
} from '../../scripts/golden';

// The golden master is permanent (docs/golden/manifest.json). While the static data
// exists, it must still hash to exactly what the app shipped before the API.
describe('golden master', () => {
  const manifest = loadManifest();

  it('lists exactly the files in public/data', () => {
    expect(dataFiles()).toEqual(Object.keys(manifest.files).sort());
    expect(manifest.fileCount).toBe(Object.keys(manifest.files).length);
  });

  it('has the same canonical content for every file', () => {
    const changed = Object.entries(manifest.files)
      .filter(([file, digest]) => digestOf(file) !== digest)
      .map(([file]) => file);
    expect(changed).toEqual([]);
  });
});

// The 2022 World Cup final, kept as a fixture that outlives public/data.
describe('the final as a fixture', () => {
  const FILE = 'matches/3869685.json';
  const fixture = readFileSync(join(goldenDir(), 'final-3869685.json'), 'utf8');

  it('is the golden master of that match', () => {
    expect(hashJson(fixture)).toBe(loadManifest().files[FILE]);
  });

  it('is what public/data holds', () => {
    const shipped = readFileSync(join('public', 'data', FILE), 'utf8');
    expect(JSON.parse(fixture) as unknown).toEqual(JSON.parse(shipped) as unknown);
  });
});
