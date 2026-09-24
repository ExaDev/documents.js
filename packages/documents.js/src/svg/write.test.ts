import { describe, expect, it } from "vitest";
import { assertNeverVectorKind } from "./write";

describe("assertNeverVectorKind", () => {
  it("throws naming the unhandled vector, proving the switch's own exhaustiveness guard fires at runtime", () => {
    expect(() => {
      assertNeverVectorKind({ kind: "bogus" } as never);
    }).toThrow('documents.js: unhandled vector {"kind":"bogus"}');
  });
});
