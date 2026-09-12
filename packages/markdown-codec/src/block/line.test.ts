import { describe, expect, it } from "vitest";
import { LineCursor } from "./line";

describe("LineCursor", () => {
  it("reports an empty line as blank as soon as it is constructed", () => {
    expect(new LineCursor("").blank).toBe(true);
  });

  it("reports a non-empty line as not blank", () => {
    expect(new LineCursor("foo").blank).toBe(false);
  });

  it("reports a whitespace-only line as blank", () => {
    expect(new LineCursor("   ").blank).toBe(true);
  });
});
