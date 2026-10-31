import { sentence, shotLabel, type Shot } from './shots';

/**
 * What is said when a shot is opened and its card appears: the label, and the facts the card
 * adds. For a layer whose marks are not elements (a canvas), whose list has a live region.
 */
export const shotAnnouncement = (s: Shot) =>
  `${shotLabel(s)}. ${sentence(s.bodyPart)}, ${s.shotType.toLowerCase()}${s.technique === 'Normal' ? '' : `, ${s.technique.toLowerCase()}`}. Shot details are open.`;
