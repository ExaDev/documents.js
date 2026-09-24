import { describe, expect, it } from "vitest";
import { RtfDiagnosticCodes } from "./diagnostics";
import { asciiText } from "./test-support/bytes";
import { expectBalancedBraces } from "./test-support/brace-balance";
import { writeRtfContent } from "./write";
import { wordprocessing, write } from "./test-support/wordprocessing-document";

describe("paragraph and run properties, direction, and hyperlink fields", () => {
  it("writes paragraph properties in twips", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          alignment: "center",
          indentLeftPt: 36,
          indentFirstLinePt: 18,
          spacingBeforePt: 12,
          spacingAfterPt: 6,
          lineSpacing: 1.5,
          pageBreakBefore: true,
        },
      ]),
    );
    expect(out).toContain("\\qc");
    expect(out).toContain("\\li720");
    expect(out).toContain("\\fi360");
    expect(out).toContain("\\sb240");
    expect(out).toContain("\\sa120");
    expect(out).toContain("\\sl360\\slmult1");
    expect(out).toContain("\\pagebb");
  });

  it("writes no \\pagebb for an explicit pageBreakBefore: false, distinct from omitting the field", () => {
    const out = write(
      wordprocessing([
        { kind: "paragraph", runs: [{ text: "x" }], pageBreakBefore: false },
      ]),
    );
    expect(out).not.toContain("\\pagebb");
  });

  it("writes a non-default font index, a non-default size, and every boolean character property a run carries", () => {
    // fontFamily mints "Courier New" at table index 1 (index 0 is the default "Times New Roman", never restated), and sizePt: 14 -> 28 half-points, distinct from DEFAULT_FONT_SIZE_HALF_POINTS (24) — both genuinely non-default values, unlike the many other tests in this file that only ever exercise the DEFAULT font/size and so cannot tell \f0/\fs24 being written from being omitted. Checked as one contiguous run group, not loose substrings, since \f1 alone would also match the {\fonttbl ...} entry the same fontFamily mints — a mutant deleting runProperties' own \f1 would leave that unrelated match standing.
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [
            {
              text: "x",
              fontFamily: "Courier New",
              sizePt: 14,
              bold: true,
              italic: true,
              underline: true,
              strike: true,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\f1\\fs28\\b\\i\\ul\\strike x}");
  });

  it("writes no \\f0 for a run explicitly naming the default font by its own name, distinct from omitting fontFamily entirely", () => {
    // fontIndex !== 0 is a real, separate condition from fontIndex !== undefined: a run naming "Times New Roman" explicitly resolves to the same index (0) collectTables always seeds the fonts table with, so fontIndex is DEFINED here, just equal to the one value that must still not be restated.
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x", fontFamily: "Times New Roman" }],
        },
      ]),
    );
    // Checked as the run's own bare group, not a loose \f0 substring search: the {\fonttbl ...} entry for the default font is always \f0, so that substring exists in this output regardless of what runProperties itself writes.
    expect(out).toContain("\\pard\\plain {x}");
  });

  it("writes no \\ul/\\strike for an explicit false, distinct from true — undefined alone cannot tell the two BooleanLiteral branches apart", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x", underline: false, strike: false }],
        },
      ]),
    );
    expect(out).toContain("\\pard\\plain {x}");
  });

  it("indents a list item's own marker one step per level (LIST_LEVEL_INDENT_TWIPS * (level + 1)), not a fixed or divided amount", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "item" }],
          list: { numId: "rtf1:bullet", level: 2 },
        },
      ]),
    );
    expect(out).toContain(`\\ls1\\ilvl2\\fi-360\\li${String(720 * 3)}`);
  });

  it("reports rather than silently dropping a depth-only list membership with no numId at all", () => {
    // numId is itself optional — absent when the source format states only a depth, not a shared numbering identity (the OOXML drawing-paragraph a:pPr/@lvl case ContentParagraph.list.numId's own comment describes). Every numId a paragraph DOES carry is minted into this.tables.lists by collectTables before any paragraph is written, so entry === undefined can only happen when numId itself was never given in the first place, not from an unrecognised numId string.
    const diagnostics: { code: string; message: string }[] = [];
    const out = writeRtfContent(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          list: { level: 0 },
        },
      ]),
      {
        sink: (diagnostic) => {
          diagnostics.push({
            code: diagnostic.code,
            message: diagnostic.message,
          });
        },
      },
    );
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a list membership carries no numId this writer minted a list for; the paragraph keeps its indentation but no list marker",
      },
    ]);
    expect(asciiText(out)).not.toContain("\\ls");
  });

  it("writes verticalAlign as the \\super/\\sub on-spellings", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [
            { text: "x" },
            { text: "2", verticalAlign: "superscript" },
            { text: " and H" },
            { text: "2", verticalAlign: "subscript" },
            { text: "O" },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\super 2}");
    expect(out).toContain("{\\sub 2}");
  });

  it("writes run direction as \\rtlch/\\ltrch and paragraph direction as \\rtlpar/\\ltrpar", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          direction: "rtl",
          runs: [
            { text: "a", direction: "rtl", sizePt: 12 },
            { text: "b", direction: "ltr", sizePt: 12 },
          ],
        },
        { kind: "paragraph", direction: "ltr", runs: [{ text: "c" }] },
        { kind: "paragraph", runs: [{ text: "d" }] },
      ]),
    );
    expect(out).toContain("\\rtlpar");
    expect(out).toContain("{\\rtlch a}");
    expect(out).toContain("{\\ltrch b}");
    expect(out).toContain("\\ltrpar");
  });

  it("writes metadata.direction as the \\rtldoc/\\ltrdoc document property beside the geometry", () => {
    const rtl = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "x" }] }], {
        direction: "rtl",
      }),
    );
    expect(rtl).toContain("\\rtldoc");
    // \ltrdoc is the spec's own default, written only because the field explicitly states it — never restated for an absent direction.
    const unstated = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "x" }] }]),
    );
    expect(unstated).not.toContain("\\rtldoc");
    expect(unstated).not.toContain("\\ltrdoc");
  });

  it("writes an explicitly-stated metadata.direction: 'ltr' as \\ltrdoc", () => {
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "x" }] }], {
        direction: "ltr",
      }),
    );
    expect(out).toContain("\\ltrdoc");
    expect(out).not.toContain("\\rtldoc");
  });

  it("writes a hyperlink run as the HYPERLINK field production", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "here", hyperlink: "https://example.com/" }],
        },
      ]),
    );
    expect(out).toContain(
      '{\\field{\\*\\fldinst{HYPERLINK "https://example.com/"}}{\\fldrslt{',
    );
    expectBalancedBraces(out);
  });
});
