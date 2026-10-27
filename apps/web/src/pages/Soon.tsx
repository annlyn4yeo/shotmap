import { useEffect, useRef } from 'preact/hooks';
import type { Page } from '../lib/router';
import { claimArrival } from '../state/app';

/** The player page and the comparison are later steps of the plan; their addresses already exist. */
export default function Soon({ page }: { page: Page }) {
  const title = page.name === 'player' ? `Player ${page.id}` : 'Compare players';
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} | Shotmap`;
    if (claimArrival()) heading.current?.focus();
  }, [title]);
  return (
    <section class="state" aria-labelledby="soon-title">
      <h1 id="soon-title" class="state-title" ref={heading} tabIndex={-1}>
        {title}
      </h1>
      <p>This page is not built yet. The matches are.</p>
      <div class="state-actions">
        <a class="state-button" href="/matches">
          Browse the matches
        </a>
      </div>
    </section>
  );
}
