/** Minimal stand-in for the browser WebSocket, used with vi.stubGlobal. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  send(data: string): void {
    this.sent.push(data);
  }

  /** Closes the socket. Tests use the code to simulate the server closing (default: abnormal 1006). */
  close(code = 1006, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  /** Test helper: simulate the connection opening. */
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  /** Test helper: simulate a server message. */
  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}
