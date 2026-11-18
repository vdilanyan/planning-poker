export const TABS = ['poker', 'confidence'] as const;
export type Tab = (typeof TABS)[number];

export const DECKS: Record<Tab, readonly number[]> = {
  poker: [2, 3, 5, 8, 13],
  confidence: [3, 4, 5, 6, 7, 8, 9, 10],
};

export interface Participant {
  /** Secret user id. Never sent to other users. */
  id: string;
  /** Random public id, safe to broadcast; used as the table row key. */
  publicId: string;
  name: string;
  lastSeen: number;
}

export interface RoomState {
  participants: Record<string, Participant>;
  votes: Record<Tab, Record<string, number>>;
  revealed: Record<Tab, boolean>;
}

export type ClientMessage =
  | { type: 'join'; userId: string; name: string }
  | { type: 'rename'; name: string }
  | { type: 'vote'; tab: Tab; value: number | null }
  | { type: 'reveal' | 'hide' | 'reset'; tab: Tab };

export interface Stats {
  count: number;
  average: number | null;
  min: number | null;
  max: number | null;
}

export interface Row {
  /** Opaque public id (`Participant.publicId`). Never the secret user id. */
  id: string;
  name: string;
  hasVoted: boolean;
  online: boolean;
  /** Present only when the tab is revealed and the user voted. */
  value?: number;
}

export interface TabView {
  revealed: boolean;
  rows: Row[];
  /** The requesting user's own vote (always visible to them). */
  myVote?: number;
  /** Present only when the tab is revealed. */
  stats?: Stats;
}

export interface StateMessage {
  type: 'state';
  you: string;
  tabs: Record<Tab, TabView>;
}
