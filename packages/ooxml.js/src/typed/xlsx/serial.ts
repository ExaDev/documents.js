import type { Package } from '../../model/package';
import { attr, childrenWithTag, rootElement } from '../util';
import { readXmlBool } from './util';

// xlsx stores every date and time as a bare serial NUMBER in the cell's own <v> -- a day count plus a fraction-of-a-day -- with nothing in the cell itself saying it is temporal at all; that lives entirely in the number format its style points at (see typed/xlsx/number-format.ts). This module is the other half of turning one back into a real value: serial -> the canonical ISO spellings document-schema.js's own ContentCellValue doc comment fixes for its three temporal variants ('date' is YYYY-MM-DD, 'time' is a 24-hour zero-padded HH:MM:SS wall-clock time of day, 'dateTime' is YYYY-MM-DDTHH:MM:SS).
//
// Only the read direction exists here: typed/xlsx/build.ts writes a temporal cell through ST_CellType's own t="d" ISO-8601 variant rather than as a styled serial, so there is no caller for an ISO -> serial inverse and none is written.

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
    // The 1904 system is a plain day count from its own epoch, with serial 0 being 1904-01-01 -- no phantom leap day, since 1904 genuinely was a leap year and the count starts after February.
    return isoDateOfUtcMs(Date.UTC(1904, 0, 1) + days * MS_PER_DAY);
  }
  if (days === PHANTOM_LEAP_DAY_SERIAL) {
    return undefined;
  }
  // Below the phantom day the count is a true offset from 1899-12-31 (serial 1 = 1900-01-01); at and above it, every serial is one too high, which is expressed by moving the base back a day to 1899-12-30 (serial 61 = 1900-03-01) rather than by subtracting from the count.
  const baseUtcMs = days < PHANTOM_LEAP_DAY_SERIAL ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  return isoDateOfUtcMs(baseUtcMs + days * MS_PER_DAY);
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
