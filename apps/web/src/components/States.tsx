import { Pitch } from './Pitch';
import { frameFor } from './frame';
import { BOTH, useMedia } from '../lib/hooks';
import { useStore } from '../lib/store';
import { openPicker, retryMatch, store } from '../state/app';
import './states.css';

/**
 * Shown only if a match takes longer than 150 ms to load. The same panels as the
 * real view, with the pitch drawn and the numbers as quiet bars, so nothing
 * moves when the data arrives. No spinner.
 */
export function MapSkeleton({ from }: { from: number }) {
  // Same panel count the real view will have, read here so the app shell never re-renders for it.
  const team = useStore(store, (s) => s.route.team);
  const roomy = useMedia(BOTH);
  const panels = (team ?? (roomy ? 'both' : 'home')) === 'both' ? 2 : 1;
  const frame = frameFor('half', 'vertical', from);
  return (
    <div class="shotmap skeleton" aria-busy="true">
      <p class="visually-hidden" role="status">
        Loading the match
      </p>
      <span class="skeleton-bar skeleton-toolbar" aria-hidden="true" />
      <div class="panels" data-count={panels}>
        {Array.from({ length: panels }, (_, i) => (
          <section class="panel" key={i} aria-hidden="true">
            <div class="strip skeleton-strip">
              {Array.from({ length: 5 }, (_, k) => (
                <span class="skeleton-bar" key={k} />
              ))}
            </div>
            <div class="stage">
              <div class="map-frame" style={`--ratio:${(frame.w / frame.h).toFixed(4)}`}>
                <div class="map">
                  <Pitch title="" mode="half" orientation="vertical" from={from} />
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** A match that did not load: say so, and offer the two ways forward. */
export function ErrorState({ what }: { what: 'match' | 'list' | 'page' }) {
  return (
    <div class="state" role="alert">
      <h2 class="state-title">
        {what === 'match'
          ? 'This match could not be loaded'
          : what === 'page'
            ? 'This page could not be loaded'
            : 'The match list could not be loaded'}
      </h2>
      <p>
        {what === 'match'
          ? 'The file did not arrive. Check your connection and try again, or pick another match.'
          : 'Check your connection and reload the page.'}
      </p>
      <div class="state-actions">
        {what === 'match' ? (
          <>
            <button type="button" class="state-button" data-primary onClick={retryMatch}>
              Try again
            </button>
            <button type="button" class="state-button" onClick={openPicker}>
              Choose another match
            </button>
          </>
        ) : (
          <button
            type="button"
            class="state-button"
            data-primary
            onClick={() => location.reload()}
          >
            Reload
          </button>
        )}
      </div>
    </div>
  );
}

/** Drawn over a map with nothing on it: no filtered shots, or a match with none. */
export function EmptyNote({
  filtered,
  team,
  onReset,
}: {
  filtered: boolean;
  team: string;
  onReset: () => void;
}) {
  return (
    <div class="empty">
      <p class="empty-title">
        {filtered ? 'No shots match these filters' : `No shots recorded for ${team}`}
      </p>
      {filtered ? (
        <button type="button" class="state-button" onClick={onReset}>
          Reset filters
        </button>
      ) : null}
    </div>
  );
}
