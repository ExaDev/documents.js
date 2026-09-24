import { describe, expect, it } from "vitest";
import { assertNeverPackage } from "./exhaustive";

describe("assertNeverPackage", () => {
  it("throws naming the unhandled package, proving buildOutline's and effectivePackage's shared exhaustiveness guard fires at runtime", () => {
    expect(() => {
      assertNeverPackage({ kind: "bogus" } as never);
    }).toThrow(
      'document-outline.js: unhandled DocumentTree package {"kind":"bogus"}',
    );
  });
});
