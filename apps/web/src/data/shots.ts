import type { DecodedShot } from '@shotmap/schema';

/** One shot as the views use it: what `decodeShotsStrict` gives. */
export type Shot = DecodedShot;

/** "Left Foot" becomes "Left foot". */
export const sentence = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

/** What assistive technology says for a shot's mark. */
export const shotLabel = (s: Shot) =>
  `${s.player}, ${s.shootout ? 'penalty shootout' : `minute ${s.min}`}, ${s.outcomeLabel.toLowerCase()}, ${s.xg.toFixed(2)} expected goals`;
