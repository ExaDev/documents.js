import { describe, expect, it } from "vitest";
import {
  eolMappingForSubfunction,
  FIRST_SINGLE_BYTE_EOL,
  isSingleByteEol,
  LAST_SINGLE_BYTE_EOL,
  subfunctionForSingleByteEol,
} from "./eol";

describe("eolMappingForSubfunction", () => {
  it("maps subfunction 0 (Beginning of File) to ignore", () => {
    expect(eolMappingForSubfunction(0)).toBe("ignore");
  });

  it("maps subfunction 28 (Deletable Hard EOP) to hardEndOfPage", () => {
    expect(eolMappingForSubfunction(28)).toBe("hardEndOfPage");
  });

  it("returns undefined outside the table", () => {
    expect(eolMappingForSubfunction(29)).toBeUndefined();
  });
});

describe("subfunctionForSingleByteEol", () => {
  it("reverses the single-byte code back to its subfunction number", () => {
    expect(subfunctionForSingleByteEol(0xcf)).toBe(1);
    expect(subfunctionForSingleByteEol(0xb4)).toBe(28);
  });
});

describe("isSingleByteEol", () => {
  it("is false one below the first single-byte code", () => {
    expect(isSingleByteEol(FIRST_SINGLE_BYTE_EOL - 1)).toBe(false);
  });

  it("is true at the first single-byte code", () => {
    expect(isSingleByteEol(FIRST_SINGLE_BYTE_EOL)).toBe(true);
  });

  it("is true at the last single-byte code", () => {
    expect(isSingleByteEol(LAST_SINGLE_BYTE_EOL)).toBe(true);
  });

  it("is false one above the last single-byte code", () => {
    expect(isSingleByteEol(LAST_SINGLE_BYTE_EOL + 1)).toBe(false);
  });
});
