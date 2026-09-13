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

  it("mints a bullet list without an 'ordered@' suffix even when a start is given", () => {
    // A bullet list has no start concept -- the type === "ordered" guard must actually gate this.
    expect(mintListNumId(4, { type: "bullet", start: 5 })).toBe("epub4:bullet");
  });

  it("parses an ordered numId with no @start suffix as having no explicit start", () => {
    expect(parseListNumId("epub1:ordered")).toEqual({ type: "ordered" });
  });

  it("ignores an @start suffix on a bullet numId -- start only ever applies to ordered", () => {
    expect(parseListNumId("epub1:bullet@5")).toEqual({ type: "bullet" });
  });
});
