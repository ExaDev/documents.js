import type {} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { WpdDiagnosticCodes, type WpdDiagnostic } from "./diagnostics";
import { readWpdContent } from "./read";
import {
  buildWpdFile,
  summaryPacket,
  text,
  variableFunction,
  wordString,
} from "./test-support/build-wpd";
import {
  COLUMN_GROUP,
  DISPLAY_NUMBER_GROUP,
  HARD_EOL,
  PAGE_GROUP,
  TAB_GROUP,
  marginFunction,
  pageForm,
  paragraphsOf,
  readDocumentArea,
  readWithDiagnostics,
  sectionOf,
  styleScope,
} from "./test-support/structure-fixtures";

describe("page geometry", () => {
  it("uses the WordPerfect default when the document states no geometry", () => {
    const section = sectionOf(readDocumentArea(text("plain")));
    expect(section.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
    expect(section.margins).toEqual({
      topPt: 72,
      rightPt: 72,
      bottomPt: 72,
      leftPt: 72,
    });
  });

  // A4 is 210 by 297 millimetres, which is 9921 by 14031 of WordPerfect's own 1200ths of an inch.
  it("reads the page size out of the Form function", () => {
    const section = sectionOf(
      readDocumentArea([
        ...pageForm({ lengthWpu: 14031, widthWpu: 9921 }),
        ...text("A4"),
      ]),
    );
    expect(section.pageSize.widthPt).toBeCloseTo(595.26, 2);
    expect(section.pageSize.heightPt).toBeCloseTo(841.86, 2);
  });

  // The vertical pair lives in the Page group and the horizontal pair in the Column group — a left or right margin is a column-oriented fact in this format.
  it("reads all four margins from their own two groups", () => {
    const section = sectionOf(
      readDocumentArea([
        ...marginFunction(PAGE_GROUP, 0x00, 600),
        ...marginFunction(PAGE_GROUP, 0x01, 900),
        ...marginFunction(COLUMN_GROUP, 0x00, 1800),
        ...marginFunction(COLUMN_GROUP, 0x01, 2400),
        ...text("margins"),
      ]),
    );
    expect(section.margins).toEqual({
      topPt: 36,
      bottomPt: 54,
      leftPt: 108,
      rightPt: 144,
    });
  });

  it("keeps the default for a dimension the document does not state", () => {
    const section = sectionOf(
      readDocumentArea([
        ...marginFunction(PAGE_GROUP, 0x00, 600),
        ...text("x"),
      ]),
    );
    expect(section.margins).toEqual({
      topPt: 36,
      rightPt: 72,
      bottomPt: 72,
      leftPt: 72,
    });
  });

  it("keeps the document's opening geometry and reports a later change", () => {
    const { document, diagnostics } = readWithDiagnostics([
      ...marginFunction(PAGE_GROUP, 0x00, 600),
      ...text("first"),
      HARD_EOL,
      ...marginFunction(PAGE_GROUP, 0x00, 2400),
      ...text("second"),
    ]);
    expect(sectionOf(document).margins.topPt).toBe(36);
    expect(
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === WpdDiagnosticCodes.PageGeometryChanged,
      ),
    ).toHaveLength(1);
  });

  it("reports a landscape form without rotating its stated dimensions", () => {
    const { document, diagnostics } = readWithDiagnostics([
      ...pageForm({ lengthWpu: 10200, widthWpu: 13200, orientation: 1 }),
      ...text("wide"),
    ]);
    expect(sectionOf(document).pageSize).toEqual({
      widthPt: 792,
      heightPt: 612,
    });
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === WpdDiagnosticCodes.LandscapeOrientationUnmapped,
      ),
    ).toBe(true);
  });

  it("does not report a landscape orientation for a portrait form", () => {
    const { diagnostics } = readWithDiagnostics([
      ...pageForm({ lengthWpu: 14031, widthWpu: 9921, orientation: 0 }),
      ...text("A4"),
    ]);
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === WpdDiagnosticCodes.LandscapeOrientationUnmapped,
      ),
    ).toBe(false);
  });

  it("does not report a page geometry change when the same value is stated twice", () => {
    const { diagnostics } = readWithDiagnostics([
      ...marginFunction(PAGE_GROUP, 0x00, 600),
      ...text("first"),
      HARD_EOL,
      ...marginFunction(PAGE_GROUP, 0x00, 600),
      ...text("second"),
    ]);
    expect(
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === WpdDiagnosticCodes.PageGeometryChanged,
      ),
    ).toHaveLength(0);
  });

  it("reports a page geometry change only once across more than one later change", () => {
    const { diagnostics } = readWithDiagnostics([
      ...marginFunction(PAGE_GROUP, 0x00, 600),
      ...text("first"),
      HARD_EOL,
      ...marginFunction(PAGE_GROUP, 0x00, 1200),
      ...text("second"),
      HARD_EOL,
      ...marginFunction(PAGE_GROUP, 0x00, 2400),
      ...text("third"),
    ]);
    expect(
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === WpdDiagnosticCodes.PageGeometryChanged,
      ),
    ).toHaveLength(1);
  });

  // applyPageGroup's own top/bottom dispatch must actually gate on the subgroup, not fall into the bottom-margin branch for any subgroup it does not recognise as either margin.
  it("does not apply a page margin function whose subgroup is neither top nor bottom", () => {
    const section = sectionOf(
      readDocumentArea([
        ...marginFunction(PAGE_GROUP, 0x02, 600),
        ...text("x"),
      ]),
    );
    expect(section.margins).toEqual({
      topPt: 72,
      rightPt: 72,
      bottomPt: 72,
      leftPt: 72,
    });
  });

  // applyColumnGroup's own left/right dispatch must actually gate on the subgroup, not fall into the right-margin branch for any subgroup it does not recognise as either margin.
  it("does not apply a column margin function whose subgroup is neither left nor right", () => {
    const section = sectionOf(
      readDocumentArea([
        ...marginFunction(COLUMN_GROUP, 0x02, 600),
        ...text("x"),
      ]),
    );
    expect(section.margins).toEqual({
      topPt: 72,
      rightPt: 72,
      bottomPt: 72,
      leftPt: 72,
    });
  });
});

describe("styles", () => {
  // "68 = heading level 1 style" through "75 = heading level 8 style", from the Global On function's own system style number.
  it("reads a heading level from the system style number", () => {
    const document = readDocumentArea([
      ...styleScope(68, text("Title")),
      HARD_EOL,
      ...text("Body"),
    ]);
    expect(paragraphsOf(document).map((p) => p.headingLevel)).toEqual([
      1,
      undefined,
    ]);
  });

  // A style region ends at its own closing code, which in a real document sits BEFORE the hard return that ends the paragraph — so the heading is captured when the paragraph's first character arrives rather than when it closes.
  it("keeps the heading level when the style closes before the hard return", () => {
    const document = readDocumentArea([
      ...styleScope(70, text("Third level")),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document)[0]?.headingLevel).toBe(3);
  });

  it("keeps the heading level when the hard return sits inside the style", () => {
    const document = readDocumentArea([
      ...styleScope(69, [...text("Second level"), HARD_EOL]),
    ]);
    expect(paragraphsOf(document)[0]?.headingLevel).toBe(2);
  });

  // The heading level is captured once, at the paragraph's own first character, and never re-derived from whatever style happens to be active later in the same paragraph — a second, different structural style opening later must not overwrite it.
  it("keeps the first style's own heading level, not a second style's, within one paragraph", () => {
    const document = readDocumentArea([
      ...styleScope(70, text("a")),
      ...styleScope(69, text("b")),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document)[0]?.headingLevel).toBe(3);
  });

  // "52 = level 1 style (indented)" — an outline level, counted from zero by ContentListMembership.
  it("reads an outline level style as a list membership", () => {
    const document = readDocumentArea([
      ...styleScope(53, text("Nested item")),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document)[0]?.list).toEqual({ level: 1 });
  });

  // Both structural facts (heading level and list membership) are captured together, at the paragraph's first character, from whichever single style is active then — not independently, each from whatever style happens to be active when its own first non-undefined value shows up. A list style at the first character must keep the paragraph's own list membership even once a later, heading-only style becomes active in the same paragraph.
  it("keeps the first style's own list membership once a later style sets a heading instead", () => {
    const document = readDocumentArea([
      ...styleScope(53, text("a")),
      ...styleScope(68, text("b")),
      HARD_EOL,
    ]);
    const paragraph = paragraphsOf(document)[0];
    expect(paragraph?.list).toEqual({ level: 1 });
    expect(paragraph?.headingLevel).toBeUndefined();
  });

  // An enclosing Global On naming the document's own Normal style must not override a heading opened inside it.
  it("takes the innermost style that says something structural", () => {
    const document = readDocumentArea([
      ...styleScope(1, styleScope(68, text("Heading"))),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document)[0]?.headingLevel).toBe(1);
  });

  // The reverse nesting: a structural style opened OUTSIDE a later, transparent one. effectiveStyle's own findLast walk must skip the innermost (Normal) scope, whose semantics are undefined, to reach the outer heading style rather than stopping at the first scope it sees regardless of what it means.
  it("reaches past an innermost style with no structural meaning to an outer heading style", () => {
    const document = readDocumentArea([
      ...styleScope(68, styleScope(1, text("Heading"))),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document)[0]?.headingLevel).toBe(1);
  });
});

describe("outline numbering", () => {
  // "<level number to display (0 - n)>" — the rendered digits between the pair are generated content, replaced by the list membership that regenerates them.
  it("reads a paragraph number display as a list membership and drops its digits", () => {
    const { document, diagnostics } = readWithDiagnostics([
      ...variableFunction({
        group: DISPLAY_NUMBER_GROUP,
        subgroup: 0x0c,
        nonDeletable: [2],
      }),
      ...text("III."),
      ...variableFunction({ group: DISPLAY_NUMBER_GROUP, subgroup: 0x0d }),
      ...text("Item text"),
      HARD_EOL,
    ]);
    const paragraph = paragraphsOf(document)[0];
    expect(paragraph?.list).toEqual({ level: 2 });
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe("Item text");
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === WpdDiagnosticCodes.OutlineNumberRegenerated,
    );
    expect(found?.message).toBe(
      "An outline number's rendered digits were replaced by the list membership that regenerates them.",
    );
  });

  // Every other member of the group displays a counter inside running text and carries no structure, so its digits stay exactly where they are.
  // applyDisplayNumberGroup's own Off dispatch must actually gate on the subfunction being an Off, not decrement the suppression depth for any subgroup it does not recognise as one — a page-number-display On (0x04) sits in the very same function group but names none of the paragraph-number On/Off codes.
  it("does not end paragraph-number suppression for an unrelated function in the same group", () => {
    const document = readDocumentArea([
      ...variableFunction({
        group: DISPLAY_NUMBER_GROUP,
        subgroup: 0x0c,
        nonDeletable: [0],
      }),
      ...text("hidden"),
      ...variableFunction({
        group: DISPLAY_NUMBER_GROUP,
        subgroup: 0x04, // page number display On — a real function, but not a paragraph-number Off
        nonDeletable: [0],
      }),
      ...text("stillHidden"),
      ...variableFunction({ group: DISPLAY_NUMBER_GROUP, subgroup: 0x0d }),
      ...text("shown"),
    ]);
    expect(
      paragraphsOf(document)[0]
        ?.runs.map((r) => r.text)
        .join(""),
    ).toBe("shown");
  });

  it("leaves a page number display's own text in place", () => {
    const document = readDocumentArea([
      ...text("page "),
      ...variableFunction({
        group: DISPLAY_NUMBER_GROUP,
        subgroup: 0x04,
        nonDeletable: [0],
      }),
      ...text("7"),
      ...variableFunction({ group: DISPLAY_NUMBER_GROUP, subgroup: 0x05 }),
    ]);
    const paragraph = paragraphsOf(document)[0];
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe("page 7");
    expect(paragraph?.list).toBeUndefined();
  });
});

describe("tabs", () => {
  // The Tab group has no subfunction catalogue: the byte in the subfunction position is the tab definition itself, whose top five bits name the type. Dropping the group ran real documents' columns together, which is a text loss rather than a formatting one.
  it("advances to a tab stop as a tab character", () => {
    const document = readDocumentArea([
      ...text("Name"),
      ...variableFunction({ group: TAB_GROUP, subgroup: 0b00010 << 3 }),
      ...text("Country"),
    ]);
    expect(
      paragraphsOf(document)[0]
        ?.runs.map((run) => run.text)
        .join(""),
    ).toBe("Name\tCountry");
  });

  // Centre-on-margins is the missing half of the construct the single-byte End of Center Align function already ends.
  it("centres the line a centring code begins", () => {
    const document = readDocumentArea([
      ...variableFunction({ group: TAB_GROUP, subgroup: 0b01000 << 3 }),
      ...text("Title"),
      HARD_EOL,
      ...text("Body"),
    ]);
    expect(paragraphsOf(document).map((p) => p.alignment)).toEqual([
      "center",
      undefined,
    ]);
  });

  it("right-aligns the line a flush-right code begins", () => {
    const document = readDocumentArea([
      ...variableFunction({ group: TAB_GROUP, subgroup: 0b10000 << 3 }),
      ...text("Date"),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document)[0]?.alignment).toBe("right");
  });

  // A line-scoped centring code applies to the line it sits in; Set Justification Mode applies from where it sits onwards, so the narrower one wins for that paragraph and the wider one resumes after it.
  it("lets a line-scoped alignment outrank the document justification for its own paragraph", () => {
    const document = readDocumentArea([
      ...variableFunction({
        group: 0xd3,
        subgroup: 0x05,
        nonDeletable: [3],
      }),
      ...variableFunction({ group: TAB_GROUP, subgroup: 0b01000 << 3 }),
      ...text("centred"),
      HARD_EOL,
      ...text("right"),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document).map((p) => p.alignment)).toEqual([
      "center",
      "right",
    ]);
  });
});

describe("document metadata", () => {
  it("reads the Extended Document Summary packet", () => {
    const document = readDocumentArea(text("body"), [
      summaryPacket([
        { tag: 17, type: 0x01, data: wordString("Annual review") },
        { tag: 5, type: 0x01, data: wordString("A. Writer") },
        { tag: 26, type: 0x01, data: wordString("annual, review") },
      ]),
    ]);
    expect(document.metadata).toEqual({
      title: "Annual review",
      author: "A. Writer",
      keywords: ["annual", "review"],
    });
  });

  it("answers an empty envelope for a document carrying no summary", () => {
    expect(readDocumentArea(text("body")).metadata).toEqual({});
  });

  // readMetadata's own packet lookup must actually filter on packet type, not just take the first packet in the index — a document whose summary is not the first packet must still find it.
  it("finds the summary packet even when it is not the first packet in the index", () => {
    const document = readDocumentArea(text("body"), [
      { packetType: 0x08, bytes: new Uint8Array(0) }, // General WP Text, not a summary
      summaryPacket([{ tag: 17, type: 0x01, data: wordString("Found it") }]),
    ]);
    expect(document.metadata).toEqual({ title: "Found it" });
  });
});

describe("constructs this reader does not lift", () => {
  // Each of these is recognised by the tokeniser and skipped by the fold, so a document containing it still reads — and says what it lost rather than passing over it in silence. Group 0xD6 no longer appears here: a header, footer, or watermark function is LIFTED into ContentSection.headers/footers/watermarks (see the page-furniture describe below), and a function whose occurrence bits claim neither parity is suppressed in its own file and lifts nothing with nothing to report.
  it.each([
    [
      0xdf,
      WpdDiagnosticCodes.BoxDropped,
      0x00,
      "This document contains a box — a figure, text box, equation, or graphic — whose function-level override names no content this reader can resolve.",
    ],
    [
      0xd7,
      WpdDiagnosticCodes.NoteDropped,
      0x00,
      "This document contains a footnote or endnote whose body packet this reader could not resolve; only its reference text survived.",
    ],
    [
      0xd5,
      WpdDiagnosticCodes.CrossReferenceFlattened,
      0x00,
      "This document contains a cross-reference; its displayed text survives as ordinary text, and the reference's own target binding does not.",
    ],
    [
      0xde,
      WpdDiagnosticCodes.MergeCodeDropped,
      0x00,
      "This document contains merge codes, which are a form-letter template's placeholders rather than text.",
    ],
  ])(
    "reports group %i through the diagnostic sink",
    (group, code, subgroup, message) => {
      const { document, diagnostics } = readWithDiagnostics([
        ...text("before"),
        ...variableFunction({ group, subgroup }),
        ...text("after"),
      ]);
      expect(
        paragraphsOf(document)[0]
          ?.runs.map((run) => run.text)
          .join(""),
      ).toBe("beforeafter");
      const matches = diagnostics.filter(
        (diagnostic) => diagnostic.code === code,
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]?.message).toBe(message);
    },
  );
});

describe("page geometry margin subgroup isolation", () => {
  it("sets only the bottom margin from PAGE_BOTTOM_MARGIN_SET, leaving the top at its default", () => {
    const section = sectionOf(
      readDocumentArea([
        ...marginFunction(PAGE_GROUP, 0x01, 900), // bottom only
        ...text("x"),
      ]),
    );
    expect(section.margins.bottomPt).toBe(54);
    expect(section.margins.topPt).toBe(72); // default, not touched
  });

  it("sets only the right margin from COLUMN_RIGHT_MARGIN_SET, leaving the left at its default", () => {
    const section = sectionOf(
      readDocumentArea([
        ...marginFunction(COLUMN_GROUP, 0x01, 2400), // right only
        ...text("x"),
      ]),
    );
    expect(section.margins.rightPt).toBe(144);
    expect(section.margins.leftPt).toBe(72); // default, not touched
  });

  it("reports the exact PageGeometryChanged message", () => {
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile([
        ...marginFunction(PAGE_GROUP, 0x00, 600),
        ...text("first"),
        HARD_EOL,
        ...marginFunction(PAGE_GROUP, 0x00, 2400),
        ...text("second"),
      ]),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.PageGeometryChanged,
    );
    expect(found?.message).toBe(
      "This document changes its page size or margins partway through; the section carries the geometry the document opens with.",
    );
  });

  it("reports the exact landscape-orientation message", () => {
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile([
        ...pageForm({ lengthWpu: 10200, widthWpu: 13200, orientation: 1 }),
        ...text("wide"),
      ]),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.LandscapeOrientationUnmapped,
    );
    expect(found?.message).toBe(
      "The document's form declares a landscape orientation; the form's own stated width and length are used as written, since a page size carries no orientation.",
    );
  });
});
