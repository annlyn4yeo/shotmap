import { useMemo } from 'preact/hooks';
import type { Shot } from '../data/shots';
import { teamStats } from '../lib/derive';
import { memo } from '../lib/memo';
import { AnimatedNumber } from './AnimatedNumber';
import './strip.css';

/** The numbers for one team: shots, on target, xG, goals against xG, and the biggest chance. */
export const StatsStrip = memo(function StatsStrip({
  shots,
}: {
  shots: readonly Shot[];
}) {
  const s = useMemo(() => teamStats(shots), [shots]);
  const big = s.biggest;
  return (
    <dl class="strip">
      <div class="strip-cell">
        <dt class="label">Shots</dt>
        <dd>
          <AnimatedNumber value={s.shots} />
        </dd>
      </div>
      <div class="strip-cell">
        <dt class="label">On target</dt>
        <dd>
          <AnimatedNumber value={s.onTarget} />
        </dd>
      </div>
      <div class="strip-cell">
        <dt class="label">xG</dt>
        <dd>
          <AnimatedNumber value={s.xg} decimals={2} />
        </dd>
      </div>
      <div class="strip-cell">
        <dt class="label">Goals v xG</dt>
        <dd>
          <AnimatedNumber value={s.delta} decimals={2} signed />
          <span class="strip-note">
            {s.goals} {s.goals === 1 ? 'goal' : 'goals'}
          </span>
        </dd>
      </div>
      <div class="strip-cell strip-big">
        <dt class="label">Biggest chance</dt>
        <dd>
          {big ? (
            <>
              <AnimatedNumber value={big.xg} decimals={2} />
              <span class="strip-note">
                {big.player}, {big.shootout ? 'shootout' : `${big.min}′`}
              </span>
            </>
          ) : (
            <span class="num">None</span>
          )}
        </dd>
      </div>
    </dl>
  );
});
