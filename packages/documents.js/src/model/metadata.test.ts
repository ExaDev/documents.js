import { describe, expect, it } from "vitest";
import { fixedClock } from "../ports/clock";
import { resolveMetadataTimestamps } from "./metadata";

const NOW = new Date("2026-06-15T12:00:00.000Z");

describe("resolveMetadataTimestamps", () => {
  it("fills in both createdIso and modifiedIso from the clock, reading it exactly once, when neither was present", () => {
    const result = resolveMetadataTimestamps({}, fixedClock(NOW));
    expect(result.createdIso).toBe("2026-06-15T12:00:00.000Z");
    expect(result.modifiedIso).toBe("2026-06-15T12:00:00.000Z");
  });

  it("never consults the clock when both createdIso and modifiedIso are already present", () => {
    const metadata = {
      createdIso: "2020-01-01T00:00:00.000Z",
      modifiedIso: "2021-01-01T00:00:00.000Z",
    };
    const throwingClock = {
      now: () => {
        throw new Error("clock should not be consulted");
      },
    };
    const result = resolveMetadataTimestamps(metadata, throwingClock);
    expect(result).toEqual(metadata);
    expect(result).toBe(metadata); // returned unchanged -- not even a shallow copy
  });

  it("fills in only the missing field when exactly one of the two is already present, never overwriting the one that is", () => {
    const withCreatedOnly = resolveMetadataTimestamps(
      { createdIso: "2020-01-01T00:00:00.000Z" },
      fixedClock(NOW),
    );
    expect(withCreatedOnly.createdIso).toBe("2020-01-01T00:00:00.000Z");
    expect(withCreatedOnly.modifiedIso).toBe("2026-06-15T12:00:00.000Z");

    const withModifiedOnly = resolveMetadataTimestamps(
      { modifiedIso: "2020-01-01T00:00:00.000Z" },
      fixedClock(NOW),
    );
    expect(withModifiedOnly.createdIso).toBe("2026-06-15T12:00:00.000Z");
    expect(withModifiedOnly.modifiedIso).toBe("2020-01-01T00:00:00.000Z");
  });

  it("preserves every other metadata field untouched while filling in timestamps", () => {
    const result = resolveMetadataTimestamps(
      { title: "My Doc", author: "A. Writer" },
      fixedClock(NOW),
    );
    expect(result.title).toBe("My Doc");
    expect(result.author).toBe("A. Writer");
    expect(result.createdIso).toBe("2026-06-15T12:00:00.000Z");
    expect(result.modifiedIso).toBe("2026-06-15T12:00:00.000Z");
  });
});
