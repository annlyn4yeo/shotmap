import { writeFileSync } from 'node:fs';
import { FIXTURE_PATH, buildFixture } from './fixture';

const text = await buildFixture();
writeFileSync(FIXTURE_PATH, text);
console.log(`wrote ${FIXTURE_PATH} (${text.length} bytes)`);
