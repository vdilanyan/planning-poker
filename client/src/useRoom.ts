import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, StateMessage } from '@shared/types';
import type { User } from './identity';

/** Why the server refused the connection. These are final: we do not retry. */
export type RoomError = 'invalid' | 'full' | 'server-full';

export interface RoomConnection {
  state: StateMessage | null;
  connected: boolean;
  error: RoomError | null;
  send: (message: ClientMessage) => void;
}

const OPEN = 1; // WebSocket.OPEN

const CLOSE_ERRORS: Record<number, RoomError> = {
  4400: 'invalid',
  4403: 'full',
  4429: 'server-full',
};

function wsUrl(roomId: string): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws?room=${encodeURIComponent(roomId)}`;
}

export function useRoom(user: User | null, roomId: string): RoomConnection {
  const [state, setState] = useState<StateMessage | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<RoomError | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  });
  const userId = user?.userId ?? null;

  useEffect(() => {
    if (!userId) return;
    let disposed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const socket = new WebSocket(wsUrl(roomId));
      socketRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
        const name = userRef.current?.name ?? '';
        socket.send(JSON.stringify({ type: 'join', userId, name }));
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message?.type === 'state') setState(message as StateMessage);
        } catch {
          // ignore malformed messages
        }
      };
      socket.onclose = (event) => {
        setConnected(false);
        if (socketRef.current === socket) socketRef.current = null;
        if (disposed) return;
        const refused = CLOSE_ERRORS[event.code];
        if (refused) {
          setError(refused);
          return;
        }
        // Exponential backoff capped at 10s, with jitter so a restarted server is not hit by
        // every client at the same instant.
        const base = Math.min(1000 * 2 ** attempt, 10_000);
        const delay = base * (0.5 + Math.random() * 0.5);
        attempt += 1;
        timer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(timer);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
      setConnected(false);
      setState(null);
      setError(null);
    };
  }, [userId, roomId]);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === OPEN) socket.send(JSON.stringify(message));
  }, []);

  return { state, connected, error, send };
}
