import type { Package } from '../../model/package';
import { attr, childrenWithTag, rootElement } from '../util';
import { readXmlBool } from './util';

// xlsx stores every date and time as a bare serial NUMBER in the cell's own <v> -- a day count plus a fraction-of-a-day -- with nothing in the cell itself saying it is temporal at all; that lives entirely in the number format its style points at (see typed/xlsx/number-format.ts). This module converts between one and the canonical ISO spellings document-schema.js's own ContentCellValue doc comment fixes for its three temporal variants ('date' is YYYY-MM-DD, 'time' is a 24-hour zero-padded HH:MM:SS wall-clock time of day, 'dateTime' is YYYY-MM-DDTHH:MM:SS), in both directions: serial -> ISO for typed/xlsx/content.ts's reader, ISO -> serial for typed/xlsx/build.ts's writer.

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1000;

const WORKBOOK_PATH = 'xl/workbook.xml';

// Which of the two epochs a workbook's serials are counted from: the 1900 system (the default, and what every mainstream producer writes -- this package's own kitchen-sink fixture carries an explicit date1904="false") or the 1904 system, historically the Macintosh Excel default and still legal to write. Getting this wrong shifts every date in the file by 1462 days, so it is read from the file rather than assumed.
export function readDate1904(pkg: Package): boolean {
  const workbook = rootElement(pkg.parts[WORKBOOK_PATH]);
  if (workbook === undefined) {
    return false;
  }
  const workbookPr = childrenWithTag(workbook, 'workbookPr')[0];
  return workbookPr !== undefined && readXmlBool(attr(workbookPr, 'date1904'));
}

// The serial the 1900 system reserves for a day that never existed: 1900-02-29. Lotus 1-2-3 treated 1900 as a leap year and Excel reproduced the bug for file compatibility, so serials at or above 61 are one day ahead of a true day count from 1899-12-31, and serial 60 itself denotes a date with no place on the calendar.
const PHANTOM_LEAP_DAY_SERIAL = 60;

// The three day-count origins, named once and shared by both directions below so a serial and its inverse can never be counted from different days. Below the phantom leap day the 1900 system is a true offset from 1899-12-31 (serial 1 = 1900-01-01); at and above it every serial is one too high, expressed by moving the origin back a day to 1899-12-30 (serial 61 = 1900-03-01) rather than by subtracting from the count. The 1904 system is a plain day count from its own epoch, with serial 0 being 1904-01-01 -- no phantom day, since 1904 genuinely was a leap year and the count starts after February.
const ORIGIN_1900_BELOW_PHANTOM_UTC_MS = Date.UTC(1899, 11, 31);
const ORIGIN_1900_ABOVE_PHANTOM_UTC_MS = Date.UTC(1899, 11, 30);
const ORIGIN_1904_UTC_MS = Date.UTC(1904, 0, 1);

interface SplitSerial {
  days: number;
  msWithinDay: number;
}

// Rounding the fractional part to the nearest millisecond is what recovers a clean wall-clock time from a serial a producer stored to fifteen significant digits (this package's own kitchen-sink fixture stores 14:30 as 0.604166666666667, whose exact product with 86400000 is 52199999.999999 ms). Rounding can legitimately reach a full day -- 0.9999999 rounds to 86400000 ms -- which rolls into the next day rather than producing an impossible 24:00:00.
function splitSerial(serial: number): SplitSerial {
  const days = Math.floor(serial);
  const msWithinDay = Math.round((serial - days) * MS_PER_DAY);
  return msWithinDay >= MS_PER_DAY ? { days: days + 1, msWithinDay: 0 } : { days, msWithinDay };
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

// Every calculation below is done in UTC deliberately: a serial carries no timezone, and using local-time Date methods would shift a date across a day boundary for any host west of Greenwich.
function isoDateOfUtcMs(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

// The day-count half of a serial, as a calendar date -- undefined when the serial names no real date, which the caller degrades to a plain number rather than emitting an invalid one. Two cases produce that: a negative serial (no date exists before either epoch), and serial 60 in the 1900 system (the phantom leap day above).
function isoDateOfDayCount(days: number, date1904: boolean): string | undefined {
  if (days < 0) {
    return undefined;
  }
  if (date1904) {
    return isoDateOfUtcMs(ORIGIN_1904_UTC_MS + days * MS_PER_DAY);
  }
  if (days === PHANTOM_LEAP_DAY_SERIAL) {
    return undefined;
  }
  const originUtcMs = days < PHANTOM_LEAP_DAY_SERIAL ? ORIGIN_1900_BELOW_PHANTOM_UTC_MS : ORIGIN_1900_ABOVE_PHANTOM_UTC_MS;
  return isoDateOfUtcMs(originUtcMs + days * MS_PER_DAY);
}

function isoTimeOfMsWithinDay(msWithinDay: number): string {
  const hours = Math.floor(msWithinDay / MS_PER_HOUR);
  const minutes = Math.floor((msWithinDay % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((msWithinDay % MS_PER_MINUTE) / MS_PER_SECOND);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}`;
}

export function serialToIsoDate(serial: number, date1904: boolean): string | undefined {
  return Number.isFinite(serial) ? isoDateOfDayCount(splitSerial(serial).days, date1904) : undefined;
}

// A time-of-day format renders only the fractional part -- a serial of 2.5 under `h:mm` displays as noon, not as "two days and twelve hours" -- so the day count is discarded here rather than made an error. Sub-second precision is discarded too: ContentCellValue's own 'time' spelling is fixed at HH:MM:SS with no fractional-seconds part.
export function serialToIsoTime(serial: number): string | undefined {
  return Number.isFinite(serial) && serial >= 0 ? isoTimeOfMsWithinDay(splitSerial(serial).msWithinDay) : undefined;
}

export function serialToIsoDateTime(serial: number, date1904: boolean): string | undefined {
  if (!Number.isFinite(serial)) {
    return undefined;
  }
  const { days, msWithinDay } = splitSerial(serial);
  const date = isoDateOfDayCount(days, date1904);
  return date === undefined ? undefined : `${date}T${isoTimeOfMsWithinDay(msWithinDay)}`;
}

// --- ISO -> serial: the write direction ---------------------------------------------------------------------------
//
// The exact inverses of the three functions above, and what lets typed/xlsx/build.ts write a temporal cell the way every mainstream producer does -- a real numeric serial displayed through a date/time number format -- rather than through ST_CellType's own rare t="d" ISO-8601 variant, which real Excel does not render as a date and which collapses xlsx's three ContentCellValue temporal kinds onto one indistinguishable wire form.
//
// Only the 1900 system is inverted: buildXlsxPackageFromContent writes no <workbookPr> at all, so every workbook it produces is a 1900-system one (CT_WorkbookPr/@date1904's own schema default is false, which readDate1904 above reads back) -- a 1904 inverse would have no caller to write for.
//
// Each returns undefined for anything that is not the exact canonical ContentCellValue spelling, and for any spelling that names a moment with no serial (a date before the epoch, an hour past 23, an impossible calendar day). buildXlsxPackageFromContent degrades such a cell to a plain text cell carrying the original string verbatim rather than fabricating a serial for it.

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIME_PATTERN = /^(\d{2}):(\d{2}):(\d{2})$/;

// The 'T' of the canonical 'YYYY-MM-DDTHH:MM:SS' dateTime spelling, which isoDateTimeToSerial splits on rather than matching with a pattern of its own, so the date and time halves are validated by exactly the same two functions a bare date and a bare time go through.
const ISO_DATE_TIME_SEPARATOR = 'T';

// Date.UTC silently ROLLS OVER an out-of-range component (month 13 becomes January of the next year, February 30th becomes March 1st or 2nd), so the only way to reject an impossible calendar date is to read the resulting instant's own components back and require every one of them still to match what was asked for. This also rejects a two-digit-year interpretation for a year below 100 (Date.UTC(50, ...) means 1950), which has no serial in either epoch anyway.
function utcMsOfCalendarDate(year: number, month: number, day: number): number | undefined {
  const utcMs = Date.UTC(year, month - 1, day);
  const date = new Date(utcMs);
  const matches = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return matches ? utcMs : undefined;
}

// The day-count half of isoDateOfDayCount inverted: try the above-the-phantom-day origin first and keep its answer when it genuinely lands above that day, otherwise recount from the below-the-phantom-day origin. A count below 0 is a date before the epoch, which has no serial at all -- exactly the range isoDateOfDayCount refuses to read back.
function dayCountOfUtcMs(utcMs: number): number | undefined {
  const abovePhantom = (utcMs - ORIGIN_1900_ABOVE_PHANTOM_UTC_MS) / MS_PER_DAY;
  if (abovePhantom > PHANTOM_LEAP_DAY_SERIAL) {
    return abovePhantom;
  }
  const belowPhantom = (utcMs - ORIGIN_1900_BELOW_PHANTOM_UTC_MS) / MS_PER_DAY;
  return belowPhantom >= 0 ? belowPhantom : undefined;
}

export function isoDateToSerial(iso: string): number | undefined {
  const match = ISO_DATE_PATTERN.exec(iso);
  if (match === null) {
    return undefined;
  }
  const [, year, month, day] = match;
  if (year === undefined || month === undefined || day === undefined) {
    return undefined;
  }
  const utcMs = utcMsOfCalendarDate(Number.parseInt(year, 10), Number.parseInt(month, 10), Number.parseInt(day, 10));
  return utcMs === undefined ? undefined : dayCountOfUtcMs(utcMs);
}

// A time of day is the FRACTIONAL part of a serial and nothing else -- a whole day count of 0 -- matching serialToIsoTime's own reading, which discards the day count a serial happens to carry.
export function isoTimeToSerial(iso: string): number | undefined {
  const match = ISO_TIME_PATTERN.exec(iso);
  if (match === null) {
    return undefined;
  }
  const [, hours, minutes, seconds] = match;
  if (hours === undefined || minutes === undefined || seconds === undefined) {
    return undefined;
  }
  const hourCount = Number.parseInt(hours, 10);
  const minuteCount = Number.parseInt(minutes, 10);
  const secondCount = Number.parseInt(seconds, 10);
  // A wall-clock time of day, not a duration: 24:00:00 and 26:30:00 are both legal ELAPSED times but neither is a time of day, and ContentCellValue's own 'time' variant is documented as the latter.
  if (hourCount > 23 || minuteCount > 59 || secondCount > 59) {
    return undefined;
  }
  return (hourCount * MS_PER_HOUR + minuteCount * MS_PER_MINUTE + secondCount * MS_PER_SECOND) / MS_PER_DAY;
}

export function isoDateTimeToSerial(iso: string): number | undefined {
  const separatorIndex = iso.indexOf(ISO_DATE_TIME_SEPARATOR);
  if (separatorIndex === -1) {
    return undefined;
  }
  const days = isoDateToSerial(iso.slice(0, separatorIndex));
  const fractionOfDay = isoTimeToSerial(iso.slice(separatorIndex + 1));
  return days === undefined || fractionOfDay === undefined ? undefined : days + fractionOfDay;
}
