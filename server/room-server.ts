import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { parseClientMessage } from '../shared/protocol';
import {
  applyMessage,
  buildView,
  createRoom,
  pruneParticipants,
  touchParticipant,
} from '../shared/room';
import {
  MAX_PARTICIPANTS_PER_ROOM,
  MAX_PARTICIPANTS_STORED_PER_ROOM,
  isValidRoomId,
} from '../shared/room-id';
import { TABS, type RoomState } from '../shared/types';
import { createSaver, loadRooms } from './persistence';

export interface RoomServerOptions {
  dataFile: string;
  /** Directory with the built client (index.html). Omit in tests. */
  staticDir?: string;
  saveDelayMs?: number;
  /** Rooms held at once. Default 500. */
  maxRooms?: number;
  /** Connected sockets per room. Default 50. */
  maxParticipantsPerRoom?: number;
  /** People remembered per room, connected or not. Default 200. */
  maxStoredParticipantsPerRoom?: number;
  /** An empty room is deleted once idle for this long. Default 7 days. */
  roomTtlMs?: number;
  /** A socket sending more messages than this within one second is closed (1008). Default 30. */
  maxMessagesPerSecond?: number;
  /** A socket that has not sent a valid `join` within this time is closed (1008). Default 10 s. */
  joinTimeoutMs?: number;
  /** Ping interval; a socket that missed the previous ping is terminated. Default 30 s. */
  heartbeatMs?: number;
  /** Concurrent sockets per client IP. Default 30. */
  maxSocketsPerIp?: number;
  /** New rooms one client IP may create per 10 minutes. Default 20. */
  maxNewRoomsPerIp?: number;
  /**
   * Take the client IP from the first `X-Forwarded-For` entry. Only enable behind a reverse proxy
   * that sets the header; when directly exposed, clients could spoof it to dodge the IP limits.
   */
  trustProxy?: boolean;
}

export interface RoomInfo {
  id: string;
  /** Connected sockets, joined or not. */
  sockets: number;
  lastActivity: number;
}

export interface RoomServer {
  /** Resolves with the bound port (pass 0 for a free port). */
  listen(port: number): Promise<number>;
  close(): Promise<void>;
  /** Deletes expired empty rooms, stale participants and expired IP counters now. Also hourly. */
  pruneNow(now?: number): void;
  /** Current rooms, for tests and diagnostics. */
  roomInfo(): RoomInfo[];
}

export const CLOSE_POLICY = 1008;
export const CLOSE_INVALID_ROOM = 4400;
export const CLOSE_ROOM_FULL = 4403;
export const CLOSE_SERVER_FULL = 4429;

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const MAX_MESSAGE_BYTES = 4096;
const DAY_MS = 24 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 1000;
/** A room used within this window is never evicted to make space for a new one. */
const EVICTION_GRACE_MS = 60 * 60 * 1000;
/** Window for counting new rooms per IP. */
const NEW_ROOM_WINDOW_MS = 10 * 60 * 1000;

interface Room {
  state: RoomState;
  /** socket -> userId; null until the socket sends `join`. */
  sockets: Map<WebSocket, string | null>;
  lastActivity: number;
}

export function createRoomServer(opts: RoomServerOptions): RoomServer {
  const maxRooms = opts.maxRooms ?? 500;
  const maxParticipants = opts.maxParticipantsPerRoom ?? MAX_PARTICIPANTS_PER_ROOM;
  const maxStored = opts.maxStoredParticipantsPerRoom ?? MAX_PARTICIPANTS_STORED_PER_ROOM;
  const roomTtlMs = opts.roomTtlMs ?? 7 * DAY_MS;
  const maxMessagesPerSecond = opts.maxMessagesPerSecond ?? 30;
  const joinTimeoutMs = opts.joinTimeoutMs ?? 10_000;
  const heartbeatMs = opts.heartbeatMs ?? 30_000;
  const maxSocketsPerIp = opts.maxSocketsPerIp ?? 30;
  const maxNewRoomsPerIp = opts.maxNewRoomsPerIp ?? 20;
  const trustProxy = opts.trustProxy ?? false;

  const rooms = new Map<string, Room>();
  for (const [roomId, stored] of loadRooms(opts.dataFile, { maxRooms })) {
    rooms.set(roomId, { state: stored.state, lastActivity: stored.lastActivity, sockets: new Map() });
  }
  const saver = createSaver(opts.dataFile, () => rooms, opts.saveDelayMs ?? 300);

  const socketsPerIp = new Map<string, number>();
  const newRoomsPerIp = new Map<string, number[]>(); // ip -> creation timestamps
  const joinTimers = new Set<NodeJS.Timeout>();
  const awaitingPong = new WeakSet<WebSocket>();

  const app = express();
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });
  if (opts.staticDir) {
    const staticDir = opts.staticDir;
    app.use(express.static(staticDir));
    app.get('*', (req, res) => {
      // A missing asset must be a 404, not the SPA shell (which would be parsed as JS/CSS).
      if (req.path.startsWith('/assets/') || path.extname(req.path) !== '') {
        res.status(404).type('text/plain').send('Not found');
        return;
      }
      // Client-side routes such as /r/<code> are served by the SPA.
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });
  // ws re-emits http server errors (e.g. EADDRINUSE) on wss; without a listener they throw.
  // listen() reports bind errors through its promise, so this one is a deliberate no-op.
  wss.on('error', () => {});
  let closing = false;

  const onlineIds = (room: Room): Set<string> => {
    const ids = new Set<string>();
    for (const userId of room.sockets.values()) if (userId) ids.add(userId);
    return ids;
  };

  function broadcast(room: Room): void {
    const online = onlineIds(room);
    for (const [socket, userId] of room.sockets) {
      if (userId && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(buildView(room.state, userId, online)));
      }
    }
  }

  function clientIp(req: http.IncomingMessage): string {
    if (trustProxy) {
      const header = req.headers['x-forwarded-for'];
      const first = (Array.isArray(header) ? header[0] : header)?.split(',')[0].trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  /** Removes the oldest empty room that has been idle for over an hour. False if none qualifies. */
  function evictIdleRoom(now: number): boolean {
    let oldest: [string, Room] | undefined;
    for (const entry of rooms) {
      const [, room] = entry;
      if (room.sockets.size > 0 || now - room.lastActivity < EVICTION_GRACE_MS) continue;
      if (!oldest || room.lastActivity < oldest[1].lastActivity) oldest = entry;
    }
    if (!oldest) return false;
    rooms.delete(oldest[0]);
    return true;
  }

  /** Forgets the longest-gone participant who is offline and holds no vote. False if none. */
  function dropOldestIdleParticipant(room: Room): boolean {
    const online = onlineIds(room);
    let oldest: { id: string; lastSeen: number } | undefined;
    for (const p of Object.values(room.state.participants)) {
      if (online.has(p.id)) continue;
      if (TABS.some((tab) => Object.hasOwn(room.state.votes[tab], p.id))) continue;
      if (!oldest || p.lastSeen < oldest.lastSeen) oldest = p;
    }
    if (!oldest) return false;
    delete room.state.participants[oldest.id];
    return true;
  }

  function closeWith(socket: WebSocket, code: number, reason: string): void {
    socket.on('error', () => {});
    socket.close(code, reason);
  }

  wss.on('connection', (socket, req) => {
    if (closing) {
      socket.terminate();
      return;
    }
    const now = Date.now();
    const roomId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('room');
    if (!isValidRoomId(roomId)) return closeWith(socket, CLOSE_INVALID_ROOM, 'invalid room');

    const ip = clientIp(req);
    if ((socketsPerIp.get(ip) ?? 0) >= maxSocketsPerIp) {
      return closeWith(socket, CLOSE_SERVER_FULL, 'too many connections');
    }

    let room = rooms.get(roomId);
    if (room && room.sockets.size >= maxParticipants) {
      return closeWith(socket, CLOSE_ROOM_FULL, 'room full');
    }
    if (!room) {
      const recent = (newRoomsPerIp.get(ip) ?? []).filter((t) => now - t < NEW_ROOM_WINDOW_MS);
      if (recent.length >= maxNewRoomsPerIp) {
        newRoomsPerIp.set(ip, recent);
        return closeWith(socket, CLOSE_SERVER_FULL, 'too many new rooms');
      }
      if (rooms.size >= maxRooms && !evictIdleRoom(now)) {
        return closeWith(socket, CLOSE_SERVER_FULL, 'server full');
      }
      // Rooms are created lazily so a shared link keeps working after the server lost its state.
      room = { state: createRoom(), sockets: new Map(), lastActivity: now };
      rooms.set(roomId, room);
      recent.push(now);
      newRoomsPerIp.set(ip, recent);
    }
    const current = room;
    current.sockets.set(socket, null);
    current.lastActivity = now;
    socketsPerIp.set(ip, (socketsPerIp.get(ip) ?? 0) + 1);
    awaitingPong.delete(socket);
    saver.schedule();

    let userId: string | null = null;
    let refused = false; // we started closing this socket: ignore anything it still sends
    let windowStart = now;
    let windowCount = 0;

    const refuse = (code: number, reason: string) => {
      refused = true;
      closeWith(socket, code, reason);
    };

    const joinTimer = setTimeout(() => {
      joinTimers.delete(joinTimer);
      if (userId === null) refuse(CLOSE_POLICY, 'join timeout');
    }, joinTimeoutMs);
    joinTimers.add(joinTimer);

    socket.on('error', () => {});
    socket.on('pong', () => awaitingPong.delete(socket));

    socket.on('message', (data) => {
      if (closing || refused) return;
      const at = Date.now();
      if (at - windowStart >= RATE_WINDOW_MS) {
        windowStart = at;
        windowCount = 0;
      }
      windowCount += 1;
      if (windowCount > maxMessagesPerSecond) {
        refuse(CLOSE_POLICY, 'rate limit');
        return;
      }

      const msg = parseClientMessage(data.toString());
      if (!msg) return;

      if (msg.type === 'join') {
        // Exactly one accepted join per socket: otherwise one socket could mint unlimited users.
        if (userId !== null) {
          if (msg.userId !== userId) refuse(CLOSE_POLICY, 'already joined');
          return;
        }
        const known = Object.hasOwn(current.state.participants, msg.userId);
        if (
          !known &&
          Object.keys(current.state.participants).length >= maxStored &&
          !dropOldestIdleParticipant(current)
        ) {
          refuse(CLOSE_ROOM_FULL, 'room full');
          return;
        }
        if (!applyMessage(current.state, msg.userId, msg, at)) return;
        userId = msg.userId;
        clearTimeout(joinTimer);
        joinTimers.delete(joinTimer);
        current.sockets.set(socket, userId);
        current.lastActivity = at;
        saver.schedule();
        broadcast(current); // the joiner gets its view; everyone else sees the online set change
        return;
      }

      if (!userId) return;
      current.lastActivity = at;
      if (applyMessage(current.state, userId, msg, at)) {
        saver.schedule();
        broadcast(current);
      }
    });

    socket.on('close', () => {
      clearTimeout(joinTimer);
      joinTimers.delete(joinTimer);
      const remaining = (socketsPerIp.get(ip) ?? 1) - 1;
      if (remaining > 0) socketsPerIp.set(ip, remaining);
      else socketsPerIp.delete(ip);

      if (closing) {
        current.sockets.delete(socket);
        return;
      }
      const at = Date.now();
      if (userId) touchParticipant(current.state, userId, at);
      current.lastActivity = at;
      saver.schedule();
      if (current.sockets.delete(socket)) broadcast(current);
    });
  });

  function pruneNow(now: number = Date.now()): void {
    if (closing) return;
    let changed = false;
    for (const [roomId, room] of rooms) {
      if (room.sockets.size === 0 && now - room.lastActivity > roomTtlMs) {
        rooms.delete(roomId);
        changed = true;
      } else if (pruneParticipants(room.state, onlineIds(room), now)) {
        changed = true;
        broadcast(room);
      }
    }
    for (const [ip, times] of newRoomsPerIp) {
      const recent = times.filter((t) => now - t < NEW_ROOM_WINDOW_MS);
      if (recent.length === 0) newRoomsPerIp.delete(ip);
      else if (recent.length !== times.length) newRoomsPerIp.set(ip, recent);
    }
    if (changed) saver.schedule();
  }

  const pruneTimer = setInterval(() => pruneNow(), PRUNE_INTERVAL_MS);
  pruneTimer.unref();

  // Dead peers (laptop lid closed, network dropped) never send a close frame. Ping everyone; a
  // socket that did not answer the previous ping is terminated, which runs the normal close path.
  const heartbeatTimer = setInterval(() => {
    for (const room of rooms.values()) {
      for (const socket of room.sockets.keys()) {
        if (awaitingPong.has(socket)) {
          socket.terminate();
          continue;
        }
        awaitingPong.add(socket);
        socket.ping();
      }
    }
  }, heartbeatMs);
  heartbeatTimer.unref();

  return {
    listen(port) {
      return new Promise((resolve, reject) => {
        const onError = (err: Error) => reject(err);
        server.once('error', onError);
        server.listen(port, () => {
          server.off('error', onError);
          resolve((server.address() as AddressInfo).port);
        });
      });
    },
    pruneNow,
    roomInfo() {
      return Array.from(rooms, ([id, room]) => ({
        id,
        sockets: room.sockets.size,
        lastActivity: room.lastActivity,
      }));
    },
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(pruneTimer);
      clearInterval(heartbeatTimer);
      for (const timer of joinTimers) clearTimeout(timer);
      joinTimers.clear();
      const now = Date.now();
      for (const room of rooms.values()) {
        if (room.sockets.size > 0) room.lastActivity = now;
        for (const userId of onlineIds(room)) touchParticipant(room.state, userId, now);
      }
      saver.flush();
      for (const client of wss.clients) client.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
