import { writeFileSync } from 'node:fs';
import { FIXTURE_PATH, buildFixture } from './fixture';

// The fixture names the release that ships. That is the whole catalogue's, so after an ingest:
//   pnpm --filter @shotmap/ingest fixture out/catalogue/shotmap.sqlite
const text = await buildFixture(process.argv[2]);
writeFileSync(FIXTURE_PATH, text);
console.log(`wrote ${FIXTURE_PATH} (${text.length} bytes)`);
