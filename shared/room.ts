import { USER_ID_PATTERN, sanitizeName } from './protocol';
import { computeStats } from './stats';
import {
  DECKS,
  TABS,
  type ClientMessage,
  type RoomState,
  type Row,
  type StateMessage,
  type Tab,
  type TabView,
} from './types';

export const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

const has = (obj: object, key: string): boolean => Object.hasOwn(obj, key);

export function createRoom(): RoomState {
  return {
    participants: {},
    votes: { poker: {}, confidence: {} },
    revealed: { poker: false, confidence: false },
  };
}

/** Mutates `state`. Returns true when the state changed. */
export function applyMessage(
  state: RoomState,
  userId: string,
  msg: ClientMessage,
  now: number,
): boolean {
  if (msg.type === 'join') {
    const name = sanitizeName(msg.name);
    if (name === null || !USER_ID_PATTERN.test(msg.userId) || msg.userId !== userId) return false;
    const existing = has(state.participants, userId) ? state.participants[userId] : undefined;
    state.participants[userId] = {
      id: userId,
      // Stable across rejoins; random so it cannot be used to impersonate anyone.
      publicId: existing?.publicId ?? crypto.randomUUID(),
      name,
      lastSeen: now,
    };
    return true;
  }

  if (!has(state.participants, userId)) return false;
  const participant = state.participants[userId];
  participant.lastSeen = now;

  switch (msg.type) {
    case 'rename': {
      const name = sanitizeName(msg.name);
      if (name === null) return false;
      participant.name = name;
      return true;
    }
    case 'vote': {
      if (state.revealed[msg.tab]) return false;
      if (msg.value === null) {
        delete state.votes[msg.tab][userId];
        return true;
      }
      if (!DECKS[msg.tab].includes(msg.value)) return false;
      state.votes[msg.tab][userId] = msg.value;
      return true;
    }
    case 'reveal':
      state.revealed[msg.tab] = true;
      return true;
    case 'hide':
      state.revealed[msg.tab] = false;
      return true;
    case 'reset':
      state.votes[msg.tab] = {};
      state.revealed[msg.tab] = false;
      return true;
    default:
      return false;
  }
}

export function touchParticipant(state: RoomState, userId: string, now: number): void {
  if (has(state.participants, userId)) state.participants[userId].lastSeen = now;
}

/** Drops offline participants without votes who have been gone for over 24h. */
export function pruneParticipants(
  state: RoomState,
  online: ReadonlySet<string>,
  now: number,
): boolean {
  let changed = false;
  for (const p of Object.values(state.participants)) {
    if (online.has(p.id)) continue;
    if (now - p.lastSeen <= PRUNE_AFTER_MS) continue;
    if (TABS.some((tab) => has(state.votes[tab], p.id))) continue;
    delete state.participants[p.id];
    changed = true;
  }
  return changed;
}

function buildTabView(
  state: RoomState,
  tab: Tab,
  viewerId: string,
  online: ReadonlySet<string>,
): TabView {
  const votes = state.votes[tab];
  const revealed = state.revealed[tab];

  // Show people while connected; keep an offline person only while they still hold a vote here.
  const rows: Row[] = Object.values(state.participants)
    .filter((p) => online.has(p.id) || has(votes, p.id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.publicId.localeCompare(b.publicId))
    .map((p) => {
      const hasVoted = has(votes, p.id);
      // Row.id is the public id; the secret user id must never leave the server.
      const row: Row = { id: p.publicId, name: p.name, hasVoted, online: online.has(p.id) };
      if (revealed && hasVoted) row.value = votes[p.id];
      return row;
    });

  const view: TabView = { revealed, rows };
  if (has(votes, viewerId)) view.myVote = votes[viewerId];
  // Only the confidence vote shows an average; poker estimates are discussed, not averaged.
  if (revealed && tab === 'confidence') view.stats = computeStats(Object.values(votes));
  return view;
}

/** Builds the redacted per-viewer message: no vote values leak before reveal. */
export function buildView(
  state: RoomState,
  viewerId: string,
  online: ReadonlySet<string>,
): StateMessage {
  return {
    type: 'state',
    you: viewerId,
    tabs: {
      poker: buildTabView(state, 'poker', viewerId, online),
      confidence: buildTabView(state, 'confidence', viewerId, online),
    },
  };
}
