import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Page } from '../lib/router';
import { ErrorState } from './States';

type PageComponent = ComponentType<{ page: Page }>;

/**
 * The pages that are their own files, fetched the first time they are shown (route-level code
 * splitting, no library). The match page is not one: it is the first thing on the screen, so it
 * stays in the first file. `tall` pages keep a screen's height while they load, so the footer
 * cannot move up onto the screen when they arrive.
 */
const FILES: Partial<
  Record<Page['name'], { load: () => Promise<{ default: PageComponent }>; tall: boolean }>
> = {
  matches: { load: () => import('../pages/Browse'), tall: true },
  player: { load: () => import('../pages/Player'), tall: true },
  compare: { load: () => import('../pages/Soon'), tall: false },
};

const loaded = new Map<string, PageComponent>();
const failed = new Set<string>();

/** Shows the page the router chose, fetching its file first if it has not been needed before. */
export function LazyPage({ page }: { page: Page }) {
  const [, rerender] = useState(0);
  const file = FILES[page.name];
  const name = page.name;
  useEffect(() => {
    if (!file || loaded.has(name)) return;
    failed.delete(name);
    file.load().then(
      (module) => {
        loaded.set(name, module.default);
        rerender((n) => n + 1);
      },
      () => {
        failed.add(name);
        rerender((n) => n + 1);
      },
    );
  }, [name]);

  const Page = loaded.get(name);
  if (Page) return <Page page={page} />;
  return failed.has(name) ? (
    <ErrorState what="page" />
  ) : (
    <p class="status label" role="status" data-tall={file?.tall || undefined}>
      Loading
    </p>
  );
}
