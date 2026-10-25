/**
 * Run a state change inside a view transition, where the browser supports it.
 * The browser snapshots the page before and after and animates between them:
 * elements with a `view-transition-name` (the map panels) move and resize from
 * where they were to where they are, which is a FLIP animation without any
 * measuring code, and everything else crossfades. Elsewhere, or with reduced
 * motion, the change just happens.
 */
export function withTransition(change: () => void): void {
  if (
    !('startViewTransition' in document) ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    change();
    return;
  }
  document.startViewTransition(async () => {
    change();
    // Let the framework render before the browser takes the "after" snapshot.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}
