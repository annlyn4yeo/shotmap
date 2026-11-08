import { OUTCOMES, type Outcome } from '@shotmap/schema';
import { OUTCOME_LABEL } from '../lib/geometry';
import { markPath } from '../lib/marks';
import { ZONES, scored, type ZoneRow } from '../lib/zones';
import './shots.css';

/**
 * The key under a home plate: choosing a result brings its colour back and steps the others back,
 * on a phone as well as with a mouse; pointing at one shows it for as long as the pointer stays.
 * Before the data arrives (`counts` null) it is the same rows, disabled, so nothing moves after it.
 */
export function ShotKey(props: {
  counts: Record<Outcome, number> | null;
  pressed: Outcome | null;
  onToggle: (outcome: Outcome) => void;
  onPreview: (outcome: Outcome | null) => void;
}) {
  const { counts, pressed, onToggle, onPreview } = props;
  return (
    <ul class="shot-key" aria-label="Highlight a result">
      {OUTCOMES.map((outcome) => (
        <li key={outcome}>
          <button
            type="button"
            class="shot-key-item"
            aria-pressed={pressed === outcome}
            disabled={counts === null || counts[outcome] === 0}
            onClick={() => onToggle(outcome)}
            onPointerEnter={(e) => {
              if (e.pointerType === 'mouse') onPreview(outcome);
            }}
            onPointerLeave={() => onPreview(null)}
          >
            <svg
              class="shot-key-mark"
              viewBox="-4 -4 8 8"
              aria-hidden="true"
              focusable="false"
            >
              <path
                class={`shot shot--${outcome}`}
                d={markPath(outcome, 0, 0, 2.6, true)}
              />
            </svg>
            <span>{OUTCOME_LABEL[outcome]}</span>
            <span class="shot-key-count num">{counts?.[outcome] ?? ''}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Where a selection's shots came from and how often each place paid. Before the data arrives (`rows`
 * null) it is the same table with its figures blank, holding its height.
 */
export function ZoneTable({ rows }: { rows: readonly ZoneRow[] | null }) {
  return (
    <table class="zones">
      <caption class="visually-hidden">
        Open-play shots and goals by where the shot was taken, and the share scored.
      </caption>
      <thead>
        <tr>
          <th scope="col">From</th>
          <th scope="col">Shots</th>
          <th scope="col">Goals</th>
          <th scope="col">Scored</th>
        </tr>
      </thead>
      <tbody>
        {ZONES.map((zone) => {
          const row = rows?.find((r) => r.key === zone.key);
          const rate = row ? scored(row) : null;
          return (
            <tr key={zone.key}>
              <th scope="row">{zone.label}</th>
              <td class="num">{row?.shots ?? ''}</td>
              <td class="num">{row?.goals ?? ''}</td>
              <td class="num zones-rate">
                {!row ? '' : rate === null ? '–' : `${rate}%`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
