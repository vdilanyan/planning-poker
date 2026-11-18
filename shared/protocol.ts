import { TABS, type ClientMessage, type Tab } from './types';

export const MAX_NAME_LENGTH = 40;
export const USER_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** Control characters, plus bidi embeddings/overrides/isolates/marks that can reorder or spoof text. */
const UNSAFE_NAME_CHARS = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;

export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(UNSAFE_NAME_CHARS, '').trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

function isTab(x: unknown): x is Tab {
  return typeof x === 'string' && (TABS as readonly string[]).includes(x);
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  const type = m.type;
  const tab = m.tab;

  switch (type) {
    case 'join': {
      const userId = m.userId;
      const name = sanitizeName(m.name);
      if (typeof userId !== 'string' || !USER_ID_PATTERN.test(userId) || name === null) return null;
      return { type: 'join', userId, name };
    }
    case 'rename': {
      const name = sanitizeName(m.name);
      return name === null ? null : { type: 'rename', name };
    }
    case 'vote': {
      const value = m.value;
      if (!isTab(tab)) return null;
      if (value !== null && typeof value !== 'number') return null;
      return { type: 'vote', tab, value };
    }
    case 'reveal':
    case 'hide':
    case 'reset':
      return isTab(tab) ? { type, tab } : null;
    default:
      return null;
  }
}
