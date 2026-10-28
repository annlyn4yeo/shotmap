import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Outcome } from '@shotmap/schema';
import { OutcomeFilter } from '../components/OutcomeFilter';
import { frameFor } from '../components/frame';
import { ShotCanvas } from '../components/ShotCanvas';
import { ShotPanel } from '../components/ShotPanel';
import { useWidth } from '../lib/hooks';
import { synthMarks } from '../lib/synth';
import './player.css';

const FROM = 80;

/**
 * `/dev/stress`: thousands of synthetic shots on the canvas layer, to push it past anything a
 * player has and to be measured (`pnpm fps`). It exists only in a dev server or a build made with
 * `VITE_STRESS=1`; a normal build has no such page. `?n=` sets how many (5,000 by default) and
 * `?renderer=svg` draws the same marks with the SVG layer, to see what that costs.
 */
export default function StressPage() {
  const params = new URLSearchParams(location.search);
  const n = Math.min(20_000, Math.max(100, Number(params.get('n')) || 5000));
  const svg = params.get('renderer') === 'svg';
  const frame = useMemo(() => frameFor('half', 'vertical', FROM), []);
  const mapRef = useRef<HTMLDivElement>(null);
  const width = useWidth(mapRef);
  const unitPx = (width || 343) / frame.w;
  const marks = useMemo(() => synthMarks(n, unitPx), [n, unitPx]);
  const [hidden, setHidden] = useState<ReadonlySet<Outcome>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const placed = useMemo(
    () => marks.filter((m) => !hidden.has(m.outcome)),
    [marks, hidden],
  );
  const counts = useMemo(() => {
    const c: Record<Outcome, number> = { goal: 0, saved: 0, off: 0, blocked: 0, post: 0 };
    for (const m of marks) c[m.outcome]++;
    return c;
  }, [marks]);
  const selected = placed.find((m) => m.id === selectedId);

  useEffect(() => {
    document.title = 'Stress | Shotmap';
  }, []);

  return (
    <article class="player" aria-labelledby="stress-name">
      <header class="player-head">
        <h1 id="stress-name" class="player-name">
          Stress: {n.toLocaleString('en-GB')} shots
        </h1>
        <p class="player-full">
          Made up, to push the {svg ? 'SVG' : 'canvas'} layer further than any player
          does.
        </p>
      </header>
      <section class="player-map" aria-label="Synthetic shots">
        <div class="player-panel" data-loading="false">
          <ShotPanel
            name="Synthetic shots"
            stats={[]}
            frame={frame}
            from={FROM}
            intro={false}
            shots={placed}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            mapRef={mapRef}
            title={`Synthetic shots: the last ${120 - FROM} yards before goal.`}
            label="Synthetic shots. Use the arrow keys to move between them, Enter to open one."
            layerName={svg ? 'svg' : 'canvas'}
            layer={
              svg ? undefined : (
                <ShotCanvas
                  frame={frame}
                  shots={placed}
                  all={marks}
                  selectedId={selected?.id ?? null}
                  intro={false}
                  label="Synthetic shots"
                  describedBy="map-summary"
                  announce={selected ? `${selected.label}. Selected.` : ''}
                  onSelect={setSelectedId}
                />
              )
            }
          />
          <OutcomeFilter
            counts={counts}
            hidden={hidden}
            onToggle={(o) =>
              setHidden((was) => {
                const next = new Set(was);
                if (!next.delete(o)) next.add(o);
                return next;
              })
            }
          />
          <p id="map-summary" class="map-note player-summary">
            {placed.length.toLocaleString('en-GB')} of {n.toLocaleString('en-GB')} shots
            drawn.
          </p>
        </div>
      </section>
    </article>
  );
}
