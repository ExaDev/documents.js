import { describe, expect, it } from "vitest";
import { DocFormatError } from "../errors";
import { parseClx } from "./piece-table";
import { buildTextClx } from "./piece-table-write";

describe("buildTextClx", () => {
  it("builds a Clx describing a single uncompressed piece covering the whole text", () => {
    const clx = buildTextClx(10, 0x400);
    const table = parseClx(clx);
    expect(table.pieces).toHaveLength(1);
    expect(table.pieces[0]).toMatchObject({
      cpStart: 0,
      cpEnd: 10,
      fc: 0x400,
      compressed: false,
    });
    expect(table.lastCp).toBe(10);
  });

  it("places the text at the exact fc it is given", () => {
    const table = parseClx(buildTextClx(3, 0x1000));
    expect(table.pieces[0]?.fc).toBe(0x1000);
  });

  it("rejects a character count of 0, since the main document always ends in a mandatory paragraph mark", () => {
    expect(() => buildTextClx(0, 0x400)).toThrow(DocFormatError);
    expect(() => buildTextClx(0, 0x400)).toThrow(
      /must cover at least one character position/,
    );
  });

  it("rejects a negative character count", () => {
    expect(() => buildTextClx(-1, 0x400)).toThrow(DocFormatError);
  });

  it("accepts a character count of exactly 1", () => {
    expect(() => buildTextClx(1, 0x400)).not.toThrow();
  });
});
