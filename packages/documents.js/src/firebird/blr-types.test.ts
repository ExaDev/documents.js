import { describe, expect, it } from "vitest";
import { assertNeverPhysical } from "./blr-types";

describe("assertNeverPhysical", () => {
  it("throws naming the unhandled physical, proving the switch's own exhaustiveness guard fires at runtime", () => {
    expect(() => {
      assertNeverPhysical("bogus" as never);
    }).toThrow('documents.js: unhandled physical "bogus"');
  });
});
