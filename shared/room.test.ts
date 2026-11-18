import { describe, expect, it } from 'vitest';
import { applyMessage, buildView, createRoom, pruneParticipants, touchParticipant, PRUNE_AFTER_MS } from './room';
import type { RoomState } from './types';

const NOW = 1_000_000;
const A = 'user-aaaa-0001';
const B = 'user-bbbb-0002';

function room(...ids: string[]): RoomState {
  const state = createRoom();
  ids.forEach((id, i) => {
    applyMessage(state, id, { type: 'join', userId: id, name: `User ${i}` }, NOW);
  });
  return state;
}
const none = new Set<string>();

describe('applyMessage', () => {
  it('registers a participant on join', () => {
    const state = room(A);
    expect(state.participants[A]).toEqual({ id: A, publicId: expect.any(String), name: 'User 0', lastSeen: NOW });
  });

  it('rejects joins with an invalid name, an invalid user id, or a mismatched user id', () => {
    const state = createRoom();
    expect(applyMessage(state, A, { type: 'join', userId: A, name: '   ' }, NOW)).toBe(false);
    expect(applyMessage(state, '__proto__', { type: 'join', userId: '__proto__', name: 'X' }, NOW)).toBe(false);
    expect(applyMessage(state, A, { type: 'join', userId: B, name: 'X' }, NOW)).toBe(false);
    expect(Object.keys(state.participants)).toEqual([]);
  });

  it('keeps votes and the public id when the same user joins again', () => {
    const state = room(A);
    const publicId = state.participants[A].publicId;
    applyMessage(state, A, { type: 'vote', tab: 'poker', value: 8 }, NOW);
    applyMessage(state, A, { type: 'join', userId: A, name: 'Renamed' }, NOW + 1);
    expect(state.participants[A].publicId).toBe(publicId);
    expect(state.participants[A].name).toBe('Renamed');
    expect(state.votes.poker[A]).toBe(8);
  });

  it('ignores messages from users who have not joined', () => {
    const state = createRoom();
    expect(applyMessage(state, A, { type: 'vote', tab: 'poker', value: 5 }, NOW)).toBe(false);
    expect(state.votes.poker).toEqual({});
  });

  it('accepts in-deck votes and rejects out-of-deck votes', () => {
    const state = room(A);
    expect(applyMessage(state, A, { type: 'vote', tab: 'poker', value: 8 }, NOW)).toBe(true);
    expect(state.votes.poker[A]).toBe(8);
    expect(applyMessage(state, A, { type: 'vote', tab: 'poker', value: 7 }, NOW)).toBe(false);
    expect(applyMessage(state, A, { type: 'vote', tab: 'poker', value: 1 }, NOW)).toBe(false);
    expect(state.votes.poker[A]).toBe(8);
    expect(applyMessage(state, A, { type: 'vote', tab: 'confidence', value: 3 }, NOW)).toBe(true);
    expect(applyMessage(state, A, { type: 'vote', tab: 'confidence', value: 13 }, NOW)).toBe(false);
  });

  it('clears a vote with null', () => {
    const state = room(A);
    applyMessage(state, A, { type: 'vote', tab: 'poker', value: 8 }, NOW);
    expect(applyMessage(state, A, { type: 'vote', tab: 'poker', value: null }, NOW)).toBe(true);
    expect(state.votes.poker[A]).toBeUndefined();
  });

  it('ignores votes while the tab is revealed', () => {
    const state = room(A);
    applyMessage(state, A, { type: 'vote', tab: 'poker', value: 8 }, NOW);
    applyMessage(state, A, { type: 'reveal', tab: 'poker' }, NOW);
    expect(applyMessage(state, A, { type: 'vote', tab: 'poker', value: 3 }, NOW)).toBe(false);
    expect(state.votes.poker[A]).toBe(8);
  });

  it('reveal and hide affect only their tab and keep votes', () => {
    const state = room(A);
    applyMessage(state, A, { type: 'vote', tab: 'poker', value: 8 }, NOW);
    applyMessage(state, A, { type: 'reveal', tab: 'poker' }, NOW);
    expect(state.revealed).toEqual({ poker: true, confidence: false });
    applyMessage(state, A, { type: 'hide', tab: 'poker' }, NOW);
    expect(state.revealed).toEqual({ poker: false, confidence: false });
    expect(state.votes.poker[A]).toBe(8);
  });

  it('reset clears only its tab and hides it', () => {
    const state = room(A);
    applyMessage(state, A, { type: 'vote', tab: 'poker', value: 8 }, NOW);
    applyMessage(state, A, { type: 'vote', tab: 'confidence', value: 7 }, NOW);
    applyMessage(state, A, { type: 'reveal', tab: 'poker' }, NOW);
    applyMessage(state, A, { type: 'reveal', tab: 'confidence' }, NOW);
    applyMessage(state, A, { type: 'reset', tab: 'poker' }, NOW);
    expect(state.votes.poker).toEqual({});
    expect(state.revealed.poker).toBe(false);
    expect(state.votes.confidence[A]).toBe(7);
    expect(state.revealed.confidence).toBe(true);
  });

  it('renames a participant', () => {
    const state = room(A);
    expect(applyMessage(state, A, { type: 'rename', name: 'Grace' }, NOW)).toBe(true);
    expect(state.participants[A].name).toBe('Grace');
  });

  it('is safe with user ids that collide with Object.prototype keys', () => {
    const state = createRoom();
    applyMessage(state, 'constructor', { type: 'join', userId: 'constructor', name: 'Eve' }, NOW);
    const view = buildView(state, 'constructor', new Set(['constructor']));
    expect(view.tabs.poker.rows[0].hasVoted).toBe(false);
    expect(applyMessage(state, 'toString', { type: 'vote', tab: 'poker', value: 5 }, NOW)).toBe(false);
  });
});

describe('buildView', () => {
  it('hides values before reveal but shows hasVoted and my own vote', () => {
    const state = room(A, B);
    applyMessage(state, A, { type: 'vote', tab: 'poker', value: 8 }, NOW);

    const forB = buildView(state, B, new Set([A, B]));
    const rowA = forB.tabs.poker.rows.find((r) => r.name === 'User 0')!;
    expect(rowA.hasVoted).toBe(true);
    expect('value' in rowA).toBe(false);
    expect(forB.tabs.poker.myVote).toBeUndefined();
    expect(forB.tabs.poker.stats).toBeUndefined();
    expect(JSON.stringify(forB)).not.toContain('"value"');
    // The secret user id of another participant must never be broadcast.
    expect(JSON.stringify(forB)).not.toContain(A);

    const forA = buildView(state, A, new Set([A, B]));
    expect(forA.tabs.poker.myVote).toBe(8);
    expect(forA.you).toBe(A);
  });

  it('shows values and stats after reveal', () => {
    const ids = ['user-0000-aaaa', 'user-0001-aaaa', 'user-0002-aaaa', 'user-0003-aaaa', 'user-0004-aaaa'];
    const state = room(...ids);
    [8, 9, 9, 10, 10].forEach((value, i) => {
      applyMessage(state, ids[i], { type: 'vote', tab: 'confidence', value }, NOW);
    });
    applyMessage(state, ids[0], { type: 'reveal', tab: 'confidence' }, NOW);

    const view = buildView(state, ids[0], new Set(ids));
    expect(view.tabs.confidence.stats).toEqual({ count: 5, average: 9.2, min: 8, max: 10 });
    expect(view.tabs.confidence.rows.map((r) => r.value).sort()).toEqual([10, 10, 8, 9, 9]);
    expect(view.tabs.poker.revealed).toBe(false);
  });

  it('computes no stats for the poker tab even after reveal', () => {
    const state = room(A, B);
    applyMessage(state, A, { type: 'vote', tab: 'poker', value: 5 }, NOW);
    applyMessage(state, B, { type: 'vote', tab: 'poker', value: 8 }, NOW);
    applyMessage(state, A, { type: 'reveal', tab: 'poker' }, NOW);

    const view = buildView(state, A, new Set([A, B]));
    expect(view.tabs.poker.revealed).toBe(true);
    expect(view.tabs.poker.rows.map((r) => r.value).sort()).toEqual([5, 8]);
    expect(view.tabs.poker.stats).toBeUndefined();
  });

  it('hides offline participants who hold no vote in the tab', () => {
    const state = room(A, B);
    state.participants[A].name = 'Zed';
    state.participants[B].name = 'Amy';
    const view = buildView(state, A, new Set([A]));
    expect(view.tabs.poker.rows.map((r) => [r.name, r.online])).toEqual([['Zed', true]]);
  });

  it('keeps offline participants who still hold a vote, greyed as offline, sorted by name', () => {
    const state = room(A, B);
    state.participants[A].name = 'Zed';
    state.participants[B].name = 'Amy';
    applyMessage(state, B, { type: 'vote', tab: 'poker', value: 5 }, NOW);
    const view = buildView(state, A, new Set([A]));
    expect(view.tabs.poker.rows.map((r) => [r.name, r.online, r.hasVoted])).toEqual([
      ['Amy', false, true],
      ['Zed', true, false],
    ]);
  });

  it('hides an offline participant in the tab where they have no vote', () => {
    const state = room(A, B);
    applyMessage(state, B, { type: 'vote', tab: 'confidence', value: 7 }, NOW);
    const view = buildView(state, A, new Set([A]));
    expect(view.tabs.poker.rows.map((r) => r.id)).toEqual([state.participants[A].publicId]);
    expect(view.tabs.confidence.rows).toHaveLength(2);
  });

  it('keeps online participants without votes', () => {
    const state = room(A, B);
    const view = buildView(state, A, new Set([A, B]));
    expect(view.tabs.poker.rows).toHaveLength(2);
    expect(view.tabs.confidence.rows).toHaveLength(2);
  });
});

describe('pruneParticipants', () => {
  it('removes offline, vote-less participants not seen for over 24h', () => {
    const state = room(A, B);
    expect(pruneParticipants(state, none, NOW + PRUNE_AFTER_MS + 1)).toBe(true);
    expect(Object.keys(state.participants)).toEqual([]);
  });

  it('keeps recent, online, and voting participants', () => {
    const state = room(A, B, 'user-cccc-0003');
    applyMessage(state, A, { type: 'vote', tab: 'poker', value: 5 }, NOW);
    const later = NOW + PRUNE_AFTER_MS + 1;
    // A has a vote, B is online, C is the only one eligible.
    expect(pruneParticipants(state, new Set([B]), later)).toBe(true);
    expect(Object.keys(state.participants).sort()).toEqual([A, B].sort());
    expect(pruneParticipants(state, new Set([B]), NOW + 1000)).toBe(false);
  });

  it('touchParticipant refreshes lastSeen', () => {
    const state = room(A);
    touchParticipant(state, A, NOW + PRUNE_AFTER_MS);
    expect(pruneParticipants(state, none, NOW + PRUNE_AFTER_MS + 1)).toBe(false);
  });
});
