import { describe, expect, it } from "vitest";
import { fixedClock, systemClock } from "./clock";

describe("systemClock", () => {
  it("returns a Date close to the actual current time", () => {
    const before = Date.now();
    const now = systemClock.now();
    const after = Date.now();
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("fixedClock", () => {
  it("always returns the same injected date", () => {
    const date = new Date("2024-01-01T00:00:00.000Z");
    const clock = fixedClock(date);
    expect(clock.now()).toBe(date);
    expect(clock.now()).toBe(date);
  });
});
