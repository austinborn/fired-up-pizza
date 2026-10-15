import { describe, expect, it } from 'vitest';
import { formatPhoneNumber, normalizePhoneNumber } from './phone';

describe('normalizePhoneNumber', () => {
  it.each([
    '2125550142',
    '212-555-0142',
    '212.555.0142',
    '212 555 0142',
    '(212) 555-0142',
    '(212)555-0142',
    '1 212 555 0142',
    '1-212-555-0142',
    '1 (212) 555-0142',
    '12125550142',
    '+12125550142',
    '+1 212 555 0142',
    '+1 (212) 555-0142',
    '+1-212-555-0142',
    '+1.212.555.0142',
    '\t 212-555-0142 \n',
  ])('normalizes %j to +12125550142', (input) => {
    expect(normalizePhoneNumber(input)).toBe('+12125550142');
  });

  it('treats non-breaking spaces, as pasted from web pages, like spaces', () => {
    expect(normalizePhoneNumber('212\u00a0555\u00a00142')).toBe('+12125550142');
  });

  it.each([
    ['2002000000', '+12002000000'],
    ['9999999999', '+19999999999'],
    ['1-800-555-0199', '+18005550199'],
  ])('accepts %j as %s', (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ['555-0142', 'seven digits'],
    ['212-555-014', 'nine digits'],
    ['212-555-01422', 'eleven digits without a leading 1'],
    ['1-212-555-01422', 'twelve digits'],
    ['012-555-0142', 'area code starts with 0'],
    ['112-555-0142', 'area code starts with 1'],
    ['1-112-555-0142', 'area code after the leading 1 starts with 1'],
    ['212-055-0142', 'exchange code starts with 0'],
    ['212-155-0142', 'exchange code starts with 1'],
    ['555-123-4567', 'the usual placeholder: exchange code starts with 1'],
    ['212-555-CAKE', 'letters'],
    ['1-800-FLOWERS', 'letters'],
    ['212-555-0142 x12', 'extension'],
    ['212-555-0142 ext. 12', 'extension'],
    ['212-555-0142#12', 'extension'],
    ['212-555-0142 12', 'extension digits'],
    ['+2125550142', '+ without the country code 1'],
    ['+44 20 7946 0958', 'UK number'],
    ['+52 55 1234 5678', 'Mexican number'],
    ['011 44 20 7946 0958', 'international dialing prefix'],
    ['001 212 555 0142', 'international dialing prefix'],
    ['1+212-555-0142', 'misplaced +'],
    ['++1 212 555 0142', 'doubled +'],
    ['212/555-0142', 'unsupported punctuation'],
    ['\uff12\uff11\uff12\uff15\uff15\uff15\uff10\uff11\uff14\uff12', 'full-width digits'],
  ])('rejects %j (%s)', (input) => {
    expect(normalizePhoneNumber(input)).toBeNull();
  });
});

describe('formatPhoneNumber', () => {
  it('formats an E.164 number for display', () => {
    expect(formatPhoneNumber('+15551234567')).toBe('(555) 123-4567');
  });

  it('formats what normalizePhoneNumber returns', () => {
    expect(formatPhoneNumber(normalizePhoneNumber('212.555.0142') ?? '')).toBe('(212) 555-0142');
  });

  it.each(['', '2125550142', '+1212555014', '+442079460958', 'call me'])(
    'returns %j unchanged',
    (input) => {
      expect(formatPhoneNumber(input)).toBe(input);
    },
  );
});
