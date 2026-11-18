// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from './identity';
import { FakeWebSocket } from './test/fake-websocket';
import { useRoom } from './useRoom';

const ROOM = 'abcdefghjk';
const ADA: User = { userId: 'user-aaaa-0001', name: 'Ada' };
const STATE = {
  type: 'state',
  you: 'user-aaaa-0001',
  tabs: {
    poker: { revealed: false, rows: [] },
    confidence: { revealed: false, rows: [] },
  },
};
const JOIN_ADA = JSON.stringify({ type: 'join', userId: ADA.userId, name: 'Ada' });
const REVEAL = JSON.stringify({ type: 'reveal', tab: 'poker' });

function renderRoom(user: User | null = ADA, roomId: string = ROOM) {
  return renderHook(
    ({ user, roomId }: { user: User | null; roomId: string }) => useRoom(user, roomId),
    { initialProps: { user, roomId } },
  );
}

function socket(index: number): FakeWebSocket {
  return FakeWebSocket.instances[index];
}

const count = () => FakeWebSocket.instances.length;

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useRoom', () => {
  it("connects to /ws?room=<code> and sends join with the user's name once open", () => {
    const { result } = renderRoom();
    const ws = socket(0);

    expect(count()).toBe(1);
    expect(ws.url).toBe(`ws://${location.host}/ws?room=${ROOM}`);
    expect(ws.sent).toEqual([]);

    act(() => ws.open());

    expect(ws.sent).toEqual([JOIN_ADA]);
    expect(result.current.connected).toBe(true);
  });

  it('exposes the latest server state', () => {
    const { result } = renderRoom();

    act(() => socket(0).receive(STATE));

    expect(result.current.state).toEqual(STATE);
  });

  it('send() drops messages while not open and sends once open', () => {
    const { result } = renderRoom();
    const ws = socket(0);

    act(() => result.current.send({ type: 'reveal', tab: 'poker' }));
    expect(ws.sent).toEqual([]);

    act(() => ws.open());
    act(() => result.current.send({ type: 'reveal', tab: 'poker' }));

    expect(ws.sent).toEqual([JOIN_ADA, REVEAL]);
  });

  it('reconnects with exponential backoff capped at 10s', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1); // no jitter: the full delay
    renderRoom();

    // Drop before ever opening: 1s, then 2s, 4s, 8s.
    act(() => socket(0).close());
    advance(999);
    expect(count()).toBe(1);
    advance(1);
    expect(count()).toBe(2);

    act(() => socket(1).close());
    advance(1999);
    expect(count()).toBe(2);
    advance(1);
    expect(count()).toBe(3);

    act(() => socket(2).close());
    advance(3999);
    expect(count()).toBe(3);
    advance(1);
    expect(count()).toBe(4);

    act(() => socket(3).close());
    advance(7999);
    expect(count()).toBe(4);
    advance(1);
    expect(count()).toBe(5);

    // Would be 16s, but the delay is capped at 10s.
    act(() => socket(4).close());
    advance(9999);
    expect(count()).toBe(5);
    advance(1);
    expect(count()).toBe(6);

    // The cap holds for further retries as well.
    act(() => socket(5).close());
    advance(10_000);
    expect(count()).toBe(7);

    // A successful open resets the backoff to 1s.
    act(() => socket(6).open());
    act(() => socket(6).close());
    advance(999);
    expect(count()).toBe(7);
    advance(1);
    expect(count()).toBe(8);
  });

  it('adds random jitter: the delay is between half and the full backoff', () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    renderRoom();

    // random = 0 -> half the delay (1s -> 500ms).
    act(() => socket(0).close());
    advance(499);
    expect(count()).toBe(1);
    advance(1);
    expect(count()).toBe(2);

    // random = 0.5 -> three quarters of 2s = 1500ms.
    random.mockReturnValue(0.5);
    act(() => socket(1).close());
    advance(1499);
    expect(count()).toBe(2);
    advance(1);
    expect(count()).toBe(3);

    // The 10s cap still bounds the jittered delay (never longer than 10s).
    random.mockReturnValue(0.999);
    for (let i = 0; i < 6; i++) {
      const before = count();
      act(() => socket(before - 1).close());
      advance(10_000);
      expect(count()).toBe(before + 1);
    }
  });

  it('does not reconnect after unmount', () => {
    vi.useFakeTimers();
    const { unmount } = renderRoom();

    unmount();
    advance(60_000);

    expect(count()).toBe(1);
    expect(socket(0).readyState).toBe(3);
  });

  it('resets state and connected when the user becomes null', () => {
    const { result, rerender } = renderRoom();
    const ws = socket(0);
    act(() => ws.open());
    act(() => ws.receive(STATE));
    expect(result.current.connected).toBe(true);
    expect(result.current.state).toEqual(STATE);

    rerender({ user: null, roomId: ROOM });

    expect(result.current.state).toBeNull();
    expect(result.current.connected).toBe(false);
    expect(ws.readyState).toBe(3);
  });

  it('does not fire stale handlers on a discarded socket', () => {
    const { result, rerender } = renderRoom();
    const ws = socket(0);

    rerender({ user: null, roomId: ROOM });
    act(() => ws.open());
    act(() => ws.receive(STATE));

    expect(ws.sent).toEqual([]);
    expect(result.current.connected).toBe(false);
    expect(result.current.state).toBeNull();
  });

  it('does not fire stale handlers after unmount', () => {
    const { unmount } = renderRoom();
    const ws = socket(0);

    unmount();
    act(() => ws.open());

    expect(ws.sent).toEqual([]);
  });

  it('joins with the latest name after a rename without reconnecting', () => {
    vi.useFakeTimers();
    const { rerender } = renderRoom();
    act(() => socket(0).open());

    rerender({ user: { ...ADA, name: 'Grace' }, roomId: ROOM });
    expect(count()).toBe(1);

    act(() => socket(0).close());
    advance(1000);
    expect(count()).toBe(2);

    act(() => socket(1).open());
    expect(socket(1).sent).toEqual([
      JSON.stringify({ type: 'join', userId: ADA.userId, name: 'Grace' }),
    ]);
  });
  it('puts the room code in the query string', () => {
    renderRoom(ADA, 'mnpqrstuvw');
    expect(socket(0).url.endsWith('/ws?room=mnpqrstuvw')).toBe(true);
  });

  it('resets state and reconnects to the new room when the room changes', () => {
    const { result, rerender } = renderRoom();
    const first = socket(0);
    act(() => first.open());
    act(() => first.receive(STATE));
    expect(result.current.state).toEqual(STATE);

    rerender({ user: ADA, roomId: 'mnpqrstuvw' });

    expect(first.readyState).toBe(3);
    expect(result.current.state).toBeNull();
    expect(result.current.connected).toBe(false);
    expect(count()).toBe(2);
    expect(socket(1).url.endsWith('/ws?room=mnpqrstuvw')).toBe(true);
    act(() => socket(1).open());
    expect(socket(1).sent).toEqual([JOIN_ADA]);
  });

  it('has no error by default', () => {
    const { result } = renderRoom();
    expect(result.current.error).toBeNull();
    act(() => socket(0).close());
    expect(result.current.error).toBeNull();
  });

  it.each([
    [4400, 'invalid'],
    [4403, 'full'],
    [4429, 'server-full'],
  ] as const)('close code %i sets error "%s" and does not reconnect', (code, error) => {
    vi.useFakeTimers();
    const { result } = renderRoom();
    act(() => socket(0).open());
    act(() => socket(0).close(code));

    expect(result.current.error).toBe(error);
    expect(result.current.connected).toBe(false);
    advance(60_000);
    expect(count()).toBe(1);
  });

  it('clears the error when the room changes', () => {
    const { result, rerender } = renderRoom();
    act(() => socket(0).close(4403));
    expect(result.current.error).toBe('full');

    rerender({ user: ADA, roomId: 'mnpqrstuvw' });
    expect(result.current.error).toBeNull();
    expect(count()).toBe(2);
  });

  it('still reconnects after other close codes', () => {
    vi.useFakeTimers();
    const { result } = renderRoom();
    act(() => socket(0).close(1001));
    advance(1000);
    expect(count()).toBe(2);
    expect(result.current.error).toBeNull();
  });
});
