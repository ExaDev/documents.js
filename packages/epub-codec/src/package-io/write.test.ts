import { describe, expect, it } from "vitest";
import { assertNeverPart } from "./write";

describe("assertNeverPart", () => {
  it("throws naming the unhandled part, proving partToBytes's own exhaustiveness guard fires at runtime", () => {
    expect(() => {
      assertNeverPart({ kind: "bogus" } as never);
    }).toThrow('epub-codec: unhandled part {"kind":"bogus"}');
  });
});
