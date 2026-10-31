import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PITCH, type Density, type Player } from '@shotmap/schema';
import { ApiError } from '../api/client';
import {
  BinCard,
  DensityCells,
  DensityLayer,
  DensityLegend,
  binAnchor,
  binAnnouncement,
} from '../components/Density';
import { frameFor } from '../components/frame';
import type { MapShot } from '../components/ShotLayer';
import { ShotPanel } from '../components/ShotPanel';
import { loadPlayer, loadPlayerDensity } from '../data/players';
import { useFooterHidden } from '../lib/hooks';
import { compareUrl, parseCompareView, type Slot } from '../lib/compare';
import {
  DENSITY_STEP,
  binsOf,
  describeDensity,
  drawableBins,
  sharedMax,
  type Bin,
} from '../lib/density';
import { figuresFor, sharedSeasons, statLines, type Scope } from '../lib/figures';
import { KEYS_HINT } from '../lib/player';
import { useStore } from '../lib/store';
import { claimArrival, navigate, openPlayerPicker, store } from '../state/app';
import './compare.css';

/**
 * Both pitches show the last 40 yards, fixed rather than read from the data: panels that share a
 * crop compare directly, and a crop that waited for the data would change the page's shape when it
 * arrived (DESIGN.md section 10).
 */
const FROM = 80;
const FRAME = frameFor('half', 'vertical', FROM);
const STEP = DENSITY_STEP;
const NO_MARKS: readonly MapShot[] = [];
const noop = () => undefined;

type Status = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

/** What was asked for and how it went. While the next answer loads, `data` is the last one. */
interface Slice<T> {
  data: T | null;
  status: Status;
}
const IDLE = { data: null, status: 'idle' } as const;
/** Before the first effect has run, an id that is set is already being asked for. */
const startFor = (id: number | null): Slice<never> =>
  id === null ? IDLE : { data: null, status: 'loading' };
const NO_BINS: readonly Bin[] = [];

const failure = (error: unknown): Status =>
  error instanceof ApiError && error.status === 404 ? 'missing' : 'error';

/**
 * One side of the comparison: the player and the squares their shots fall in, both asked for as
 * soon as the id is known. Nothing waits for the other side, or for the profile before the
 * squares. A new player or scope keeps what was on the page until the next answer is in.
 */
function useSide(id: number | null, scope: Scope) {
  const [profile, setProfile] = useState<Slice<Player>>(() => startFor(id));
  const [density, setDensity] = useState<Slice<Density>>(() => startFor(id));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (id === null) {
      setProfile(IDLE);
      return;
    }
    const ask = new AbortController();
    setProfile((was) => ({ data: was.data, status: 'loading' }));
    loadPlayer(id, ask.signal).then(
      (data) => setProfile({ data, status: 'ready' }),
      (error: unknown) => {
        if (!ask.signal.aborted) setProfile({ data: null, status: failure(error) });
      },
    );
    return () => ask.abort();
  }, [id, attempt]);

  useEffect(() => {
    if (id === null) {
      setDensity(IDLE);
      return;
    }
    const ask = new AbortController();
    setDensity((was) => ({ data: was.data, status: 'loading' }));
    loadPlayerDensity({ id }, scope, null, ask.signal).then(
      (data) => setDensity({ data, status: 'ready' }),
      (error: unknown) => {
        if (!ask.signal.aborted) setDensity({ data: null, status: failure(error) });
      },
    );
    return () => ask.abort();
  }, [id, scope, attempt]);

  return { id, profile, density, retry: () => setAttempt((n) => n + 1) };
}
type Side = ReturnType<typeof useSide>;

/** The bins a map can show: those with any of their square in the last 40 yards. */
const drawable = (d: Density | null): Bin[] =>
  d ? drawableBins(binsOf(d), STEP, FROM) : [];

const seasonName = (r: { competition: { name: string }; season: { name: string } }) =>
  `${r.competition.name} ${r.season.name}`;

/**
 * Two players on one sheet: who they are, their figures side by side, and a density map of each
 * on one shared scale. Everything worth a link is in the URL (lib/compare.ts); a square opened on
 * a map is not, since a shared link is about the players and the span.
 */
export default function ComparePage() {
  const search = useStore(store, (s) => s.search);
  const view = useMemo(() => parseCompareView(search), [search]);
  const scope = useMemo<Scope>(
    () => ({ competition: view.competition, season: view.season }),
    [view.competition, view.season],
  );
  // Both sides ask for everything at once, from the URL alone.
  const a = useSide(view.a, scope);
  const b = useSide(view.b, scope);
  const sides = { a, b };

  // The page is a heading and a block that keeps a screen's height until it has shown anything.
  // After that a player being chosen loads in its own slot: the page, and the focus on the button
  // that asked, stay where they are.
  const first = (s: Side) =>
    s.id !== null && s.profile.data === null && s.profile.status === 'loading';
  const shown = useRef(false);
  const waiting = !shown.current && (first(a) || first(b));
  if (!waiting) shown.current = true;
  useFooterHidden(waiting);

  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (claimArrival()) heading.current?.focus();
  }, []);

  const pa = a.profile.data;
  const pb = b.profile.data;
  const compared = pa !== null && pb !== null;
  const names = compared ? `${pa.name} and ${pb.name}` : null;
  useEffect(() => {
    document.title = names ? `${names} compared | Shotmap` : 'Compare players | Shotmap';
  }, [names]);

  const shared = useMemo(
    () => (compared ? sharedSeasons(pa, pb) : []),
    [compared, pa, pb],
  );
  const settled = a.profile.status === 'ready' && b.profile.status === 'ready';
  // A link to a season one of them never played: the span falls back to every season.
  useEffect(() => {
    if (!settled || view.competition === null) return;
    if (
      !shared.some(
        (r) => r.competition.id === view.competition && r.season.id === view.season,
      )
    )
      navigate(compareUrl(view, { competition: null, season: null }), { replace: true });
  }, [settled, shared, view]);

  const binsA = useMemo(() => drawable(a.density.data), [a.density.data]);
  const binsB = useMemo(() => drawable(b.density.data), [b.density.data]);
  // One top for both scales; the maps are drawn only once both are in, so the first tint shown is the last.
  const mapped = a.density.data !== null && b.density.data !== null;
  const max = useMemo(() => sharedMax(binsA, binsB), [binsA, binsB]);

  const fa = pa && figuresFor(pa, scope);
  const fb = pb && figuresFor(pb, scope);
  const lines = fa && fb ? statLines(fa, fb) : null;
  const chosen = shared.find(
    (r) => r.competition.id === view.competition && r.season.id === view.season,
  );

  const loading = [a.profile, b.profile, a.density, b.density].some(
    (s) => s.status === 'loading',
  );
  // What to say in place of the comparison: nothing while a player is on its way.
  const prompt =
    view.a === null && view.b === null
      ? 'Choose two players to compare them.'
      : view.a === null || view.b === null
        ? 'Choose a second player to compare them.'
        : loading
          ? null
          : 'Choose two players who are in the data to compare them.';

  return (
    <article class="compare" aria-labelledby="compare-title">
      <header class="compare-head">
        <h1 id="compare-title" class="compare-title" ref={heading} tabIndex={-1}>
          Compare players
        </h1>
        <p class="compare-lede">
          Two players, one scale: where each shoots from, and how their figures stand.
        </p>
      </header>

      {waiting ? (
        <p class="status label compare-wait" role="status">
          Loading the players
        </p>
      ) : (
        <>
          <div class="compare-slots">
            <SlotHead slot="a" side={a} />
            <SlotHead slot="b" side={b} />
          </div>

          {compared && lines ? (
            <div class="compare-body" data-loading={loading} aria-busy={loading}>
              <section class="versus" aria-labelledby="versus-title">
                <h2 id="versus-title" class="compare-section">
                  Figures
                </h2>
                {shared.length > 0 ? (
                  <label class="versus-scope">
                    <span class="label">Compare over</span>
                    <select
                      class="versus-select"
                      value={chosen ? `${chosen.competition.id}:${chosen.season.id}` : ''}
                      onChange={(e) => {
                        const row = shared.find(
                          (r) =>
                            `${r.competition.id}:${r.season.id}` ===
                            e.currentTarget.value,
                        );
                        navigate(
                          compareUrl(view, {
                            competition: row?.competition.id ?? null,
                            season: row?.season.id ?? null,
                          }),
                          { replace: true },
                        );
                      }}
                    >
                      <option value="">Every season</option>
                      {shared.map((r) => (
                        <option
                          key={`${r.competition.id}:${r.season.id}`}
                          value={`${r.competition.id}:${r.season.id}`}
                        >
                          {seasonName(r)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p class="map-note">
                    These two have no season in common, so only their careers can be
                    compared.
                  </p>
                )}
                <table class="versus-table">
                  <caption class="visually-hidden">
                    Open-play shots, {chosen ? seasonName(chosen) : 'every season'}:{' '}
                    {pa.name} against {pb.name}. The better figure in a row is in bold and
                    underlined, and read out as higher.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" class="versus-name">
                        {pa.name}
                      </th>
                      <th scope="col">
                        <span class="visually-hidden">Figure</span>
                      </th>
                      <th scope="col" class="versus-name">
                        {pb.name}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.key}>
                        <Figure text={line.a} lead={line.lead === 'a'} />
                        <th scope="row" class="versus-label">
                          {line.label}
                        </th>
                        <Figure text={line.b} lead={line.lead === 'b'} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <div class="compare-maps">
                {(['a', 'b'] as const).map((slot) => {
                  const side = sides[slot];
                  const player = slot === 'a' ? pa : pb;
                  const bins = slot === 'a' ? binsA : binsB;
                  return (
                    <MapPanel
                      key={slot}
                      slot={slot}
                      player={player}
                      other={slot === 'a' ? pb : pa}
                      side={side}
                      bins={bins}
                      all={side.density.data}
                      max={max}
                      mapped={mapped}
                    />
                  );
                })}
              </div>

              {mapped && max > 0 ? (
                <div class="compare-key">
                  <DensityLegend max={max} step={STEP} />
                  <p class="map-note">
                    Both maps are shaded on this one scale, so a tint means the same
                    number of shots on either side.
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            prompt && <p class="compare-prompt">{prompt}</p>
          )}
        </>
      )}
    </article>
  );
}

/** A figure, and whether it is the better one in its row: bold and underlined, and said aloud. */
function Figure({ text, lead }: { text: string | null; lead: boolean }) {
  return (
    <td class="num versus-figure" data-lead={lead}>
      {text === null ? (
        <>
          <span aria-hidden="true">–</span>
          <span class="visually-hidden">none</span>
        </>
      ) : (
        <>
          {text}
          {lead ? <span class="visually-hidden"> (higher)</span> : null}
        </>
      )}
    </td>
  );
}

/** Who is on one side, and the button that opens the search to change them. */
function SlotHead({ slot, side }: { slot: Slot; side: Side }) {
  const { id, profile } = side;
  const player = id === null ? null : profile.data;
  const tag = `Player ${slot.toUpperCase()}`;
  return (
    <section class="slot" aria-label={tag}>
      <p class="label slot-tag">{tag}</p>
      {player ? (
        <>
          <p class="slot-name">
            <a href={`/players/${player.id}`}>{player.name}</a>
          </p>
          <p class="slot-teams">{player.teams.map((t) => t.name).join(' · ')}</p>
        </>
      ) : profile.status === 'missing' ? (
        <>
          <p class="slot-name">No such player</p>
          <p class="slot-teams">Nobody in the data has this number.</p>
        </>
      ) : profile.status === 'error' ? (
        <>
          <p class="slot-name" role="alert">
            The player did not load
          </p>
          <p class="slot-teams">Check your connection and try again.</p>
        </>
      ) : (
        <p class="slot-name slot-none" role={id === null ? undefined : 'status'}>
          {id === null ? 'Nobody chosen yet' : 'Loading the player'}
        </p>
      )}
      <div class="state-actions">
        {profile.status === 'error' ? (
          <button type="button" class="state-button" data-primary onClick={side.retry}>
            Try again
          </button>
        ) : null}
        <button
          type="button"
          class="state-button"
          aria-haspopup="dialog"
          onClick={() => openPlayerPicker(slot)}
        >
          {id === null || profile.status === 'missing' ? 'Choose a player' : 'Change'}
          <span class="visually-hidden"> for {tag}</span>
        </button>
      </div>
    </section>
  );
}

/**
 * One player's density map: the same panel as the player page, on the scale both maps share. A
 * square opened is this panel's own business (a shared link is about the players, not a square).
 */
function MapPanel(props: {
  slot: Slot;
  player: Player;
  other: Player;
  side: Side;
  /** The squares that can be drawn here, and every square counted (for the long shots left out). */
  bins: readonly Bin[];
  all: Density | null;
  max: number;
  /** Both maps have their squares: only then is either drawn. */
  mapped: boolean;
}) {
  const { slot, player, other, side, bins, all, max, mapped } = props;
  const [open, setOpen] = useState<number | null>(null);
  // A square belongs to the map it was opened on.
  useEffect(() => setOpen(null), [bins]);

  const shown = mapped ? bins : NO_BINS;
  const total = useMemo(() => shown.reduce((n, b) => n + b.n, 0), [shown]);
  const behind = useMemo(
    () =>
      all ? all.n.reduce((n, v) => n + v, 0) - bins.reduce((n, b) => n + b.n, 0) : 0,
    [all, bins],
  );
  const openBin = open === null ? undefined : shown.find((b) => b.key === open);
  useEffect(() => {
    if (open === null) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);

  const summaryId = `summary-${slot}`;
  const failed = side.density.status === 'error' || side.density.status === 'missing';
  const empty = !mapped ? (
    failed ? null : (
      <p class="compare-empty">Counting the shots</p>
    )
  ) : shown.length === 0 ? (
    <p class="compare-empty">No shots here.</p>
  ) : null;

  return (
    <div class="compare-map">
      <ShotPanel
        name={player.name}
        frame={FRAME}
        from={FROM}
        intro={false}
        shots={NO_MARKS}
        selectedId={null}
        onSelect={noop}
        layerName="density"
        underlay={<DensityCells bins={shown} step={STEP} max={max} />}
        layer={
          <DensityLayer
            frame={FRAME}
            bins={shown}
            step={STEP}
            selectedKey={openBin?.key ?? null}
            label={`${player.name}'s shots, square by square`}
            describedBy={summaryId}
            announce={openBin ? binAnnouncement(openBin, STEP, total) : ''}
            onSelect={setOpen}
          />
        }
        title={`Map of ${player.name}: how many shots were taken from each ${STEP}-yard square of the last ${PITCH.length - FROM} yards before goal, on the same scale as ${other.name}.`}
        label={`${player.name}'s shots, square by square.`}
        empty={empty}
        card={
          openBin ? (
            <BinCard
              bin={openBin}
              step={STEP}
              total={total}
              anchor={binAnchor(FRAME, openBin, STEP)}
              onClose={() => setOpen(null)}
            />
          ) : null
        }
      />
      {failed ? (
        <div class="compare-failed" role="alert">
          <p class="map-note">The squares did not load.</p>
          <div class="state-actions">
            <button type="button" class="state-button" onClick={side.retry}>
              Try again
            </button>
          </div>
        </div>
      ) : null}
      {mapped && shown.length > 0 ? (
        <p id={summaryId} class="map-note compare-summary">
          {describeDensity(shown, STEP)}
          {/* How to use the list, said to those who use it: two of them on a page is one too many to read. */}
          <span class="visually-hidden"> {KEYS_HINT}</span>
        </p>
      ) : null}
      {mapped && behind > 0 ? (
        <p class="map-note">
          {behind} long {behind === 1 ? 'shot' : 'shots'} from further out than the map
          shows {behind === 1 ? 'is' : 'are'} not drawn.
        </p>
      ) : null}
    </div>
  );
}
