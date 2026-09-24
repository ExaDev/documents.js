import { describe, expect, it } from "vitest";
import { assertNeverAlignment } from "./table";

describe("assertNeverAlignment", () => {
  it("throws naming the unhandled alignment, proving delimiterCell's own exhaustiveness guard fires at runtime", () => {
    expect(() => {
      assertNeverAlignment("bogus" as never);
    }).toThrow('markdown-codec: unhandled table alignment "bogus"');
  });
});
