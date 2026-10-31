import { describe, expect, it } from "vitest";
import { readPdf } from "./read";
import {
  compositeFontProgramPdf,
  simpleFontDifferencesPdf,
} from "./test-support/pdf-font-programs";
import {
  buildCmapTable,
  buildPostV2Table,
  buildSfnt,
} from "./test-support/sfnt";
import { buildMaxpTable } from "./test-support/sfnt-tables";

// What a page reads as when nothing in the font dictionary maps its codes to text: no /ToUnicode CMap, so whatever comes out was recovered from the encoding and the embedded program, or is U+FFFD.

const REPLACEMENT = "�";

function pageText(pdf: Uint8Array<ArrayBuffer>): string {
  return (
    readPdf(pdf)
      .pages[0]?.items.flatMap((item) =>
        item.kind === "text" ? [item.text] : [],
      )
      .join("") ?? ""
  );
}

describe("a composite font with a /CIDToGIDMap stream", () => {
  // A program whose Unicode subtable maps A to glyph 7 and B to glyph 9, reached from CIDs 1 and 2 only through the map.
  const program = buildSfnt(
    new Map([
      [
        "cmap",
        buildCmapTable([
          {
            platformId: 3,
            encodingId: 1,
            format: 4,
            mappings: new Map([
              [0x41, 7],
              [0x42, 9],
            ]),
          },
        ]),
      ],
    ]),
  );
  const cidToGidMap = Uint8Array.from([0, 0, 0, 7, 0, 9]);

  it("reads each CID through the glyph the map assigns it", () => {
    const pdf = compositeFontProgramPdf({
      baseFont: "ABCDEF+Subset",
      program,
      cids: [1, 2],
      cidToGidMap,
    });
    expect(pageText(pdf)).toBe("AB");
  });

  it("leaves unmapped a CID past the end of the map rather than reading it as its own glyph index", () => {
    // CID 7 would read as A if the map were ignored and the CID taken as the glyph index.
    const pdf = compositeFontProgramPdf({
      baseFont: "ABCDEF+Subset",
      program,
      cids: [7, 1],
      cidToGidMap,
    });
    expect(pageText(pdf)).toBe(`${REPLACEMENT}A`);
  });
});

describe("a simple font whose /Differences names a glyph the Adobe Glyph List does not know", () => {
  // A subset whose 'post' table calls glyph 5 "g5" and whose Unicode subtable says glyph 5 draws the ohm sign.
  const program = buildSfnt(
    new Map([
      ["maxp", buildMaxpTable(6)],
      ["post", buildPostV2Table(["", "", "", "", "", "g5"])],
      [
        "cmap",
        buildCmapTable([
          {
            platformId: 3,
            encodingId: 1,
            format: 4,
            mappings: new Map([[0x2126, 5]]),
          },
        ]),
      ],
    ]),
  );

  it("reads the code through the program's own glyph of that name", () => {
    const pdf = simpleFontDifferencesPdf({
      differences: "65 /g5",
      codes: [65],
      program,
    });
    expect(pageText(pdf)).toBe("Ω");
  });

  it("leaves unmapped a code whose /Differences name nothing identifies, rather than reading the code through the base encoding it replaced", () => {
    // Read through WinAnsi, code 65 would come out as A: the glyph /Differences put there is named g9, which neither the list nor the program identifies.
    const pdf = simpleFontDifferencesPdf({
      differences: "65 /g9",
      codes: [65, 66],
      program,
    });
    expect(pageText(pdf)).toBe(`${REPLACEMENT}B`);
  });

  it("reads a ligature name through its components", () => {
    const pdf = simpleFontDifferencesPdf({
      differences: "65 /f_f_i 66 /uni0041030A",
      codes: [65, 66],
    });
    expect(pageText(pdf)).toBe("ffiÅ");
  });
});
