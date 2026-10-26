import type { MatchFile } from '@shotmap/schema';

/** What the static files throw away about a shot, kept for the database. */
export interface RichShot {
  /** StatsBomb's event id. */
  uuid: string;
  playerId: number;
  teamId: number;
  /** StatsBomb play_pattern id (regular play, from a corner...). */
  playPattern: number;
  firstTime: boolean;
}

/** A player who took a shot in one match, as that match's lineup names them. */
export interface RosterRow {
  playerId: number;
  teamId: number;
  /** 0 home, 1 away. */
  side: 0 | 1;
  /** Nickname if the lineup has one, else the full name, else the event's name. */
  name: string;
  /** The lineup's full name, else the event's name. */
  fullName: string;
  shirt: number | null;
}

/** Everything the build learns about one match. `file` is exactly what the static build writes. */
export interface MatchRecord {
  file: MatchFile;
  stage: string;
  /** Own goals credited to each side. Not shots, so dropped from the files, but they explain score gaps. */
  ownGoals: [number, number];
  rich: {
    /** In seq order: open play in event order, then the shootout kicks. */
    shots: RichShot[];
    /** In order of each player's first shot, which is the static file's `players` order. */
    roster: RosterRow[];
  };
}
