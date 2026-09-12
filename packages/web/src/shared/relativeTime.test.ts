import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { relativeTime } from "./relativeTime";

const NOW = new Date("2026-01-01T12:00:00.000Z").getTime();

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
    expect(relativeTime(NOW - 59_000)).toBe("just now");
  });

  it("switches to minutes at exactly the one-minute boundary", () => {
    expect(relativeTime(NOW - 60_000)).toBe("1m ago");
  });

  it("floors a partial minute rather than rounding", () => {
    expect(relativeTime(NOW - 119_000)).toBe("1m ago");
  });

  it("reports minutes up to just under an hour", () => {
    expect(relativeTime(NOW - 59 * 60_000)).toBe("59m ago");
  });

  it("switches to hours at exactly the one-hour boundary", () => {
    expect(relativeTime(NOW - 60 * 60_000)).toBe("1h ago");
  });

  it("floors a partial hour rather than rounding", () => {
    expect(relativeTime(NOW - (60 * 60_000 + 59 * 60_000))).toBe("1h ago");
  });

  it("reports hours up to just under a day", () => {
    expect(relativeTime(NOW - 23 * 60 * 60_000)).toBe("23h ago");
  });

  it("switches to days at exactly the one-day boundary", () => {
    expect(relativeTime(NOW - 24 * 60 * 60_000)).toBe("1d ago");
  });

  it("floors a partial day rather than rounding", () => {
    expect(relativeTime(NOW - (24 * 60 * 60_000 + 23 * 60 * 60_000))).toBe(
      "1d ago",
    );
  });

  it("reports an arbitrarily large day count with no upper unit", () => {
    expect(relativeTime(NOW - 10 * 24 * 60 * 60_000)).toBe("10d ago");
  });
});
