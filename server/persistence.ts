import fs from 'node:fs';
import path from 'node:path';
import { MAX_NAME_LENGTH, USER_ID_PATTERN } from '../shared/protocol';
import { isValidRoomId } from '../shared/room-id';
import { DECKS, TABS, type RoomState } from '../shared/types';

export const FILE_VERSION = 2;

/** What survives a restart: the room state and when it was last used. Sockets never persist. */
export interface StoredRoom {
  state: RoomState;
  lastActivity: number;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isParticipant(key: string, x: unknown): boolean {
  return (
    isObject(x) &&
    typeof x.id === 'string' &&
    x.id === key &&
    USER_ID_PATTERN.test(key) &&
    typeof x.publicId === 'string' &&
    typeof x.name === 'string' &&
    x.name.length >= 1 &&
    x.name.length <= MAX_NAME_LENGTH &&
    isFiniteNumber(x.lastSeen)
  );
}

/** Votes must belong to a valid user id and be a card of that tab's deck. */
function isVoteMap(x: unknown, deck: readonly number[]): boolean {
  return (
    isObject(x) &&
    Object.entries(x).every(
      ([userId, v]) => USER_ID_PATTERN.test(userId) && isFiniteNumber(v) && deck.includes(v),
    )
  );
}

function isRoomState(x: unknown): x is RoomState {
  if (!isObject(x)) return false;
  const { participants, votes, revealed } = x;
  return (
    isObject(participants) &&
    Object.entries(participants).every(([key, p]) => isParticipant(key, p)) &&
    isObject(votes) &&
    TABS.every((tab) => isVoteMap(votes[tab], DECKS[tab])) &&
    isObject(revealed) &&
    TABS.every((tab) => typeof revealed[tab] === 'boolean')
  );
}

function isStoredRoom(x: unknown): x is StoredRoom {
  return isObject(x) && isFiniteNumber(x.lastActivity) && isRoomState(x.state);
}

function parseFile(parsed: unknown, now: number): Map<string, StoredRoom> {
  if (!isObject(parsed) || parsed.version !== FILE_VERSION || !isObject(parsed.rooms)) {
    throw new Error('unexpected shape');
  }
  const rooms = new Map<string, StoredRoom>();
  for (const [roomId, room] of Object.entries(parsed.rooms)) {
    if (!isValidRoomId(roomId)) throw new Error(`invalid room id "${roomId}"`);
    if (!isStoredRoom(room)) throw new Error(`invalid room "${roomId}"`);
    // A clock that was ahead (or a hand-edited file) must not make a room immortal.
    for (const p of Object.values(room.state.participants)) p.lastSeen = Math.min(p.lastSeen, now);
    rooms.set(roomId, { state: room.state, lastActivity: Math.min(room.lastActivity, now) });
  }
  return rooms;
}

export interface LoadOptions {
  /** Keep at most this many rooms, the most recently active first. Default: no cap. */
  maxRooms?: number;
  /** Clock for clamping future timestamps. Default `Date.now()`. */
  now?: number;
}

/**
 * Loads all rooms. A missing file means no rooms. An unreadable file (corrupt, legacy single-room
 * format, or any invalid content) is moved aside as `<file>.corrupt-<ts>` and we start empty.
 */
export function loadRooms(file: string, opts: LoadOptions = {}): Map<string, StoredRoom> {
  if (!fs.existsSync(file)) return new Map();
  try {
    const rooms = parseFile(JSON.parse(fs.readFileSync(file, 'utf8')), opts.now ?? Date.now());
    const max = opts.maxRooms;
    if (max === undefined || rooms.size <= max) return rooms;
    const newest = [...rooms].sort((a, b) => b[1].lastActivity - a[1].lastActivity).slice(0, max);
    return new Map(newest);
  } catch (err) {
    const corrupt = `${file}.corrupt-${Date.now()}`;
    console.warn(`State file ${file} is unreadable (${(err as Error).message}); moved to ${corrupt}`);
    try {
      fs.renameSync(file, corrupt);
    } catch (renameErr) {
      console.warn(`Could not move corrupt state file aside: ${(renameErr as Error).message}`);
    }
    return new Map();
  }
}

export function saveRooms(file: string, rooms: ReadonlyMap<string, StoredRoom>): void {
  const out: Record<string, StoredRoom> = {};
  for (const [roomId, room] of rooms) {
    out[roomId] = { state: room.state, lastActivity: room.lastActivity };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: FILE_VERSION, rooms: out }));
  fs.renameSync(tmp, file);
}

export function createSaver(
  file: string,
  getRooms: () => ReadonlyMap<string, StoredRoom>,
  delayMs = 300,
): { schedule(): void; flush(): void } {
  let timer: NodeJS.Timeout | undefined;
  const write = () => {
    timer = undefined;
    try {
      saveRooms(file, getRooms());
    } catch (err) {
      console.error('Failed to persist state', err);
    }
  };
  return {
    schedule() {
      if (!timer) timer = setTimeout(write, delayMs);
    },
    /** Cancels any pending debounced write and writes now, unconditionally. */
    flush() {
      if (timer) clearTimeout(timer);
      write();
    },
  };
}
