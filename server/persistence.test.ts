import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoom } from '../shared/room';
import { createSaver, loadRooms, saveRooms, type StoredRoom } from './persistence';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-persist-'));
  file = path.join(dir, 'nested', 'state.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const ROOM_A = 'abcdefghjk';
const ROOM_B = 'mnpqrstuvw';

function stored(name: string, vote: number, lastActivity: number): StoredRoom {
  const state = createRoom();
  state.participants['user-aaaa-0001'] = {
    id: 'user-aaaa-0001',
    publicId: `public-${name}`,
    name,
    lastSeen: 5,
  };
  state.votes.poker['user-aaaa-0001'] = vote;
  return { state, lastActivity };
}

function writeRaw(raw: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof raw === 'string' ? raw : JSON.stringify(raw));
}

function expectMovedAside(): void {
  const leftovers = fs.readdirSync(path.dirname(file));
  expect(leftovers.some((f) => f.startsWith('state.json.corrupt-'))).toBe(true);
  expect(leftovers).not.toContain('state.json');
}

function load(): Map<string, StoredRoom> {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    return loadRooms(file);
  } finally {
    warn.mockRestore();
  }
}

describe('persistence', () => {
  it('returns no rooms when the file does not exist', () => {
    expect(loadRooms(file).size).toBe(0);
  });

  it('round-trips two rooms and creates missing directories', () => {
    const rooms = new Map([
      [ROOM_A, stored('Ada', 8, 100)],
      [ROOM_B, stored('Bob', 3, 200)],
    ]);
    saveRooms(file, rooms);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).version).toBe(2);
    expect(loadRooms(file)).toEqual(rooms);
  });

  it('does not persist anything beyond state and lastActivity', () => {
    const extra = { ...stored('Ada', 8, 100), sockets: new Map([['x', 'y']]) };
    saveRooms(file, new Map([[ROOM_A, extra]]));
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(Object.keys(raw.rooms[ROOM_A]).sort()).toEqual(['lastActivity', 'state']);
  });

  it('moves a corrupt file aside and starts empty', () => {
    writeRaw('{ not json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadRooms(file).size).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expectMovedAside();
  });

  it('treats a legacy single-room file as unreadable and moves it aside', () => {
    writeRaw({
      participants: {},
      votes: { poker: {}, confidence: {} },
      revealed: { poker: false, confidence: false },
    });
    expect(load().size).toBe(0);
    expectMovedAside();
  });

  it('treats a wrong version as unreadable', () => {
    writeRaw({ version: 1, rooms: {} });
    expect(load().size).toBe(0);
    expectMovedAside();
  });

  it('treats an invalid room id key as unreadable', () => {
    writeRaw({ version: 2, rooms: { 'Bad Id!': stored('Ada', 8, 1) } });
    expect(load().size).toBe(0);
    expectMovedAside();
  });

  it('treats a room with a participant without publicId as unreadable', () => {
    writeRaw({
      version: 2,
      rooms: {
        [ROOM_A]: {
          lastActivity: 1,
          state: {
            participants: { 'user-aaaa-0001': { id: 'user-aaaa-0001', name: 'Ada', lastSeen: 5 } },
            votes: { poker: {}, confidence: {} },
            revealed: { poker: false, confidence: false },
          },
        },
      },
    });
    expect(load().size).toBe(0);
    expectMovedAside();
  });

  it('treats a non-numeric vote as unreadable', () => {
    writeRaw({
      version: 2,
      rooms: {
        [ROOM_A]: {
          lastActivity: 1,
          state: {
            participants: {},
            votes: { poker: { 'user-aaaa-0001': 'eight' }, confidence: {} },
            revealed: { poker: false, confidence: false },
          },
        },
      },
    });
    expect(load().size).toBe(0);
    expectMovedAside();
  });

  it('treats a participant stored under a different key than its id as unreadable', () => {
    const room = stored('Ada', 8, 1);
    room.state.participants['user-bbbb-0002'] = room.state.participants['user-aaaa-0001'];
    delete room.state.participants['user-aaaa-0001'];
    writeRaw({ version: 2, rooms: { [ROOM_A]: room } });
    expect(load().size).toBe(0);
    expectMovedAside();
  });

  it('treats a missing or non-numeric lastActivity as unreadable', () => {
    writeRaw({ version: 2, rooms: { [ROOM_A]: { state: createRoom() } } });
    expect(load().size).toBe(0);
    expectMovedAside();
  });

  it('treats an invalid user id as unreadable', () => {
    const room = stored('Ada', 8, 1);
    room.state.participants.x = { ...room.state.participants['user-aaaa-0001'], id: 'x' };
    delete room.state.participants['user-aaaa-0001'];
    delete room.state.votes.poker['user-aaaa-0001'];
    writeRaw({ version: 2, rooms: { [ROOM_A]: room } });
    expect(load().size).toBe(0);
    expectMovedAside();
  });

  it.each([
    ['empty', ''],
    ['too long', 'x'.repeat(41)],
    ['not a string', 42],
  ])('treats a participant name that is %s as unreadable', (_label, name) => {
    const room = stored('Ada', 8, 1);
    (room.state.participants['user-aaaa-0001'] as { name: unknown }).name = name;
    writeRaw({ version: 2, rooms: { [ROOM_A]: room } });
    expect(load().size).toBe(0);
    expectMovedAside();
  });

  it('accepts a 40-character name', () => {
    const room = stored('x'.repeat(40), 8, 1);
    writeRaw({ version: 2, rooms: { [ROOM_A]: room } });
    expect(loadRooms(file).size).toBe(1);
  });

  it.each([
    ['poker vote outside the deck', 'poker', 7],
    ['confidence vote outside the deck', 'confidence', 13],
    ['poker vote of zero', 'poker', 0],
    ['vote of null (a non-finite number)', 'poker', null],
  ])('treats a %s as unreadable', (_label, tab, value) => {
    const room = stored('Ada', 8, 1);
    delete room.state.votes.poker['user-aaaa-0001'];
    (room.state.votes as Record<string, Record<string, unknown>>)[tab as string]['user-aaaa-0001'] = value;
    writeRaw({ version: 2, rooms: { [ROOM_A]: room } });
    expect(load().size).toBe(0);
    expectMovedAside();
  });

  it('treats a vote keyed by an invalid user id as unreadable', () => {
    const room = stored('Ada', 8, 1);
    room.state.votes.poker.__proto__x = 5;
    writeRaw({ version: 2, rooms: { [ROOM_A]: room } });
    expect(load().size).toBe(0);
    expectMovedAside();
  });

  it('treats a non-numeric lastSeen as unreadable', () => {
    const room = stored('Ada', 8, 1);
    (room.state.participants['user-aaaa-0001'] as { lastSeen: unknown }).lastSeen = 'yesterday';
    writeRaw({ version: 2, rooms: { [ROOM_A]: room } });
    expect(load().size).toBe(0);
    expectMovedAside();
  });

  it('clamps timestamps in the future to now', () => {
    const now = 1_000_000;
    const room = stored('Ada', 8, now + 5_000_000);
    room.state.participants['user-aaaa-0001'].lastSeen = now + 9_000_000;
    saveRooms(file, new Map([[ROOM_A, room]]));
    const loaded = loadRooms(file, { now }).get(ROOM_A)!;
    expect(loaded.lastActivity).toBe(now);
    expect(loaded.state.participants['user-aaaa-0001'].lastSeen).toBe(now);
  });

  it('leaves past timestamps alone', () => {
    const room = stored('Ada', 8, 100);
    saveRooms(file, new Map([[ROOM_A, room]]));
    const loaded = loadRooms(file, { now: 1_000_000 }).get(ROOM_A)!;
    expect(loaded.lastActivity).toBe(100);
    expect(loaded.state.participants['user-aaaa-0001'].lastSeen).toBe(5);
  });

  it('applies maxRooms on load, keeping the most recently active rooms', () => {
    const ids = ['aaaaaaaa1', 'bbbbbbbb2', 'cccccccc3', 'dddddddd4'].map((s) => s.slice(0, 9) + '5');
    const rooms = new Map(ids.map((id, i) => [id, stored('Ada', 8, 100 + i * 10)] as const));
    saveRooms(file, rooms);
    const loaded = loadRooms(file, { maxRooms: 2, now: 1_000_000 });
    expect([...loaded.keys()].sort()).toEqual([ids[2], ids[3]].sort());
    // The file is not moved aside for being over the cap.
    expect(fs.existsSync(file)).toBe(true);
  });

  it('flush writes even when nothing is scheduled', () => {
    const saver = createSaver(file, () => new Map(), 300);
    saver.flush();
    expect(fs.existsSync(file)).toBe(true);
  });

  it('debounces writes and flush writes immediately', () => {
    vi.useFakeTimers();
    const saver = createSaver(file, () => new Map(), 300);
    saver.schedule();
    saver.schedule();
    expect(fs.existsSync(file)).toBe(false);
    vi.advanceTimersByTime(300);
    expect(fs.existsSync(file)).toBe(true);

    fs.rmSync(file);
    saver.schedule();
    saver.flush();
    expect(fs.existsSync(file)).toBe(true);
    vi.useRealTimers();
  });
});
