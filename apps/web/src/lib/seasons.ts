/** "2014/2015" as "2014/15"; a single year stays as it is. */
export const shortSeason = (name: string): string =>
  name.replace(/^(\d{4})\/\d{2}(\d{2})$/, '$1/$2');

/** A run of seasons in words: "2015/16", "2018 and 2022", "2014/15 to 2020/21". */
export function seasonSpan(names: readonly string[]): string {
  const sorted = [...names].sort().map(shortSeason);
  const first = sorted[0] ?? '';
  const last = sorted[sorted.length - 1] ?? '';
  if (sorted.length <= 1) return first;
  if (sorted.length === 2) return `${first} and ${last}`;
  return `${first} to ${last}`;
}
