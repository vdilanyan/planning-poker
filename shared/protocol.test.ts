import { describe, expect, it } from 'vitest';
import { parseClientMessage, sanitizeName } from './protocol';

describe('sanitizeName', () => {
  it('trims', () => expect(sanitizeName('  Ada  ')).toBe('Ada'));
  it('rejects empty and whitespace', () => {
    expect(sanitizeName('')).toBeNull();
    expect(sanitizeName('   ')).toBeNull();
  });
  it('rejects names longer than 40 characters', () => {
    expect(sanitizeName('x'.repeat(41))).toBeNull();
    expect(sanitizeName('x'.repeat(40))).toBe('x'.repeat(40));
  });
  it('rejects non-strings', () => expect(sanitizeName(5)).toBeNull());

  it('strips control characters', () => {
    expect(sanitizeName('A\u0000d\ta\n\r\u001b\u007f\u0085')).toBe('Ada');
    expect(sanitizeName('\u0007Ada')).toBe('Ada');
  });
  it('strips bidi override, embedding, isolate and mark characters', () => {
    expect(sanitizeName('\u202EAda\u202C')).toBe('Ada');
    expect(sanitizeName('\u202AA\u202Bd\u202Da\u202C')).toBe('Ada');
    expect(sanitizeName('\u2066A\u2067d\u2068a\u2069')).toBe('Ada');
    expect(sanitizeName('A\u200Ed\u200Fa\u061C')).toBe('Ada');
  });
  it('rejects a name made only of stripped characters', () => {
    expect(sanitizeName('\u202E\u202C')).toBeNull();
    expect(sanitizeName(' \u0000 \u200E ')).toBeNull();
  });
  it('strips before the length check and before trimming', () => {
    expect(sanitizeName('\u202E' + 'x'.repeat(40))).toBe('x'.repeat(40));
    expect(sanitizeName('x'.repeat(41) + '\u202E')).toBeNull();
    expect(sanitizeName('\u202E  Ada  \u202C')).toBe('Ada');
  });
  it('keeps ordinary non-ASCII names', () => {
    expect(sanitizeName('Zoë Müller 日本語 🙂')).toBe('Zoë Müller 日本語 🙂');
  });
});

describe('parseClientMessage', () => {
  const join = { type: 'join', userId: 'abcdef12', name: ' Ada ' };

  it('parses a join and trims the name', () => {
    expect(parseClientMessage(JSON.stringify(join))).toEqual({
      type: 'join',
      userId: 'abcdef12',
      name: 'Ada',
    });
  });

  it('rejects a join with a bad user id', () => {
    expect(parseClientMessage(JSON.stringify({ ...join, userId: 'short' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...join, userId: 'has space here' }))).toBeNull();
  });

  it('parses votes including null', () => {
    expect(parseClientMessage('{"type":"vote","tab":"poker","value":8}')).toEqual({
      type: 'vote',
      tab: 'poker',
      value: 8,
    });
    expect(parseClientMessage('{"type":"vote","tab":"confidence","value":null}')).toEqual({
      type: 'vote',
      tab: 'confidence',
      value: null,
    });
  });

  it('rejects votes with a bad tab or value type', () => {
    expect(parseClientMessage('{"type":"vote","tab":"nope","value":8}')).toBeNull();
    expect(parseClientMessage('{"type":"vote","tab":"poker","value":"8"}')).toBeNull();
  });

  it('parses reveal, hide, reset', () => {
    for (const type of ['reveal', 'hide', 'reset']) {
      expect(parseClientMessage(JSON.stringify({ type, tab: 'poker' }))).toEqual({ type, tab: 'poker' });
    }
  });

  it('rejects rename without a valid name', () => {
    expect(parseClientMessage('{"type":"rename","name":""}')).toBeNull();
    expect(parseClientMessage('{"type":"rename","name":"Bob"}')).toEqual({ type: 'rename', name: 'Bob' });
  });

  it('rejects garbage', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('"a string"')).toBeNull();
    expect(parseClientMessage('null')).toBeNull();
    expect(parseClientMessage('{"type":"explode"}')).toBeNull();
  });
});
