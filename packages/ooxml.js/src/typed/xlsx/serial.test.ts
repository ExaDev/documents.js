import { describe, expect, it } from 'vitest';
import type { Package } from '../../model/package';
import { el } from '../../xml/fragment';
import { readDate1904, serialToIsoDate, serialToIsoDateTime, serialToIsoTime } from './serial';

function workbookPackage(workbookPr?: ReturnType<typeof el>): Package {
  const children = workbookPr === undefined ? [] : [workbookPr];
  return { parts: { 'xl/workbook.xml': { kind: 'xml', nodes: [el('workbook', {}, children)] } } };
}

describe('readDate1904', () => {
  it('reads the 1900 system from a real date1904="false" attribute (what every mainstream producer writes)', () => {
    expect(readDate1904(workbookPackage(el('workbookPr', { date1904: 'false' })))).toBe(false);
  });

  it('reads the 1904 system from both spec-legal spellings of an xsd:boolean true', () => {
    expect(readDate1904(workbookPackage(el('workbookPr', { date1904: 'true' })))).toBe(true);
    expect(readDate1904(workbookPackage(el('workbookPr', { date1904: '1' })))).toBe(true);
  });

  it('defaults to the 1900 system when there is no workbookPr, no attribute, or no workbook part at all', () => {
    expect(readDate1904(workbookPackage())).toBe(false);
    expect(readDate1904(workbookPackage(el('workbookPr', {})))).toBe(false);
    expect(readDate1904({ parts: {} })).toBe(false);
  });
});

describe('serialToIsoDate: the 1900 system and its Lotus phantom leap day', () => {
  it('converts the real serial this package\'s own kitchen-sink fixture stores for its Due Date cell', () => {
    expect(serialToIsoDate(46234, false)).toBe('2026-07-31');
  });

  it('counts from 1899-12-31 below the phantom day, so serial 1 is 1900-01-01 and serial 59 is 1900-02-28', () => {
    expect(serialToIsoDate(1, false)).toBe('1900-01-01');
    expect(serialToIsoDate(59, false)).toBe('1900-02-28');
  });

  it('counts from 1899-12-30 above it, absorbing the phantom day, so serial 61 is 1900-03-01', () => {
    expect(serialToIsoDate(61, false)).toBe('1900-03-01');
  });

  it('refuses serial 60 outright -- 1900-02-29 never existed, and an invalid ISO date is worse than degrading to the number', () => {
    expect(serialToIsoDate(60, false)).toBeUndefined();
    expect(serialToIsoDate(60.75, false)).toBeUndefined();
  });

  it('refuses a negative serial, which names no date under either epoch', () => {
    expect(serialToIsoDate(-1, false)).toBeUndefined();
    expect(serialToIsoDate(-1, true)).toBeUndefined();
  });

  it('discards the time-of-day fraction, keeping the day the serial falls on', () => {
    expect(serialToIsoDate(46234.9, false)).toBe('2026-07-31');
  });
});

describe('serialToIsoDate: the 1904 system', () => {
  it('counts from its own 1904-01-01 epoch, with no phantom day to absorb', () => {
    expect(serialToIsoDate(0, true)).toBe('1904-01-01');
    expect(serialToIsoDate(60, true)).toBe('1904-03-01');
  });

  it('sits exactly 1462 days ahead of the same calendar date in the 1900 system', () => {
    expect(serialToIsoDate(46234, false)).toBe(serialToIsoDate(46234 - 1462, true));
  });
});

describe('serialToIsoTime', () => {
  it('recovers a clean wall-clock time from the fifteen-significant-digit fraction a real producer stores', () => {
    // 0.604166666666667 * 86400000 is 52199999.999999 ms exactly -- rounding to the nearest millisecond is what makes this 14:30:00 rather than 14:29:59.
    expect(serialToIsoTime(0.604166666666667)).toBe('14:30:00');
  });

  it('always emits the canonical zero-padded 24-hour HH:MM:SS spelling, seconds included', () => {
    expect(serialToIsoTime(0)).toBe('00:00:00');
    expect(serialToIsoTime(0.5)).toBe('12:00:00');
    expect(serialToIsoTime(0.25 + 1 / 86400)).toBe('06:00:01');
  });

  it('renders only the fractional part, so a serial carrying whole days still reads as a time of day', () => {
    expect(serialToIsoTime(2.5)).toBe('12:00:00');
  });

  it('rolls a fraction that rounds up to a whole day back to midnight rather than emitting 24:00:00', () => {
    // 0.9999999999 of a day is 86399999.99136 ms, which rounds to a full 86400000; the neighbouring 0.99999999 rounds to 86399999 and stays inside the day.
    expect(serialToIsoTime(0.9999999999)).toBe('00:00:00');
    expect(serialToIsoTime(0.99999999)).toBe('23:59:59');
  });
});

describe('serialToIsoDateTime', () => {
  it('joins the two halves with the canonical T separator', () => {
    expect(serialToIsoDateTime(46234.60416666667, false)).toBe('2026-07-31T14:30:00');
  });

  it('carries the day roll-over from a fraction that rounds up to a whole day into the DATE half, not just the time', () => {
    expect(serialToIsoDateTime(46234.9999999999, false)).toBe('2026-08-01T00:00:00');
  });

  it('is undefined wherever its own date half is', () => {
    expect(serialToIsoDateTime(60.5, false)).toBeUndefined();
  });
});
