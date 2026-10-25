import { describe, expect, it } from 'vitest';
import { dataFiles, digestOf, loadManifest } from '../../scripts/golden';

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
