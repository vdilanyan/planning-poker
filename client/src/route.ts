import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { isValidRoomId } from '@shared/room-id';

export type Route = { page: 'landing' } | { page: 'room'; roomId: string };

/**
 * `/r/<code>` is a room (the code may still be invalid; the app shows an invalid-link screen).
 * Everything else, including unknown paths, is the landing page.
 */
export function parseRoute(pathname: string): Route {
  const match = /^\/r\/([^/]+)\/?$/.exec(pathname);
  if (!match) return { page: 'landing' };
  let roomId = match[1];
  try {
    roomId = decodeURIComponent(roomId);
  } catch {
    // keep the raw segment; it will fail validation
  }
  return { page: 'room', roomId };
}

export function roomPath(roomId: string): string {
  return `/r/${roomId}`;
}

/** Pulls a room code out of a pasted link, a `/r/<code>` path or a bare code. */
export function extractRoomId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const fromPath = /(?:^|\/)r\/([^/?#\s]+)/.exec(text);
  const candidate = (fromPath ? fromPath[1] : text).toLowerCase();
  return isValidRoomId(candidate) ? candidate : null;
}

/** Client-side navigation without a full page load. */
export function navigate(path: string): void {
  if (window.location.pathname !== path) window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Room codes are lower case. `/r/ABCDEFGHJK` is the same room, so its canonical form is lower
 * case; anything that is not a valid code even in lower case is left as is (invalid-link screen).
 */
export function canonicalPathname(pathname: string): string {
  const match = /^\/r\/([^/]+)(\/?)$/.exec(pathname);
  if (!match) return pathname;
  const lower = match[1].toLowerCase();
  return lower !== match[1] && isValidRoomId(lower) ? `/r/${lower}${match[2]}` : pathname;
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}

const getPathname = (): string => window.location.pathname;

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, getPathname);
  const canonical = canonicalPathname(pathname);

  // Fix the address bar in place (no new history entry); the route below already uses the fix.
  useLayoutEffect(() => {
    if (canonical !== pathname && window.location.pathname === pathname) {
      const { search, hash } = window.location;
      window.history.replaceState(window.history.state, '', `${canonical}${search}${hash}`);
    }
  }, [canonical, pathname]);

  return useMemo(() => parseRoute(canonical), [canonical]);
}
