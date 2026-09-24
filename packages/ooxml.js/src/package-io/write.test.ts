import { describe, expect, it } from "vitest";
import { assertNeverPartKind } from "./write";

describe("assertNeverPartKind", () => {
  it("throws naming the unhandled kind, proving partToBytes's own exhaustiveness guard actually fires at runtime", () => {
    let caught: unknown;
    try {
      assertNeverPartKind({ kind: "bogus" } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'partToBytes: unhandled Part kind {"kind":"bogus"}',
    );
  });
});
