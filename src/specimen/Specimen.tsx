import { useEffect, useRef, useState } from 'preact/hooks';
import { Legend } from '../components/Legend';
import { Pitch } from '../components/Pitch';
import { ShotMark } from '../components/ShotMark';
import { Wordmark } from '../components/Wordmark';
import {
  OUTCOMES,
  OUTCOME_LABEL,
  OUTCOME_SHAPE,
  drawOrder,
  project,
  type Outcome,
} from '../lib/geometry';
import '../app.css';
import './specimen.css';

type Theme = 'auto' | 'light' | 'dark';
type Rgb = readonly [number, number, number];

/** Invented shots in StatsBomb coordinates. Not from a real match. */
const SAMPLE: readonly { x: number; y: number; xg: number; outcome: Outcome }[] = [
  { x: 108, y: 40, xg: 0.76, outcome: 'goal' },
  { x: 116, y: 31, xg: 0.35, outcome: 'goal' },
  { x: 113, y: 51, xg: 0.21, outcome: 'goal' },
  { x: 103, y: 25, xg: 0.09, outcome: 'goal' },
  { x: 105, y: 54, xg: 0.31, outcome: 'saved' },
  { x: 106, y: 30, xg: 0.2, outcome: 'saved' },
  { x: 98, y: 62, xg: 0.05, outcome: 'saved' },
  { x: 92, y: 46, xg: 0.03, outcome: 'saved' },
  { x: 99, y: 45, xg: 0.12, outcome: 'off' },
  { x: 94, y: 20, xg: 0.03, outcome: 'off' },
  { x: 111, y: 68, xg: 0.04, outcome: 'off' },
  { x: 86, y: 33, xg: 0.02, outcome: 'off' },
  { x: 98, y: 38, xg: 0.07, outcome: 'blocked' },
  { x: 107, y: 60, xg: 0.14, outcome: 'blocked' },
  { x: 98, y: 14, xg: 0.04, outcome: 'blocked' },
  { x: 102, y: 74, xg: 0.18, outcome: 'blocked' },
  { x: 114, y: 14, xg: 0.12, outcome: 'post' },
  { x: 90, y: 58, xg: 0.03, outcome: 'post' },
];

const XG_STEPS = [0.03, 0.08, 0.2, 0.45, 0.8] as const;

const PALETTE: readonly { name: string; tokens: readonly string[] }[] = [
  { name: 'Surfaces, against ink', tokens: ['paper', 'paper-2', 'paper-3'] },
  { name: 'Ink', tokens: ['ink', 'ink-2', 'ink-3'] },
  { name: 'Lines, against paper', tokens: ['line', 'line-2', 'line-3'] },
  { name: 'Accent', tokens: ['accent', 'accent-wash'] },
  { name: 'Outcomes', tokens: ['goal', 'saved', 'off', 'blocked', 'post'] },
];

const TYPE_STEPS: readonly {
  step: string;
  range: string;
  weight: number;
  text: string;
}[] = [
  { step: '5', range: '49 to 80 px', weight: 800, text: 'Shotmap' },
  { step: '4', range: '39 to 57 px', weight: 750, text: 'Every shot, surveyed' },
  { step: '3', range: '31 to 43 px', weight: 750, text: 'Arsenal 3, Chelsea 1' },
  { step: '2', range: '25 to 32 px', weight: 650, text: 'Where the match was won' },
  {
    step: '1',
    range: '20 to 24 px',
    weight: 500,
    text: 'Forty-one shots, nine on target',
  },
  {
    step: '0',
    range: '16 to 18 px',
    weight: 400,
    text: 'A curled finish from the edge of the box, the keeper beaten at his far post.',
  },
  {
    step: '-1',
    range: '14 to 15 px',
    weight: 400,
    text: 'Second half, minute 67. Open play, right foot.',
  },
];

const MOTION: readonly { token: string; value: string; use: string }[] = [
  { token: '--dur-press', value: '120 ms', use: 'Press feedback' },
  { token: '--dur-fast', value: '160 ms', use: 'Hover, colour, small state changes' },
  { token: '--dur-base', value: '240 ms', use: 'A mark plotting in, panels' },
  { token: '--dur-slow', value: '480 ms', use: 'Sheets and route changes' },
  { token: '--dur-draw', value: '900 ms', use: 'Contours drawing, once per view' },
  {
    token: '--ease-out',
    value: '0.23, 1, 0.32, 1',
    use: 'Everything entering or responding',
  },
  {
    token: '--ease-in-out',
    value: '0.77, 0, 0.175, 1',
    use: 'Things moving across the screen',
  },
  { token: '--stagger', value: '18 ms', use: 'Between marks, capped at 28 marks' },
];

function parseColor(css: string): Rgb | null {
  const rgb = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(css);
  if (rgb?.[1] && rgb[2] && rgb[3])
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(css);
  if (srgb?.[1] && srgb[2] && srgb[3]) {
    return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
  }
  return null;
}

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};
const hex = ([r, g, b]: Rgb) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const grade = (r: number) =>
  r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'UI 3:1' : 'decor';

function Swatches({ theme }: { theme: Theme }) {
  const root = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState<Record<string, Rgb>>({});

  useEffect(() => {
    const read = () => {
      const next: Record<string, Rgb> = {};
      root.current?.querySelectorAll<HTMLElement>('[data-token]').forEach((chip) => {
        const rgb = parseColor(getComputedStyle(chip).backgroundColor);
        if (rgb && chip.dataset['token']) next[chip.dataset['token']] = rgb;
      });
      setResolved(next);
    };
    read();
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', read);
    return () => media.removeEventListener('change', read);
  }, [theme]);

  const paper = resolved['paper'];
  const ink = resolved['ink'];
  return (
    <div ref={root}>
      {PALETTE.map((group) => (
        <div key={group.name} class="palette-group">
          <h3 class="label">{group.name}</h3>
          <ul class="swatches">
            {group.tokens.map((token) => {
              const rgb = resolved[token];
              const isSurface = group.name.startsWith('Surfaces');
              const against = isSurface ? ink : paper;
              const ratio =
                rgb && against && token !== 'accent-wash' ? contrast(rgb, against) : null;
              return (
                <li key={token} class="swatch">
                  <div
                    class="swatch-chip"
                    data-token={token}
                    style={`background:var(--${token})`}
                  />
                  <span class="swatch-name">--{token}</span>
                  <span class="swatch-meta num">
                    {rgb ? hex(rgb) : ''}
                    {ratio ? (
                      <>
                        <br />
                        {ratio.toFixed(1)}:1 {grade(ratio)}
                      </>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; text: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div class="seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={props.value === o.value}
          onClick={() => props.onChange(o.value)}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

export function Specimen() {
  const [theme, setThemeState] = useState<Theme>('auto');
  const [grey, setGrey] = useState(false);
  const [plot, setPlot] = useState(0);

  // Applied synchronously so the palette reads the new scheme in the same frame.
  const setTheme = (next: Theme) => {
    const el = document.documentElement;
    if (next === 'auto') el.removeAttribute('data-theme');
    else el.dataset['theme'] = next;
    setThemeState(next);
  };

  const shots = drawOrder(SAMPLE.map((s) => ({ ...s, ...project(s.x, s.y) })));

  return (
    <div class="spec" data-grey={grey ? 'on' : 'off'}>
      <header class="spec-top">
        <span class="label">Specimen</span>
        <div class="spec-controls">
          <Segmented
            label="Colour scheme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'auto', text: 'Auto' },
              { value: 'light', text: 'Day' },
              { value: 'dark', text: 'Night' },
            ]}
          />
          <Segmented
            label="Greyscale check"
            value={grey ? 'on' : 'off'}
            onChange={(v) => setGrey(v === 'on')}
            options={[
              { value: 'off', text: 'Colour' },
              { value: 'on', text: 'Grey' },
            ]}
          />
        </div>
      </header>

      <section class="spec-hero">
        <h1>
          <Wordmark />
        </h1>
        <p class="spec-tagline">Every shot, surveyed.</p>
      </section>

      <section class="spec-section spec-section--first" aria-labelledby="h-pitch">
        <h2 id="h-pitch" class="visually-hidden">
          The sheet
        </h2>
        <figure class="sheet grey-target">
          <Pitch key={plot} title="Illustrative shots on an attacking half" isolines>
            {shots.map((s, i) => (
              <ShotMark
                key={`${s.x}-${s.y}`}
                x={s.x}
                y={s.y}
                xg={s.xg}
                outcome={s.outcome}
                index={i}
                title={`${OUTCOME_LABEL[s.outcome]}, xG ${s.xg.toFixed(2)}`}
              />
            ))}
          </Pitch>
          <figcaption class="sheet-cap">
            <Legend />
            <div class="sheet-foot">
              <p class="sheet-note">Illustrative shots, not a real match.</p>
              <button type="button" class="btn" onClick={() => setPlot((k) => k + 1)}>
                Replay plot
              </button>
            </div>
          </figcaption>
        </figure>
        <p class="spec-note">
          Size is expected goals, by area. Shape is the outcome. Contours join the spots
          that see the goal mouth at the same angle, from 60 degrees in the six-yard box
          to 11 at the edge of range. The outer two are labelled.
        </p>
      </section>

      <section class="spec-section" aria-labelledby="h-marks">
        <h2 id="h-marks">Shot marks</h2>
        <div class="matrix-wrap grey-target">
          <table class="matrix">
            <caption class="visually-hidden">Every outcome at five xG values</caption>
            <thead>
              <tr>
                <th scope="col" class="label">
                  xG
                </th>
                {XG_STEPS.map((v) => (
                  <th key={v} scope="col" class="num">
                    {v.toFixed(2)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {OUTCOMES.map((o) => (
                <tr key={o}>
                  <th scope="row">
                    <span class="matrix-name">{OUTCOME_LABEL[o]}</span>
                    <span class="label matrix-shape">{OUTCOME_SHAPE[o]}</span>
                  </th>
                  {XG_STEPS.map((v) => (
                    <td key={v}>
                      <svg viewBox="-7 -7 14 14" aria-hidden="true" focusable="false">
                        <ShotMark x={0} y={0} xg={v} outcome={o} />
                      </svg>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p class="spec-note">
          Shape alone separates all five outcomes, so the Grey switch above changes
          nothing you can read. Goals are the only marks with a ring and a hole, and they
          are drawn last.
        </p>
      </section>

      <section class="spec-section" aria-labelledby="h-colour">
        <h2 id="h-colour">Colour</h2>
        <p class="spec-note">
          Vellum by day, a night chart after dark. One set of tokens; the values below are
          live from the page, so flip Day and Night to see them change.
        </p>
        <Swatches theme={theme} />
      </section>

      <section class="spec-section" aria-labelledby="h-type">
        <h2 id="h-type">Type</h2>
        <p class="spec-note">
          Archivo for words, Azeret Mono for map labels and data. Fluid between 375 and
          1280 px.
        </p>
        <div class="type-list">
          {TYPE_STEPS.map((t) => (
            <div key={t.step} class="type-row">
              <span class="label num">
                Step {t.step}, {t.range}, {t.weight}
              </span>
              <p
                class="type-sample"
                style={`font-size:var(--step-${t.step});font-weight:${t.weight};line-height:${
                  Number(t.step) >= 4
                    ? 'var(--leading-display)'
                    : 'var(--leading-heading)'
                };letter-spacing:${Number(t.step) >= 1 ? 'var(--track-tight)' : '0'}`}
              >
                {t.text}
              </p>
            </div>
          ))}
        </div>

        <div class="type-duo">
          <div>
            <h3 class="label">Proportional</h3>
            <p class="type-nums">
              1<br />
              11
              <br />
              111
              <br />
              0.34 xG
            </p>
          </div>
          <div>
            <h3 class="label">Tabular, for minutes and xG</h3>
            <p class="type-nums num">
              1<br />
              11
              <br />
              111
              <br />
              0.34 xG
            </p>
          </div>
          <div>
            <h3 class="label">Map label</h3>
            <p class="label type-map">Distance from goal line, yards</p>
          </div>
        </div>

        <p class="type-names">Szczęsny, Dzeko, Özil, Çalhanoğlu, Lewandowski, Mbappé</p>
      </section>

      <section class="spec-section" aria-labelledby="h-motion">
        <h2 id="h-motion">Shape, space and motion</h2>
        <p class="spec-note">
          Corners are square; circles are for shots. There is no elevation. Panels are
          separated by a double rule and a change of paper. Space runs on a 4 px base.
        </p>
        <ul class="space-scale">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <li key={n}>
              <span class="space-bar" style={`width:var(--space-${n})`} />
              <span class="label num">--space-{n}</span>
            </li>
          ))}
        </ul>
        <table class="motion-table">
          <caption class="visually-hidden">Motion tokens</caption>
          <tbody>
            {MOTION.map((m) => (
              <tr key={m.token}>
                <th scope="row" class="label">
                  {m.token}
                </th>
                <td class="num">{m.value}</td>
                <td>{m.use}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="spec-note">
          Reduced motion removes every movement above: marks and contours appear in place.
        </p>
      </section>

      <footer class="credit">
        <span class="credit-logo" data-slot="statsbomb-logo" aria-hidden="true" />
        <p>
          Data by{' '}
          <a href="https://statsbomb.com" rel="noopener">
            StatsBomb
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
