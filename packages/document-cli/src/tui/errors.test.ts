import { describe, expect, it } from "vitest";
import { describeError } from "./errors";

describe("describeError", () => {
  it("returns a real Error's own message", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("describes a non-Error value by its typeof", () => {
    expect(describeError("a string")).toBe(
      "A non-Error value of type string was thrown",
    );
    expect(describeError(42)).toBe(
      "A non-Error value of type number was thrown",
    );
    expect(describeError(undefined)).toBe(
      "A non-Error value of type undefined was thrown",
    );
  });
});
