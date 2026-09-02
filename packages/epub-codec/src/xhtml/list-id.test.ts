import { describe, expect, it } from "vitest";
import { mintListNumId, parseListNumId } from "./list-id";

describe("mintListNumId / parseListNumId", () => {
  it("round-trips a bullet list", () => {
    const numId = mintListNumId(1, { type: "bullet" });
    expect(numId).toBe("epub1:bullet");
    expect(parseListNumId(numId)).toEqual({ type: "bullet" });
  });

  it("round-trips an ordered list with the default start", () => {
    const numId = mintListNumId(2, { type: "ordered", start: 1 });
    expect(numId).toBe("epub2:ordered");
    expect(parseListNumId(numId)).toEqual({ type: "ordered" });
  });

  it("round-trips an ordered list with a non-default start", () => {
    const numId = mintListNumId(3, { type: "ordered", start: 5 });
    expect(numId).toBe("epub3:ordered@5");
    expect(parseListNumId(numId)).toEqual({ type: "ordered", start: 5 });
  });

  it("returns undefined for a cross-format numId", () => {
    expect(parseListNumId("list1")).toBeUndefined();
    expect(parseListNumId("md1:bullet")).toBeUndefined();
  });
});
