import { describe, expect, it } from "vitest";
import { assertNeverInstanceKind } from "./render";

describe("assertNeverInstanceKind", () => {
  it("throws naming the unhandled instance.kind, proving the switch's own exhaustiveness guard fires at runtime", () => {
    expect(() => {
      assertNeverInstanceKind("bogus" as never);
    }).toThrow('documents.js: unhandled instance.kind "bogus"');
  });
});
