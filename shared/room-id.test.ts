import { describe, expect, it } from 'vitest';
import { ROOM_ID_ALPHABET, ROOM_ID_PATTERN, generateRoomId, isValidRoomId } from './room-id';

describe('room id', () => {
  it('validates 8-32 lowercase alphanumeric characters', () => {
    expect(ROOM_ID_PATTERN.test('abcdefghjk')).toBe(true);
    expect(isValidRoomId('abcdefgh')).toBe(true);
    expect(isValidRoomId('a'.repeat(32))).toBe(true);
    expect(isValidRoomId('abc234xy')).toBe(true);
  });

  it('rejects bad ids', () => {
    expect(isValidRoomId('abcdefg')).toBe(false); // too short
    expect(isValidRoomId('a'.repeat(33))).toBe(false); // too long
    expect(isValidRoomId('ABCDEFGHJK')).toBe(false);
    expect(isValidRoomId('abcdef-hjk')).toBe(false);
    expect(isValidRoomId('abcdef/hjk')).toBe(false);
    expect(isValidRoomId('abcdefghjk\n')).toBe(false);
    expect(isValidRoomId('')).toBe(false);
    expect(isValidRoomId(undefined)).toBe(false);
    expect(isValidRoomId(42)).toBe(false);
  });

  it('has no look-alike characters in the alphabet', () => {
    for (const c of '01ilo') expect(ROOM_ID_ALPHABET).not.toContain(c);
    expect(ROOM_ID_ALPHABET).toHaveLength(31);
  });

  it('generates a valid 10-character id from the alphabet', () => {
    const id = generateRoomId();
    expect(id).toHaveLength(10);
    expect(isValidRoomId(id)).toBe(true);
    for (const c of id) expect(ROOM_ID_ALPHABET).toContain(c);
  });

  it('uses the injected random source and honours the length', () => {
    let calls = 0;
    const fill = (bytes: Uint8Array) => {
      calls += 1;
      bytes.fill(0);
    };
    expect(generateRoomId(fill, 12)).toBe('a'.repeat(12));
    expect(calls).toBeGreaterThan(0);
  });

  it('rejects biased bytes instead of using modulo', () => {
    // 255 is above the largest multiple of 31 (248), so it must be skipped; the next round gives 1 -> 'b'.
    const sequence = [255, 1];
    const fill = (bytes: Uint8Array) => {
      for (let i = 0; i < bytes.length; i++) bytes[i] = sequence[i % sequence.length];
    };
    const id = generateRoomId(fill, 8);
    expect(id).toBe('b'.repeat(8));
  });

  it('produces different ids', () => {
    expect(generateRoomId()).not.toBe(generateRoomId());
  });
});
