import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ErrorState } from './States';

/**
 * A page that is its own file, fetched the first time it is shown (route-level code splitting,
 * no library). The match page is not one: it is the first thing on the screen, so it stays in
 * the first file. A page that cannot be fetched says so, with a way to try again.
 */
export function lazyPage<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  /** A tall page keeps its place at least a screen high while it loads, so the footer cannot move up. */
  tall = false,
): ComponentType<P> {
  let loaded: ComponentType<P> | undefined;
  let failed = false;
  return function LazyPage(props: P) {
    const [, rerender] = useState(0);
    useEffect(() => {
      if (loaded) return;
      failed = false;
      load().then(
        (module) => {
          loaded = module.default;
          rerender((n) => n + 1);
        },
        () => {
          failed = true;
          rerender((n) => n + 1);
        },
      );
    }, []);
    if (loaded) {
      const Page = loaded;
      return <Page {...props} />;
    }
    return failed ? (
      <ErrorState what="page" />
    ) : (
      <p class="status label" role="status" data-tall={tall || undefined}>
        Loading
      </p>
    );
  };
}
