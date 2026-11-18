import { MAX_NAME_LENGTH, USER_ID_PATTERN } from '@shared/protocol';

export const STORAGE_KEY = 'planning-poker.user';

export interface User {
  userId: string;
  name: string;
}

/** 32 hex chars. Uses getRandomValues because randomUUID needs a secure context (https). */
export function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createUser(name: string, makeId: () => string = randomId): User {
  return { userId: makeId(), name: name.trim().slice(0, MAX_NAME_LENGTH) };
}

export function loadUser(storage: Storage = localStorage): User | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<User> | null;
    if (
      parsed &&
      typeof parsed.userId === 'string' &&
      USER_ID_PATTERN.test(parsed.userId) &&
      typeof parsed.name === 'string' &&
      parsed.name.trim().length > 0
    ) {
      return { userId: parsed.userId, name: parsed.name };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveUser(user: User, storage: Storage = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(user));
}
