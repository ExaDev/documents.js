import { describe, expect, it } from "vitest";
import { mintRtfListNumId, parseRtfListNumId } from "./list-id";

describe("mintRtfListNumId", () => {
  it("mints a bullet numId with no start suffix", () => {
    expect(mintRtfListNumId({ listOverrideIndex: 3, type: "bullet" })).toBe(
      "rtf3:bullet",
    );
  });

  it("mints an ordered numId with no start suffix when the start is the default 1", () => {
    expect(
      mintRtfListNumId({ listOverrideIndex: 3, type: "ordered", start: 1 }),
    ).toBe("rtf3:ordered");
  });

  it("mints an ordered numId with no start suffix when no start is given at all", () => {
    expect(mintRtfListNumId({ listOverrideIndex: 3, type: "ordered" })).toBe(
      "rtf3:ordered",
    );
  });

  it("mints an ordered numId with an @-start suffix for a non-default start", () => {
    expect(
      mintRtfListNumId({ listOverrideIndex: 3, type: "ordered", start: 5 }),
    ).toBe("rtf3:ordered@5");
  });

  it("never mints a start suffix for a bullet, even when a start is given", () => {
    // A bullet has no numbering start at all -- start is only ever an ordered-list fact, so passing one for a bullet must not surface it.
    expect(
      mintRtfListNumId({
        listOverrideIndex: 3,
        type: "bullet",
        start: 5,
      }),
    ).toBe("rtf3:bullet");
  });
});

describe("parseRtfListNumId", () => {
  it("parses a bullet numId with no start", () => {
    expect(parseRtfListNumId("rtf3:bullet")).toEqual({
      listOverrideIndex: 3,
      type: "bullet",
    });
  });

  it("parses an ordered numId's own start suffix", () => {
    expect(parseRtfListNumId("rtf3:ordered@5")).toEqual({
      listOverrideIndex: 3,
      type: "ordered",
      start: 5,
    });
  });

  it("returns undefined for a numId this package never minted", () => {
    expect(parseRtfListNumId("odf-list1")).toBeUndefined();
  });

  it("returns undefined for a numId naming neither bullet nor ordered", () => {
    expect(parseRtfListNumId("rtf3:numbered")).toBeUndefined();
  });

  it("returns undefined for a numId with no index at all", () => {
    expect(parseRtfListNumId("rtf:bullet")).toBeUndefined();
  });

  it("round-trips through mint then parse for both list types", () => {
    expect(
      parseRtfListNumId(
        mintRtfListNumId({ listOverrideIndex: 7, type: "ordered", start: 3 }),
      ),
    ).toEqual({ listOverrideIndex: 7, type: "ordered", start: 3 });
  });
});
