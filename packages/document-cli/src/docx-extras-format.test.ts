import type { DocxExtras, NumberingLevel } from "documents.js";
import { decodePackage, readDocxExtras } from "documents.js";
import { describe, expect, it } from "vitest";
import { formatDocxExtrasLines } from "./docx-extras-format";
import {
  buildDocxWithExtras,
  DOCX_EXTRAS_FIXTURE,
} from "./test-support/docx-extras-fixture";

// sectionHeaderFooters is positional (one entry per section, {} when that section spells no references) — a one-section document with none spells exactly [{}].
const EMPTY_EXTRAS: DocxExtras = {
  comments: [],
  footnotes: [],
  headerFooterParts: [],
  sectionHeaderFooters: [{}],
  numbering: {},
};

function fixtureExtras(): DocxExtras {
  return readDocxExtras(decodePackage(buildDocxWithExtras()));
}

describe("formatDocxExtrasLines", () => {
  it("says so plainly when the document carries none of the five kinds of extra data", () => {
    expect(formatDocxExtrasLines(EMPTY_EXTRAS)).toStrictEqual([
      "This document carries no comments, footnotes, headers, footers, or numbering definitions.",
    ]);
  });

  it("renders every comment by 1-based position, an author-less comment reading '(no author)'", () => {
    const extras = fixtureExtras();
    expect(extras.comments).toHaveLength(2);
    const lines = formatDocxExtrasLines(extras);
    expect(lines).toContain("comments");
    expect(lines).toContain(
      `  [1] ${DOCX_EXTRAS_FIXTURE.commentAuthor}: ${DOCX_EXTRAS_FIXTURE.commentWithAuthorText}`,
    );
    expect(lines).toContain(
      `  [2] (no author): ${DOCX_EXTRAS_FIXTURE.commentWithoutAuthorText}`,
    );
  });

  it("renders the one real footnote, with the separator footnote already excluded by readDocxExtras itself", () => {
    const extras = fixtureExtras();
    expect(extras.footnotes).toHaveLength(1);
    expect(formatDocxExtrasLines(extras)).toContain(
      `  [1] ${DOCX_EXTRAS_FIXTURE.footnoteText}`,
    );
  });

  it("renders headers and footers as their own labelled, 1-based-position sections", () => {
    const lines = formatDocxExtrasLines(fixtureExtras());
    expect(lines).toContain("headers");
    expect(lines).toContain(`  [1] ${DOCX_EXTRAS_FIXTURE.headerText}`);
    expect(lines).toContain("footers");
    expect(lines).toContain(`  [1] ${DOCX_EXTRAS_FIXTURE.footerText}`);
  });

  it("derives one line per part from that part's own runs, concatenated with no separator", () => {
    // The fixture's parts arrive through the unreferenced-part walk (they carry no relationships), and this pins the derivation itself: two paragraphs in one header render as one line, every run joined with nothing between.
    const extras: DocxExtras = {
      ...EMPTY_EXTRAS,
      headerFooterParts: [
        {
          path: "word/header1.xml",
          kind: "header",
          blocks: [
            { kind: "paragraph", runs: [{ text: "Running header" }] },
            { kind: "paragraph", runs: [{ text: "Second line" }] },
          ],
        },
      ],
    };
    expect(formatDocxExtrasLines(extras)).toEqual([
      "headers",
      "  [1] Running headerSecond line",
    ]);
  });

  it("joins two runs within the same paragraph with no separator between them", () => {
    const extras: DocxExtras = {
      ...EMPTY_EXTRAS,
      headerFooterParts: [
        {
          path: "word/header1.xml",
          kind: "header",
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "Hello, " }, { text: "world." }],
            },
          ],
        },
      ],
    };
    expect(formatDocxExtrasLines(extras)).toContain("  [1] Hello, world.");
  });

  it("renders a numbering definition keyed by numId, its own level keyed by ilvl in ascending numeric order", () => {
    const lines = formatDocxExtrasLines(fixtureExtras());
    expect(lines).toContain("numbering");
    expect(lines).toContain(`  numId ${DOCX_EXTRAS_FIXTURE.numId}`);
    expect(lines).toContain(
      `    level 0: ${DOCX_EXTRAS_FIXTURE.numberingLevel.format} ${JSON.stringify(DOCX_EXTRAS_FIXTURE.numberingLevel.text)} starting at 1`,
    );
  });

  it("names the footnote's own type in parentheses when it has one", () => {
    const extras: DocxExtras = {
      ...EMPTY_EXTRAS,
      footnotes: [{ text: "Endnote text", type: "endnote" }],
    };
    expect(formatDocxExtrasLines(extras)).toContain(
      "  [1] (endnote) Endnote text",
    );
  });

  it("omits the type parenthetical entirely for a footnote with none, not a blank pair", () => {
    const extras: DocxExtras = {
      ...EMPTY_EXTRAS,
      footnotes: [{ text: "Plain footnote" }],
    };
    expect(formatDocxExtrasLines(extras)).toContain("  [1] Plain footnote");
  });

  it("recurses into a table cell's own paragraphs, not just top-level ones", () => {
    const extras: DocxExtras = {
      ...EMPTY_EXTRAS,
      headerFooterParts: [
        {
          path: "word/header1.xml",
          kind: "header",
          blocks: [
            {
              kind: "table",
              columns: [{ widthPt: 100 }, { widthPt: 100 }],
              rows: [
                {
                  cells: [
                    {
                      blocks: [
                        {
                          kind: "paragraph",
                          runs: [{ text: "Cell one" }],
                        },
                      ],
                    },
                    {
                      blocks: [
                        {
                          kind: "paragraph",
                          runs: [{ text: "Cell two" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(formatDocxExtrasLines(extras)).toContain("  [1] Cell oneCell two");
  });

  it("reads a merged region's text once, since its covered entries hold no blocks", () => {
    const extras: DocxExtras = {
      ...EMPTY_EXTRAS,
      headerFooterParts: [
        {
          path: "word/header1.xml",
          kind: "header",
          blocks: [
            {
              kind: "table",
              columns: [{ widthPt: 100 }, { widthPt: 100 }],
              rows: [
                {
                  cells: [
                    {
                      colSpan: 2,
                      rowSpan: 2,
                      blocks: [
                        { kind: "paragraph", runs: [{ text: "Merged" }] },
                      ],
                    },
                    { blocks: [] },
                  ],
                },
                { cells: [{ blocks: [] }, { blocks: [] }] },
              ],
            },
          ],
        },
      ],
    };
    expect(formatDocxExtrasLines(extras)).toContain("  [1] Merged");
  });

  it("names the restart level in a numbering level's own line when it has one", () => {
    const extras: DocxExtras = {
      ...EMPTY_EXTRAS,
      numbering: {
        "1": {
          levels: {
            "0": { format: "decimal", text: "%1.", startAt: 1, restart: 1 },
          },
        },
      },
    };
    expect(formatDocxExtrasLines(extras)).toContain(
      '    level 0: decimal "%1." starting at 1, restarts at level 1',
    );
  });

  it("sorts numbering levels numerically, not lexicographically, once there are 10 or more", () => {
    const level = (startAt: number): NumberingLevel => ({
      format: "decimal",
      text: "%1.",
      startAt,
    });
    const extras: DocxExtras = {
      ...EMPTY_EXTRAS,
      numbering: {
        "1": {
          levels: {
            "2": level(2),
            "10": level(10),
          },
        },
      },
    };
    const lines = formatDocxExtrasLines(extras);
    const index2 = lines.findIndex((line) => line.includes("level 2:"));
    const index10 = lines.findIndex((line) => line.includes("level 10:"));
    // A lexicographic sort would place "10" before "2"; a numeric sort keeps 2 first.
    expect(index2).toBeLessThan(index10);
  });

  it("separates non-empty sections with exactly one blank line, and never leads with one", () => {
    const lines = formatDocxExtrasLines(fixtureExtras());
    expect(lines[0]).toBe("comments");
    const blankIndices = lines.reduce<number[]>(
      (acc, line, index) => (line === "" ? [...acc, index] : acc),
      [],
    );
    // Five sections in the fixture (comments, footnotes, headers, footers, numbering) -> four separating blank lines.
    expect(blankIndices).toHaveLength(4);
  });
});
