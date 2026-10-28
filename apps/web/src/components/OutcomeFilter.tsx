import { OUTCOMES, type Outcome } from '@shotmap/schema';
import { OUTCOME_LABEL } from '../lib/geometry';
import { markPath } from '../lib/marks';
import { memo } from '../lib/memo';
import './shots.css';

interface OutcomeFilterProps {
  counts: Record<Outcome, number>;
  /** Outcomes currently hidden. */
  hidden: ReadonlySet<Outcome>;
  onToggle: (outcome: Outcome) => void;
  /** What the note under the chips says, when the map is not a map of marks. */
  note?: string | undefined;
}

/** The legend, and the filter: each outcome is a toggle showing its own mark and a count. */
export const OutcomeFilter = memo(function OutcomeFilter({
  counts,
  hidden,
  onToggle,
  note,
}: OutcomeFilterProps) {
  return (
    <div class="legend">
      <div class="chips" role="group" aria-label="Show outcomes">
        {OUTCOMES.map((outcome) => (
          <button
            key={outcome}
            type="button"
            class="chip"
            aria-pressed={!hidden.has(outcome)}
            disabled={counts[outcome] === 0}
            onClick={() => onToggle(outcome)}
          >
            <svg
              class="chip-mark"
              viewBox="-7 -7 14 14"
              aria-hidden="true"
              focusable="false"
            >
              <path class={`shot shot--${outcome}`} d={markPath(outcome, 0, 0, 4.6)} />
            </svg>
            <span>{OUTCOME_LABEL[outcome]}</span>
            <span class="chip-count num">{counts[outcome]}</span>
          </button>
        ))}
      </div>
      <p class="legend-note">
        {note ??
          'Mark size shows expected goals (xG). The scale is yards from the goal line.'}
      </p>
    </div>
  );
});
