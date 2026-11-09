import type { Page } from '../lib/router';
import { PickerButton } from './Picker';
import { Wordmark } from './Wordmark';
import './site-header.css';

const LINKS: readonly { page: Page['name']; href: string; label: string }[] = [
  { page: 'matches', href: '/matches', label: 'Matches' },
  { page: 'compare', href: '/compare', label: 'Compare' },
];

/**
 * The header of every page (DESIGN.md section 12): the top margin of the sheet, on the paper.
 * The wordmark goes home, two links go to the pages that have no other way in, and the search is
 * shaped as the field it opens. A double rule closes it, as the neatline frames a plate, and the
 * rule thickens under the page you are on.
 */
export function SiteHeader({ current }: { current: Page['name'] }) {
  return (
    <header class="site-header">
      <div class="site-header-inner">
        <a
          class="home-link"
          href="/"
          aria-label="Shotmap, home"
          aria-current={current === 'home' ? 'page' : undefined}
        >
          <Wordmark />
        </a>
        <nav class="site-nav" aria-label="Main">
          {LINKS.map((link) => (
            <a
              key={link.page}
              class="site-link"
              href={link.href}
              aria-current={current === link.page ? 'page' : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <PickerButton />
      </div>
    </header>
  );
}
