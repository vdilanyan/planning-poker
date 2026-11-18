/** No look-alikes (0/o, 1/l/i). 31 characters. */
export const ROOM_ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const ROOM_ID_LENGTH = 10;
/** Default cap on connected sockets per room (shown to users when a room is full). */
export const MAX_PARTICIPANTS_PER_ROOM = 50;
/** Cap on people remembered in one room (connected or not). Bounds memory and the state file. */
export const MAX_PARTICIPANTS_STORED_PER_ROOM = 200;
/** What the server accepts. Deliberately looser than the generator's alphabet. */
export const ROOM_ID_PATTERN = /^[a-z0-9]{8,32}$/;

export function isValidRoomId(id: unknown): id is string {
  return typeof id === 'string' && ROOM_ID_PATTERN.test(id);
}

export type FillRandom = (bytes: Uint8Array) => void;

const defaultFill: FillRandom = (bytes) => {
  crypto.getRandomValues(bytes);
};

/**
 * Random room code. Uses getRandomValues (not randomUUID, which needs a secure context) and
 * rejection sampling so every character is equally likely.
 */
export function generateRoomId(
  fill: FillRandom = defaultFill,
  length: number = ROOM_ID_LENGTH,
): string {
  const size = ROOM_ID_ALPHABET.length;
  const limit = 256 - (256 % size); // bytes at or above this would bias the result
  let id = '';
  while (id.length < length) {
    const bytes = new Uint8Array(length);
    fill(bytes);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      id += ROOM_ID_ALPHABET[byte % size];
      if (id.length === length) break;
    }
  }
  return id;
}
