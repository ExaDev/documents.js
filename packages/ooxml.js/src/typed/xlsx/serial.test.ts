import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import { el } from "../../xml/fragment";
import {
  isoDateTimeToSerial,
  isoDateToSerial,
  isoTimeToSerial,
  readDate1904,
  serialToIsoDate,
  serialToIsoDateTime,
  serialToIsoTime,
  utcMsOfCalendarDate,
} from "./serial";

function workbookPackage(workbookPr?: ReturnType<typeof el>): Package {
  const children = workbookPr === undefined ? [] : [workbookPr];
  return {
    parts: {
      "xl/workbook.xml": { kind: "xml", nodes: [el("workbook", {}, children)] },
    },
  };
}

// The 1900-system serial this package's own kitchen-sink fixture (see the read/write round-trip integration tests) stores for its Due Date cell, resolving to 2026-07-31. Reused across many of the tests below so a fixture value and its own assertion never drift independently of one another.
const FIXTURE_DUE_DATE_SERIAL = 46234;
// Excel's own 1900-system leap-year bug, per the module under test: 1900 was never a leap year, but Lotus 1-2-3 (which Excel's serial system originates from) treated it as one, so serial 60 names a 1900-02-29 that never existed. Named identically to serial.ts's own (unexported) local constant of the same meaning, since this test file independently re-verifies the same boundary rather than importing it.
const PHANTOM_LEAP_DAY_SERIAL = 60;
const DAY_BEFORE_PHANTOM_LEAP_DAY_SERIAL = 59; // 1900-02-28, the last real day before the phantom leap day
const DAY_AFTER_PHANTOM_LEAP_DAY_SERIAL = 61; // 1900-03-01, the day the 1900 system resumes counting real days from, having absorbed the phantom one
// The fixed offset between the 1900 and 1904 epoch systems: 1904-01-01 (the 1904 system's own epoch) is this many days after 1899-12-31 (the 1900 system's own epoch, serial 0), once the phantom leap day above is accounted for.
const DAYS_BETWEEN_1900_AND_1904_EPOCHS = 1462;
const NOON_FRACTION = 0.5; // half a day: the fraction-of-a-day serial for 12:00:00
const SIX_AM_FRACTION = 0.25; // a quarter of a day: the fraction-of-a-day serial for 06:00:00
const SECONDS_PER_DAY = 86400;
// The 1900-system serial for 1970-01-01 (the Unix epoch), a well-known Excel constant independent of anything this module computes, used here purely as an arbitrary large real-world round-trip sample.
const UNIX_EPOCH_SERIAL_1900_SYSTEM = 25569;

describe("readDate1904", () => {
  it('reads the 1900 system from a real date1904="false" attribute (what every mainstream producer writes)', () => {
    expect(
      readDate1904(workbookPackage(el("workbookPr", { date1904: "false" }))),
    ).toBe(false);
  });

  it("reads the 1904 system from both spec-legal spellings of an xsd:boolean true", () => {
    expect(
      readDate1904(workbookPackage(el("workbookPr", { date1904: "true" }))),
    ).toBe(true);
    expect(
      readDate1904(workbookPackage(el("workbookPr", { date1904: "1" }))),
    ).toBe(true);
  });

  it("defaults to the 1900 system when there is no workbookPr, no attribute, or no workbook part at all", () => {
    expect(readDate1904(workbookPackage())).toBe(false);
    expect(readDate1904(workbookPackage(el("workbookPr", {})))).toBe(false);
    expect(readDate1904({ parts: {} })).toBe(false);
  });
});

describe("serialToIsoDate: the 1900 system and its Lotus phantom leap day", () => {
  it("converts the real serial this package's own kitchen-sink fixture stores for its Due Date cell", () => {
    expect(serialToIsoDate(FIXTURE_DUE_DATE_SERIAL, false)).toBe("2026-07-31");
  });

  it("counts from 1899-12-31 below the phantom day, so serial 1 is 1900-01-01 and serial 59 is 1900-02-28", () => {
    expect(serialToIsoDate(1, false)).toBe("1900-01-01");
    expect(serialToIsoDate(DAY_BEFORE_PHANTOM_LEAP_DAY_SERIAL, false)).toBe(
      "1900-02-28",
    );
  });

  it("counts from 1899-12-30 above it, absorbing the phantom day, so serial 61 is 1900-03-01", () => {
    expect(serialToIsoDate(DAY_AFTER_PHANTOM_LEAP_DAY_SERIAL, false)).toBe(
      "1900-03-01",
    );
  });

  it("refuses serial 60 outright, since 1900-02-29 never existed and an invalid ISO date is worse than degrading to the number", () => {
    expect(serialToIsoDate(PHANTOM_LEAP_DAY_SERIAL, false)).toBeUndefined();
    // The same phantom serial with a time-of-day fraction attached: still refused, since the date half alone is already invalid.
    const PHANTOM_LEAP_DAY_SERIAL_WITH_FRACTION = 60.75;
    expect(
      serialToIsoDate(PHANTOM_LEAP_DAY_SERIAL_WITH_FRACTION, false),
    ).toBeUndefined();
  });

  it("refuses a negative serial, which names no date under either epoch", () => {
    expect(serialToIsoDate(-1, false)).toBeUndefined();
    expect(serialToIsoDate(-1, true)).toBeUndefined();
  });

  it("discards the time-of-day fraction, keeping the day the serial falls on", () => {
    // The fixture's own Due Date serial with an arbitrary time-of-day fraction attached, to prove the date half alone still resolves correctly.
    const FIXTURE_DUE_DATE_SERIAL_WITH_TIME_FRACTION = 46234.9;
    expect(
      serialToIsoDate(FIXTURE_DUE_DATE_SERIAL_WITH_TIME_FRACTION, false),
    ).toBe("2026-07-31");
  });
});

describe("serialToIsoDate: the 1904 system", () => {
  it("counts from its own 1904-01-01 epoch, with no phantom day to absorb", () => {
    expect(serialToIsoDate(0, true)).toBe("1904-01-01");
    // The same numeric value as PHANTOM_LEAP_DAY_SERIAL above, but with no special meaning in the 1904 system: it is simply 60 real, uninterrupted days after the 1904-01-01 epoch.
    const SIXTY_DAYS_AFTER_1904_EPOCH = 60;
    expect(serialToIsoDate(SIXTY_DAYS_AFTER_1904_EPOCH, true)).toBe(
      "1904-03-01",
    );
  });

  it("sits exactly 1462 days ahead of the same calendar date in the 1900 system", () => {
    expect(serialToIsoDate(FIXTURE_DUE_DATE_SERIAL, false)).toBe(
      serialToIsoDate(
        FIXTURE_DUE_DATE_SERIAL - DAYS_BETWEEN_1900_AND_1904_EPOCHS,
        true,
      ),
    );
  });
});

describe("serialToIsoTime", () => {
  it("recovers a clean wall-clock time from the fifteen-significant-digit fraction a real producer stores", () => {
    // A real producer's own fifteen-significant-digit fraction for 14:30:00. 0.604166666666667 * 86400000 is 52199999.999999 ms exactly, and rounding to the nearest millisecond is what makes this 14:30:00 rather than 14:29:59.
    const FOURTEEN_THIRTY_FRACTION = 0.604166666666667;
    expect(serialToIsoTime(FOURTEEN_THIRTY_FRACTION)).toBe("14:30:00");
  });

  it("always emits the canonical zero-padded 24-hour HH:MM:SS spelling, seconds included", () => {
    expect(serialToIsoTime(0)).toBe("00:00:00");
    expect(serialToIsoTime(NOON_FRACTION)).toBe("12:00:00");
    expect(serialToIsoTime(SIX_AM_FRACTION + 1 / SECONDS_PER_DAY)).toBe(
      "06:00:01",
    );
  });

  it("renders only the fractional part, so a serial carrying whole days still reads as a time of day", () => {
    // Two whole days plus NOON_FRACTION: the whole-day part must be discarded, leaving only the time.
    const TWO_WHOLE_DAYS_PLUS_NOON = 2.5;
    expect(serialToIsoTime(TWO_WHOLE_DAYS_PLUS_NOON)).toBe("12:00:00");
  });

  it("rolls a fraction that rounds up to a whole day back to midnight rather than emitting 24:00:00", () => {
    // 0.9999999999 of a day is 86399999.99136 ms, which rounds to a full 86400000. The neighbouring, slightly smaller fraction rounds to 86399999 ms and stays inside the day.
    const ROUNDS_UP_TO_MIDNIGHT_FRACTION = 0.9999999999;
    const STAYS_JUST_BEFORE_MIDNIGHT_FRACTION = 0.99999999;
    expect(serialToIsoTime(ROUNDS_UP_TO_MIDNIGHT_FRACTION)).toBe("00:00:00");
    expect(serialToIsoTime(STAYS_JUST_BEFORE_MIDNIGHT_FRACTION)).toBe(
      "23:59:59",
    );
  });

  it("is undefined for a non-finite serial", () => {
    expect(serialToIsoTime(Number.NaN)).toBeUndefined();
    expect(serialToIsoTime(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("is undefined for a negative serial, which has no time-of-day fraction to render", () => {
    expect(serialToIsoTime(-NOON_FRACTION)).toBeUndefined();
  });
});

describe("serialToIsoDateTime", () => {
  it("joins the two halves with the canonical T separator", () => {
    // The fixture's own Due Date serial with a 14:30:00 time-of-day fraction attached.
    const FIXTURE_DUE_DATE_SERIAL_WITH_1430_TIME = 46234.60416666667;
    expect(
      serialToIsoDateTime(FIXTURE_DUE_DATE_SERIAL_WITH_1430_TIME, false),
    ).toBe("2026-07-31T14:30:00");
  });

  it("carries the day roll-over from a fraction that rounds up to a whole day into the DATE half, not just the time", () => {
    // The fixture's own Due Date serial with a fraction just below a whole day, which rounds up to midnight of the NEXT day.
    const FIXTURE_DUE_DATE_SERIAL_ROLLING_TO_NEXT_DAY = 46234.9999999999;
    expect(
      serialToIsoDateTime(FIXTURE_DUE_DATE_SERIAL_ROLLING_TO_NEXT_DAY, false),
    ).toBe("2026-08-01T00:00:00");
  });

  it("is undefined wherever its own date half is", () => {
    // The phantom leap day serial with a time-of-day fraction attached: the date half alone is already invalid, so the whole thing is undefined regardless of the time.
    const PHANTOM_LEAP_DAY_SERIAL_WITH_TIME = 60.5;
    expect(
      serialToIsoDateTime(PHANTOM_LEAP_DAY_SERIAL_WITH_TIME, false),
    ).toBeUndefined();
  });

  it("is undefined for a non-finite serial", () => {
    expect(serialToIsoDateTime(Number.NaN, false)).toBeUndefined();
  });
});

describe("isoDateToSerial: the exact inverse of serialToIsoDate, 1900 system", () => {
  it("converts the real ISO date this package's own kitchen-sink fixture stores as serial 46234", () => {
    expect(isoDateToSerial("2026-07-31")).toBe(FIXTURE_DUE_DATE_SERIAL);
  });

  it("inverts both sides of the phantom leap day, counting from 1899-12-31 below it and 1899-12-30 above it", () => {
    expect(isoDateToSerial("1899-12-31")).toBe(0);
    expect(isoDateToSerial("1900-01-01")).toBe(1);
    expect(isoDateToSerial("1900-02-28")).toBe(
      DAY_BEFORE_PHANTOM_LEAP_DAY_SERIAL,
    );
    expect(isoDateToSerial("1900-03-01")).toBe(
      DAY_AFTER_PHANTOM_LEAP_DAY_SERIAL,
    );
  });

  it("round-trips every serial serialToIsoDate can read back", () => {
    // An arbitrary round mid-range sample and an arbitrary round large sample, alongside the boundary and fixture serials already named above.
    const AN_ARBITRARY_MID_RANGE_SERIAL = 1000;
    const AN_ARBITRARY_LARGE_SERIAL = 100000;
    for (const serial of [
      0,
      1,
      DAY_BEFORE_PHANTOM_LEAP_DAY_SERIAL,
      DAY_AFTER_PHANTOM_LEAP_DAY_SERIAL,
      AN_ARBITRARY_MID_RANGE_SERIAL,
      UNIX_EPOCH_SERIAL_1900_SYSTEM,
      FIXTURE_DUE_DATE_SERIAL,
      AN_ARBITRARY_LARGE_SERIAL,
    ]) {
      const iso = serialToIsoDate(serial, false);
      expect({
        serial,
        iso,
        back: iso === undefined ? undefined : isoDateToSerial(iso),
      }).toEqual({ serial, iso, back: serial });
    }
  });

  it("rejects the phantom leap day itself, which has no place on the calendar", () => {
    expect(isoDateToSerial("1900-02-29")).toBeUndefined();
  });

  it("rejects a date before the epoch, which has no serial in the 1900 system at all", () => {
    expect(isoDateToSerial("1850-01-01")).toBeUndefined();
    expect(isoDateToSerial("1899-12-30")).toBeUndefined();
  });

  it("rejects an impossible calendar day rather than letting Date.UTC roll it over into the next month", () => {
    expect(isoDateToSerial("2026-02-30")).toBeUndefined();
    expect(isoDateToSerial("2026-13-01")).toBeUndefined();
  });

  it("rejects every spelling that is not the canonical zero-padded YYYY-MM-DD", () => {
    expect(isoDateToSerial("2026-7-31")).toBeUndefined();
    expect(isoDateToSerial("31/07/2026")).toBeUndefined();
    expect(isoDateToSerial("2026-07-31T00:00:00")).toBeUndefined();
    expect(isoDateToSerial("")).toBeUndefined();
  });
});

describe("isoTimeToSerial: a time of day is the fraction-of-a-day part alone", () => {
  it("converts midnight to zero and a real wall-clock time to its own fraction", () => {
    expect(isoTimeToSerial("00:00:00")).toBe(0);
    expect(isoTimeToSerial("06:00:00")).toBe(SIX_AM_FRACTION);
    expect(isoTimeToSerial("12:00:00")).toBe(NOON_FRACTION);
  });

  it("round-trips every time serialToIsoTime reads back, including the last second of the day", () => {
    for (const iso of [
      "00:00:00",
      "06:00:00",
      "14:30:00",
      "14:30:27",
      "23:59:59",
    ]) {
      const serial = isoTimeToSerial(iso);
      expect({
        iso,
        back: serial === undefined ? undefined : serialToIsoTime(serial),
      }).toEqual({ iso, back: iso });
    }
  });

  it("rejects an elapsed duration — ContentCellValue's own time variant is a wall-clock time of day, not one", () => {
    expect(isoTimeToSerial("24:00:00")).toBeUndefined();
    expect(isoTimeToSerial("25:30:00")).toBeUndefined();
    expect(isoTimeToSerial("12:60:00")).toBeUndefined();
    expect(isoTimeToSerial("12:00:60")).toBeUndefined();
  });

  it("rejects every spelling that is not the canonical zero-padded HH:MM:SS, including ODF's own xsd:duration form", () => {
    expect(isoTimeToSerial("14:30")).toBeUndefined();
    expect(isoTimeToSerial("2:30:00")).toBeUndefined();
    expect(isoTimeToSerial("PT14H30M00S")).toBeUndefined();
  });
});

describe("isoDateTimeToSerial: the two halves summed, each validated by its own inverse", () => {
  it("round-trips the combined value serialToIsoDateTime reads back", () => {
    const serial = isoDateTimeToSerial("2026-07-31T14:30:00");
    expect(
      serial === undefined ? undefined : serialToIsoDateTime(serial, false),
    ).toBe("2026-07-31T14:30:00");
  });

  it("is undefined wherever either half is, and for a value carrying no T separator at all", () => {
    expect(isoDateTimeToSerial("2026-02-30T14:30:00")).toBeUndefined();
    expect(isoDateTimeToSerial("2026-07-31T24:00:00")).toBeUndefined();
    expect(isoDateTimeToSerial("2026-07-31 14:30:00")).toBeUndefined();
    expect(isoDateTimeToSerial("2026-07-31")).toBeUndefined();
  });
});

describe("utcMsOfCalendarDate: rejects a rollover in any one of year/month independently", () => {
  // An arbitrary ordinary (non-leap) year, reused throughout this block so every test's own fixture year is visibly the same one.
  const TEST_YEAR = 2026;
  // July, in utcMsOfCalendarDate's own 1-indexed month numbering (matching OOXML/ISO's convention, where 1 = January).
  const JULY_ONE_INDEXED = 7;
  // July, in Date.UTC's own 0-indexed month numbering (JavaScript's native convention, where 0 = January), used to cross-check utcMsOfCalendarDate against the same real calendar date.
  const JULY_ZERO_INDEXED = 6;
  const LAST_DAY_OF_JULY = 31;

  it("accepts a genuine calendar date, returning its real UTC instant", () => {
    expect(
      utcMsOfCalendarDate(TEST_YEAR, JULY_ONE_INDEXED, LAST_DAY_OF_JULY),
    ).toBe(Date.UTC(TEST_YEAR, JULY_ZERO_INDEXED, LAST_DAY_OF_JULY));
  });

  it("rejects a month rollover even when the resulting year happens to be unchanged (Feb 30 in a non-leap year lands on March 2, same year)", () => {
    const NONEXISTENT_FEBRUARY_DAY = 30; // February never has this many days
    expect(
      utcMsOfCalendarDate(TEST_YEAR, 2, NONEXISTENT_FEBRUARY_DAY),
    ).toBeUndefined();
  });

  it("rejects a month value that rolls the year forward (month 13 becomes January of the next year)", () => {
    const MONTH_ROLLOVER_VALUE = 13; // one past December, the 1-indexed month numbering's own valid maximum
    expect(
      utcMsOfCalendarDate(TEST_YEAR, MONTH_ROLLOVER_VALUE, 1),
    ).toBeUndefined();
  });

  it("rejects a year rollover even when the resulting month happens to read back unchanged, since a day large enough to cross an entire leap year lands back on the same month index, one year later", () => {
    // 2024 was a leap year (366 days), so day 367 of January 2024 is January 1, 2025: getUTCMonth() reads back 0 (January) either way, but getUTCFullYear() reads back the year after the one requested.
    const LEAP_YEAR = 2024;
    const DAY_AFTER_LEAP_YEAR_END = 367; // one day past 2024's own 366th day
    const YEAR_AFTER_LEAP_YEAR = 2025;
    expect(Date.UTC(LEAP_YEAR, 0, DAY_AFTER_LEAP_YEAR_END)).toBe(
      Date.UTC(YEAR_AFTER_LEAP_YEAR, 0, 1),
    );
    expect(
      utcMsOfCalendarDate(LEAP_YEAR, 1, DAY_AFTER_LEAP_YEAR_END),
    ).toBeUndefined();
  });

  it("does not re-check the day component once year and month both already match: it cannot legitimately differ once they do", () => {
    // Every real, in-range day for July (1 to LAST_DAY_OF_JULY) round-trips with year and month unchanged; there is no day value that changes only the day field while leaving year and month exactly as requested.
    for (let day = 1; day <= LAST_DAY_OF_JULY; day++) {
      expect(utcMsOfCalendarDate(TEST_YEAR, JULY_ONE_INDEXED, day)).toBe(
        Date.UTC(TEST_YEAR, JULY_ZERO_INDEXED, day),
      );
    }
  });
});
