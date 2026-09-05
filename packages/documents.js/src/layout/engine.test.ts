import { bytesToBase64 } from "ooxml.js";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentDocument,
  ContentImageBlock,
  ContentParagraph,
  ContentRun,
  ContentSection,
  ContentTable,
} from "document-schema.js";

import type {
  LayoutImage,
  LayoutItem,
  LayoutLine,
  LayoutLink,
  LayoutRect,
  LayoutText,
  TextMeasurer,
} from "pdf-codec";
import { encodePng } from "byte-codec";
import { loadMathFont } from "pdf-codec";
const mathMetricsAt = (sizePt: number) => loadMathFont().metricsAt(sizePt);
import { convertWordprocessingToLayout } from "./engine";

// Every character is sizePt/10 pt wide; lineHeightAtSize is 1.2x, ascender 0.8x, descender -0.2x -- the same fake-measurer convention already used across pdf-codec's own text-layout.test.ts, src/layout/slides.test.ts, and src/layout/shared.test.ts.
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

describe("convertWordprocessingToLayout: basic flow", () => {
  it("positions a single line, flipping Y from OOXML top-left/y-down into PDF bottom-left/y-up", () => {
    const layout = convert([section([paragraph([run("Hi", { sizePt: 10 })])])]);
    expect(layout.pages).toHaveLength(1);
    const [text] = textItems(layout.pages[0]!.items);
    // baselineYDown = 0(top margin) + ascent(8) = 8 -> y = 50 - 8 = 42.
    expect(text?.text).toBe("Hi");
    expect(text?.yPt).toBe(42);
  });

  it("stacks consecutive paragraphs by line height", () => {
    const layout = convert([
      section([
        paragraph([run("One", { sizePt: 10 })]),
        paragraph([run("Two", { sizePt: 10 })]),
      ]),
    ]);
    const items = textItems(layout.pages[0]!.items);
    expect(items.map((i) => i.text)).toEqual(["One", "Two"]);
    // line height = 12; para1 baseline=8->y=42; para2 baseline=12+8=20->y=30.
    expect(items[0]?.yPt).toBe(42);
    expect(items[1]?.yPt).toBe(30);
  });

  it("produces one page per section, using that section's own page size", () => {
    const layout = convert([
      section([paragraph([run("A", { sizePt: 10 })])], {
        pageSize: { widthPt: 100, heightPt: 50 },
      }),
      section([paragraph([run("B", { sizePt: 10 })])], {
        pageSize: { widthPt: 200, heightPt: 300 },
      }),
    ]);
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]).toMatchObject({ widthPt: 100, heightPt: 50 });
    expect(layout.pages[1]).toMatchObject({ widthPt: 200, heightPt: 300 });
  });

  it("produces exactly one (empty) page for a section with no blocks", () => {
    const layout = convert([section([])]);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]?.items).toHaveLength(0);
  });
});

describe("convertWordprocessingToLayout: pagination overflow", () => {
  it("starts a new page when the next line would overflow the content area", () => {
    // Page height 50, each line 12pt: four lines exactly fill (48pt used), a fifth overflows (60 > 50) and moves to a new page.
    const paragraphs = ["One", "Two", "Three", "Four", "Five"].map((word) =>
      paragraph([run(word, { sizePt: 10 })]),
    );
    const layout = convert([section(paragraphs)]);
    expect(layout.pages).toHaveLength(2);
    expect(textItems(layout.pages[0]!.items).map((i) => i.text)).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
    ]);
    expect(textItems(layout.pages[1]!.items).map((i) => i.text)).toEqual([
      "Five",
    ]);
  });

  it("never drops content, even a word so oversized each of its emergency-split characters is individually too tall for a page", () => {
    const layout = convert([
      section([paragraph([run("Huge", { sizePt: 1000 })])]),
    ]);
    const allText = layout.pages
      .flatMap((p) => textItems(p.items))
      .map((i) => i.text)
      .join("");
    expect(allText).toBe("Huge"); // every character survives, however many pages it took to place them
  });
});

describe("convertWordprocessingToLayout: explicit page breaks", () => {
  it("starts a new page at a pageBreak block, even when the current page has room left", () => {
    const layout = convert([
      section([
        paragraph([run("Before", { sizePt: 10 })]),
        { kind: "pageBreak" },
        paragraph([run("After", { sizePt: 10 })]),
      ]),
    ]);
    expect(layout.pages).toHaveLength(2);
    expect(textItems(layout.pages[0]!.items).map((i) => i.text)).toEqual([
      "Before",
    ]);
    expect(textItems(layout.pages[1]!.items).map((i) => i.text)).toEqual([
      "After",
    ]);
  });

  it("does not emit a blank leading page for a pageBreak with nothing before it", () => {
    const layout = convert([
      section([
        { kind: "pageBreak" },
        paragraph([run("After", { sizePt: 10 })]),
      ]),
    ]);
    expect(layout.pages).toHaveLength(1);
  });

  it("skips spacingBeforePt for a paragraph that starts a fresh page, avoiding stacked whitespace at the top", () => {
    const layout = convert([
      section([
        paragraph([run("Before", { sizePt: 10 })]),
        { kind: "pageBreak" },
        paragraph([run("After", { sizePt: 10 })], { spacingBeforePt: 1000 }),
      ]),
    ]);
    const [afterText] = textItems(layout.pages[1]!.items);
    // If spacingBeforePt had been applied, the baseline would be far off the page (1000+8 down from the top); instead it should sit at the same position an ordinary first line on a fresh page would.
    expect(afterText?.yPt).toBe(42);
  });
});

describe("convertWordprocessingToLayout: hyperlinks", () => {
  it("emits a LayoutLink alongside the text for a hyperlinked run", () => {
    const layout = convert([
      section([
        paragraph([
          run("link", { sizePt: 10, hyperlink: "https://example.com" }),
        ]),
      ]),
    ]);
    const links = layout.pages[0]!.items.filter(
      (i): i is LayoutLink => i.kind === "link",
    );
    expect(links).toHaveLength(1);
    expect(links[0]?.uri).toBe("https://example.com");
  });
});

describe("convertWordprocessingToLayout: images", () => {
  it("places an image at the content cursor, flipped, and registers it in the image registry", () => {
    const layout = convert([section([tinyPngBlock()])]);
    const [image] = layout.pages[0]!.items.filter(
      (i): i is LayoutImage => i.kind === "image",
    );
    expect(image).toBeDefined();
    // flipY at cursor 0 on a 50pt-tall page with a 20pt image: yPt = 50 - 0 - 20 = 30.
    expect(image?.yPt).toBe(30);
    expect(layout.images[image!.imageId]?.format).toBe("png");
  });

  it("advances the cursor past a placed image for subsequent content", () => {
    const layout = convert([
      section([
        tinyPngBlock(),
        paragraph([run("After image", { sizePt: 10 })]),
      ]),
    ]);
    const [text] = textItems(layout.pages[0]!.items);
    // cursor after a 20pt image = 20; baseline = 20+8=28 -> y = 50-28 = 22.
    expect(text?.yPt).toBe(22);
  });
});

describe("convertWordprocessingToLayout: tables", () => {
  function tableWithRowHeights(...heights: number[]): ContentTable {
    return {
      kind: "table",
      columnWidthsPt: [100],
      rows: heights.map((h, i) => ({
        heightPt: h,
        cells: [{ blocks: [paragraph([run(`Row${i}`, { sizePt: 10 })])] }],
      })),
    };
  }

  it("positions each row's text stacked by row height", () => {
    const layout = convert([section([tableWithRowHeights(10, 10)])]);
    const items = textItems(layout.pages[0]!.items);
    expect(items.map((i) => i.text)).toEqual(["Row0", "Row1"]);
  });

  it("splits a table row-atomically: a row that doesn't fit moves entirely to a new page rather than splitting", () => {
    const layout = convert([section([tableWithRowHeights(30, 30)])]); // page height 50: row0 fits (0-30), row1 (30+30=60) doesn't
    expect(layout.pages).toHaveLength(2);
    expect(textItems(layout.pages[0]!.items).map((i) => i.text)).toEqual([
      "Row0",
    ]);
    expect(textItems(layout.pages[1]!.items).map((i) => i.text)).toEqual([
      "Row1",
    ]);
  });

  it("emits a background rect for a cell with a fill colour", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [100],
      rows: [
        {
          heightPt: 20,
          cells: [
            {
              blocks: [],
              background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
            },
          ],
        },
      ],
    };
    const layout = convert([section([table])]);
    const rects = layout.pages[0]!.items.filter(
      (i): i is LayoutRect => i.kind === "rect",
    );
    expect(rects).toHaveLength(1);
    expect(rects[0]?.fill).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("emits no background rect at all for a pattern fill that resolves to no colour, rather than a fill-less no-op one", () => {
    // A 'pattern' fill stating neither foregroundColor nor backgroundColor (the reserved gray125 scaffolding pattern, or a theme/indexed colour this reader could not resolve) is exactly the case resolveCellFillColor's own doc comment names as returning undefined -- genuinely no fill, not a reason to still push a rect item that would render invisibly.
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [100],
      rows: [
        {
          heightPt: 20,
          cells: [
            {
              blocks: [],
              background: { kind: "pattern", patternType: "gray125" },
            },
          ],
        },
      ],
    };
    const layout = convert([section([table])]);
    const rects = layout.pages[0]!.items.filter(
      (i): i is LayoutRect => i.kind === "rect",
    );
    expect(rects).toHaveLength(0);
  });

  it("emits one LayoutLine per declared border edge of a cell, at that edge's own position", () => {
    const red = { r: 1, g: 0, b: 0 };
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [100],
      rows: [
        {
          heightPt: 20,
          cells: [
            {
              blocks: [],
              borders: {
                top: { color: red, widthPt: 2 },
                bottom: { color: red, widthPt: 2 },
              },
            },
          ],
        },
      ],
    };
    const layout = convert([section([table])]);
    const lines = layout.pages[0]!.items.filter(
      (i): i is LayoutLine => i.kind === "line",
    );
    expect(lines).toHaveLength(2); // top and bottom only -- left/right were never declared
    // Page height 50, cell frame y-down (0, 0, 100, 20): top edge at PDF y 50, bottom edge at PDF y 30.
    expect(lines).toContainEqual(
      expect.objectContaining({
        x1Pt: 0,
        y1Pt: 50,
        x2Pt: 100,
        y2Pt: 50,
        color: red,
        widthPt: 2,
      }),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({
        x1Pt: 0,
        y1Pt: 30,
        x2Pt: 100,
        y2Pt: 30,
        color: red,
        widthPt: 2,
      }),
    );
  });

  it("carries a declared border's own dash style through onto the emitted LayoutLine, as of document-schema.js 2.1.0", () => {
    const red = { r: 1, g: 0, b: 0 };
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [100],
      rows: [
        {
          heightPt: 20,
          cells: [
            {
              blocks: [],
              borders: { top: { color: red, widthPt: 2, style: "dashed" } },
            },
          ],
        },
      ],
    };
    const layout = convert([section([table])]);
    const [line] = layout.pages[0]!.items.filter(
      (i): i is LayoutLine => i.kind === "line",
    );
    expect(line).toMatchObject({ style: "dashed", color: red, widthPt: 2 });
  });

  it("attributes a cell's own background and borders to that cell's own sourcePath, falling back to the table's when it has none", () => {
    const red = { r: 1, g: 0, b: 0 };
    const table: ContentTable = {
      kind: "table",
      sourcePath: "sections[0].blocks[0]",
      columnWidthsPt: [50, 50],
      rows: [
        {
          heightPt: 20,
          cells: [
            {
              blocks: [],
              background: { kind: "solid", color: red },
              borders: { top: { color: red, widthPt: 1 } },
              sourcePath: "sections[0].blocks[0].rows[0].cells[0]",
            },
            {
              blocks: [],
              background: { kind: "solid", color: red },
              borders: { top: { color: red, widthPt: 1 } },
            },
          ],
        },
      ],
    };
    const decorations = convert([section([table])]).pages[0]!.items.filter(
      (i) => i.kind === "rect" || i.kind === "line",
    );
    expect(
      decorations.filter(
        (i) => i.sourcePath === "sections[0].blocks[0].rows[0].cells[0]",
      ),
    ).toHaveLength(2); // the first cell's own rect + line
    expect(
      decorations.filter((i) => i.sourcePath === "sections[0].blocks[0]"),
    ).toHaveLength(2); // the second cell's, falling back to the table's
  });

  it("scales column widths proportionally to fit the content width", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [50, 50],
      rows: [
        {
          heightPt: 10,
          cells: [
            { blocks: [] },
            { blocks: [paragraph([run("B", { sizePt: 10 })])] },
          ],
        },
      ],
    };
    const layout = convert([
      section([table], {
        pageSize: { widthPt: 200, heightPt: 50 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
      }),
    ]);
    // grid width 100 scaled to content width 200 -> scale 2; second column starts at 50*2=100.
    const [text] = textItems(layout.pages[0]!.items);
    expect(text?.xPt).toBe(100);
  });
});

describe("convertWordprocessingToLayout: indentation and alignment", () => {
  it("offsets a paragraph by its own indentLeftPt", () => {
    const layout = convert([
      section([paragraph([run("Hi", { sizePt: 10 })], { indentLeftPt: 20 })]),
    ]);
    const [text] = textItems(layout.pages[0]!.items);
    expect(text?.xPt).toBe(20);
  });

  it("centers a line within the content width", () => {
    const layout = convert([
      section([
        paragraph([run("hi", { sizePt: 10 })], { alignment: "center" }),
      ]),
    ]);
    const [text] = textItems(layout.pages[0]!.items);
    // width('hi')=2; content width 100; offset=(100-2)/2=49.
    expect(text?.xPt).toBe(49);
  });

  it("stretches inter-word gaps on a justified paragraph's own wrapped (non-final) lines, but leaves its final line at natural, unstretched spacing", () => {
    // Content width 7pt; each word ('aa'/'bb'/'cc'/'dd') is 2pt wide, a space 1pt -- "aa bb" (5pt) fits, "aa bb cc" (8pt) doesn't, so this wraps into two lines of two words each: "aa bb" then "cc dd", both naturally 5pt wide.
    const layout = convert([
      section(
        [
          paragraph([run("aa bb cc dd", { sizePt: 10 })], {
            alignment: "justify",
          }),
        ],
        {
          pageSize: { widthPt: 7, heightPt: 50 },
          margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        },
      ),
    ]);
    const [aa, bb, cc, dd] = textItems(layout.pages[0]!.items);
    expect([aa?.text, bb?.text, cc?.text, dd?.text]).toEqual([
      "aa",
      "bb",
      "cc",
      "dd",
    ]);

    // Non-final line ("aa bb"): natural width 5pt against a 7pt target line box -- 2pt of slack, one gap, so the whole 2pt lands on 'bb', which is otherwise naturally 1pt after 'aa'.
    expect(aa?.xPt).toBe(0);
    expect(bb?.xPt).toBe(5); // natural offset 3 + 2pt of distributed slack
    const nonFinalGapPt = (bb?.xPt ?? 0) - (aa?.xPt ?? 0) - 2; // 2 = width of 'aa'

    // Final line ("cc dd") is never stretched, even though it has the identical 2pt of slack available -- it renders at its own natural, single-space gap instead.
    expect(cc?.xPt).toBe(0);
    expect(dd?.xPt).toBe(3);
    const finalGapPt = (dd?.xPt ?? 0) - (cc?.xPt ?? 0) - 2;

    expect(nonFinalGapPt).toBe(3);
    expect(finalGapPt).toBe(1);
    expect(nonFinalGapPt).toBeGreaterThan(finalGapPt);
  });
});

describe("convertWordprocessingToLayout: heading styles", () => {
  it("renders a Heading1-styled paragraph bold and larger than the nominal body text size, resolved at layout time from styleId", () => {
    const layout = convert([
      section([paragraph([run("Title")], { styleId: "Heading1" })]),
    ]);
    const [text] = textItems(layout.pages[0]!.items);
    expect(text?.font.weight).toBe("bold");
    expect(text?.sizePt).toBe(28);
  });

  it("does not override a run's own explicit bold/sizePt inside a heading", () => {
    const layout = convert([
      section([
        paragraph([run("Title", { bold: false, sizePt: 9 })], {
          styleId: "Heading2",
        }),
      ]),
    ]);
    const [text] = textItems(layout.pages[0]!.items);
    expect(text?.font.weight).toBe("normal");
    expect(text?.sizePt).toBe(9);
  });

  it("leaves an ordinary (non-heading) paragraph at the nominal body size", () => {
    const layout = convert([section([paragraph([run("Body")])])]);
    const [text] = textItems(layout.pages[0]!.items);
    expect(text?.font.weight).toBe("normal");
    expect(text?.sizePt).toBe(18);
  });

  it("ignores a styleId that is not a recognised Heading1-6 style", () => {
    const layout = convert([
      section([paragraph([run("Quote")], { styleId: "Quote" })]),
    ]);
    const [text] = textItems(layout.pages[0]!.items);
    expect(text?.font.weight).toBe("normal");
    expect(text?.sizePt).toBe(18);
  });
});

describe("convertWordprocessingToLayout: list markers", () => {
  it("draws a bullet glyph in the indent gutter before a level-0 list item, left of the item's own text", () => {
    const layout = convert([
      section([
        paragraph([run("Item", { sizePt: 10 })], {
          list: { numId: "1", level: 0 },
        }),
      ]),
    ]);
    const items = textItems(layout.pages[0]!.items);
    expect(items.map((i) => i.text)).toEqual(["•", "Item"]);
    expect(items[0]!.xPt).toBeLessThan(items[1]!.xPt);
  });

  it("cycles the bullet glyph by nesting depth", () => {
    const layout = convert([
      section([
        paragraph([run("One", { sizePt: 10 })], {
          list: { numId: "1", level: 0 },
        }),
        paragraph([run("Two", { sizePt: 10 })], {
          list: { numId: "1", level: 1 },
        }),
        paragraph([run("Three", { sizePt: 10 })], {
          list: { numId: "1", level: 2 },
        }),
      ]),
    ]);
    const items = textItems(layout.pages[0]!.items);
    const markers = items
      .filter((i) => !["One", "Two", "Three"].includes(i.text))
      .map((i) => i.text);
    expect(markers).toEqual(["•", "-", "*"]);
  });

  it('a docx/odt-conventional numId ("1", "list1") always degrades to a bullet -- ContentListMembership carries no format field to distinguish ordered from bullet for those sources', () => {
    const layout = convert([
      section([
        paragraph([run("First", { sizePt: 10 })], {
          list: { numId: "list1", level: 0 },
        }),
        paragraph([run("Second", { sizePt: 10 })], {
          list: { numId: "list1", level: 0 },
        }),
      ]),
    ]);
    const items = textItems(layout.pages[0]!.items);
    const markers = items
      .filter((i) => !["First", "Second"].includes(i.text))
      .map((i) => i.text);
    expect(markers).toEqual(["•", "•"]);
  });

  it("renders real sequential numbers for a markdown-minted ordered-list numId, via markdown-codec's own public numId convention", () => {
    const layout = convert([
      section([
        paragraph([run("First", { sizePt: 10 })], {
          list: { numId: "md1:ordered@1", level: 0 },
        }),
        paragraph([run("Second", { sizePt: 10 })], {
          list: { numId: "md1:ordered@1", level: 0 },
        }),
        paragraph([run("Third", { sizePt: 10 })], {
          list: { numId: "md1:ordered@1", level: 0 },
        }),
      ]),
    ]);
    const items = textItems(layout.pages[0]!.items);
    const markers = items
      .filter((i) => !["First", "Second", "Third"].includes(i.text))
      .map((i) => i.text);
    expect(markers).toEqual(["1.", "2.", "3."]);
  });

  it("starts an ordered list at its own declared start value", () => {
    const layout = convert([
      section([
        paragraph([run("Item", { sizePt: 10 })], {
          list: { numId: "md1:ordered@5", level: 0 },
        }),
      ]),
    ]);
    const items = textItems(layout.pages[0]!.items);
    expect(items[0]!.text).toBe("5.");
  });

  it("draws no marker at all for a paragraph with no list membership", () => {
    const layout = convert([
      section([paragraph([run("Plain", { sizePt: 10 })])]),
    ]);
    const items = textItems(layout.pages[0]!.items);
    expect(items.map((i) => i.text)).toEqual(["Plain"]);
  });
});
