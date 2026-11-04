import { describe, expect, it } from "vitest";
import type { LayoutDocument, LayoutItem, LayoutText } from "pdf-codec";
import { renderContentDocumentToMarkdown } from "../markdown/render";
import { dropHiddenLineNumbers } from "./hidden-line-numbers";
import { reconstructWordprocessing } from "./reconstruct";

// Line numbers a page sets down its margin in white are not the document's content: ENA's engineering recommendations carry such a column, which a reader of the page never sees and the text read as digits among the words of the lines.

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 1, g: 1, b: 1 };
const NAVY = { r: 0, g: 0, b: 0.5 };
const SIZE_PT = 10;
const MARGIN_X_PT = 34;
const BODY_X_PT = 70;
const LINE_PITCH_PT = 20;
const FIRST_LINE_Y_PT = 700;

// The fewest line numbers a column has, as the rule reads one.
const MIN_LINE_NUMBERS = 3;

function text(
  value: string,
  xPt: number,
  yPt: number,
  color = BLACK,
  rotationDeg?: number,
): LayoutText {
  return {
    kind: "text",
    text: value,
    xPt,
    yPt,
    widthPt: value.length * SIZE_PT * 0.5,
    font: { family: "Helvetica", weight: "normal", style: "normal" },
    sizePt: SIZE_PT,
    color,
    ...(rotationDeg === undefined ? {} : { rotationDeg }),
  };
}

function documentOf(items: LayoutItem[]): LayoutDocument {
  return {
    formatVersion: 1,
    metadata: {},
    images: {},
    pages: [{ widthPt: 612, heightPt: 792, items }],
  };
}

function textsOf(doc: LayoutDocument): string[] {
  return (doc.pages[0]?.items ?? []).flatMap((item) =>
    item.kind === "text" ? [item.text] : [],
  );
}

// `count` lines of body text, each beside a line number in `lineNumberColor` that starts at `first`.
function numberedLines(
  count: number,
  first: number,
  lineNumberColor = WHITE,
): LayoutItem[] {
  return Array.from({ length: count }, (_line, index) => {
    const yPt = FIRST_LINE_Y_PT - index * LINE_PITCH_PT;
    return [
      text(String(first + index), MARGIN_X_PT, yPt, lineNumberColor),
      text(`Body line ${String(index)} of the page`, BODY_X_PT, yPt),
    ];
  }).flat();
}

describe("dropHiddenLineNumbers", () => {
  it("removes a column of white numbers down the margin and keeps the lines beside them", () => {
    const dropped = dropHiddenLineNumbers(
      documentOf(numberedLines(MIN_LINE_NUMBERS + 2, 171)),
    );

    expect(textsOf(dropped)).toEqual(
      Array.from(
        { length: MIN_LINE_NUMBERS + 2 },
        (_line, index) => `Body line ${String(index)} of the page`,
      ),
    );
  });

  it("removes a column that skips numbers where a paragraph break takes one, since it is rising and not consecutive", () => {
    const dropped = dropHiddenLineNumbers(
      documentOf([
        text("171", MARGIN_X_PT, 700, WHITE),
        text("first line", BODY_X_PT, 700),
        text("172", MARGIN_X_PT, 680, WHITE),
        text("second line", BODY_X_PT, 680),
        text("177", MARGIN_X_PT, 640, WHITE),
        text("after a paragraph break", BODY_X_PT, 640),
      ]),
    );

    expect(textsOf(dropped)).toEqual([
      "first line",
      "second line",
      "after a paragraph break",
    ]);
  });

  it("keeps a column too short to be line numbers", () => {
    const doc = documentOf(numberedLines(MIN_LINE_NUMBERS - 1, 171));

    expect(dropHiddenLineNumbers(doc)).toBe(doc);
  });

  it("keeps numbers that are not white, which a reader sees", () => {
    const doc = documentOf(numberedLines(MIN_LINE_NUMBERS + 2, 171, BLACK));

    expect(dropHiddenLineNumbers(doc)).toBe(doc);
  });

  it("keeps white numbers that do not rise down the page", () => {
    const doc = documentOf([
      text("5", MARGIN_X_PT, 700, WHITE),
      text("a", BODY_X_PT, 700),
      text("9", MARGIN_X_PT, 680, WHITE),
      text("b", BODY_X_PT, 680),
      text("2", MARGIN_X_PT, 660, WHITE),
      text("c", BODY_X_PT, 660),
    ]);

    expect(dropHiddenLineNumbers(doc)).toBe(doc);
  });

  it("keeps white numbers that are not left of the page's other text, as the cells of a table on a dark band are not", () => {
    const doc = documentOf(
      Array.from({ length: MIN_LINE_NUMBERS + 1 }, (_row, index) => {
        const yPt = FIRST_LINE_Y_PT - index * LINE_PITCH_PT;
        return [
          text("A heading further left", 20, 740),
          text(String(index + 1), BODY_X_PT, yPt, WHITE),
          text("a cell", 120, yPt),
        ];
      }).flat(),
    );

    expect(dropHiddenLineNumbers(doc)).toBe(doc);
  });

  it("keeps white numbers that have no line of text beside them", () => {
    const doc = documentOf([
      ...Array.from({ length: MIN_LINE_NUMBERS + 1 }, (_n, index) =>
        text(String(index + 1), MARGIN_X_PT, 700 - index * 20, WHITE),
      ),
      text("one line elsewhere", BODY_X_PT, 300),
    ]);

    expect(dropHiddenLineNumbers(doc)).toBe(doc);
  });

  it("keeps white numbers set on a coloured shape in the margin, which a reader sees", () => {
    const doc = documentOf([
      {
        kind: "rect",
        xPt: 20,
        yPt: 560,
        widthPt: 30,
        heightPt: 160,
        fill: NAVY,
      },
      ...numberedLines(MIN_LINE_NUMBERS + 1, 3),
    ]);

    expect(dropHiddenLineNumbers(doc)).toBe(doc);
  });

  it("keeps white numbers set on an ellipse, a filled path or an image", () => {
    const backdrops: LayoutItem[] = [
      {
        kind: "ellipse",
        xPt: 20,
        yPt: 560,
        widthPt: 30,
        heightPt: 160,
        fill: NAVY,
      },
      {
        kind: "path",
        subpaths: [
          {
            startXPt: 20,
            startYPt: 560,
            segments: [
              { kind: "line", xPt: 50, yPt: 560 },
              { kind: "line", xPt: 50, yPt: 720 },
            ],
            closed: true,
          },
        ],
        fill: NAVY,
      },
      {
        kind: "image",
        imageId: "tab",
        xPt: 20,
        yPt: 560,
        widthPt: 30,
        heightPt: 160,
      },
    ];
    for (const backdrop of backdrops) {
      const doc = documentOf([
        backdrop,
        ...numberedLines(MIN_LINE_NUMBERS + 1, 3),
      ]);

      expect(dropHiddenLineNumbers(doc)).toBe(doc);
    }
  });

  it("drops numbers over a shape filled white or not filled, since the page is white under it", () => {
    const dropped = dropHiddenLineNumbers(
      documentOf([
        {
          kind: "rect",
          xPt: 20,
          yPt: 560,
          widthPt: 30,
          heightPt: 160,
          fill: WHITE,
        },
        { kind: "rect", xPt: 20, yPt: 560, widthPt: 30, heightPt: 160 },
        ...numberedLines(MIN_LINE_NUMBERS + 1, 3),
      ]),
    );

    expect(textsOf(dropped)).not.toContain("3");
  });

  it("takes the page's left edge from its upright text, so a licence stamp set turned up the margin does not keep the numbers", () => {
    const stamp = text("Supplied to a licensee", 25, 35, BLACK, 90);

    const dropped = dropHiddenLineNumbers(
      documentOf([stamp, ...numberedLines(MIN_LINE_NUMBERS + 1, 171)]),
    );

    expect(textsOf(dropped)).not.toContain("171");
    expect(textsOf(dropped)).toContain("Supplied to a licensee");
  });

  it("keeps white words and white numbers elsewhere on a page whose margin it clears", () => {
    const dropped = dropHiddenLineNumbers(
      documentOf([
        ...numberedLines(MIN_LINE_NUMBERS + 1, 10),
        text("White heading", 300, 300, WHITE),
        text("7", 500, 300, WHITE),
      ]),
    );

    expect(textsOf(dropped)).toContain("White heading");
    expect(textsOf(dropped)).toContain("7");
    expect(textsOf(dropped)).not.toContain("10");
  });

  it("returns a document that loses nothing as the same object", () => {
    const doc = documentOf([text("visible", BODY_X_PT, 700)]);

    expect(dropHiddenLineNumbers(doc)).toBe(doc);
  });
});

describe("reconstructWordprocessing on a page with white line numbers in its margin", () => {
  it("reads the words of each line without the numbers beside them", () => {
    const content = reconstructWordprocessing(
      documentOf(numberedLines(MIN_LINE_NUMBERS + 3, 171)),
    );
    const markdown = renderContentDocumentToMarkdown(content);

    expect(markdown).not.toMatch(/\b17\d\b/u);
    expect(markdown).toContain("Body line 0 of the page");
    expect(markdown).toContain(
      `Body line ${String(MIN_LINE_NUMBERS + 2)} of the page`,
    );
  });
});
