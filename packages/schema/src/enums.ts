import type { Outcome } from './constants';

/**
 * The enums that shot columns refer to by StatsBomb id. They are constants, not a file
 * the client has to fetch before it can decode anything. They list what appears in the
 * data we ingest; ingest stops on an id that is not here, so a new value is a conscious
 * addition. `label` is what the UI shows. Outcomes also say which of the five marks
 * they are drawn as. The first four match the legend in the static index.json exactly
 * (a test checks that), so the legacy files and the new payloads decode the same way.
 */
export const ENUMS = {
  outcome: [
    { id: 96, name: 'Blocked', label: 'Blocked', group: 'blocked' },
    { id: 97, name: 'Goal', label: 'Goal', group: 'goal' },
    { id: 98, name: 'Off T', label: 'Off target', group: 'off' },
    { id: 99, name: 'Post', label: 'Hit the post', group: 'post' },
    { id: 100, name: 'Saved', label: 'Saved', group: 'saved' },
    { id: 101, name: 'Wayward', label: 'Wayward', group: 'off' },
    {
      id: 115,
      name: 'Saved Off Target',
      label: 'Saved, would have missed',
      group: 'saved',
    },
    { id: 116, name: 'Saved to Post', label: 'Saved onto the post', group: 'saved' },
  ],
  bodyPart: [
    { id: 37, name: 'Head', label: 'Head' },
    { id: 38, name: 'Left Foot', label: 'Left Foot' },
    { id: 40, name: 'Right Foot', label: 'Right Foot' },
    { id: 70, name: 'Other', label: 'Other' },
  ],
  shotType: [
    { id: 61, name: 'Corner', label: 'Corner' },
    { id: 62, name: 'Free Kick', label: 'Free Kick' },
    { id: 87, name: 'Open Play', label: 'Open Play' },
    { id: 88, name: 'Penalty', label: 'Penalty' },
  ],
  technique: [
    { id: 89, name: 'Backheel', label: 'Backheel' },
    { id: 90, name: 'Diving Header', label: 'Diving Header' },
    { id: 91, name: 'Half Volley', label: 'Half Volley' },
    { id: 92, name: 'Lob', label: 'Lob' },
    { id: 93, name: 'Normal', label: 'Normal' },
    { id: 94, name: 'Overhead Kick', label: 'Overhead Kick' },
    { id: 95, name: 'Volley', label: 'Volley' },
  ],
  /** How the possession began. Stored by ingest, not yet in the shot payloads. */
  playPattern: [
    { id: 1, name: 'Regular Play', label: 'Regular Play' },
    { id: 2, name: 'From Corner', label: 'From Corner' },
    { id: 3, name: 'From Free Kick', label: 'From Free Kick' },
    { id: 4, name: 'From Throw In', label: 'From Throw In' },
    { id: 5, name: 'Other', label: 'Other' },
    { id: 6, name: 'From Counter', label: 'From Counter' },
    { id: 7, name: 'From Goal Kick', label: 'From Goal Kick' },
    { id: 8, name: 'From Keeper', label: 'From Keeper' },
    { id: 9, name: 'From Kick Off', label: 'From Kick Off' },
  ],
} as const satisfies Record<
  string,
  readonly { id: number; name: string; label: string; group?: Outcome }[]
>;

export type EnumKind = keyof typeof ENUMS;
