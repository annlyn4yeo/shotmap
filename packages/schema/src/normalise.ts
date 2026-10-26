/**
 * Lower case, no accents: "Türkiye" matches "turkiye". Ingest builds the database's
 * search text with this function and the client folds the query with it, so the two
 * can never disagree about an accent.
 */
export const normalise = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The words of a normalised string: letters and digits, whatever the script. */
export const wordsOf = (text: string): string[] =>
  normalise(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
