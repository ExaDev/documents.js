import { describe, expect, it } from "vitest";
import { unrecognizedFillKind } from "./cell-fill";

describe("unrecognizedFillKind", () => {
  it("stringifies a value's own kind field", () => {
    expect(unrecognizedFillKind({ kind: "gradient" })).toBe("gradient");
  });

  it("stringifies an absent kind field as the literal string 'undefined'", () => {
    expect(unrecognizedFillKind({})).toBe("undefined");
  });
});
