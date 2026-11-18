// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractRoomId, navigate, parseRoute, roomPath, useRoute } from './route';

const ID = 'abcdefghjk';

describe('parseRoute', () => {
  it('maps / to the landing page', () => {
    expect(parseRoute('/')).toEqual({ page: 'landing' });
    expect(parseRoute('')).toEqual({ page: 'landing' });
  });

  it('maps /r/<code> to a room, with or without a trailing slash', () => {
    expect(parseRoute(`/r/${ID}`)).toEqual({ page: 'room', roomId: ID });
    expect(parseRoute(`/r/${ID}/`)).toEqual({ page: 'room', roomId: ID });
  });

  it('keeps an invalid code so the app can show the invalid-link screen', () => {
    expect(parseRoute('/r/Not-Valid')).toEqual({ page: 'room', roomId: 'Not-Valid' });
  });

  it('sends unknown paths to the landing page', () => {
    expect(parseRoute('/r')).toEqual({ page: 'landing' });
    expect(parseRoute('/r/')).toEqual({ page: 'landing' });
    expect(parseRoute('/other')).toEqual({ page: 'landing' });
    expect(parseRoute(`/r/${ID}/extra`)).toEqual({ page: 'landing' });
    expect(parseRoute(`/x/r/${ID}`)).toEqual({ page: 'landing' });
  });
});

describe('roomPath', () => {
  it('builds /r/<code>', () => {
    expect(roomPath(ID)).toBe(`/r/${ID}`);
  });
});

describe('extractRoomId', () => {
  it('accepts a full URL, a path and a bare code', () => {
    expect(extractRoomId(`https://poker.example.com/r/${ID}`)).toBe(ID);
    expect(extractRoomId(`http://localhost:3000/r/${ID}?x=1#y`)).toBe(ID);
    expect(extractRoomId(`/r/${ID}`)).toBe(ID);
    expect(extractRoomId(`r/${ID}`)).toBe(ID);
    expect(extractRoomId(ID)).toBe(ID);
  });

  it('trims whitespace and ignores letter case', () => {
    expect(extractRoomId(`  ${ID}\n`)).toBe(ID);
    expect(extractRoomId(ID.toUpperCase())).toBe(ID);
  });

  it('returns null for anything invalid', () => {
    expect(extractRoomId('')).toBeNull();
    expect(extractRoomId('   ')).toBeNull();
    expect(extractRoomId('short')).toBeNull();
    expect(extractRoomId('https://poker.example.com/')).toBeNull();
    expect(extractRoomId('https://poker.example.com/r/')).toBeNull();
    expect(extractRoomId('https://poker.example.com/r/bad-code')).toBeNull();
    expect(extractRoomId('not a room')).toBeNull();
    expect(extractRoomId(`${ID}/extra`)).toBeNull();
    expect(extractRoomId('a'.repeat(33))).toBeNull();
  });
});

describe('useRoute', () => {
  beforeEach(() => window.history.pushState({}, '', '/'));
  afterEach(() => {
    cleanup();
    window.history.pushState({}, '', '/');
  });

  it('reflects the current location and follows navigate()', () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ page: 'landing' });

    act(() => navigate(`/r/${ID}`));
    expect(window.location.pathname).toBe(`/r/${ID}`);
    expect(result.current).toEqual({ page: 'room', roomId: ID });

    act(() => navigate('/'));
    expect(result.current).toEqual({ page: 'landing' });
  });

  it('follows popstate (browser back/forward)', () => {
    window.history.pushState({}, '', `/r/${ID}`);
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ page: 'room', roomId: ID });

    act(() => {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current).toEqual({ page: 'landing' });
  });

  it('lowercases an upper-case code and replaces the URL with the canonical path', () => {
    window.history.pushState({}, '', `/r/${ID.toUpperCase()}?x=1#frag`);
    const lengthBefore = window.history.length;
    const { result } = renderHook(() => useRoute());

    expect(result.current).toEqual({ page: 'room', roomId: ID });
    expect(window.location.pathname).toBe(`/r/${ID}`);
    expect(window.location.search).toBe('?x=1');
    expect(window.location.hash).toBe('#frag');
    expect(window.history.length).toBe(lengthBefore); // replaced, not pushed
  });

  it('canonicalizes after a popstate to an upper-case room URL too', () => {
    const { result } = renderHook(() => useRoute());
    act(() => {
      window.history.pushState({}, '', `/r/${ID.toUpperCase()}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current).toEqual({ page: 'room', roomId: ID });
    expect(window.location.pathname).toBe(`/r/${ID}`);
  });

  it('leaves a code that is invalid even in lower case untouched', () => {
    window.history.pushState({}, '', '/r/Bad-Code');
    const { result } = renderHook(() => useRoute());
    expect(window.location.pathname).toBe('/r/Bad-Code');
    expect(result.current).toEqual({ page: 'room', roomId: 'Bad-Code' });
  });

  it('stops listening after unmount', () => {
    const { result, unmount } = renderHook(() => useRoute());
    unmount();
    act(() => navigate(`/r/${ID}`));
    expect(result.current).toEqual({ page: 'landing' });
  });
});
