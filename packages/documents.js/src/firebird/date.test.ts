import { describe, expect, it } from "vitest";
import {
  decodeFirebirdDate,
  decodeFirebirdTime,
  formatFirebirdDate,
  formatFirebirdTime,
  formatFirebirdTimestamp,
} from "./date";

// The MJD-epoch day-count algorithm (decodeFirebirdDate) and the 1/10000-second tick algorithm (decodeFirebirdTime) are both restated directly from Firebird's own open-source NoThrowTimeStamp.cpp -- these tests check the algorithm in isolation against known reference points, independent of the real-fixture end-to-end proof in backup.test.ts (whose own HIRE_DATE values already cross-checked correctly against real LibreOffice output, but only for dates in the 2019-2024 range).

describe("decodeFirebirdDate", () => {
  it("decodes day 0 as the Modified Julian Date epoch, 17 November 1858", () => {
    expect(decodeFirebirdDate(0)).toEqual({ year: 1858, month: 11, day: 17 });
  });

  it("decodes a genuine value cross-checked against this package's own real fixture (2020-01-15)", () => {
    // Day count independently confirmed against real LibreOffice output in backup.test.ts's own "Alice Smith" row.
    const days = Math.round(
      (Date.UTC(2020, 0, 15) - Date.UTC(1858, 10, 17)) / 86400000,
    );
    expect(decodeFirebirdDate(days)).toEqual({ year: 2020, month: 1, day: 15 });
  });

  it("round-trips through formatFirebirdDate as an ISO-shaped string", () => {
    const days = Math.round(
      (Date.UTC(2024, 11, 31) - Date.UTC(1858, 10, 17)) / 86400000,
    );
    expect(formatFirebirdDate(days)).toBe("2024-12-31");
  });

  it("handles a leap-year boundary correctly (29 February 2024)", () => {
    const days = Math.round(
      (Date.UTC(2024, 1, 29) - Date.UTC(1858, 10, 17)) / 86400000,
    );
    expect(decodeFirebirdDate(days)).toEqual({ year: 2024, month: 2, day: 29 });
  });
});

describe("decodeFirebirdTime", () => {
  it("decodes 0 as midnight", () => {
    expect(decodeFirebirdTime(0)).toEqual({
      hours: 0,
      minutes: 0,
      seconds: 0,
      fractions: 0,
    });
  });

  it("decodes 13:45:30.5000 correctly (ISC_TIME_SECONDS_PRECISION = 10000 ticks/second)", () => {
    const ticks = (13 * 3600 + 45 * 60 + 30) * 10000 + 5000;
    expect(decodeFirebirdTime(ticks)).toEqual({
      hours: 13,
      minutes: 45,
      seconds: 30,
      fractions: 5000,
    });
  });

  it("formats to HH:MM:SS.mmm", () => {
    const ticks = (9 * 3600 + 5 * 60 + 1) * 10000;
    expect(formatFirebirdTime(ticks)).toBe("09:05:01.000");
  });
});

describe("formatFirebirdTimestamp", () => {
  it("combines date and time into one space-separated string", () => {
    const days = Math.round(
      (Date.UTC(2020, 0, 15) - Date.UTC(1858, 10, 17)) / 86400000,
    );
    const ticks = 8 * 3600 * 10000;
    expect(formatFirebirdTimestamp(days, ticks)).toBe(
      "2020-01-15 08:00:00.000",
    );
  });
});
