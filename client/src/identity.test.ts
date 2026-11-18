// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { USER_ID_PATTERN } from '@shared/protocol';
import { STORAGE_KEY, createUser, loadUser, randomId, saveUser } from './identity';

beforeEach(() => localStorage.clear());

describe('identity', () => {
  it('returns null when nothing is stored', () => {
    expect(loadUser()).toBeNull();
  });

  it('round-trips a saved user', () => {
    saveUser({ userId: 'abcdef12', name: 'Ada' });
    expect(loadUser()).toEqual({ userId: 'abcdef12', name: 'Ada' });
  });

  it('returns null for corrupt or invalid stored data', () => {
    localStorage.setItem(STORAGE_KEY, '{ nope');
    expect(loadUser()).toBeNull();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId: 'abcdef12', name: '   ' }));
    expect(loadUser()).toBeNull();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId: 'bad id!', name: 'Ada' }));
    expect(loadUser()).toBeNull();
  });

  it('randomId matches the server pattern and is unique', () => {
    const a = randomId();
    expect(a).toMatch(USER_ID_PATTERN);
    expect(randomId()).not.toBe(a);
  });

  it('createUser trims and limits the name', () => {
    const user = createUser('  Ada  ', () => 'fixedid-1234');
    expect(user).toEqual({ userId: 'fixedid-1234', name: 'Ada' });
    expect(createUser('x'.repeat(60)).name).toHaveLength(40);
  });
});
