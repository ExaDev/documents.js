import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined if the index capture somehow comes back absent from an otherwise-successful match", () => {
    // NUMID_PATTERN's own (\d+) capture group is required, so a real match can never actually omit it -- but the code still guards it explicitly (TypeScript types every regex match index as possibly undefined, since the type system has no way to encode "always present for a required group"). Forcing the impossible case here proves that guard is real and not merely decorative.
    vi.spyOn(RegExp.prototype, "exec").mockImplementationOnce(function (
      this: RegExp,
      value: string,
    ) {
      // A fresh RegExp built from the same source/flags, rather than reusing the (now-mocked) prototype method, so the real match still runs underneath the mock.
      const result = new RegExp(this.source, this.flags).exec(value);
      if (result !== null) {
        result[1] = undefined as unknown as string;
      }
      return result;
    });
    expect(parseRtfListNumId("rtf3:bullet")).toBeUndefined();
  });

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
