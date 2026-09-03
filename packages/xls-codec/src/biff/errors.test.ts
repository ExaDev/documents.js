import { describe, expect, it } from "vitest";

import { errorTextOf } from "./errors";

describe("errorTextOf", () => {
  // [MS-XLS] 2.5.10's own bBoolErr table for the error case. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/4a18edf4-b88c-4b39-a857-b31757314d0f

  it.each([
    [0x00, "#NULL!"],
    [0x07, "#DIV/0!"],
    [0x0f, "#VALUE!"],
    [0x17, "#REF!"],
    [0x1d, "#NAME?"],
    [0x24, "#NUM!"],
    [0x2a, "#N/A"],
    [0x2b, "#GETTING_DATA"],
  ])("maps error code 0x%s to its displayed spelling", (code, text) => {
    expect(errorTextOf(code)).toBe(text);
  });

  it("returns undefined for a code the specification does not define", () => {
    // Inventing a spelling for an unknown code would put a value in the document that no producer wrote; the caller degrades the cell instead.
    expect(errorTextOf(0x99)).toBeUndefined();
  });
});
