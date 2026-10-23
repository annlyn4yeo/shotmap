import { OUTCOMES, OUTCOME_LABEL } from '../lib/geometry';
import { ShotMark } from './ShotMark';
import './legend.css';

/** Outcome key. Shapes differ as well as colours, so the key works in greyscale. */
export function Legend() {
  return (
    <ul class="legend">
      {OUTCOMES.map((outcome) => (
        <li key={outcome} class="legend-item">
          <svg
            class="legend-icon"
            viewBox="-7 -7 14 14"
            aria-hidden="true"
            focusable="false"
          >
            <ShotMark x={0} y={0} xg={0.2} outcome={outcome} />
          </svg>
          <span class="legend-name">{OUTCOME_LABEL[outcome]}</span>
        </li>
      ))}
    </ul>
  );
}
