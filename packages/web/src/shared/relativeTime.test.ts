import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { relativeTime } from "./relativeTime";

const NOW = new Date("2026-01-01T12:00:00.000Z").getTime();

// Restated here rather than imported from relativeTime.ts, so a boundary this suite pins stays pinned to the real duration even if the module's own constants were to drift.
const SECOND_MS = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTE_MS = SECONDS_PER_MINUTE * SECOND_MS;
const HOUR_MS = MINUTES_PER_HOUR * MINUTE_MS;
const DAY_MS = HOURS_PER_DAY * HOUR_MS;

// The count this suite uses wherever the assertion is only that the unit no longer rolls over, rather than that a particular boundary was crossed.
const MANY_DAYS = 10;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("relativeTime", () => {
  it("reports 'just now' for a timestamp in the same instant", () => {
    expect(relativeTime(NOW)).toBe("just now");
  });

  it("reports 'just now' for anything under a minute old", () => {
    expect(relativeTime(NOW - (MINUTE_MS - SECOND_MS))).toBe("just now");
  });

  it("switches to minutes at exactly the one-minute boundary", () => {
    expect(relativeTime(NOW - MINUTE_MS)).toBe("1m ago");
  });

  it("floors a partial minute rather than rounding", () => {
    expect(relativeTime(NOW - (2 * MINUTE_MS - SECOND_MS))).toBe("1m ago");
  });

  it("reports minutes up to just under an hour", () => {
    expect(relativeTime(NOW - (HOUR_MS - MINUTE_MS))).toBe(
      `${String(MINUTES_PER_HOUR - 1)}m ago`,
    );
  });

  it("switches to hours at exactly the one-hour boundary", () => {
    expect(relativeTime(NOW - HOUR_MS)).toBe("1h ago");
  });

  it("floors a partial hour rather than rounding", () => {
    expect(relativeTime(NOW - (2 * HOUR_MS - MINUTE_MS))).toBe("1h ago");
  });

  it("reports hours up to just under a day", () => {
    expect(relativeTime(NOW - (DAY_MS - HOUR_MS))).toBe(
      `${String(HOURS_PER_DAY - 1)}h ago`,
    );
  });

  it("switches to days at exactly the one-day boundary", () => {
    expect(relativeTime(NOW - DAY_MS)).toBe("1d ago");
  });

  it("floors a partial day rather than rounding", () => {
    expect(relativeTime(NOW - (2 * DAY_MS - HOUR_MS))).toBe("1d ago");
  });

  it("reports an arbitrarily large day count with no upper unit", () => {
    expect(relativeTime(NOW - MANY_DAYS * DAY_MS)).toBe(
      `${String(MANY_DAYS)}d ago`,
    );
  });
});
