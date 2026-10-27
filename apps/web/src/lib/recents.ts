import { normalise } from './search';

/**
 * The searches someone chose a result from, newest first, kept on their own device and nowhere
 * else (`localStorage`; nothing about it is ever sent). Storage can be missing, full or
 * blocked, so every access is guarded and the picker works without it.
 */
const KEY = 'shotmap:recent-searches';
export const MAX_RECENTS = 8;

export function loadRecents(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((w): w is string => typeof w === 'string' && w.length > 0 && w.length <= 64)
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

/** Put `words` first, once: "Messi" and "messi" are the same search. Returns the new list. */
export function rememberSearch(words: string): string[] {
  const typed = words.trim().replace(/\s+/g, ' ');
  if (typed.length < 2 || typed.length > 64) return loadRecents();
  const key = normalise(typed);
  const next = [typed, ...loadRecents().filter((w) => normalise(w) !== key)].slice(
    0,
    MAX_RECENTS,
  );
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode or a full disk: the list lives until the page closes, and that is fine.
  }
  return next;
}

export function forgetSearches(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget if nothing can be stored.
  }
}
