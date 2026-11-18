// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StateMessage, TabView } from '@shared/types';
import { App } from './App';
import { STORAGE_KEY } from './identity';
import { FakeWebSocket } from './test/fake-websocket';
import { THEME_KEY } from './theme';

const ME = 'user-aaaa-0001';
const ROOM = 'abcdefghjk';

const emptyTab = (): TabView => ({
  revealed: false,
  rows: [{ id: 'row-0001', name: 'Ada', hasVoted: false, online: true }],
});

function stateMessage(overrides: Partial<StateMessage['tabs']> = {}): StateMessage {
  return { type: 'state', you: ME, tabs: { poker: emptyTab(), confidence: emptyTab(), ...overrides } };
}

function sentMessages(socket: FakeWebSocket): Array<Record<string, unknown>> {
  return socket.sent.map((s) => JSON.parse(s));
}

function storeUser() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId: ME, name: 'Ada' }));
}

beforeEach(() => {
  window.history.pushState({}, '', `/r/${ROOM}`);
  localStorage.clear();
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  window.history.pushState({}, '', '/');
});

describe('theme toggle', () => {
  function openRoom() {
    storeUser();
    render(<App />);
    act(() => {
      FakeWebSocket.instances[0].open();
      FakeWebSocket.instances[0].receive(stateMessage());
    });
  }

  it('starts in GUI mode and switches the whole page to TUI and back', () => {
    openRoom();
    expect(document.documentElement.dataset.theme).toBe('gui');

    fireEvent.click(screen.getByRole('button', { name: 'TUI mode' }));
    expect(document.documentElement.dataset.theme).toBe('tui');
    expect(screen.queryByRole('button', { name: 'TUI mode' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'GUI mode' }));
    expect(document.documentElement.dataset.theme).toBe('gui');
    expect(screen.getByRole('button', { name: 'TUI mode' })).toBeTruthy();
  });

  it('remembers TUI mode in the browser across reloads', () => {
    openRoom();
    fireEvent.click(screen.getByRole('button', { name: 'TUI mode' }));
    expect(localStorage.getItem(THEME_KEY)).toBe('tui');

    cleanup();
    delete document.documentElement.dataset.theme;
    FakeWebSocket.reset();
    openRoom();
    expect(document.documentElement.dataset.theme).toBe('tui');
    expect(screen.getByRole('button', { name: 'GUI mode' })).toBeTruthy();
  });

  it('does not disturb the voting deck while in TUI mode', () => {
    openRoom();
    fireEvent.click(screen.getByRole('button', { name: 'TUI mode' }));
    fireEvent.click(screen.getByRole('button', { name: '8' }));
    expect(sentMessages(FakeWebSocket.instances[0])).toContainEqual({
      type: 'vote',
      tab: 'poker',
      value: 8,
    });
  });
});

describe('App', () => {
  it('asks for a name on first visit, stores it, and joins', () => {
    render(<App />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(FakeWebSocket.instances).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.name).toBe('Ada');
    expect(stored.userId).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(screen.queryByRole('dialog')).toBeNull();

    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => FakeWebSocket.instances[0].open());
    expect(sentMessages(FakeWebSocket.instances[0])[0]).toEqual({
      type: 'join',
      userId: stored.userId,
      name: 'Ada',
    });
  });

  it('does not ask again for a returning user and joins with the stored identity', () => {
    storeUser();
    render(<App />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => FakeWebSocket.instances[0].open());
    expect(sentMessages(FakeWebSocket.instances[0])[0]).toEqual({
      type: 'join',
      userId: ME,
      name: 'Ada',
    });
  });

  it('shows only the agreed poker cards', () => {
    storeUser();
    render(<App />);
    const socket = FakeWebSocket.instances[0];
    act(() => {
      socket.open();
      socket.receive(stateMessage());
    });
    const cards = screen
      .getAllByRole('button', { pressed: false })
      .map((b) => b.textContent);
    expect(cards).toEqual(['2', '3', '5', '8', '13']);
  });

  it('sends a vote on click and clears it when the selected card is clicked again', () => {
    storeUser();
    render(<App />);
    const socket = FakeWebSocket.instances[0];
    act(() => {
      socket.open();
      socket.receive(stateMessage());
    });

    fireEvent.click(screen.getByRole('button', { name: '8' }));
    expect(sentMessages(socket)).toContainEqual({ type: 'vote', tab: 'poker', value: 8 });

    act(() => {
      socket.receive(stateMessage({ poker: { ...emptyTab(), myVote: 8 } }));
    });
    fireEvent.click(screen.getByRole('button', { name: '8' }));
    expect(sentMessages(socket)).toContainEqual({ type: 'vote', tab: 'poker', value: null });
  });

  it('shows the confidence deck and the 9.2 average after reveal', () => {
    storeUser();
    render(<App />);
    const socket = FakeWebSocket.instances[0];
    const confidence: TabView = {
      revealed: true,
      rows: [8, 9, 9, 10, 10].map((value, i) => ({
        id: `row-000${i}`,
        name: `Person ${i}`,
        hasVoted: true,
        online: true,
        value,
      })),
      stats: { count: 5, average: 9.2, min: 8, max: 10 },
    };
    act(() => {
      socket.open();
      socket.receive(stateMessage({ confidence }));
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Confidence' }));
    expect(screen.getByTestId('average').textContent).toBe('9.2');
    expect(screen.getByText('Person 0')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide' })).toBeTruthy();
    const deck = screen.getAllByRole('button', { pressed: false }).map((b) => b.textContent);
    expect(deck).toEqual(['3', '4', '5', '6', '7', '8', '9', '10']);
  });

  it('shows no average on the revealed poker tab', () => {
    storeUser();
    render(<App />);
    const socket = FakeWebSocket.instances[0];
    const poker: TabView = {
      revealed: true,
      rows: [5, 8].map((value, i) => ({
        id: `row-000${i}`,
        name: `Person ${i}`,
        hasVoted: true,
        online: true,
        value,
      })),
    };
    act(() => {
      socket.open();
      socket.receive(stateMessage({ poker }));
    });

    expect(screen.getByText('Person 0')).toBeTruthy();
    expect(screen.queryByTestId('average')).toBeNull();
    expect(screen.queryByText('Average')).toBeNull();
  });

  it('reveal and delete buttons send the matching messages for the active tab', () => {
    storeUser();
    render(<App />);
    const socket = FakeWebSocket.instances[0];
    act(() => {
      socket.open();
      socket.receive(stateMessage());
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Confidence' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Estimates' }));
    expect(sentMessages(socket)).toContainEqual({ type: 'reveal', tab: 'confidence' });
    expect(sentMessages(socket)).toContainEqual({ type: 'reset', tab: 'confidence' });
  });

  it('lets the user change their name', () => {
    storeUser();
    render(<App />);
    const socket = FakeWebSocket.instances[0];
    act(() => {
      socket.open();
      socket.receive(stateMessage());
    });

    fireEvent.click(screen.getByRole('button', { name: 'Not you? Change name' }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Grace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(sentMessages(socket)).toContainEqual({ type: 'rename', name: 'Grace' });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ userId: ME, name: 'Grace' });
  });

  it('counts votes against the rows the server sent', () => {
    storeUser();
    render(<App />);
    const socket = FakeWebSocket.instances[0];
    const poker: TabView = {
      revealed: false,
      rows: [
        { id: 'row-0001', name: 'Ada', hasVoted: true, online: true },
        { id: 'row-0002', name: 'Bob', hasVoted: false, online: true },
      ],
    };
    act(() => {
      socket.open();
      socket.receive(stateMessage({ poker }));
    });
    expect(screen.getByText('1 of 2 voted')).toBeTruthy();
  });

  it('picks up a rename made in another browser tab and rejoins with it', () => {
    vi.useFakeTimers();
    try {
      storeUser();
      render(<App />);
      const first = FakeWebSocket.instances[0];
      act(() => {
        first.open();
        first.receive(stateMessage());
      });
      const header = within(screen.getByRole('banner'));
      expect(header.getByText('Ada')).toBeTruthy();

      // Another tab renames: it writes localStorage, and this tab gets a storage event.
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId: ME, name: 'Grace' }));
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
      });
      expect(header.getByText('Grace')).toBeTruthy();
      expect(header.queryByText('Ada')).toBeNull();

      // The connection drops; the reconnect must carry the new name, not the old one.
      act(() => {
        first.close();
        vi.advanceTimersByTime(1000);
      });
      const second = FakeWebSocket.instances[1];
      act(() => second.open());
      expect(sentMessages(second)[0]).toEqual({ type: 'join', userId: ME, name: 'Grace' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores unrelated storage events and cleared storage', () => {
    storeUser();
    render(<App />);
    act(() => FakeWebSocket.instances[0].open());
    const header = within(screen.getByRole('banner'));

    localStorage.setItem('other', 'x');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
    });
    expect(header.getByText('Ada')).toBeTruthy();

    localStorage.removeItem(STORAGE_KEY);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    });
    expect(header.getByText('Ada')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables the vote cards, reveal and delete while disconnected, enables them when connected', () => {
    storeUser();
    render(<App />);
    const socket = FakeWebSocket.instances[0];
    act(() => {
      socket.open();
      socket.receive(stateMessage());
    });
    const controls = () => [
      screen.getByRole('button', { name: '8' }),
      screen.getByRole('button', { name: 'Reveal' }),
      screen.getByRole('button', { name: 'Delete Estimates' }),
    ];
    controls().forEach((el) => expect((el as HTMLButtonElement).disabled).toBe(false));

    // Drop the connection; the retry timer is pending so no new socket opens yet.
    act(() => socket.close());
    controls().forEach((el) => expect((el as HTMLButtonElement).disabled).toBe(true));
  });
});
