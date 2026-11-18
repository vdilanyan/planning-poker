// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StateMessage } from '@shared/types';
import { App } from './App';
import { STORAGE_KEY } from './identity';
import { FakeWebSocket } from './test/fake-websocket';
import { THEME_KEY } from './theme';

const ME = 'user-aaaa-0001';
const ROOM = 'abcdefghjk';
const OTHER = 'mnpqrstuvw';

const STATE: StateMessage = {
  type: 'state',
  you: ME,
  tabs: {
    poker: { revealed: false, rows: [{ id: 'row-1', name: 'Ada', hasVoted: false, online: true }] },
    confidence: { revealed: false, rows: [] },
  },
};

const storeUser = () => localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId: ME, name: 'Ada' }));
const go = (path: string) => window.history.pushState({}, '', path);
const sockets = () => FakeWebSocket.instances;

function openRoom(): FakeWebSocket {
  const socket = sockets()[0];
  act(() => {
    socket.open();
    socket.receive(STATE);
  });
  return socket;
}

beforeEach(() => {
  localStorage.clear();
  go('/');
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete document.documentElement.dataset.theme;
  delete (document as { execCommand?: unknown }).execCommand;
  go('/');
});

describe('routing', () => {
  it('shows the landing page at / without opening a connection', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Planning Poker' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create room' })).toBeTruthy();
    expect(screen.getByLabelText('Paste a room link or code')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy();
    expect(sockets()).toHaveLength(0);
  });

  it('shows unknown paths as the landing page', () => {
    go('/nope/at/all');
    render(<App />);
    expect(screen.getByRole('button', { name: 'Create room' })).toBeTruthy();
  });

  it('opens the room at /r/<code> and connects with ?room=<code>', () => {
    storeUser();
    go(`/r/${ROOM}`);
    render(<App />);
    expect(sockets()).toHaveLength(1);
    expect(sockets()[0].url).toBe(`ws://${location.host}/ws?room=${ROOM}`);
    expect(screen.queryByRole('button', { name: 'Create room' })).toBeNull();
  });

  it("shows an invalid-link screen for /r/<invalid code> and goes back to the landing page", () => {
    storeUser();
    go('/r/Not-A-Valid-Code');
    render(<App />);
    expect(screen.getByText("This room link isn't valid")).toBeTruthy();
    expect(sockets()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Back to start page' }));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('button', { name: 'Create room' })).toBeTruthy();
  });

  it('follows browser back/forward (popstate) between landing and rooms, closing the old socket', () => {
    storeUser();
    go(`/r/${ROOM}`);
    render(<App />);
    const first = sockets()[0];
    act(() => first.open());

    act(() => {
      go('/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByRole('button', { name: 'Create room' })).toBeTruthy();
    expect(first.readyState).toBe(3);

    act(() => {
      go(`/r/${OTHER}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(sockets()).toHaveLength(2);
    expect(sockets()[1].url.endsWith(`?room=${OTHER}`)).toBe(true);
  });

  it('switches rooms directly when the room code in the URL changes', () => {
    storeUser();
    go(`/r/${ROOM}`);
    render(<App />);
    openRoom();

    act(() => {
      go(`/r/${OTHER}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(sockets()).toHaveLength(2);
    expect(sockets()[0].readyState).toBe(3);
    expect(sockets()[1].url.endsWith(`?room=${OTHER}`)).toBe(true);
  });

  it('opens an upper-case room link as the canonical lower-case room', () => {
    storeUser();
    go(`/r/${ROOM.toUpperCase()}`);
    render(<App />);
    expect(screen.queryByText("This room link isn't valid")).toBeNull();
    expect(window.location.pathname).toBe(`/r/${ROOM}`);
    expect(sockets()).toHaveLength(1);
    expect(sockets()[0].url.endsWith(`?room=${ROOM}`)).toBe(true);
  });

  it('the header title links back to the landing page', () => {
    storeUser();
    go(`/r/${ROOM}`);
    render(<App />);
    openRoom();
    const link = within(screen.getByRole('banner')).getByRole('link', { name: 'Planning Poker' });
    expect(link.getAttribute('href')).toBe('/');
    fireEvent.click(link);
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('button', { name: 'Create room' })).toBeTruthy();
  });
});

describe('landing page', () => {
  it('Create room navigates to a valid /r/<code> and connects with that code', () => {
    storeUser();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));

    expect(window.location.pathname).toMatch(/^\/r\/[abcdefghjkmnpqrstuvwxyz23456789]{10}$/);
    const code = window.location.pathname.slice('/r/'.length);
    expect(sockets()).toHaveLength(1);
    expect(sockets()[0].url).toBe(`ws://${location.host}/ws?room=${code}`);
  });

  it('Create room makes a different room each time', () => {
    storeUser();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    const first = window.location.pathname;
    act(() => {
      go('/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(window.location.pathname).not.toBe(first);
  });

  it.each([
    ['a full link', `https://poker.example.com/r/${ROOM}`],
    ['a path', `/r/${ROOM}`],
    ['a bare code', ROOM],
    ['a code with spaces around it', `  ${ROOM}  `],
  ])('Join accepts %s', (_label, input) => {
    storeUser();
    render(<App />);
    fireEvent.change(screen.getByLabelText('Paste a room link or code'), { target: { value: input } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(window.location.pathname).toBe(`/r/${ROOM}`);
    expect(sockets()[0].url.endsWith(`?room=${ROOM}`)).toBe(true);
  });

  it('Join submits on Enter', () => {
    storeUser();
    render(<App />);
    const field = screen.getByLabelText('Paste a room link or code');
    fireEvent.change(field, { target: { value: ROOM } });
    fireEvent.submit(field.closest('form')!);
    expect(window.location.pathname).toBe(`/r/${ROOM}`);
  });

  it.each([
    ['empty', ''],
    ['too short', 'abc'],
    ['a link without a room', 'https://poker.example.com/'],
    ['a link with a bad code', 'https://poker.example.com/r/bad-code'],
    ['random text', 'hello there'],
  ])('Join shows an inline error for %s and stays on the landing page', (_label, input) => {
    render(<App />);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(screen.getByLabelText('Paste a room link or code'), { target: { value: input } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(screen.getByRole('alert').textContent).toMatch(/room link or code/);
    expect(window.location.pathname).toBe('/');
    expect(sockets()).toHaveLength(0);

    // Typing again clears the error.
    fireEvent.change(screen.getByLabelText('Paste a room link or code'), { target: { value: 'x' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('has a theme toggle that restyles the landing page and is remembered', () => {
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe('gui');
    fireEvent.click(screen.getByRole('button', { name: 'TUI mode' }));
    expect(document.documentElement.dataset.theme).toBe('tui');
    expect(localStorage.getItem(THEME_KEY)).toBe('tui');
    expect(screen.getByRole('button', { name: 'GUI mode' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'GUI mode' }));
    expect(document.documentElement.dataset.theme).toBe('gui');
  });

  it('keeps the chosen theme when entering a room', () => {
    storeUser();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'TUI mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    openRoom();
    expect(document.documentElement.dataset.theme).toBe('tui');
    expect(screen.getByRole('button', { name: 'GUI mode' })).toBeTruthy();
  });
});

describe('name prompt', () => {
  it('is not shown on the landing page, but is asked when entering a room, once per browser', () => {
    render(<App />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(sockets()).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sockets()).toHaveLength(1);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);

    // Entering another room reuses the same identity and does not ask again.
    act(() => {
      go('/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    fireEvent.change(screen.getByLabelText('Paste a room link or code'), { target: { value: OTHER } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sockets()).toHaveLength(2);
    act(() => sockets()[1].open());
    expect(JSON.parse(sockets()[1].sent[0])).toEqual({ type: 'join', userId: stored.userId, name: 'Ada' });
  });
});

describe('copy link', () => {
  function enterRoom() {
    storeUser();
    go(`/r/${ROOM}`);
    render(<App />);
    openRoom();
  }

  async function clickCopy() {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    });
  }

  it('copies the page URL with the clipboard API and shows "Link copied" for about 2 seconds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      enterRoom();
      vi.useFakeTimers();
      await clickCopy();

      expect(writeText).toHaveBeenCalledWith(window.location.href);
      expect(window.location.href).toContain(`/r/${ROOM}`);
      expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(1999);
      });
      expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('falls back to document.execCommand("copy") when navigator.clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const execCommand = vi.fn(() => true);
    (document as { execCommand?: unknown }).execCommand = execCommand;
    try {
      enterRoom();
      await clickCopy();
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
      expect(document.querySelector('body > textarea')).toBeNull();
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('falls back to execCommand when the clipboard API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const execCommand = vi.fn(() => true);
    (document as { execCommand?: unknown }).execCommand = execCommand;
    try {
      enterRoom();
      await clickCopy();
      expect(writeText).toHaveBeenCalled();
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('shows the link in a selected read-only field when nothing can copy', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    (document as { execCommand?: unknown }).execCommand = vi.fn(() => false);
    try {
      enterRoom();
      await clickCopy();
      const field = screen.getByLabelText('Room link') as HTMLInputElement;
      expect(field.readOnly).toBe(true);
      expect(field.value).toBe(window.location.href);
      expect(document.activeElement === field || field.selectionEnd === field.value.length).toBe(true);
      expect(screen.queryByRole('button', { name: 'Link copied' })).toBeNull();
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });
});

describe('connection refused by the server', () => {
  function enterRoom() {
    vi.useFakeTimers();
    storeUser();
    go(`/r/${ROOM}`);
    render(<App />);
    const socket = sockets()[0];
    act(() => socket.open());
    return socket;
  }

  it.each([
    [4403, 'Room is full (50 people)'],
    [4429, 'Server is busy, try again later'],
    [4400, "This room link isn't valid"],
  ])('close code %i shows "%s" and does not reconnect', (code, message) => {
    const socket = enterRoom();
    act(() => socket.close(code));

    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(sockets()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Back to start page' }));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('button', { name: 'Create room' })).toBeTruthy();
  });

  it('still reconnects after an ordinary connection drop', () => {
    const socket = enterRoom();
    act(() => {
      socket.close(1006);
      vi.advanceTimersByTime(1000);
    });
    expect(sockets()).toHaveLength(2);
    expect(screen.queryByText('Room is full (50 people)')).toBeNull();
  });
});
