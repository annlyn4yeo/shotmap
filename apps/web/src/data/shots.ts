import type { DecodedShot } from '@shotmap/schema';

/** One shot as the views use it: what `decodeShotsStrict` gives. */
export type Shot = DecodedShot;

/** "Left Foot" becomes "Left foot". */
export const sentence = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
