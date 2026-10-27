import type { ComponentChildren, Ref } from 'preact';
import type { Shot } from '../data/shots';
import type { Frame } from './frame';
import { Pitch } from './Pitch';
import { ShotLayer, type MapShot } from './ShotLayer';
import { StatsStrip } from './StatsStrip';
import './shotmap.css';

export interface ShotPanelProps {
  /** The panel's heading: a team, a player. */
  name: string;
  /** The shots its stats strip counts. */
  stats: readonly Shot[];
  frame: Frame;
  /** Where the pitch is cropped from, in yards from the goal line's far end. */
  from: number;
  intro: boolean;
  /** What is drawn: already filtered and placed. */
  shots: readonly MapShot[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** The map's title, and the label of the group of marks, for assistive technology. */
  title: string;
  label: string;
  /** Only the first panel is measured (see useMapFrame). */
  stageRef?: Ref<HTMLDivElement> | null;
  mapRef?: Ref<HTMLDivElement> | null;
  /** Names the panel in a view transition, so it morphs between filter changes. */
  transitionName?: string | undefined;
  /** Shown over the map when nothing is drawn. */
  empty?: ComponentChildren;
  /** The selected shot's details, laid out by the panel's map frame. */
  card?: ComponentChildren;
}

/**
 * One shot map with its heading and stats: a pitch, the layer of marks on it, and room for the
 * detail card. It knows nothing about where the shots came from, so a match's two panels and a
 * player's one are built from the same piece.
 */
export function ShotPanel(props: ShotPanelProps) {
  const { name, frame, from, intro, shots } = props;
  return (
    <section
      class="panel"
      aria-label={`${name} shots`}
      style={
        props.transitionName ? `view-transition-name:${props.transitionName}` : undefined
      }
    >
      <h2 class="panel-name">{name}</h2>
      <StatsStrip shots={props.stats} />
      <div ref={props.stageRef ?? null} class="stage">
        <div class="map-frame" style={`--ratio:${(frame.w / frame.h).toFixed(4)}`}>
          <div ref={props.mapRef ?? null} class="map" data-intro={intro}>
            <Pitch title={props.title} mode="half" orientation="vertical" from={from} />
            <ShotLayer
              frame={frame}
              shots={shots}
              selectedId={props.selectedId}
              intro={intro}
              label={props.label}
              onSelect={props.onSelect}
            />
          </div>
          {props.empty}
          {props.card}
        </div>
      </div>
    </section>
  );
}
