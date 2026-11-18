import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoom } from '../shared/room';
import { createRoomServer, type RoomServer, type RoomServerOptions } from './room-server';
import { saveRooms } from './persistence';
import { TestClient } from './test-client';

let dir: string;
let server: RoomServer | undefined;
let clients: TestClient[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-server-'));
});

afterEach(async () => {
  clients.forEach((c) => c.close());
  clients = [];
  await server?.close();
  server = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

const ROOM = 'abcdefghjk';
const ROOM_2 = 'mnpqrstuvw';
const ROOM_3 = 'xyz2345678';
const ROOM_4 = 'ab23cd45ef';
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Writes a state file with empty rooms last used `idleMs` ago. */
function seedRooms(idleByRoom: Record<string, number>): void {
  const now = Date.now();
  saveRooms(
    path.join(dir, 'state.json'),
    new Map(
      Object.entries(idleByRoom).map(([id, idle]) => [
        id,
        { state: createRoom(), lastActivity: now - idle },
      ]),
    ),
  );
}

async function start(extra: Partial<RoomServerOptions> = {}): Promise<number> {
  server = createRoomServer({
    dataFile: path.join(dir, 'state.json'),
    saveDelayMs: 10,
    ...extra,
  });
  return server.listen(0);
}

async function join(
  port: number,
  userId: string,
  name: string,
  roomId: string = ROOM,
): Promise<TestClient> {
  const client = await TestClient.connect(port, roomId);
  clients.push(client);
  client.send({ type: 'join', userId, name });
  await client.waitFor((s) => s.you === userId);
  return client;
}

const A = 'user-aaaa-0001';
const B = 'user-bbbb-0002';

describe('room server', () => {
  it('keeps votes hidden until reveal', async () => {
    const port = await start();
    const a = await join(port, A, 'Ada');
    const b = await join(port, B, 'Bob');

    a.send({ type: 'vote', tab: 'poker', value: 8 });
    const hidden = await b.waitFor((s) =>
      s.tabs.poker.rows.some((r) => r.name === 'Ada' && r.hasVoted),
    );
    const rowA = hidden.tabs.poker.rows.find((r) => r.name === 'Ada')!;
    expect('value' in rowA).toBe(false);
    expect(JSON.stringify(hidden)).not.toContain('"value"');
    // Ada's secret user id must not reach Bob.
    expect(JSON.stringify(hidden)).not.toContain(A);
    expect(hidden.tabs.poker.stats).toBeUndefined();

    const own = await a.waitFor((s) => s.tabs.poker.myVote === 8);
    expect(own.tabs.poker.revealed).toBe(false);

    b.send({ type: 'reveal', tab: 'poker' });
    const revealed = await a.waitFor((s) => s.tabs.poker.revealed);
    expect(revealed.tabs.poker.rows.find((r) => r.name === 'Ada')?.value).toBe(8);
    expect(revealed.tabs.poker.stats).toBeUndefined();
  });

  it('computes the average 9.2 for confidence votes 8 9 9 10 10', async () => {
    const port = await start();
    const votes = [8, 9, 9, 10, 10];
    const people: TestClient[] = [];
    for (let i = 0; i < votes.length; i++) {
      const client = await join(port, `user-000${i}-aaaa`, `Person ${i}`);
      client.send({ type: 'vote', tab: 'confidence', value: votes[i] });
      people.push(client);
    }
    await people[0].waitFor((s) => s.tabs.confidence.rows.filter((r) => r.hasVoted).length === 5);
    people[0].send({ type: 'reveal', tab: 'confidence' });
    const state = await people[4].waitFor((s) => s.tabs.confidence.revealed);
    expect(state.tabs.confidence.stats).toEqual({ count: 5, average: 9.2, min: 8, max: 10 });
  });

  it('hide re-hides values and reset clears only its own tab', async () => {
    const port = await start();
    const a = await join(port, A, 'Ada');
    a.send({ type: 'vote', tab: 'poker', value: 5 });
    a.send({ type: 'vote', tab: 'confidence', value: 7 });
    a.send({ type: 'reveal', tab: 'poker' });
    a.send({ type: 'reveal', tab: 'confidence' });
    await a.waitFor((s) => s.tabs.poker.revealed && s.tabs.confidence.revealed);

    a.send({ type: 'reset', tab: 'poker' });
    const afterReset = await a.waitFor((s) => !s.tabs.poker.revealed);
    expect(afterReset.tabs.poker.rows[0].hasVoted).toBe(false);
    expect(afterReset.tabs.confidence.revealed).toBe(true);
    expect(afterReset.tabs.confidence.rows[0].value).toBe(7);

    a.send({ type: 'hide', tab: 'confidence' });
    const afterHide = await a.waitFor((s) => !s.tabs.confidence.revealed);
    expect(afterHide.tabs.confidence.rows[0].hasVoted).toBe(true);
    expect('value' in afterHide.tabs.confidence.rows[0]).toBe(false);
  });

  it('ignores invalid votes and garbage messages', async () => {
    const port = await start();
    const a = await join(port, A, 'Ada');
    a.send({ type: 'vote', tab: 'poker', value: 7 }); // not in deck
    a.send({ type: 'vote', tab: 'poker', value: 1 }); // not in deck
    a.send('garbage');
    a.send({ type: 'rename', name: 'Ada L' }); // barrier: processed after the above
    const state = await a.waitFor((s) => s.tabs.poker.rows[0].name === 'Ada L');
    expect(state.tabs.poker.myVote).toBeUndefined();
    expect(state.tabs.poker.rows[0].hasVoted).toBe(false);
  });

  it('reports who is online', async () => {
    const port = await start();
    const a = await join(port, A, 'Ada');
    const b = await join(port, B, 'Bob');
    await a.waitFor((s) => s.tabs.poker.rows.every((r) => r.online) && s.tabs.poker.rows.length === 2);
    b.close();
    // Bob holds no vote, so he disappears once offline.
    const state = await a.waitFor((s) => s.tabs.poker.rows.every((r) => r.name !== 'Bob'));
    expect(state.tabs.poker.rows.find((r) => r.name === 'Ada')?.online).toBe(true);
  });

  it('keeps an offline participant who still holds a vote, marked offline', async () => {
    const port = await start();
    const a = await join(port, A, 'Ada');
    const b = await join(port, B, 'Bob');
    b.send({ type: 'vote', tab: 'poker', value: 5 });
    await a.waitFor((s) => s.tabs.poker.rows.some((r) => r.name === 'Bob' && r.hasVoted));
    b.close();
    const state = await a.waitFor((s) => s.tabs.poker.rows.some((r) => r.name === 'Bob' && !r.online));
    expect(state.tabs.poker.rows.find((r) => r.name === 'Bob')?.hasVoted).toBe(true);
  });

  it('does not write to the data file after close() resolves', async () => {
    const port = await start();
    const dataFile = path.join(dir, 'state.json');
    const a = await join(port, A, 'Ada');
    a.send({ type: 'vote', tab: 'poker', value: 8 });
    await a.waitFor((s) => s.tabs.poker.myVote === 8);
    await server!.close();
    server = undefined;
    expect(fs.existsSync(dataFile)).toBe(true);
    a.close();
    clients = [];

    fs.rmSync(dataFile);
    await new Promise((r) => setTimeout(r, 100));
    expect(fs.existsSync(dataFile)).toBe(false);
  });

  it('rejects listen when the port is already in use', async () => {
    const port = await start();
    const other = createRoomServer({ dataFile: path.join(dir, 'other.json') });
    await expect(other.listen(port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await other.close();
  });

  it('survives a server restart via the JSON file', async () => {
    let port = await start();
    const a = await join(port, A, 'Ada');
    a.send({ type: 'vote', tab: 'poker', value: 8 });
    await a.waitFor((s) => s.tabs.poker.myVote === 8);
    a.close();
    clients = [];
    await server!.close();
    server = undefined;

    port = await start();
    const again = await join(port, A, 'Ada');
    const state = await again.waitFor((s) => s.tabs.poker.myVote === 8);
    expect(state.tabs.poker.rows).toHaveLength(1);
  });
});

async function waitUntil(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const socketsIn = (roomId: string): number | undefined =>
  server!.roomInfo().find((r) => r.id === roomId)?.sockets;

async function connectExpectClose(port: number, roomId: string | null) {
  const client = await TestClient.connect(port, roomId);
  clients.push(client);
  return client.closed;
}

describe('rooms', () => {
  it('isolates votes, reveal state and participants between rooms (same userId in both)', async () => {
    const port = await start();
    const inRoom1 = await join(port, A, 'Ada', ROOM);
    const inRoom2 = await join(port, A, 'Ada', ROOM_2);
    const bobInRoom2 = await join(port, B, 'Bob', ROOM_2);

    inRoom1.send({ type: 'vote', tab: 'poker', value: 13 });
    inRoom1.send({ type: 'reveal', tab: 'poker' });
    await inRoom1.waitFor((s) => s.tabs.poker.revealed && s.tabs.poker.myVote === 13);

    inRoom2.send({ type: 'vote', tab: 'poker', value: 2 });
    const state2 = await bobInRoom2.waitFor((s) =>
      s.tabs.poker.rows.some((r) => r.name === 'Ada' && r.hasVoted),
    );
    expect(state2.tabs.poker.revealed).toBe(false);
    expect(state2.tabs.poker.rows.map((r) => r.name).sort()).toEqual(['Ada', 'Bob']);
    expect('value' in state2.tabs.poker.rows.find((r) => r.name === 'Ada')!).toBe(false);

    // Room 1 is untouched by room 2's vote and still has a single participant.
    const state1 = await inRoom1.waitFor((s) => s.tabs.poker.revealed);
    expect(state1.tabs.poker.rows).toHaveLength(1);
    expect(state1.tabs.poker.rows[0].value).toBe(13);
    expect(state1.tabs.poker.myVote).toBe(13);

    // Resetting room 2 does not touch room 1.
    bobInRoom2.send({ type: 'reset', tab: 'poker' });
    await inRoom2.waitFor((s) => s.tabs.poker.myVote === undefined);
    expect(inRoom1.received.at(-1)!.tabs.poker.myVote).toBe(13);
  });

  it('only broadcasts to the sockets of the room that changed, with per-room online status', async () => {
    const port = await start();
    const a = await join(port, A, 'Ada', ROOM);
    const b = await join(port, B, 'Bob', ROOM_2);
    const before = a.received.length;
    b.send({ type: 'vote', tab: 'poker', value: 5 });
    await b.waitFor((s) => s.tabs.poker.myVote === 5);
    expect(a.received.length).toBe(before);
    // Bob is not "online" in Ada's room.
    expect(a.received.at(-1)!.tabs.poker.rows.map((r) => r.name)).toEqual(['Ada']);
  });

  it('keeps redaction per room: no vote values or secret user ids before reveal', async () => {
    const port = await start();
    const a = await join(port, A, 'Ada', ROOM);
    const b = await join(port, B, 'Bob', ROOM);
    const outsider = await join(port, 'user-cccc-0003', 'Cy', ROOM_2);

    a.send({ type: 'vote', tab: 'poker', value: 8 });
    const seen = await b.waitFor((s) => s.tabs.poker.rows.some((r) => r.name === 'Ada' && r.hasVoted));
    expect(JSON.stringify(seen)).not.toContain('"value"');
    expect(JSON.stringify(seen)).not.toContain(A);
    expect(JSON.stringify(seen)).toContain(B); // `you`, the viewer's own id
    expect(seen.tabs.poker.stats).toBeUndefined();

    // Nothing from room 1 ever reached room 2.
    outsider.send({ type: 'rename', name: 'Cyrus' });
    const out = await outsider.waitFor((s) => s.tabs.poker.rows[0]?.name === 'Cyrus');
    expect(JSON.stringify(out)).not.toContain('Ada');
    expect(JSON.stringify(out)).not.toContain(A);
    expect(JSON.stringify(out)).not.toContain(B);
    expect(out.tabs.poker.rows).toHaveLength(1);
  });

  it('creates rooms lazily on the first connection to a valid code', async () => {
    const port = await start();
    expect(server!.roomInfo()).toEqual([]);

    const a = await join(port, A, 'Ada', ROOM);
    expect(server!.roomInfo().map((r) => r.id)).toEqual([ROOM]);
    expect(socketsIn(ROOM)).toBe(1);

    // A brand-new code is created on demand too (e.g. a link used after a restart lost its state).
    await join(port, B, 'Bob', ROOM_2);
    expect(server!.roomInfo().map((r) => r.id).sort()).toEqual([ROOM, ROOM_2].sort());
    expect(a.received.at(-1)!.tabs.poker.rows).toHaveLength(1);
  });

  it('closes with 4400 for a missing or invalid room code', async () => {
    const port = await start();
    for (const bad of [null, '', 'short', 'UPPERCASE1', 'has-dash-1234', 'a'.repeat(33), 'a b c d e f']) {
      expect(await connectExpectClose(port, bad)).toEqual({ code: 4400, reason: 'invalid room' });
    }
    expect(server!.roomInfo()).toEqual([]);
  });

  it('closes with 4403 when a room already has maxParticipantsPerRoom sockets', async () => {
    const port = await start({ maxParticipantsPerRoom: 2 });
    await join(port, A, 'Ada');
    await join(port, B, 'Bob');
    expect(await connectExpectClose(port, ROOM)).toEqual({ code: 4403, reason: 'room full' });

    // Other rooms are not affected.
    const other = await join(port, 'user-cccc-0003', 'Cy', ROOM_2);
    expect(other.received.at(-1)!.tabs.poker.rows).toHaveLength(1);

    // A freed slot can be taken again.
    clients[0].close();
    await waitUntil(() => socketsIn(ROOM) === 1);
    const again = await join(port, 'user-dddd-0004', 'Di');
    expect(again.received.at(-1)!.tabs.poker.rows.map((r) => r.name).sort()).toEqual(['Bob', 'Di']);
  });

  it('counts sockets that have connected but not yet joined towards the room limit', async () => {
    const port = await start({ maxParticipantsPerRoom: 1 });
    const first = await TestClient.connect(port, ROOM);
    clients.push(first);
    expect(await connectExpectClose(port, ROOM)).toEqual({ code: 4403, reason: 'room full' });
  });

  it('evicts the oldest empty room idle for over an hour when maxRooms is reached', async () => {
    seedRooms({ [ROOM]: 5 * HOUR, [ROOM_2]: 3 * HOUR, [ROOM_3]: 10 * MINUTE });
    const port = await start({ maxRooms: 3 });

    const d = await join(port, 'user-cccc-0003', 'Cy', ROOM_4);
    expect(d.received.at(-1)!.tabs.poker.rows).toHaveLength(1);
    expect(server!.roomInfo().map((r) => r.id).sort()).toEqual([ROOM_2, ROOM_3, ROOM_4].sort());
  });

  it('never evicts a room used within the last hour: closes with 4429 instead', async () => {
    seedRooms({ [ROOM]: 30 * MINUTE, [ROOM_2]: 10 * MINUTE });
    const port = await start({ maxRooms: 2 });

    expect(await connectExpectClose(port, ROOM_3)).toEqual({ code: 4429, reason: 'server full' });
    expect(server!.roomInfo().map((r) => r.id).sort()).toEqual([ROOM, ROOM_2].sort());
  });

  it('does not evict a room that was just vacated (last activity within the hour)', async () => {
    const port = await start({ maxRooms: 2 });
    const a = await join(port, A, 'Ada', ROOM);
    await join(port, B, 'Bob', ROOM_2);
    a.close();
    await waitUntil(() => socketsIn(ROOM) === 0);
    expect(await connectExpectClose(port, ROOM_3)).toEqual({ code: 4429, reason: 'server full' });
    expect(server!.roomInfo().map((r) => r.id).sort()).toEqual([ROOM, ROOM_2].sort());
  });

  it('closes with 4429 when maxRooms is reached and no room can be evicted', async () => {
    const port = await start({ maxRooms: 2 });
    await join(port, A, 'Ada', ROOM);
    await join(port, B, 'Bob', ROOM_2);
    expect(await connectExpectClose(port, ROOM_3)).toEqual({ code: 4429, reason: 'server full' });
    expect(server!.roomInfo().map((r) => r.id).sort()).toEqual([ROOM, ROOM_2].sort());

    // Existing rooms keep accepting people when the server is at its room cap.
    const extra = await join(port, 'user-cccc-0003', 'Cy', ROOM);
    expect(extra.received.at(-1)!.tabs.poker.rows).toHaveLength(2);
  });

  it('pruneNow deletes only empty rooms older than the ttl and keeps rooms with sockets', async () => {
    const day = 24 * 60 * 60 * 1000;
    const base = Date.now();
    saveRooms(path.join(dir, 'state.json'), new Map([
      [ROOM, { state: createRoom(), lastActivity: base - 10 * day }], // stale, empty
      [ROOM_2, { state: createRoom(), lastActivity: base - 10 * day }], // stale, but someone connects
      [ROOM_3, { state: createRoom(), lastActivity: base - 1 * day }], // recent, empty
    ]));
    const port = await start({ roomTtlMs: 7 * day });
    expect(server!.roomInfo()).toHaveLength(3);

    await join(port, A, 'Ada', ROOM_2);
    server!.pruneNow(base + 1000);

    const ids = server!.roomInfo().map((r) => r.id).sort();
    expect(ids).toEqual([ROOM_2, ROOM_3].sort());

    // Later, the recent empty room expires as well; the occupied one never does.
    server!.pruneNow(base + 30 * day);
    expect(server!.roomInfo().map((r) => r.id)).toEqual([ROOM_2]);
  });

  it('keeps a room that was recently active until its ttl runs out', async () => {
    const day = 24 * 60 * 60 * 1000;
    const port = await start({ roomTtlMs: 7 * day });
    const a = await join(port, A, 'Ada');
    a.close();
    await waitUntil(() => socketsIn(ROOM) === 0);
    server!.pruneNow(Date.now() + 6 * day);
    expect(server!.roomInfo().map((r) => r.id)).toEqual([ROOM]);
    server!.pruneNow(Date.now() + 8 * day);
    expect(server!.roomInfo()).toEqual([]);
  });

  it('pruneNow still prunes stale offline participants inside surviving rooms', async () => {
    const day = 24 * 60 * 60 * 1000;
    const base = Date.now();
    const state = createRoom();
    state.participants[A] = { id: A, publicId: 'pub-a', name: 'Ada', lastSeen: base - 2 * day };
    saveRooms(path.join(dir, 'state.json'), new Map([[ROOM, { state, lastActivity: base }]]));
    const port = await start({ roomTtlMs: 30 * day });
    const b = await join(port, B, 'Bob');
    server!.pruneNow(base + 1000);
    // Ada was stale and offline with no vote: she is removed from the stored state.
    b.send({ type: 'rename', name: 'Bobby' });
    await b.waitFor((s) => s.tabs.poker.rows[0]?.name === 'Bobby');
    await server!.close();
    server = undefined;
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    expect(Object.keys(saved.rooms[ROOM].state.participants)).toEqual([B]);
  });

  it('persists and restores two rooms across a restart', async () => {
    let port = await start();
    const a = await join(port, A, 'Ada', ROOM);
    const b = await join(port, B, 'Bob', ROOM_2);
    a.send({ type: 'vote', tab: 'poker', value: 8 });
    b.send({ type: 'vote', tab: 'confidence', value: 9 });
    await a.waitFor((s) => s.tabs.poker.myVote === 8);
    await b.waitFor((s) => s.tabs.confidence.myVote === 9);
    a.close();
    b.close();
    clients = [];
    await server!.close();
    server = undefined;

    port = await start();
    expect(server!.roomInfo().map((r) => r.id).sort()).toEqual([ROOM, ROOM_2].sort());
    expect(server!.roomInfo().every((r) => r.sockets === 0)).toBe(true);
    const a2 = await join(port, A, 'Ada', ROOM);
    const b2 = await join(port, B, 'Bob', ROOM_2);
    expect((await a2.waitFor((s) => s.tabs.poker.myVote === 8)).tabs.confidence.myVote).toBeUndefined();
    expect((await b2.waitFor((s) => s.tabs.confidence.myVote === 9)).tabs.poker.myVote).toBeUndefined();
  });

  it('closes a socket that sends more than the allowed messages per second (1008)', async () => {
    const port = await start();
    const a = await join(port, A, 'Ada');
    for (let i = 0; i < 60; i++) a.send({ type: 'vote', tab: 'poker', value: i % 2 ? 3 : null });
    const info = await a.closed;
    expect(info.code).toBe(1008);
  });

  it('does not rate-limit normal use', async () => {
    const port = await start();
    const a = await join(port, A, 'Ada');
    for (let i = 0; i < 20; i++) a.send({ type: 'vote', tab: 'poker', value: i % 2 ? 3 : null });
    a.send({ type: 'vote', tab: 'poker', value: 5 });
    await a.waitFor((s) => s.tabs.poker.myVote === 5);
  });

  it('serves /healthz', async () => {
    const port = await start();
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('static client', () => {
  it('serves index.html for /, /r/<code> and any unknown path (SPA fallback)', async () => {
    const staticDir = path.join(dir, 'dist');
    fs.mkdirSync(staticDir);
    fs.writeFileSync(path.join(staticDir, 'index.html'), '<html><body>spa-marker</body></html>');
    const port = await start({ staticDir });

    for (const route of ['/', `/r/${ROOM}`, '/r/not-valid', '/something/else']) {
      const res = await fetch(`http://127.0.0.1:${port}${route}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('spa-marker');
    }
    // The API endpoints are still reachable.
    expect(await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()).toEqual({ ok: true });
  });
});

function savedParticipants(roomId: string): string[] {
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  return Object.keys(saved.rooms[roomId].state.participants).sort();
}

async function closeAndRead(roomId: string): Promise<string[]> {
  await server!.close();
  server = undefined;
  return savedParticipants(roomId);
}

function seedParticipants(
  roomId: string,
  people: Array<{ id: string; lastSeen: number; vote?: number }>,
): void {
  const state = createRoom();
  for (const p of people) {
    state.participants[p.id] = { id: p.id, publicId: `pub-${p.id}`, name: p.id, lastSeen: p.lastSeen };
    if (p.vote !== undefined) state.votes.poker[p.id] = p.vote;
  }
  saveRooms(
    path.join(dir, 'state.json'),
    new Map([[roomId, { state, lastActivity: Date.now() }]]),
  );
}

const P1 = 'user-p001-0001';
const P2 = 'user-p002-0002';
const P3 = 'user-p003-0003';
const NEWBIE = 'user-new0-0009';

describe('one join per socket', () => {
  it('closes the socket (1008) on a second join with a different userId and adds no participant', async () => {
    const port = await start();
    const a = await join(port, A, 'Ada');
    const observer = await join(port, B, 'Bob');

    a.send({ type: 'join', userId: 'user-eve0-0666', name: 'Eve' });
    expect(await a.closed).toEqual({ code: 1008, reason: 'already joined' });

    // Ada drops off, and Eve never appeared anywhere.
    await observer.waitFor((s) => s.tabs.poker.rows.every((r) => r.name !== 'Ada'));
    expect(JSON.stringify(observer.received)).not.toContain('Eve');
    expect(await closeAndRead(ROOM)).toEqual([A, B].sort());
  });

  it('ignores a repeated join with the same userId (no rename, no close)', async () => {
    const port = await start();
    const a = await join(port, A, 'Ada');
    a.send({ type: 'join', userId: A, name: 'Zed' });
    a.send({ type: 'vote', tab: 'poker', value: 5 });
    const state = await a.waitFor((s) => s.tabs.poker.myVote === 5);
    expect(state.tabs.poker.rows.map((r) => r.name)).toEqual(['Ada']);
    expect(JSON.stringify(a.received)).not.toContain('Zed');
  });

  it('still lets the same userId join from a second socket (another tab)', async () => {
    const port = await start();
    await join(port, A, 'Ada');
    const second = await join(port, A, 'Ada');
    expect(second.received.at(-1)!.tabs.poker.rows).toHaveLength(1);
    expect(socketsIn(ROOM)).toBe(2);
  });
});

describe('stored participant cap', () => {
  it('drops the oldest offline participant without a vote to make room', async () => {
    seedParticipants(ROOM, [
      { id: P1, lastSeen: 1000, vote: 5 }, // oldest but holds a vote: kept
      { id: P2, lastSeen: 2000 }, // oldest idle: dropped
      { id: P3, lastSeen: 3000 },
    ]);
    const port = await start({ maxStoredParticipantsPerRoom: 3 });
    const n = await join(port, NEWBIE, 'Newbie');
    expect(n.received.at(-1)!.tabs.poker.rows.some((r) => r.name === 'Newbie')).toBe(true);
    expect(await closeAndRead(ROOM)).toEqual([P1, P3, NEWBIE].sort());
  });

  it('rejects a new user with 4403 when nobody can be dropped, and keeps everyone', async () => {
    seedParticipants(ROOM, [
      { id: P1, lastSeen: 1000, vote: 5 },
      { id: P2, lastSeen: 2000, vote: 8 },
      { id: P3, lastSeen: 3000, vote: 3 },
    ]);
    const port = await start({ maxStoredParticipantsPerRoom: 3 });
    const c = await TestClient.connect(port, ROOM);
    clients.push(c);
    c.send({ type: 'join', userId: NEWBIE, name: 'Newbie' });
    expect(await c.closed).toEqual({ code: 4403, reason: 'room full' });
    expect(await closeAndRead(ROOM)).toEqual([P1, P2, P3].sort());
  });

  it('never drops a participant who is online, even without a vote', async () => {
    seedParticipants(ROOM, [
      { id: P1, lastSeen: 1000 },
      { id: P2, lastSeen: 2000, vote: 8 },
    ]);
    const port = await start({ maxStoredParticipantsPerRoom: 2 });
    await join(port, P1, 'P One'); // returning participant, now online
    const c = await TestClient.connect(port, ROOM);
    clients.push(c);
    c.send({ type: 'join', userId: NEWBIE, name: 'Newbie' });
    expect(await c.closed).toEqual({ code: 4403, reason: 'room full' });
  });

  it('lets an already-stored participant rejoin when the room is at the cap', async () => {
    seedParticipants(ROOM, [
      { id: P1, lastSeen: 1000, vote: 5 },
      { id: P2, lastSeen: 2000, vote: 8 },
    ]);
    const port = await start({ maxStoredParticipantsPerRoom: 2 });
    const back = await join(port, P1, 'P One');
    expect(back.received.at(-1)!.tabs.poker.myVote).toBe(5);
    expect(await closeAndRead(ROOM)).toEqual([P1, P2].sort());
  });
});

describe('join timeout and heartbeat', () => {
  it('closes a socket that never sends join (1008)', async () => {
    const port = await start({ joinTimeoutMs: 50 });
    const idle = await TestClient.connect(port, ROOM);
    clients.push(idle);
    expect(await idle.closed).toEqual({ code: 1008, reason: 'join timeout' });
    await waitUntil(() => socketsIn(ROOM) === 0);
  });

  it('does not time out a socket that joined in time', async () => {
    const port = await start({ joinTimeoutMs: 100 });
    const a = await join(port, A, 'Ada');
    await new Promise((r) => setTimeout(r, 250));
    a.send({ type: 'vote', tab: 'poker', value: 8 });
    await a.waitFor((s) => s.tabs.poker.myVote === 8);
  });

  it('terminates a socket that stops answering pings and updates online for the others', async () => {
    const port = await start({ heartbeatMs: 40 });
    const a = await join(port, A, 'Ada');
    const dead = await join(port, B, 'Bob');
    await a.waitFor((s) => s.tabs.poker.rows.length === 2);
    dead.disablePong();

    await dead.closed;
    const state = await a.waitFor((s) => s.tabs.poker.rows.every((r) => r.name !== 'Bob'));
    expect(state.tabs.poker.rows.map((r) => r.name)).toEqual(['Ada']);
    await waitUntil(() => socketsIn(ROOM) === 1);
  });

  it('keeps sockets that answer pings', async () => {
    const port = await start({ heartbeatMs: 30 });
    const a = await join(port, A, 'Ada');
    await new Promise((r) => setTimeout(r, 200));
    a.send({ type: 'vote', tab: 'poker', value: 3 });
    await a.waitFor((s) => s.tabs.poker.myVote === 3);
    expect(socketsIn(ROOM)).toBe(1);
  });
});

describe('broadcast only on change', () => {
  it('does not broadcast for rejected or no-op messages', async () => {
    const port = await start();
    const a = await join(port, A, 'Ada');
    const b = await join(port, B, 'Bob');
    await a.waitFor((s) => s.tabs.poker.rows.length === 2);
    const beforeB = b.received.length;
    const beforeA = a.received.length;

    a.send({ type: 'vote', tab: 'poker', value: 7 }); // not in the deck
    a.send({ type: 'vote', tab: 'poker', value: 1 }); // not in the deck
    a.send('garbage');
    a.send({ type: 'rename', name: '   ' }); // invalid name
    a.send({ type: 'vote', tab: 'poker', value: 5 }); // the only real change
    await b.waitFor((s) => s.tabs.poker.rows.some((r) => r.name === 'Ada' && r.hasVoted));
    await a.waitFor((s) => s.tabs.poker.myVote === 5);

    expect(b.received.length - beforeB).toBe(1);
    expect(a.received.length - beforeA).toBe(1);
  });

  it('sends the joining socket its view and tells the rest of the room', async () => {
    const port = await start();
    const a = await join(port, A, 'Ada');
    const before = a.received.length;
    const b = await join(port, B, 'Bob');
    expect(b.received.length).toBe(1);
    await a.waitFor((s) => s.tabs.poker.rows.length === 2);
    expect(a.received.length - before).toBe(1);
  });
});

describe('per-IP limits', () => {
  it('closes with 4429 beyond maxSocketsPerIp and frees the slot when a socket closes', async () => {
    const port = await start({ maxSocketsPerIp: 2 });
    const a = await join(port, A, 'Ada');
    await join(port, B, 'Bob');
    expect(await connectExpectClose(port, ROOM_2)).toEqual({ code: 4429, reason: 'too many connections' });

    a.close();
    await waitUntil(() => socketsIn(ROOM) === 1);
    const again = await join(port, 'user-cccc-0003', 'Cy', ROOM_2);
    expect(again.received.at(-1)!.tabs.poker.rows).toHaveLength(1);
  });

  it('does not count refused sockets towards the IP limit', async () => {
    const port = await start({ maxSocketsPerIp: 1 });
    await join(port, A, 'Ada');
    for (let i = 0; i < 3; i++) {
      expect((await connectExpectClose(port, ROOM_2)).code).toBe(4429);
    }
    expect(server!.roomInfo().map((r) => r.id)).toEqual([ROOM]);
  });

  it('limits NEW room creations per IP, but not connects to existing rooms', async () => {
    const port = await start({ maxNewRoomsPerIp: 2 });
    await join(port, A, 'Ada', ROOM);
    await join(port, B, 'Bob', ROOM_2);
    expect(await connectExpectClose(port, ROOM_3)).toEqual({ code: 4429, reason: 'too many new rooms' });
    expect(server!.roomInfo().map((r) => r.id).sort()).toEqual([ROOM, ROOM_2].sort());

    // Existing rooms are still reachable from the same IP.
    const third = await join(port, 'user-cccc-0003', 'Cy', ROOM);
    expect(third.received.at(-1)!.tabs.poker.rows).toHaveLength(2);
  });

  it('expires the new-room counters: pruneNow clears entries older than 10 minutes', async () => {
    const port = await start({ maxNewRoomsPerIp: 1 });
    await join(port, A, 'Ada', ROOM);
    expect((await connectExpectClose(port, ROOM_2)).code).toBe(4429);

    server!.pruneNow(Date.now() + 11 * MINUTE);
    const b = await join(port, B, 'Bob', ROOM_2);
    expect(b.received.at(-1)!.tabs.poker.rows).toHaveLength(1);
  });

  it('ignores X-Forwarded-For unless trustProxy is set', async () => {
    const port = await start({ maxSocketsPerIp: 1 });
    const first = await TestClient.connect(port, ROOM, { 'x-forwarded-for': '203.0.113.1' });
    clients.push(first);
    const second = await TestClient.connect(port, ROOM, { 'x-forwarded-for': '203.0.113.2' });
    clients.push(second);
    expect(await second.closed).toEqual({ code: 4429, reason: 'too many connections' });
  });

  it('uses the first X-Forwarded-For entry as the client IP when trustProxy is set', async () => {
    const port = await start({ maxSocketsPerIp: 1, trustProxy: true });
    const one = await TestClient.connect(port, ROOM, { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' });
    clients.push(one);
    const other = await TestClient.connect(port, ROOM, { 'x-forwarded-for': '203.0.113.2, 10.0.0.1' });
    clients.push(other);
    other.send({ type: 'join', userId: B, name: 'Bob' });
    await other.waitFor((s) => s.you === B);

    const sameAsOne = await TestClient.connect(port, ROOM, { 'x-forwarded-for': '203.0.113.1, 10.9.9.9' });
    clients.push(sameAsOne);
    expect(await sameAsOne.closed).toEqual({ code: 4429, reason: 'too many connections' });
  });

  it('falls back to the socket address when trustProxy is set but the header is missing', async () => {
    const port = await start({ maxSocketsPerIp: 1, trustProxy: true });
    const first = await TestClient.connect(port, ROOM);
    clients.push(first);
    expect(await connectExpectClose(port, ROOM)).toEqual({ code: 4429, reason: 'too many connections' });
  });
});

describe('static 404s', () => {
  it('returns 404 for missing assets and any missing file with an extension', async () => {
    const staticDir = path.join(dir, 'dist');
    fs.mkdirSync(path.join(staticDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(staticDir, 'index.html'), '<html>spa-marker</html>');
    fs.writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'console.log(1)');
    const port = await start({ staticDir });
    const url = (p: string) => `http://127.0.0.1:${port}${p}`;

    for (const missing of ['/assets/missing.js', '/assets/no-extension', '/favicon.ico', '/r/abc.js']) {
      const res = await fetch(url(missing));
      expect(res.status, missing).toBe(404);
      expect(await res.text()).not.toContain('spa-marker');
    }
    expect((await fetch(url('/assets/app.js'))).status).toBe(200);
    for (const route of ['/', `/r/${ROOM}`, '/anything/else']) {
      const res = await fetch(url(route));
      expect(res.status, route).toBe(200);
      expect(await res.text()).toContain('spa-marker');
    }
  });
});
