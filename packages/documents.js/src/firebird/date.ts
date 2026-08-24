// Firebird's own DATE/TIME wire encoding -- unlike the gbak backup framing itself (Gotchas: no ratified spec), this part genuinely IS documented Firebird public API behaviour (ISC_DATE/ISC_TIME), and is additionally cross-checked here against the actual open-source engine implementation (src/common/classes/NoThrowTimeStamp.cpp's decode_date/decode_time) rather than taken purely from memory. A SQL DATE is a signed 32-bit day count with day 0 = 17 November 1858 (the Modified Julian Date epoch Firebird/InterBase has always used); a SQL TIME is an unsigned 32-bit count of 1/10000-second ticks since midnight (ISC_TIME_SECONDS_PRECISION, confirmed at src/common/classes/NoThrowTimeStamp.h:74 -- `#define ISC_TIME_SECONDS_PRECISION 10000`).

const ISC_TIME_SECONDS_PRECISION = 10000;

// The exact integer algorithm from NoThrowTimeStamp::decode_date, restated in TypeScript -- not reimplemented from a generic Julian-day formula, since the two magic constants (1721119, 2400001) are specific to Firebird's own MJD-based epoch and this reader's own testing is against Firebird's real output, not a general calendar library.
export function decodeFirebirdDate(days: number): {
  year: number;
  month: number;
  day: number;
} {
  let nday = days + 2400001 - 1721119;
  const century = Math.floor((4 * nday - 1) / 146097);
  nday = 4 * nday - 1 - 146097 * century;
  let day = Math.floor(nday / 4);

  nday = Math.floor((4 * day + 3) / 1461);
  day = 4 * day + 3 - 1461 * nday;
  day = Math.floor((day + 4) / 4);

  let month = Math.floor((5 * day - 3) / 153);
  day = 5 * day - 3 - 153 * month;
  day = Math.floor((day + 5) / 5);

  let year = 100 * century + nday;

  if (month < 10) {
    month += 3;
  } else {
    month -= 9;
    year += 1;
  }

  return { year, month, day };
}

export function decodeFirebirdTime(ticks: number): {
  hours: number;
  minutes: number;
  seconds: number;
  fractions: number;
} {
  let remaining = ticks;
  const hours = Math.floor(remaining / (3600 * ISC_TIME_SECONDS_PRECISION));
  remaining %= 3600 * ISC_TIME_SECONDS_PRECISION;
  const minutes = Math.floor(remaining / (60 * ISC_TIME_SECONDS_PRECISION));
  remaining %= 60 * ISC_TIME_SECONDS_PRECISION;
  const seconds = Math.floor(remaining / ISC_TIME_SECONDS_PRECISION);
  const fractions = remaining % ISC_TIME_SECONDS_PRECISION;
  return { hours, minutes, seconds, fractions };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad4(value: number): string {
  return String(value).padStart(4, "0");
}

// Matches this package's own ContentCellValue 'date' kind's string convention (src/hsqldb/script.ts's own DATE/TIMESTAMP literal handling): an ISO-shaped "YYYY-MM-DD" (or "YYYY-MM-DD HH:MM:SS[.fff]" for a timestamp), never a Date object or epoch number -- ContentCellValue's date/time kinds are both plain strings.
export function formatFirebirdDate(days: number): string {
  const { year, month, day } = decodeFirebirdDate(days);
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

export function formatFirebirdTime(ticks: number): string {
  const { hours, minutes, seconds, fractions } = decodeFirebirdTime(ticks);
  const millis = Math.round(fractions / 10);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${String(millis).padStart(3, "0")}`;
}

export function formatFirebirdTimestamp(days: number, ticks: number): string {
  return `${formatFirebirdDate(days)} ${formatFirebirdTime(ticks)}`;
}
