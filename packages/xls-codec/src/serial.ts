// BIFF8 stores every date and time as a bare serial number -- a day count plus a fraction of a day -- with nothing in the cell itself saying it is temporal at all; that lives entirely in the number format its XF points at (see number-format.ts). This module converts one into the canonical ISO spellings document-schema.js's own ContentCellValue fixes for its three temporal variants: 'date' is YYYY-MM-DD, 'time' is a 24-hour zero-padded HH:MM:SS wall-clock time of day, and 'dateTime' is YYYY-MM-DDTHH:MM:SS -- and, since the writer added in xls-codec#815, the other direction as well: isoDateToSerial/isoTimeToSerial/isoDateTimeToSerial turn one of those ISO strings back into the serial a Number record carries.
//
// Which epoch a workbook's serials count from is read from the file's own Date1904 record ([MS-XLS] 2.4.77) rather than assumed: getting it wrong shifts every date in the workbook by 1462 days. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/4a5e900a-0eb0-4355-8fc1-81aab8f46e8b The writer always emits the 1900 system and never writes a Date1904 record: that is this reader's own default when the record is absent, so a workbook this package writes and reads back agrees with itself without needing to state the epoch explicitly.

import { BiffWriteError } from "./biff/write-errors";

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1000;

/** The serial the 1900 system reserves for a day that never existed: 1900-02-29. Lotus 1-2-3 treated 1900 as a leap year and Excel reproduced the bug for file compatibility, so serials at or above 61 are one day ahead of a true day count from 1899-12-31, and serial 60 itself denotes a date with no place on the calendar. */
const PHANTOM_LEAP_DAY_SERIAL = 60;

/** The three day-count origins, named once so a serial and its parts can never be counted from different days. Below the phantom leap day the 1900 system is a true offset from 1899-12-31 (serial 1 = 1900-01-01); at and above it every serial is one too high, expressed by moving the origin back a day rather than by subtracting from the count. The 1904 system is a plain day count from its own epoch, with serial 0 being 1904-01-01 -- no phantom day, since 1904 genuinely was a leap year and the count starts after February. */
const ORIGIN_1900_BELOW_PHANTOM_UTC_MS = Date.UTC(1899, 11, 31);
const ORIGIN_1900_ABOVE_PHANTOM_UTC_MS = Date.UTC(1899, 11, 30);
const ORIGIN_1904_UTC_MS = Date.UTC(1904, 0, 1);

interface SplitSerial {
  days: number;
  msWithinDay: number;
}

/** Rounding the fractional part to the nearest millisecond is what recovers a clean wall-clock time from a serial a producer stored to fifteen significant digits (14:30 is commonly stored as 0.604166666666667, whose exact product with 86400000 is 52199999.999999 ms). Rounding can legitimately reach a full day -- 0.9999999 rounds to 86400000 ms -- which rolls into the next day rather than producing an impossible 24:00:00. */
function splitSerial(serial: number): SplitSerial {
  const days = Math.floor(serial);
  const msWithinDay = Math.round((serial - days) * MS_PER_DAY);
  return msWithinDay >= MS_PER_DAY
    ? { days: days + 1, msWithinDay: 0 }
    : { days, msWithinDay };
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

/** Every calculation is done in UTC deliberately: a serial carries no timezone, and local-time Date methods would shift a date across a day boundary for any host west of Greenwich. */
function isoDateOfUtcMs(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/** The day-count half of a serial, as a calendar date -- undefined when the serial names no real date, which the caller degrades to a plain number rather than emitting an invalid one. Two cases produce that: a negative serial (no date exists before either epoch), and serial 60 in the 1900 system (the phantom leap day). */
function isoDateOfDayCount(
  days: number,
  date1904: boolean,
): string | undefined {
  if (days < 0) {
    return undefined;
  }
  if (date1904) {
    return isoDateOfUtcMs(ORIGIN_1904_UTC_MS + days * MS_PER_DAY);
  }
  if (days === PHANTOM_LEAP_DAY_SERIAL) {
    return undefined;
  }
  const originUtcMs =
    days < PHANTOM_LEAP_DAY_SERIAL
      ? ORIGIN_1900_BELOW_PHANTOM_UTC_MS
      : ORIGIN_1900_ABOVE_PHANTOM_UTC_MS;
  return isoDateOfUtcMs(originUtcMs + days * MS_PER_DAY);
}

function isoTimeOfMsWithinDay(msWithinDay: number): string {
  const hours = Math.floor(msWithinDay / MS_PER_HOUR);
  const minutes = Math.floor((msWithinDay % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((msWithinDay % MS_PER_MINUTE) / MS_PER_SECOND);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}`;
}

export function serialToIsoDate(
  serial: number,
  date1904: boolean,
): string | undefined {
  return Number.isFinite(serial)
    ? isoDateOfDayCount(splitSerial(serial).days, date1904)
    : undefined;
}

/** A time-of-day format renders only the fractional part -- a serial of 2.5 under `h:mm` displays as noon, not as "two days and twelve hours" -- so the day count is discarded here rather than made an error. Sub-second precision is discarded too: ContentCellValue's own 'time' spelling is fixed at HH:MM:SS. */
export function serialToIsoTime(serial: number): string | undefined {
  return Number.isFinite(serial) && serial >= 0
    ? isoTimeOfMsWithinDay(splitSerial(serial).msWithinDay)
    : undefined;
}

export function serialToIsoDateTime(
  serial: number,
  date1904: boolean,
): string | undefined {
  if (!Number.isFinite(serial)) {
    return undefined;
  }
  const { days, msWithinDay } = splitSerial(serial);
  const date = isoDateOfDayCount(days, date1904);
  return date === undefined
    ? undefined
    : `${date}T${isoTimeOfMsWithinDay(msWithinDay)}`;
}

// --- The write direction: an ISO string back to the serial a Number record carries. ---

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIME_PATTERN = /^(\d{2}):(\d{2}):(\d{2})$/;

/** The calendar day count a real date maps to, inverting isoDateOfDayCount: below the 1900 system's phantom leap day (1900-02-29) the day count is a plain offset from 1899-12-31; on or after it, one day is added to skip over the phantom date the calendar never had. The date1904 system has no such adjustment -- 1904 genuinely was a leap year, so its serial 0 origin needs no correction. */
function isoDateToDayCount(isoDate: string, date1904: boolean): number {
  const match = ISO_DATE_PATTERN.exec(isoDate);
  if (match === null) {
    throw new BiffWriteError(
      `date value ${JSON.stringify(isoDate)} is not an ISO 8601 calendar date (YYYY-MM-DD), which is the only spelling document-schema.js's 'date' cell value permits`,
    );
  }
  const [, year, month, day] = match;
  const utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (date1904) {
    return Math.round((utcMs - ORIGIN_1904_UTC_MS) / MS_PER_DAY);
  }
  const daysBelowPhantom = Math.round(
    (utcMs - ORIGIN_1900_BELOW_PHANTOM_UTC_MS) / MS_PER_DAY,
  );
  const days =
    daysBelowPhantom < PHANTOM_LEAP_DAY_SERIAL
      ? daysBelowPhantom
      : daysBelowPhantom + 1;
  if (days < 0) {
    // date1904 is always false here: the true branch above already returned. 1899-12-31 is therefore the only epoch this throw can ever be describing.
    throw new BiffWriteError(
      `date value ${JSON.stringify(isoDate)} is before the epoch a BIFF8 serial can represent (1899-12-31)`,
    );
  }
  return days;
}

/** The fraction-of-a-day a wall-clock time maps to, inverting isoTimeOfMsWithinDay. Exact for any whole-second HH:MM:SS input, which is the only shape document-schema.js's 'time'/'dateTime' cell values permit. */
function isoTimeToDayFraction(isoTime: string): number {
  const match = ISO_TIME_PATTERN.exec(isoTime);
  if (match === null) {
    throw new BiffWriteError(
      `time value ${JSON.stringify(isoTime)} is not an ISO 8601 wall-clock time (HH:MM:SS), which is the only spelling document-schema.js's 'time'/'dateTime' cell values permit`,
    );
  }
  const [, hours, minutes, seconds] = match;
  const msWithinDay =
    Number(hours) * MS_PER_HOUR +
    Number(minutes) * MS_PER_MINUTE +
    Number(seconds) * MS_PER_SECOND;
  return msWithinDay / MS_PER_DAY;
}

export function isoDateToSerial(isoDate: string, date1904: boolean): number {
  return isoDateToDayCount(isoDate, date1904);
}

export function isoTimeToSerial(isoTime: string): number {
  return isoTimeToDayFraction(isoTime);
}

/**
 * A combined ISO date-time back to its serial. Accepts a trailing fractional-seconds part and/or a 'Z'/offset suffix -- document-schema.js's own wire contract permits both when the source genuinely carried one -- but a BIFF8 serial has no timezone concept at all (see the read direction's own comment above), so any offset is dropped rather than applied: the wall-clock digits are taken as written, exactly as they would be typed into Excel directly.
 */
export function isoDateTimeToSerial(
  isoDateTime: string,
  date1904: boolean,
): number {
  const separatorIndex = isoDateTime.indexOf("T");
  if (separatorIndex !== 10) {
    throw new BiffWriteError(
      `dateTime value ${JSON.stringify(isoDateTime)} is not an ISO 8601 combined date and time (YYYY-MM-DDTHH:MM:SS), which is the only spelling document-schema.js's 'dateTime' cell value permits`,
    );
  }
  const datePart = isoDateTime.slice(0, separatorIndex);
  const timeRemainder = isoDateTime.slice(separatorIndex + 1);
  // Drop a trailing offset ('Z', or '+HH:MM'/'-HH:MM' after the time-of-day digits) and any fractional-seconds part, keeping only the HH:MM:SS the ISO_TIME_PATTERN above expects.
  const timePart = timeRemainder.slice(0, 8);
  return isoDateToDayCount(datePart, date1904) + isoTimeToDayFraction(timePart);
}
