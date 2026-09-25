// Firebird's own DATE/TIME wire encoding — unlike the gbak backup framing itself (Gotchas: no ratified spec), this part genuinely IS documented Firebird public API behaviour (ISC_DATE/ISC_TIME), and is additionally cross-checked here against the actual open-source engine implementation (src/common/classes/NoThrowTimeStamp.cpp's decode_date/decode_time) rather than taken purely from memory. A SQL DATE is a signed 32-bit day count with day 0 = 17 November 1858 (the Modified Julian Date epoch Firebird/InterBase has always used); a SQL TIME is an unsigned 32-bit count of 1/10000-second ticks since midnight (ISC_TIME_SECONDS_PRECISION, confirmed at src/common/classes/NoThrowTimeStamp.h:74 — `#define ISC_TIME_SECONDS_PRECISION 10000`).

const ISC_TIME_SECONDS_PRECISION = 10000;

// The two epoch-adjustment constants NoThrowTimeStamp::decode_date restates: converting this reader's own input day count to Firebird's own MJD-based day 0 (17 November 1858), then to the Julian Day Number the algorithm below is expressed in terms of.
const FIREBIRD_MJD_EPOCH_OFFSET = 2400001;
const JULIAN_DAY_CIVIL_EPOCH_OFFSET = 1721119;

// This algorithm groups days into 400-year cycles, DAYS_PER_400_YEARS, since 400 Gregorian years is 400*365 + 97 leap days, then 4-year cycles within a century, DAYS_PER_4_YEARS, since 4 years is 4*365 + 1 leap day, then "civil month" groups of 5 months starting in March, DAYS_PER_5_MONTHS_FROM_MARCH, since March through July always totals 153 days regardless of leap year, as neither month is ever February. The March-based re-indexing is why the final month/year adjustment below shifts the two winter months into the following calendar year.
const DAYS_PER_400_YEARS = 146097;
const DAYS_PER_4_YEARS = 1461;
const DAYS_PER_5_MONTHS_FROM_MARCH = 153;

// Each cycle step above uses the same "multiply by the cycle's own inner scale, add a rounding term, floor-divide by the cycle length expressed in that scale" trick to extract a whole cycle index without an intermediate fraction. QUAD_* belongs to the 400-year and 4-year steps, both scaled by 4; QUINT_* belongs to the 5-month step, scaled by 5. The two rounding terms happen to share a value, 3, but are named separately since they round different quantities.
const QUAD_SCALE = 4;
const QUAD_ROUND = 3;
const QUINT_SCALE = 5;
const QUINT_ROUND = 3;
const CENTURY_TO_YEAR_SCALE = 100;

// Civil months are numbered 0 (March) through 9 (December), then 10 (January) and 11 (February) of the following calendar year, so a civil month at or beyond MARCH_BASED_MONTH_COUNT has already rolled into the next calendar year. MARCH_MONTH_OFFSET converts civil month 0 (March) to calendar month 3; JANUARY_MONTH_OFFSET converts civil month 10 (January) to calendar month 1, which is 10 minus 9.
const MARCH_BASED_MONTH_COUNT = 10;
const MARCH_MONTH_OFFSET = 3;
const JANUARY_MONTH_OFFSET = 9;

// The exact integer algorithm from NoThrowTimeStamp::decode_date, restated in TypeScript. Not reimplemented from a generic Julian-day formula, since the two epoch-adjustment constants above are specific to Firebird's own MJD-based epoch and this reader's own testing is against Firebird's real output, not a general calendar library.
export function decodeFirebirdDate(days: number): {
  year: number;
  month: number;
  day: number;
} {
  let nday = days + FIREBIRD_MJD_EPOCH_OFFSET - JULIAN_DAY_CIVIL_EPOCH_OFFSET;
  const century = Math.floor((QUAD_SCALE * nday - 1) / DAYS_PER_400_YEARS);
  nday = QUAD_SCALE * nday - 1 - DAYS_PER_400_YEARS * century;
  let day = Math.floor(nday / QUAD_SCALE);

  nday = Math.floor((QUAD_SCALE * day + QUAD_ROUND) / DAYS_PER_4_YEARS);
  day = QUAD_SCALE * day + QUAD_ROUND - DAYS_PER_4_YEARS * nday;
  day = Math.floor((day + QUAD_SCALE) / QUAD_SCALE);

  let month = Math.floor(
    (QUINT_SCALE * day - QUINT_ROUND) / DAYS_PER_5_MONTHS_FROM_MARCH,
  );
  day = QUINT_SCALE * day - QUINT_ROUND - DAYS_PER_5_MONTHS_FROM_MARCH * month;
  day = Math.floor((day + QUINT_SCALE) / QUINT_SCALE);

  let year = CENTURY_TO_YEAR_SCALE * century + nday;

  if (month < MARCH_BASED_MONTH_COUNT) {
    month += MARCH_MONTH_OFFSET;
  } else {
    month -= JANUARY_MONTH_OFFSET;
    year += 1;
  }

  return { year, month, day };
}

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

export function decodeFirebirdTime(ticks: number): {
  hours: number;
  minutes: number;
  seconds: number;
  fractions: number;
} {
  let remaining = ticks;
  const hours = Math.floor(
    remaining / (SECONDS_PER_HOUR * ISC_TIME_SECONDS_PRECISION),
  );
  remaining %= SECONDS_PER_HOUR * ISC_TIME_SECONDS_PRECISION;
  const minutes = Math.floor(
    remaining / (SECONDS_PER_MINUTE * ISC_TIME_SECONDS_PRECISION),
  );
  remaining %= SECONDS_PER_MINUTE * ISC_TIME_SECONDS_PRECISION;
  const seconds = Math.floor(remaining / ISC_TIME_SECONDS_PRECISION);
  const fractions = remaining % ISC_TIME_SECONDS_PRECISION;
  return { hours, minutes, seconds, fractions };
}

const CLOCK_DIGIT_WIDTH = 2;
const YEAR_DIGIT_WIDTH = 4;
const MILLIS_DIGIT_WIDTH = 3;
// ISC_TIME_SECONDS_PRECISION (10000) ticks per second, divided by 1000 milliseconds per second.
const TICKS_PER_MILLISECOND = 10;

function pad2(value: number): string {
  return String(value).padStart(CLOCK_DIGIT_WIDTH, "0");
}

function pad4(value: number): string {
  return String(value).padStart(YEAR_DIGIT_WIDTH, "0");
}

// Matches this package's own ContentCellValue 'date' kind's string convention (src/hsqldb/script.ts's own DATE/TIMESTAMP literal handling): an ISO-shaped "YYYY-MM-DD" (or "YYYY-MM-DD HH:MM:SS[.fff]" for a timestamp), never a Date object or epoch number — ContentCellValue's date/time kinds are both plain strings.
export function formatFirebirdDate(days: number): string {
  const { year, month, day } = decodeFirebirdDate(days);
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

export function formatFirebirdTime(ticks: number): string {
  const { hours, minutes, seconds, fractions } = decodeFirebirdTime(ticks);
  const millis = Math.round(fractions / TICKS_PER_MILLISECOND);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${String(millis).padStart(MILLIS_DIGIT_WIDTH, "0")}`;
}

export function formatFirebirdTimestamp(days: number, ticks: number): string {
  return `${formatFirebirdDate(days)} ${formatFirebirdTime(ticks)}`;
}
