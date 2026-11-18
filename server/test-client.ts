import { WebSocket } from 'ws';
import type { StateMessage } from '../shared/types';

export interface CloseInfo {
  code: number;
  reason: string;
}

/** Minimal WebSocket client for integration tests. */
export class TestClient {
  private states: StateMessage[] = [];
  private listeners: Array<() => void> = [];
  /** Resolves when the socket closes (by either side). */
  readonly closed: Promise<CloseInfo>;

  private constructor(private ws: WebSocket) {
    ws.on('message', (data) => {
      this.states.push(JSON.parse(data.toString()) as StateMessage);
      this.listeners.slice().forEach((listener) => listener());
    });
    this.closed = new Promise((resolve) => {
      ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
  }

  /** Opens `/ws?room=<roomId>`. Pass `null` to omit the room parameter entirely. */
  static async connect(
    port: number,
    roomId: string | null,
    headers: Record<string, string> = {},
  ): Promise<TestClient> {
    const query = roomId === null ? '' : `?room=${encodeURIComponent(roomId)}`;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`, { headers });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return new TestClient(ws);
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Every state message received so far, oldest first. */
  get received(): readonly StateMessage[] {
    return this.states;
  }

  /** Resolves when the most recent state satisfies `pred`. */
  waitFor(pred: (s: StateMessage) => boolean, timeoutMs = 2000): Promise<StateMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('timed out waiting for state'));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners = this.listeners.filter((l) => l !== check);
      };
      const check = () => {
        const last = this.states[this.states.length - 1];
        if (last && pred(last)) {
          cleanup();
          resolve(last);
        }
      };
      this.listeners.push(check);
      check();
    });
  }

  /** Stops answering the server's pings (simulates a dead peer that never closes). */
  disablePong(): void {
    this.ws.pong = () => {};
  }

  close(): void {
    this.ws.close();
  }
}
