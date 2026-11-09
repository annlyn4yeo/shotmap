import type { RefObject } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { HERO_MATCH_ID, OUTCOMES, PITCH, type Meta, type Outcome } from '@shotmap/schema';
import { Pitch } from '../components/Pitch';
import { ShotKey, ShotLayer, ZoneTable, type MapShot } from '../components/ShotLayer';
import { frameFor } from '../components/frame';
import { delayFor } from '../components/useMapFrame';
import { loadMeta } from '../data/browse';
import { loadMatch, readMatch } from '../data/load';
import type { LoadedMatch } from '../data/match';
import { shotLabel, type Shot } from '../data/shots';
import { OUTCOME_LABEL, markRadius } from '../lib/geometry';
import { BOTH, useFooterHidden, useMedia, useSeen, useWidth } from '../lib/hooks';
import { markPath } from '../lib/marks';
import { DEFAULT_ROUTE, formatUrl } from '../lib/route';
import { seasonSpan } from '../lib/seasons';
import { claimArrival, navigate, openPicker } from '../state/app';
import './home.css';

/**
 * The home page (DESIGN.md section 11): the title sheet of an atlas. A plate of the 2022 final,
 * a key to the marks, an index of the pages with a plate for each, and where the data is from.
 * Every drawing is the real data: the final is inlined in the page (so the first view needs no
 * request), the competitions and counts come from /v1/meta, and the two plates that need the API
 * (a player's shots in one competition, a career's squares) ask for it only as they come near.
 */

/** The two players of the comparison, both in the final, so its figures need nothing but the page. */
const MBAPPE = 3009;
const MESSI = 5503;
/** The 2022 World Cup, for the comparison's span. */
const WORLD_CUP = { competition: 43, season: 106 };
/**
 * The player and density cells: Cristiano Ronaldo in La Liga, the same shots drawn both ways (marks,
 * then squares). La Liga, not the Champions League, because the open data's Champions League is its
 * finals alone, one match a season; in La Liga he has a whole season (2015/16) and his Clásicos.
 */
const RONALDO = { id: 5207, name: 'Cristiano Ronaldo' };
const LA_LIGA = 11;

const nf = new Intl.NumberFormat('en-GB');
const dateOf = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`),
  );

// Data

/** The hero match: from the inlined seed when it is there, else asked for. */
function useHero(): LoadedMatch | 'error' | null {
  const [match, setMatch] = useState<LoadedMatch | 'error' | null>(
    () => readMatch(HERO_MATCH_ID) ?? null,
  );
  useEffect(() => {
    if (match) return;
    let live = true;
    loadMatch(HERO_MATCH_ID).then(
      (m) => live && setMatch(m),
      () => live && setMatch('error'),
    );
    return () => {
      live = false;
    };
  }, []);
  return match;
}

/** The release's competitions and counts. Shared with the browse page through the client's cache. */
function useMeta(): Meta | 'error' | null {
  const [meta, setMeta] = useState<Meta | 'error' | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    loadMeta(controller.signal).then(setMeta, () => {
      if (!controller.signal.aborted) setMeta('error');
    });
    return () => controller.abort();
  }, []);
  return meta;
}

const inPlay = (shots: readonly Shot[]) => shots.filter((s) => !s.shootout);

/** Opens one of the hero match's shots on the match page. */
function useOpenShot(shots: readonly Shot[]) {
  const roomy = useMedia(BOTH);
  return (id: number | null) => {
    const shot = shots.find((s) => s.id === id);
    if (!shot) return;
    // Wide, the match page shows both teams; narrow, the side the shot was for.
    const team = roomy ? null : shot.team === 0 ? 'home' : 'away';
    navigate(formatUrl({ ...DEFAULT_ROUTE, team, shot: shot.id }));
  };
}

// The hero plate

const HERO_FRAME = frameFor('full', 'horizontal');
const INTRO_MS = 3200;

/**
 * Both teams on one whole pitch, the way the match was played: the home side attacking right as
 * the data has it, the away side turned half a turn to attack left. A mark opens its shot on the
 * match page.
 */
function HeroPlate({ match }: { match: LoadedMatch }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const width = useWidth(frameRef);
  const unitPx = (width || 343) / HERO_FRAME.w;
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setIntro(false), INTRO_MS);
    return () => clearTimeout(timer);
  }, []);

  const { detail } = match;
  const [home, away] = detail.teams;
  const shots = useMemo(() => inPlay(match.shots), [match]);
  const marks: MapShot[] = useMemo(
    () =>
      shots.map((s) => {
        const turn = s.team === 1;
        const X = (x: number) => (turn ? PITCH.length - x : x);
        const Y = (y: number) => (turn ? PITCH.width - y : y);
        return {
          id: s.id,
          outcome: s.outcome,
          xg: s.xg,
          label: `${detail.teams[s.team].name}: ${shotLabel(s)}`,
          x: X(s.x),
          y: Y(s.y),
          ex: X(s.ex),
          ey: Y(s.ey),
          r: markRadius(s.xg, unitPx),
          delay: delayFor(s.min),
        };
      }),
    [shots, unitPx, detail],
  );

  const open = useOpenShot(shots);

  const goals = shots.filter((s) => s.outcome === 'goal').length;
  const pens = home.pens !== null && away.pens !== null;
  const winner = pens && (home.pens ?? 0) > (away.pens ?? 0) ? home : away;
  const loser = winner === home ? away : home;

  return (
    <figure class="plate hero-plate">
      <div class="plate-ends" aria-hidden="true">
        <span class="label">&larr; {away.name}</span>
        <span class="label">{home.name} &rarr;</span>
      </div>
      <div
        ref={frameRef}
        class="map-frame"
        style={`--ratio:${HERO_FRAME.w} / ${HERO_FRAME.h}`}
      >
        <div class="map" data-intro={intro && !reduced}>
          <Pitch
            title={`The whole pitch, ${home.name} attacking right and ${away.name} attacking left`}
            mode="full"
            orientation="horizontal"
          />
          <ShotLayer
            frame={HERO_FRAME}
            shots={marks}
            selectedId={null}
            intro={intro && !reduced}
            label={`Every shot of the ${detail.season.name} ${detail.competition.name} ${detail.stage.name.toLowerCase()}. Choose one to open it on the match page.`}
            onSelect={open}
          />
        </div>
      </div>
      <figcaption class="plate-caption">
        <span class="plate-score">
          {home.name}{' '}
          <span class="num">
            {home.score}-{away.score}
          </span>{' '}
          {away.name}
        </span>
        <span>
          {detail.competition.name} {detail.season.name} {detail.stage.name.toLowerCase()}
          , {dateOf(detail.date)}.{' '}
          {pens ? (
            <>
              {winner.name} won {winner.pens}-{loser.pens} on penalties.{' '}
            </>
          ) : null}
          <span class="num">{shots.length}</span> shots, <span class="num">{goals}</span>{' '}
          goals. Choose a mark to open that shot.
        </span>
      </figcaption>
    </figure>
  );
}

// The key

const KEY_NOTE: Record<Outcome, string> = {
  goal: 'In the net.',
  saved: 'Kept out by the goalkeeper.',
  off: 'Missed the frame.',
  blocked: 'Stopped before it reached goal.',
  post: 'Hit the woodwork.',
};

/** Graduated symbols, as a map's key draws them: one ring per value, all on one baseline. */
const SCALE = [0.05, 0.3, 0.78] as const;
/** A mark's radius by its xG alone, without the floor that keeps tiny marks tappable on a map. */
const areaRadius = (xg: number) => markRadius(xg, Number.POSITIVE_INFINITY);

function Key() {
  const biggest = areaRadius(SCALE[SCALE.length - 1] ?? 1);
  return (
    <section class="home-key" aria-labelledby="key-title">
      <div class="key-head">
        <h2 id="key-title" class="home-h2">
          Read it like a map
        </h2>
        <p class="home-body">
          Shape says what happened to the shot. Size says how likely it was to score,
          before it was struck.
        </p>
      </div>

      <ul class="key-marks">
        {OUTCOMES.map((o) => (
          <li key={o} class="key-item">
            <svg
              class="key-mark"
              viewBox="-4.5 -4.5 9 9"
              aria-hidden="true"
              focusable="false"
            >
              <path class={`shot shot--${o}`} d={markPath(o, 0, 0, 2.6)} />
            </svg>
            <span class="key-name">{OUTCOME_LABEL[o]}</span>
            <span class="key-note">{KEY_NOTE[o]}</span>
          </li>
        ))}
      </ul>

      <figure class="key-scale">
        <svg
          class="key-rings"
          viewBox={`-0.2 -0.8 ${2 * biggest + 7} ${2 * biggest + 1.6}`}
          aria-hidden="true"
          focusable="false"
        >
          {SCALE.map((xg) => {
            const r = areaRadius(xg);
            const top = 2 * biggest - 2 * r;
            return (
              <g key={xg}>
                <circle class="key-ring" cx={biggest} cy={2 * biggest - r} r={r} />
                <path class="key-leader" d={`M${biggest} ${top}H${2 * biggest + 2}`} />
                <text class="key-value" x={2 * biggest + 2.6} y={top}>
                  {xg.toFixed(2)}
                </text>
              </g>
            );
          })}
        </svg>
        <figcaption class="key-scale-note">
          <strong>Expected goals (xG)</strong> is how often a shot like it is scored, from
          0 to 1. A penalty is about <span class="num">0.78</span>. A mark&rsquo;s area
          follows its xG. On a map of a hundred shots or more, every mark is smaller and
          everything but goals is one ink.
        </figcaption>
      </figure>
    </section>
  );
}

// The index: one sheet for each kind of page

interface DuelRow {
  label: string;
  decimals: number;
  of: (own: readonly Shot[]) => number | null;
}

const sumXg = (own: readonly Shot[]) => own.reduce((t, s) => t + s.xg, 0);

const DUEL_ROWS: readonly DuelRow[] = [
  { label: 'Shots', decimals: 0, of: (own) => own.length },
  {
    label: 'Goals',
    decimals: 0,
    of: (own) => own.filter((s) => s.outcome === 'goal').length,
  },
  { label: 'xG', decimals: 2, of: sumXg },
  {
    label: 'xG per shot',
    decimals: 2,
    of: (own) => (own.length ? sumXg(own) / own.length : null),
  },
];

/** Must match PLATE_FROM in HomePlates.tsx: a placeholder is the same shape as its plate. */
const PLATE_FROM = 80;
const PLATE_FRAME = frameFor('half', 'vertical', PLATE_FROM);

/** The match's minutes, and the ones the sheet marks: half time, full time, the turn of extra time. */
const MINUTES = 120;
const GUIDES = [45, 90, 105];
const TICKS = [0, ...GUIDES, MINUTES];
const atMinute = (min: number) => (Math.min(min, MINUTES) / MINUTES) * 100;
/** Goals closer together than this share one label: their marks all but touch. */
const SAME_MOMENT = 6;

/** The minute over each goal, or over the first of a few that come together. */
function goalMinutes(own: readonly Shot[]): Map<number, string> {
  const groups: Shot[][] = [];
  for (const goal of own
    .filter((s) => s.outcome === 'goal')
    .sort((x, y) => x.min - y.min)) {
    const last = groups.at(-1);
    const previous = last?.at(-1);
    if (last && previous && goal.min - previous.min < SAME_MOMENT) last.push(goal);
    else groups.push([goal]);
  }
  return new Map(
    groups.flatMap((g) => {
      const first = g[0];
      return first ? [[first.id, g.map((s) => `${s.min}'`).join(', ')] as const] : [];
    }),
  );
}

/** One player's side of the line: their name, and each shot at its minute, in the map's own marks. */
function TimelineLane(props: {
  name: string;
  own: readonly Shot[];
  side: 'above' | 'below';
  unit: number;
}) {
  const minutes = goalMinutes(props.own);
  const radius = (shot: Shot) => markRadius(shot.xg, props.unit) * props.unit;
  // Of two marks that would land on each other, the smaller steps toward the line, so a small goal
  // a minute after a big one is seen, not swallowed. One step: a match's marks rarely crowd further.
  const steps = new Map<number, number>();
  const byMinute = [...props.own].sort((x, y) => x.min - y.min);
  byMinute.forEach((s, i) => {
    const before = byMinute[i - 1];
    if (!before || steps.has(before.id)) return;
    const reach = radius(before) + radius(s);
    if (((s.min - before.min) / MINUTES) * 100 * props.unit < reach)
      steps.set((radius(s) < radius(before) ? s : before).id, reach + 2);
  });
  // Goals last, so one is never under a miss.
  const ordered = [...props.own].sort(
    (x, y) => Number(x.outcome === 'goal') - Number(y.outcome === 'goal'),
  );
  return (
    <div class="tl-lane" data-side={props.side}>
      <span class="tl-name">{props.name}</span>
      {ordered.map((s) => {
        const r = radius(s);
        const when = minutes.get(s.id);
        return (
          <span
            key={s.id}
            class="tl-shot"
            style={`--x:${atMinute(s.min)};--r:${r}px;--step:${steps.get(s.id) ?? 0}px;--d:${delayFor(s.min)}ms`}
          >
            <svg viewBox={`${-r} ${-r} ${2 * r} ${2 * r}`} focusable="false">
              {/* A goal's hole shows the paper, not a mark that happens to lie under it. */}
              {s.outcome === 'goal' ? <circle class="tl-hole" r={0.4 * r} /> : null}
              <path class={`shot shot--${s.outcome}`} d={markPath(s.outcome, 0, 0, r)} />
            </svg>
            {when ? <span class="tl-when num">{when}</span> : null}
          </span>
        );
      })}
    </div>
  );
}

const inWords = (name: string, own: readonly Shot[]) => {
  const goals = [...goalMinutes(own).values()].join(', ');
  return `${name}: ${own.length} shots${goals ? `, goals at ${goals}` : ''}.`;
};

/**
 * Two players in the hero match. The plate beside it says where a player shoots from, so this one
 * says when: the match as one line, one player above it and the other below, then their figures in
 * a table on the same rule as the one beside it.
 */
function Duel({ match, a, b }: { match: LoadedMatch; a: number; b: number }) {
  const name = (id: number) => match.detail.players.find((p) => p.id === id)?.name ?? '';
  const [left, right] = useMemo(() => {
    const shots = inPlay(match.shots);
    return [a, b].map((id) => shots.filter((s) => s.playerId === id)) as [Shot[], Shot[]];
  }, [match, a, b]);
  const frameRef = useRef<HTMLDivElement>(null);
  const unit = (useWidth(frameRef) || 343) / 100;
  const seen = useSeen(frameRef, 0.35);
  const sides = [
    { id: a, own: left },
    { id: b, own: right },
  ];
  const goalsOf = (own: readonly Shot[]) =>
    own.filter((s) => s.outcome === 'goal').length;
  const [first, second] = goalsOf(left) >= goalsOf(right) ? sides : [...sides].reverse();

  return (
    <>
      {first && second ? (
        <p class="plate-claim">
          {name(first.id)} scored {goalsOf(first.own)} from {first.own.length} shots.{' '}
          {name(second.id)} scored {goalsOf(second.own)} from {second.own.length}.
        </p>
      ) : null}
      <div
        ref={frameRef}
        class="map-frame timeline"
        data-plot={seen ? 'in' : 'wait'}
        role="img"
        aria-label={`Their shots through the final, by the minute. ${inWords(name(a), left)} ${inWords(name(b), right)}`}
      >
        <div class="tl-plot">
          {GUIDES.map((m) => (
            <span key={m} class="tl-guide" style={`--x:${atMinute(m)}`} />
          ))}
          <TimelineLane name={name(a)} own={left} side="above" unit={unit} />
          <div class="tl-axis">
            {TICKS.map((m) => (
              <span key={m} class="tl-tick num" style={`--x:${atMinute(m)}`}>
                {m}&prime;
              </span>
            ))}
          </div>
          <TimelineLane name={name(b)} own={right} side="below" unit={unit} />
        </div>
      </div>
      <table class="zones duel">
        <caption class="visually-hidden">
          {name(a)} and {name(b)} in the final. The higher figure in each column is in
          bold.
        </caption>
        <thead>
          <tr>
            <th scope="col">Player</th>
            {DUEL_ROWS.map((row) => (
              <th key={row.label} scope="col">
                {row.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sides.map(({ id, own }) => {
            const other = id === a ? right : left;
            return (
              <tr key={id}>
                <th scope="row">{name(id)}</th>
                {DUEL_ROWS.map((row) => {
                  const mine = row.of(own)?.toFixed(row.decimals) ?? '';
                  const theirs = row.of(other)?.toFixed(row.decimals) ?? '';
                  // The lead is judged on the printed figures: two that read alike are never ranked.
                  const lead = mine && theirs && Number(mine) > Number(theirs);
                  return (
                    <td
                      key={row.label}
                      class="duel-value num"
                      data-lead={lead || undefined}
                    >
                      {mine}
                      {lead ? <span class="visually-hidden"> (higher)</span> : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

type Plates = typeof import('./HomePlates');

/**
 * The plates that ask the API live in their own file (it brings the density layer and the player
 * loaders), fetched once, when the first of them comes within 300 px of the screen.
 */
function usePlates(ref: RefObject<Element | null>): Plates | 'error' | null {
  const near = useSeen(ref, 0, '300px');
  const [plates, setPlates] = useState<Plates | 'error' | null>(null);
  useEffect(() => {
    if (!near) return;
    let live = true;
    import('./HomePlates').then(
      (m) => live && setPlates(m),
      () => live && setPlates('error'),
    );
    return () => {
      live = false;
    };
  }, [near]);
  return plates;
}

const noop = () => undefined;

/** A plate before its file and data are in: the same empty pitch, the same height of everything. */
function PlatePlaceholder(props: {
  frameRef: RefObject<HTMLDivElement | null>;
  title: string;
  failed: string | null;
  density?: boolean;
}) {
  return (
    <figure class="plate">
      {props.density ? null : <p class="plate-claim"> </p>}
      <div
        ref={props.frameRef}
        class="map-frame"
        style={`--ratio:${PLATE_FRAME.w} / ${PLATE_FRAME.h}`}
      >
        <div class="map">
          <Pitch title={props.title} from={PLATE_FROM} />
        </div>
      </div>
      <figcaption
        class={`plate-caption plate-caption--lazy${props.density ? ' density-caption' : ''}`}
      >
        {props.density ? <span class="tint-key" /> : null}
        <span>{props.failed ?? ' '}</span>
      </figcaption>
      {props.density ? null : (
        <>
          <ShotKey counts={null} pressed={null} onToggle={noop} onPreview={noop} />
          <ZoneTable rows={null} />
        </>
      )}
    </figure>
  );
}

function LazyCompetitionPlate(props: { player: number; competition: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const plates = usePlates(ref);
  if (plates && plates !== 'error') {
    const Plate = plates.CompetitionPlate;
    return <Plate {...props} />;
  }
  return (
    <PlatePlaceholder
      frameRef={ref}
      title="The shots, not yet loaded"
      failed={plates === 'error' ? 'The shots could not be loaded.' : null}
    />
  );
}

function LazyDensityPlate(props: {
  player: number;
  name: string;
  competition: number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const plates = usePlates(ref);
  if (plates && plates !== 'error') {
    const Plate = plates.DensityPlate;
    return <Plate {...props} />;
  }
  return (
    <PlatePlaceholder
      frameRef={ref}
      title={`${props.name}'s squares, not yet loaded`}
      failed={plates === 'error' ? 'The squares could not be loaded.' : null}
      density
    />
  );
}

const WORDS = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
];
/** A small count as a word at the start of a sentence: "Five competitions". */
const countWord = (n: number) => WORDS[n] ?? nf.format(n);

function Competitions({ meta }: { meta: Meta | 'error' | null }) {
  if (meta === 'error')
    return (
      <p class="home-body">
        The competitions could not be loaded. <a href="/matches">All matches</a> are a
        page away.
      </p>
    );
  return (
    <ul class="comps" aria-busy={meta === null || undefined}>
      {meta?.competitions.map((c) => {
        const matches = c.seasons.reduce((t, s) => t + s.matches, 0);
        return (
          <li key={c.id}>
            <a class="comp" href={`/matches?competition=${c.id}`}>
              <span class="comp-name">{c.name}</span>
              <span class="comp-seasons">{seasonSpan(c.seasons.map((s) => s.name))}</span>
              <span class="comp-count num">
                {nf.format(matches)} {matches === 1 ? 'match' : 'matches'}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function Index({ match, meta }: { match: LoadedMatch; meta: Meta | 'error' | null }) {
  const player = (id: number) => match.detail.players.find((p) => p.id === id);
  const mbappe = player(MBAPPE);
  const messi = player(MESSI);
  const final = match.detail.stage.name.toLowerCase();

  return (
    <section class="home-index" aria-labelledby="index-title">
      <h2 id="index-title" class="visually-hidden">
        The pages
      </h2>

      <article class="sheet sheet--player">
        <h3 class="sheet-title">A player, shot by shot</h3>
        <p class="sheet-note">
          {RONALDO.name} in La Liga, every shot in the data. Goals stand out; everything
          else steps back.
        </p>
        <LazyCompetitionPlate player={RONALDO.id} competition={LA_LIGA} />
        <a class="sheet-link" href={`/players/${RONALDO.id}`}>
          Open {RONALDO.name}{' '}
          <span class="arrow" aria-hidden="true">
            &rarr;
          </span>
        </a>
      </article>

      {mbappe && messi ? (
        <article class="sheet sheet--compare">
          <h3 class="sheet-title">Two players on one sheet</h3>
          <p class="sheet-note">
            Every shot they took in the {final}, at the minute they took it, then the
            figures. The higher of each is in bold.
          </p>
          <Duel match={match} a={MESSI} b={MBAPPE} />
          <a
            class="sheet-link"
            href={`/compare?a=${MESSI}&b=${MBAPPE}&competition=${WORLD_CUP.competition}&season=${WORLD_CUP.season}`}
          >
            Compare their whole World Cup{' '}
            <span class="arrow" aria-hidden="true">
              &rarr;
            </span>
          </a>
        </article>
      ) : null}

      <article class="sheet sheet--matches">
        <h3 class="sheet-title">Every match, newest first</h3>
        <p class="sheet-note">
          {meta && meta !== 'error'
            ? `${countWord(meta.competitions.length)} competitions`
            : 'The competitions'}
          , from 2014 on. Pick one to see its matches.
        </p>
        <Competitions meta={meta} />
      </article>

      <article class="sheet sheet--density">
        <h3 class="sheet-title">Where a player shoots from</h3>
        <p class="sheet-note">
          {RONALDO.name}&rsquo;s La Liga shots again, counted in two-yard squares. The
          darker the square, the more shots.
        </p>
        <LazyDensityPlate player={RONALDO.id} name={RONALDO.name} competition={LA_LIGA} />
        <a class="sheet-link" href={`/players/${RONALDO.id}?view=density`}>
          Open his density map{' '}
          <span class="arrow" aria-hidden="true">
            &rarr;
          </span>
        </a>
      </article>
    </section>
  );
}

// The imprint

const COUNTS: readonly { key: keyof Meta['counts']; label: string }[] = [
  { key: 'matches', label: 'Matches' },
  { key: 'shots', label: 'Shots' },
  { key: 'players', label: 'Players' },
  { key: 'teams', label: 'Teams' },
];

function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

function Imprint({ meta }: { meta: Meta | 'error' | null }) {
  const ready = meta !== null && meta !== 'error';
  return (
    <section class="home-imprint" aria-labelledby="imprint-title">
      <h2 id="imprint-title" class="home-h2">
        From StatsBomb&rsquo;s open data
      </h2>
      {meta !== 'error' ? (
        <dl class="counts" aria-busy={!ready || undefined}>
          {COUNTS.map((c) => (
            <div key={c.key} class="count">
              <dt class="label">{c.label}</dt>
              <dd class="count-value num">
                {ready ? nf.format(meta.counts[c.key]) : ''}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p class="home-body">
        {ready
          ? `${listOf(meta.competitions.map((c) => c.name))}, in the seasons StatsBomb has released from 2014 on.`
          : 'The seasons StatsBomb has released from 2014 on.'}{' '}
        Every position, outcome and xG value is theirs. Shotmap only draws them.
      </p>
    </section>
  );
}

// The page

/** True until the home page has been shown once in this page load. */
let booting = true;

/**
 * On the page load's first view, everything under the hero is drawn after the hero is painted:
 * two tasks instead of one long one, which took the page's blocking time from about 150 ms to
 * about 100. Preact runs an effect after the paint, and the timer makes the rest a task of its
 * own. (Not requestAnimationFrame: a window the browser does not paint, such as one behind
 * another, gets no frames, and the page would stop at the hero.) Coming back to the page later in
 * the same load, it is all drawn at once. The footer is out of the page until the rest is in, so
 * nothing on screen moves when it arrives.
 */
function useRestAfterPaint(): boolean {
  const [ready, setReady] = useState(!booting);
  useFooterHidden(!ready);
  useEffect(() => {
    booting = false;
    if (ready) return;
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, []);
  return ready;
}

export function Home() {
  const match = useHero();
  const meta = useMeta();
  const rest = useRestAfterPaint();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = 'Shotmap: every shot, surveyed';
    if (claimArrival()) heading.current?.focus();
  }, []);

  return (
    <div class="home">
      <section class="home-hero" aria-labelledby="home-title">
        <div class="hero-text">
          <h1 id="home-title" class="home-title" ref={heading} tabIndex={-1}>
            Every shot, surveyed.
          </h1>
          <p class="home-lead">
            Football shots plotted on the pitch: where each was taken, how good the chance
            was, and what happened next.
          </p>
          <div class="hero-actions">
            <button
              type="button"
              class="hero-search"
              onClick={openPicker}
              aria-haspopup="dialog"
            >
              <span>Search a player, team or match</span>
              <kbd class="hero-key" aria-hidden="true">
                /
              </kbd>
            </button>
            <a class="hero-browse" href="/matches">
              Browse every match{' '}
              <span class="arrow" aria-hidden="true">
                &rarr;
              </span>
            </a>
          </div>
        </div>
        {match && match !== 'error' ? (
          <HeroPlate match={match} />
        ) : (
          <div class="plate hero-plate" aria-hidden="true">
            <div class="plate-ends" />
            <div class="map-frame" style={`--ratio:${HERO_FRAME.w} / ${HERO_FRAME.h}`} />
          </div>
        )}
      </section>

      {rest ? (
        <>
          <Key />
          {match && match !== 'error' ? <Index match={match} meta={meta} /> : null}
          <Imprint meta={meta} />
        </>
      ) : null}
    </div>
  );
}
