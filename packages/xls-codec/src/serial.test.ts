import { describe, expect, it } from "vitest";

import { BiffWriteError } from "./biff/write-errors";
import {
  isoDateTimeToSerial,
  isoDateToSerial,
  isoTimeToSerial,
  serialToIsoDate,
  serialToIsoDateTime,
  serialToIsoTime,
} from "./serial";

describe("serialToIsoDate", () => {
  it("reads serial 1 as the first day of the 1900 system", () => {
    // [MS-XLS] 2.4.77: "The first date of the 1900 date system is 00:00:00 on January 1, 1900, specified by a serial value of 1."
    expect(serialToIsoDate(1, false)).toBe("1900-01-01");
  });

  it("reads serial 0 as the first day of the 1904 system", () => {
    // Same section: "The first date of the 1904 date system is 00:00:00 on January 1, 1904, specified by a serial value of 0."
    expect(serialToIsoDate(0, true)).toBe("1904-01-01");
  });

  it("refuses the 1900 system's phantom leap day", () => {
    // Serial 60 is 1900-02-29, a date that never existed -- Lotus 1-2-3 treated 1900 as a leap year and Excel reproduced the bug for compatibility. Emitting an ISO date for it would put an impossible day in the document.
    expect(serialToIsoDate(60, false)).toBeUndefined();
  });

  it("counts from a day earlier above the phantom leap day", () => {
    // Serial 61 is 1900-03-01, not 1900-03-02: every serial at or above 60 is one day ahead of a true count from 1899-12-31.
    expect(serialToIsoDate(61, false)).toBe("1900-03-01");
  });

  it("counts correctly below the phantom leap day", () => {
    expect(serialToIsoDate(59, false)).toBe("1900-02-28");
  });

  it("reads a modern date in the 1900 system", () => {
    expect(serialToIsoDate(45292, false)).toBe("2024-01-01");
  });

  it("offsets the same calendar date by 1462 days in the 1904 system", () => {
    // The two epochs differ by exactly 1462 days; reading a 1904 workbook as a 1900 one shifts every date by four years and a day.
    expect(serialToIsoDate(45292 - 1462, true)).toBe("2024-01-01");
  });

  it("discards the fractional part when reading a date", () => {
    expect(serialToIsoDate(45292.75, false)).toBe("2024-01-01");
  });

  it("refuses a serial before the epoch", () => {
    expect(serialToIsoDate(-1, false)).toBeUndefined();
  });

  it("refuses a non-finite serial", () => {
    expect(serialToIsoDate(Number.NaN, false)).toBeUndefined();
  });
});

describe("serialToIsoTime", () => {
  it("reads midnight", () => {
    expect(serialToIsoTime(0)).toBe("00:00:00");
  });

  it("reads midday from a half-day fraction", () => {
    expect(serialToIsoTime(0.5)).toBe("12:00:00");
  });

  it("recovers a clean wall-clock time from a producer's rounded fraction", () => {
    // 0.604166666666667 * 86400000 is 52199999.999999 ms exactly; without rounding to the nearest millisecond this reads as 14:29:59.
    expect(serialToIsoTime(0.604166666666667)).toBe("14:30:00");
  });

  it("renders only the fractional part of a serial carrying a day count", () => {
    // A time-of-day format over a serial of 2.5 displays noon, not "two days and twelve hours".
    expect(serialToIsoTime(2.5)).toBe("12:00:00");
  });

  it("reads a fraction just short of a full day as the last second of it", () => {
    // 0.9999999 * 86400000 is 86399991.36 ms, which rounds to 86399991 -- genuinely 23:59:59, not a roll-over.
    expect(serialToIsoTime(0.9999999)).toBe("23:59:59");
  });

  it("rolls a fraction that rounds to a full day into midnight rather than an impossible 24:00:00", () => {
    // The roll-over threshold is a product of at least 86399999.5 ms, so it takes a fraction this close to 1 to reach it.
    expect(serialToIsoTime(0.9999999995)).toBe("00:00:00");
  });
});

describe("serialToIsoDateTime", () => {
  it("joins the date and time halves with the canonical separator", () => {
    expect(serialToIsoDateTime(45292.5, false)).toBe("2024-01-01T12:00:00");
  });

  it("rolls a fraction rounding to a full day into the next date", () => {
    expect(serialToIsoDateTime(45292.9999999995, false)).toBe(
      "2024-01-02T00:00:00",
    );
  });

  it("refuses a serial whose date half names no real day", () => {
    expect(serialToIsoDateTime(60.5, false)).toBeUndefined();
  });
});

// The write direction: every serialToIsoX case above inverted, so writing a date and reading it back through this package's own reader agrees with itself.

describe("isoDateToSerial", () => {
  it("writes the first day of the 1900 system as serial 1", () => {
    expect(isoDateToSerial("1900-01-01", false)).toBe(1);
  });

  it("writes the first day of the 1904 system as serial 0", () => {
    expect(isoDateToSerial("1904-01-01", true)).toBe(0);
  });

  it("counts correctly below the phantom leap day", () => {
    expect(isoDateToSerial("1900-02-28", false)).toBe(59);
  });

  it("skips the phantom leap day when counting on or after it", () => {
    // 1900-03-01 is serial 61, not 60: the phantom Feb 29 1900 has no serial of its own to land on.
    expect(isoDateToSerial("1900-03-01", false)).toBe(61);
  });

  it("writes a modern date in the 1900 system", () => {
    expect(isoDateToSerial("2024-01-01", false)).toBe(45292);
  });

  it("offsets the same calendar date by 1462 days in the 1904 system", () => {
    expect(isoDateToSerial("2024-01-01", true)).toBe(45292 - 1462);
  });

  it("round-trips through serialToIsoDate for a real modern date", () => {
    const serial = isoDateToSerial("2026-09-03", false);
    expect(serialToIsoDate(serial, false)).toBe("2026-09-03");
  });

  it("round-trips a date below the phantom leap day", () => {
    const serial = isoDateToSerial("1900-01-15", false);
    expect(serialToIsoDate(serial, false)).toBe("1900-01-15");
  });

  it("refuses a date before the 1900 epoch", () => {
    expect(() => isoDateToSerial("1899-12-01", false)).toThrow(BiffWriteError);
  });

  it("refuses a malformed date string", () => {
    expect(() => isoDateToSerial("not-a-date", false)).toThrow(BiffWriteError);
  });
});

describe("isoTimeToSerial", () => {
  it("writes midnight as serial 0", () => {
    expect(isoTimeToSerial("00:00:00")).toBe(0);
  });

  it("writes midday as a half-day fraction", () => {
    expect(isoTimeToSerial("12:00:00")).toBe(0.5);
  });

  it("round-trips through serialToIsoTime for an arbitrary whole-second time", () => {
    expect(serialToIsoTime(isoTimeToSerial("14:30:00"))).toBe("14:30:00");
    expect(serialToIsoTime(isoTimeToSerial("23:59:59"))).toBe("23:59:59");
    expect(serialToIsoTime(isoTimeToSerial("00:00:01"))).toBe("00:00:01");
  });

  it("refuses a malformed time string", () => {
    expect(() => isoTimeToSerial("14:30")).toThrow(BiffWriteError);
  });
});

describe("isoDateTimeToSerial", () => {
  it("joins the date and time halves back into one serial", () => {
    expect(isoDateTimeToSerial("2024-01-01T12:00:00", false)).toBe(45292.5);
  });

  it("round-trips through serialToIsoDateTime for a real modern date-time", () => {
    const serial = isoDateTimeToSerial("2026-09-03T13:45:30", false);
    expect(serialToIsoDateTime(serial, false)).toBe("2026-09-03T13:45:30");
  });

  it("drops a trailing 'Z' offset, keeping the wall-clock digits as written", () => {
    expect(isoDateTimeToSerial("2024-01-01T12:00:00Z", false)).toBe(45292.5);
  });

  it("drops a trailing numeric offset, keeping the wall-clock digits as written", () => {
    expect(isoDateTimeToSerial("2024-01-01T12:00:00+05:00", false)).toBe(
      45292.5,
    );
  });

  it("drops a fractional-seconds part", () => {
    expect(isoDateTimeToSerial("2024-01-01T12:00:00.500", false)).toBe(45292.5);
  });

  it("refuses a string with no 'T' separator at the expected position", () => {
    expect(() => isoDateTimeToSerial("2024-01-01 12:00:00", false)).toThrow(
      BiffWriteError,
    );
  });
});
