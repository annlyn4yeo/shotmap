import type { SearchResult } from '@shotmap/schema';

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; words: string }
  | { status: 'ready'; words: string; result: SearchResult }
  | { status: 'error'; words: string };

export interface SearcherOptions {
  /** How long typing has to pause before a request goes out. */
  delay?: number;
  search: (words: string, signal: AbortSignal) => Promise<SearchResult>;
  onState: (state: SearchState) => void;
}

/**
 * Search as you type without flooding the API: nothing is sent until typing pauses (120 ms by
 * default), a request that is no longer wanted is aborted, and only the latest question can
 * ever be answered, so a slow reply to "mes" cannot overwrite the reply to "messi".
 */
export function createSearcher({ delay = 120, search, onState }: SearcherOptions) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: AbortController | undefined;
  let latest = 0;

  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    inflight?.abort();
    inflight = undefined;
  };

  return {
    /** Ask for these words once typing pauses. Empty words clear the search. */
    run(typed: string): void {
      const words = typed.trim();
      const mine = ++latest;
      stop();
      if (words === '') {
        onState({ status: 'idle' });
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        const ask = new AbortController();
        inflight = ask;
        onState({ status: 'loading', words });
        search(words, ask.signal).then(
          (result) => {
            if (mine === latest) onState({ status: 'ready', words, result });
          },
          () => {
            if (mine === latest && !ask.signal.aborted)
              onState({ status: 'error', words });
          },
        );
      }, delay);
    },
    /** Drop whatever is pending or in flight, for when the picker closes. */
    cancel(): void {
      latest++;
      stop();
    },
  };
}
