import { bytesToBase64 } from "ooxml.js";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentDocument,
  ContentEmbeddedObjectBlock,
  ContentImageBlock,
  ContentParagraph,
  ContentRun,
  ContentSection,
  ContentTable,
} from "document-schema.js";

import type {
  LayoutImage,
  LayoutItem,
  LayoutLink,
  LayoutText,
  TextMeasurer,
} from "pdf-codec";
import { encodePng, loadMathFont } from "pdf-codec";
import { latexToFormula } from "../latex/lower";
import { convertWordprocessingToLayout } from "./engine";

// The companion suite to engine.test.ts's behaviour pins: exact coordinate pins for the flow and cell geometry (engine.test.ts sits at the max-lines ceiling). The same fake-measurer convention as engine.test.ts applies throughout: every character is sizePt/10 pt wide, lineHeightAtSize is 1.2x, ascender 0.8x, descender -0.2x, on a 100x50pt page with zero default margins, so a sizePt-10 run is 1pt per character, a 12pt line, an 8pt ascent, a -2pt descent, and the list gutter step is 18pt.

const mathMetricsAt = (sizePt: number) => loadMathFont().metricsAt(sizePt);

function fakeMeasurer(): TextMeasurer {
  return {
    widthOfTextAtSize: (text, _font, sizePt) =>
      Array.from(text).length * (sizePt / 10),
    lineHeightAtSize: (_font, sizePt) => sizePt * 1.2,
    ascenderAtSize: (_font, sizePt) => sizePt * 0.8,
    descenderAtSize: (_font, sizePt) => -sizePt * 0.2,
    underlineAtSize: (_font, sizePt) => ({
      offsetPt: -sizePt * 0.1,
      thicknessPt: sizePt * 0.05,
    }),
    horizontalScaleFor: () => 1,
  };
}

function run(text: string, overrides: Partial<ContentRun> = {}): ContentRun {
  return { text, ...overrides };
}

function paragraph(
  runs: ContentRun[],
  overrides: Partial<ContentParagraph> = {},
): ContentParagraph {
  return { kind: "paragraph", runs, ...overrides };
}

function section(
  blocks: ContentBlock[],
  overrides: Partial<ContentSection> = {},
): ContentSection {
  return {
    pageSize: { widthPt: 100, heightPt: 50 },
    margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
    blocks,
    ...overrides,
  };
}

function doc(
  sections: ContentSection[],
): Extract<ContentDocument, { kind: "wordprocessing" }> {
  return { kind: "wordprocessing", metadata: {}, sections };
}

function convert(sections: ContentSection[]) {
  return convertWordprocessingToLayout(doc(sections), {
    measurer: fakeMeasurer(),
    mathMetricsAt,
  }).document;
}

function textItems(items: readonly LayoutItem[]): LayoutText[] {
  return items.filter((i): i is LayoutText => i.kind === "text");
}

function linkItems(items: readonly LayoutItem[]): LayoutLink[] {
  return items.filter((i): i is LayoutLink => i.kind === "link");
}

function imageItems(items: readonly LayoutItem[]): LayoutImage[] {
  return items.filter((i): i is LayoutImage => i.kind === "image");
}

function twoColumnTable(
  cells: ContentTable["rows"][number]["cells"],
): ContentTable {
  return {
    kind: "table",
    columns: [{ widthPt: 50 }, { widthPt: 50 }],
    rows: [{ heightPt: 30, cells }],
  };
}

function tinyPngBlock(): ContentImageBlock {
  const bytes = encodePng({
    width: 2,
    height: 2,
    channels: 3,
    data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
  });
  return {
    kind: "image",
    format: "png",
    base64: bytesToBase64(bytes),
    widthPt: 20,
    heightPt: 20,
  };
}

function formulaBlock(): ContentEmbeddedObjectBlock {
  return {
    kind: "embeddedObject",
    objectKind: "formula",
    frame: { xPt: 0, yPt: 0, widthPt: 28, heightPt: 14 },
    document: {
      kind: "formula",
      metadata: {},
      formula: latexToFormula("\\sqrt{x}").formula,
    },
  };
}

describe("convertWordprocessingToLayout: exact paragraph-flow geometry", () => {
  it("places the list marker one gutter step left of the item's own indented text, per nesting level", () => {
    const layout = convert([
      section([
        paragraph([run("I", { sizePt: 10 })], {
          list: { numId: "1", level: 0 },
        }),
        paragraph([run("J", { sizePt: 10 })], {
          list: { numId: "1", level: 2 },
        }),
      ]),
    ]);
    const items = textItems(layout.pages[0]!.items);
    expect(items.map((i) => i.text)).toEqual(["•", "I", "*", "J"]);
    // Level 0: marker at 0 steps, text at 1 step (18pt). Level 2: marker at 2 steps (36pt), text at 3 steps (54pt).
    expect(items[0]!.xPt).toBe(0);
    expect(items[1]!.xPt).toBe(18);
    expect(items[2]!.xPt).toBe(36);
    expect(items[3]!.xPt).toBe(54);
    // Both rows of each pair share the line's baseline, flipped: y = 50 - 8.
    expect(items[0]!.yPt).toBe(42);
    expect(items[1]!.yPt).toBe(42);
  });

  it("shrinks the wrap width by the left indent and the list gutter together", () => {
    // Content width 100; indentLeft 10 + level-0 gutter 18 leave 72pt of wrap width, so an 80-character word (80pt) emergency-splits at exactly 72.
    const layout = convert([
      section([
        paragraph([run("w".repeat(80), { sizePt: 10 })], {
          indentLeftPt: 10,
          list: { numId: "1", level: 0 },
        }),
      ]),
    ]);
    const items = textItems(layout.pages[0]!.items).filter(
      (i) => i.text !== "•",
    );
    expect(items).toHaveLength(2);
    // Both pieces of the split start at the paragraph's own left edge: 10 + 18.
    expect(items[0]!.xPt).toBe(28);
    expect(items[0]!.text).toHaveLength(72);
    expect(items[1]!.text).toHaveLength(8);
  });

  it("applies the first-line indent to line one only, and multiplies each line's advance by the line spacing", () => {
    // Page width 5pt: "aaa bbb" (7pt) wraps to one word per line.
    const layout = convert([
      section(
        [
          paragraph([run("aaa bbb", { sizePt: 10 })], {
            indentFirstLinePt: 7,
            lineSpacing: 0.5,
          }),
        ],
        { pageSize: { widthPt: 5, heightPt: 50 } },
      ),
    ]);
    const items = textItems(layout.pages[0]!.items);
    expect(items.map((i) => i.text)).toEqual(["aaa", "bbb"]);
    // Line one starts at the first-line indent; line two does not.
    expect(items[0]!.xPt).toBe(7);
    expect(items[1]!.xPt).toBe(0);
    // Line one's baseline is the page-top ascent; with 0.5 spacing the advance is 6pt, so line two's baseline sits 6pt lower.
    expect(items[0]!.yPt).toBe(42);
    expect(items[1]!.yPt).toBe(36);
  });

  it("draws the list marker on the item's first line only, not on its wrapped continuation", () => {
    const layout = convert([
      section(
        [
          paragraph([run("aaaa bbbb", { sizePt: 10 })], {
            list: { numId: "1", level: 0 },
          }),
        ],
        { pageSize: { widthPt: 5, heightPt: 50 } },
      ),
    ]);
    const items = textItems(layout.pages[0]!.items);
    expect(items.map((i) => i.text)).toEqual(["•", "aaaa", "bbbb"]);
    expect(items[0]!.yPt).toBe(items[1]!.yPt);
  });

  it("advances the cursor by spacing after the first paragraph and spacing before the second", () => {
    const layout = convert([
      section([
        paragraph([run("One", { sizePt: 10 })], { spacingAfterPt: 6 }),
        paragraph([run("Two", { sizePt: 10 })], { spacingBeforePt: 5 }),
      ]),
    ]);
    const items = textItems(layout.pages[0]!.items);
    // Line 12pt + after 6 + before 5 = 23pt of cursor, so the second baseline is 31pt down: y = 50 - 31 = 19.
    expect(items[1]!.yPt).toBe(19);
  });

  it("never flushes an empty page for an oversized first item: the item stays on page one and overflows", () => {
    const layout = convert([
      section([paragraph([run("Big", { sizePt: 60 })])]),
    ]);
    expect(layout.pages).toHaveLength(1);
    expect(textItems(layout.pages[0]!.items)).toHaveLength(1);
  });

  it("keeps a line that exactly meets the content bottom on the current page", () => {
    // Bottom margin 2pt: content bottom is 48pt. Four 12pt lines end at exactly 48, which still fits ("would overflow" is strict).
    const layout = convert([
      section([paragraph([run("a\nb\nc\nd", { sizePt: 10 })])], {
        margins: { topPt: 0, rightPt: 0, bottomPt: 2, leftPt: 0 },
      }),
    ]);
    expect(layout.pages).toHaveLength(1);
    const items = textItems(layout.pages[0]!.items);
    expect(items).toHaveLength(4);
  });

  it("breaks pages against the margin-derived content bottom", () => {
    // Bottom margin 6pt: content bottom 44pt. A five-line paragraph places 3 lines (36pt) then flushes before line four (36+12 > 44).
    const layout = convert([
      section([paragraph([run("a\nb\nc\nd\ne", { sizePt: 10 })])], {
        margins: { topPt: 0, rightPt: 0, bottomPt: 6, leftPt: 0 },
      }),
    ]);
    expect(layout.pages).toHaveLength(2);
    expect(textItems(layout.pages[0]!.items)).toHaveLength(3);
    expect(textItems(layout.pages[1]!.items)).toHaveLength(2);
  });

  it("derives the content left and wrap width from the left and right margins", () => {
    // Left 12 right 8: content left 12, wrap width 80, so an 85-character word splits (85 > 80) and every line starts at 12.
    const layout = convert([
      section([paragraph([run("w".repeat(85), { sizePt: 10 })])], {
        margins: { topPt: 0, rightPt: 8, bottomPt: 0, leftPt: 12 },
      }),
    ]);
    const items = textItems(layout.pages[0]!.items);
    expect(items).toHaveLength(2);
    expect(items[0]!.xPt).toBe(12);
    expect(items[1]!.xPt).toBe(12);
  });

  it("sizes a hyperlink's box from the line's ascent and descent around the flipped baseline", () => {
    const layout = convert([
      section([
        paragraph([
          run("Go", {
            sizePt: 10,
            hyperlink: "https://example.com/",
          }),
        ]),
      ]),
    ]);
    const [link] = linkItems(layout.pages[0]!.items);
    expect(link?.uri).toBe("https://example.com/");
    // Box top at the baseline plus the descent (-2pt), height spanning ascent minus descent: 50 - 8 - 2 = 40, 8 - (-2) = 10.
    expect(link?.xPt).toBe(0);
    expect(link?.yPt).toBe(40);
    expect(link?.widthPt).toBe(2);
    expect(link?.heightPt).toBe(10);
  });

  it("registers the placed image under an id the emitted item actually carries", () => {
    const block = tinyPngBlock();
    const result = convertWordprocessingToLayout(doc([section([block])]), {
      measurer: fakeMeasurer(),
      mathMetricsAt,
    });
    const [image] = imageItems(result.document.pages[0]!.items);
    expect(typeof image?.imageId).toBe("string");
    expect(image && result.document.images[image.imageId]).toBeDefined();
  });

  it("does not open a blank page for a page break with nothing before it", () => {
    const layout = convert([
      section([{ kind: "pageBreak" }, paragraph([run("Hi", { sizePt: 10 })])]),
    ]);
    expect(layout.pages).toHaveLength(1);
    expect(textItems(layout.pages[0]!.items).map((i) => i.text)).toEqual([
      "Hi",
    ]);
  });
});

describe("convertWordprocessingToLayout: exact table-cell geometry", () => {
  // A two-column 50/50 table on the 100pt-wide page: scale 1, so each cell is 50pt wide starting at x 0 and 50.
  it("baselines cell text from the row's top", () => {
    const layout = convert([
      section([
        twoColumnTable([
          { blocks: [paragraph([run("Hi", { sizePt: 10 })])] },
          { blocks: [] },
        ]),
      ]),
    ]);
    const [text] = textItems(layout.pages[0]!.items);
    expect(text?.text).toBe("Hi");
    expect(text?.xPt).toBe(0);
    expect(text?.yPt).toBe(42);
  });

  it("advances the in-cell cursor through spacing after and before", () => {
    const layout = convert([
      section([
        twoColumnTable([
          {
            blocks: [
              paragraph([run("One", { sizePt: 10 })], {
                spacingAfterPt: 4,
              }),
              paragraph([run("Two", { sizePt: 10 })], {
                spacingBeforePt: 5,
              }),
            ],
          },
          { blocks: [] },
        ]),
      ]),
    ]);
    const items = textItems(layout.pages[0]!.items);
    // 12pt line + 4 after + 5 before = 21, baseline 29: y = 50 - 29 = 21.
    expect(items[1]!.yPt).toBe(21);
  });

  it("indents and wraps a cell's list item inside the cell's own width, marker in the level's gutter", () => {
    // Level 1 claims 2 gutter steps (36pt) of the 50pt cell, leaving 14pt of wrap width; each 10-character word is 10pt, so the paragraph wraps one word per line.
    const layout = convert([
      section([
        twoColumnTable([
          {
            blocks: [
              paragraph([run("cccccccccc dddddddddd", { sizePt: 10 })], {
                list: { numId: "1", level: 1 },
                indentFirstLinePt: 3,
                lineSpacing: 0.5,
              }),
            ],
          },
          { blocks: [] },
        ]),
      ]),
    ]);
    const items = textItems(layout.pages[0]!.items);
    expect(items.map((i) => i.text)).toEqual(["-", "cccccccccc", "dddddddddd"]);
    // Marker one step left of the text's own edge (36 - 18); line one carries the first-line indent, line two does not.
    expect(items[0]!.xPt).toBe(18);
    expect(items[1]!.xPt).toBe(39);
    expect(items[2]!.xPt).toBe(36);
    // 0.5 spacing advances 6pt per line.
    expect(items[0]!.yPt).toBe(42);
    expect(items[2]!.yPt).toBe(36);
  });

  it("stretches a justified cell paragraph's wrapped non-final line only", () => {
    // A 6pt cell: "aa bb" (5pt) fits on one line, "aa bb cc" (8pt) does not, so line one holds two words and line two the third.
    const layout = convert([
      section(
        [
          {
            kind: "table",
            columns: [{ widthPt: 6 }, { widthPt: 6 }],
            rows: [
              {
                heightPt: 30,
                cells: [
                  {
                    blocks: [
                      paragraph([run("aa bb cc", { sizePt: 10 })], {
                        alignment: "justify",
                      }),
                    ],
                  },
                  { blocks: [] },
                ],
              },
            ],
          },
        ],
        { pageSize: { widthPt: 12, heightPt: 50 } },
      ),
    ]);
    const items = textItems(layout.pages[0]!.items);
    expect(items.map((i) => i.text)).toEqual(["aa", "bb", "cc"]);
    // Non-final line: 1pt of slack lands in the single gap, so 'bb' moves past its natural 3pt offset. Final line keeps its own natural start.
    expect(items[1]!.xPt).toBe(4);
    expect(items[2]!.xPt).toBe(0);
  });
});

describe("convertWordprocessingToLayout: embedded formula placement", () => {
  it("places the formula flipped, with the following content advanced past its box", () => {
    const block = formulaBlock();
    const result = convertWordprocessingToLayout(
      doc([section([block, paragraph([run("After", { sizePt: 10 })])])]),
      { measurer: fakeMeasurer(), mathMetricsAt },
    );
    const [text] = textItems(result.document.pages[0]!.items);
    expect(text?.text).toBe("After");
    // The block's own frame is flipped PDF space: its bottom sits at the page top's cursor (0), so frame.y + frame.height = 50.
    const frame = block.frames?.[0];
    expect(frame).toBeDefined();
    expect(frame!.yPt + frame!.heightPt).toBe(50);
    expect(frame!.xPt).toBe(0);
    expect(frame!.pageIndex).toBe(0);
    // The formula's side-channel entry matches its frame, and the following paragraph's baseline is exactly one ascent (8pt) below the frame's top.
    expect(result.formulas).toHaveLength(1);
    expect(result.formulas[0]!.xPt).toBe(frame!.xPt);
    expect(result.formulas[0]!.yPt).toBe(frame!.yPt);
    expect(text!.yPt).toBe(frame!.yPt - 8);
  });

  it("falls back to the plain-text stand-in when the block carries no MathML to typeset", () => {
    const { formula } = latexToFormula("\\sqrt{x}");
    const block: ContentEmbeddedObjectBlock = {
      kind: "embeddedObject",
      objectKind: "formula",
      frame: { xPt: 0, yPt: 0, widthPt: 28, heightPt: 14 },
      document: {
        kind: "formula",
        metadata: {},
        formula: { ...formula, mathml: [] },
      },
    };
    const result = convertWordprocessingToLayout(doc([section([block])]), {
      measurer: fakeMeasurer(),
      mathMetricsAt,
    });
    expect(result.formulas).toHaveLength(0);
    const items = textItems(result.document.pages[0]!.items);
    expect(items).toHaveLength(1);
    // The stand-in is the formula's own verbatim presentation, the LaTeX it came in as.
    expect(items[0]!.text).toBe("\\sqrt{x}");
  });

  it("lays out nothing at all for an embedded object that is not a formula document", () => {
    const block: ContentEmbeddedObjectBlock = {
      kind: "embeddedObject",
      objectKind: "formula",
      frame: { xPt: 0, yPt: 0, widthPt: 28, heightPt: 14 },
      document: doc([section([])]),
    };
    const result = convertWordprocessingToLayout(doc([section([block])]), {
      measurer: fakeMeasurer(),
      mathMetricsAt,
    });
    expect(result.document.pages[0]!.items).toHaveLength(0);
    expect(result.formulas).toHaveLength(0);
  });
});
