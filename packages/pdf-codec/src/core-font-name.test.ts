import { describe, expect, it } from "vitest";
import {
  coreFaceNameOfFontName,
  withoutTrailingNumber,
} from "./core-font-glyph-orders";

/** The pattern `withoutTrailingNumber` replaces, as the reference its result must equal. */
function referenceWithoutTrailingNumber(name: string): string {
  return name.replace(/\d+(?:\.\d+)?$/u, "");
}

// Every string of up to this length over the alphabet below, so each placement of digits, full stops and letters is covered.
const EXHAUSTIVE_LENGTH = 6;
const ALPHABET = ["0", "7", ".", "a"] as const;

function* allStrings(length: number): Generator<string> {
  if (length === 0) {
    yield "";
    return;
  }
  for (const prefix of allStrings(length - 1)) {
    for (const character of ALPHABET) {
      yield prefix + character;
    }
  }
}

describe("withoutTrailingNumber", () => {
  it("cuts the same trailing number the end-anchored pattern does, for every short name over digits, full stops and a letter", () => {
    for (let length = 0; length <= EXHAUSTIVE_LENGTH; length += 1) {
      for (const name of allStrings(length)) {
        expect(withoutTrailingNumber(name)).toBe(
          referenceWithoutTrailingNumber(name),
        );
      }
    }
  });

  it("cuts a version number and a size", () => {
    expect(withoutTrailingNumber("Arial.Bold0133")).toBe("Arial.Bold");
    expect(withoutTrailingNumber("Arial086.75")).toBe("Arial");
    expect(withoutTrailingNumber("Foo1.2.3")).toBe("Foo1.");
    expect(withoutTrailingNumber("Arial")).toBe("Arial");
  });

  it("finishes a very long digit run that a letter follows, which the pattern it replaces takes time quadratic in the run's length to reject", () => {
    // A million digits is far beyond what a quadratic scan finishes: this returns only because the scan is linear.
    const run = "7".repeat(1_000_000);

    expect(withoutTrailingNumber(`${run}a`)).toBe(`${run}a`);
    expect(withoutTrailingNumber(`a${run}`)).toBe("a");
    expect(coreFaceNameOfFontName(`${run}a`)).toBeUndefined();
  });
});
