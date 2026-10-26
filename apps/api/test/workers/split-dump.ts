/**
 * The dump (packages/ingest/src/dump.ts) is one statement after another, each ending in
 * ";" and a newline, and each beginning with a keyword at the start of a line. Row text
 * never starts a line with one of those keywords followed by a space, so this split is exact:
 * ingest's dump.test.ts checks it gives back the statements the dump was built from.
 */
export const splitDump = (text: string): string[] =>
  text
    .trim()
    .split(/;\n(?=(?:PRAGMA|DROP|CREATE|INSERT) )/)
    .map((statement) => `${statement.replace(/;$/, '')};`);
