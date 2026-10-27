/**
 * Lower case, no accents: "Türkiye" matches "turkiye". This is the client's copy of the folding
 * that `@shotmap/schema` gives ingest and the API (the browser bundle imports only what it uses,
 * and normalise.test.ts holds the two together). The API folds what is typed the same way, so
 * the client only needs it to compare searches with each other.
 */
export const normalise = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
