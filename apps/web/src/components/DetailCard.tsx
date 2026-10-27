import type { ComponentChildren } from 'preact';
import { sentence, type Shot } from '../data/shots';
import './card.css';

interface DetailCardProps {
  shot: Shot;
  team: string;
  /** Where the shot is on the map, as percentages of its width and height (popover anchor). */
  anchor: { x: number; y: number };
  onClose: () => void;
  /** More for the foot of the card: a shot shown away from its match links back to it. */
  children?: ComponentChildren;
}

/**
 * Shot details. A bottom sheet on a phone, a popover beside the mark on a wide
 * screen: the same element, laid out by CSS. It is a live region, so selecting
 * a shot announces it while focus stays on the mark.
 */
export function DetailCard({ shot, team, anchor, onClose, children }: DetailCardProps) {
  const extra = shot.technique === 'Normal' ? '' : `, ${shot.technique.toLowerCase()}`;
  return (
    <section
      class="card"
      aria-label="Shot details"
      aria-live="polite"
      data-outcome={shot.outcome}
      data-side={anchor.x > 55 ? 'left' : 'right'}
      style={`--ax:${anchor.x.toFixed(1)}%;--ay:${anchor.y.toFixed(1)}%`}
    >
      <button
        type="button"
        class="card-close"
        aria-label="Close shot details"
        onClick={onClose}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M2 2L10 10M10 2L2 10" />
        </svg>
      </button>
      <h2 class="card-title">{shot.player}</h2>
      <p class="card-team">
        {team}
        {shot.shirt !== null ? <span class="num">, number {shot.shirt}</span> : null}
      </p>
      <dl class="card-facts">
        <div>
          <dt class="label">Minute</dt>
          <dd class="num">{shot.shootout ? 'Shootout' : <>{shot.min}&prime;</>}</dd>
        </div>
        <div>
          <dt class="label">xG</dt>
          <dd class="num">{shot.xg.toFixed(2)}</dd>
        </div>
        <div class="card-wide">
          <dt class="label">Outcome</dt>
          <dd class="card-outcome">{shot.outcomeLabel}</dd>
        </div>
        <div>
          <dt class="label">Body part</dt>
          <dd>{sentence(shot.bodyPart)}</dd>
        </div>
        <div>
          <dt class="label">Shot type</dt>
          <dd>
            {shot.shotType}
            {extra}
          </dd>
        </div>
      </dl>
      {children}
    </section>
  );
}
