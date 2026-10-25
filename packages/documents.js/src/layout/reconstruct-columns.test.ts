import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentParagraph } from "document-schema.js";
import type {
  LayoutDocument,
  LayoutImageAsset,
  LayoutItem,
  LayoutText,
} from "pdf-codec";
import { reconstructWordprocessing } from "./reconstruct";
import { reconstructPresentation } from "./reconstruct-presentations-prod";

// Column reading order. The prose fixtures follow the geometry of a two-column public guidance PDF (HSE's HSG141): A4, 12pt type on 15pt leading, columns about 240pt wide starting at x 56.7 and 303, and the two columns' baselines a twentieth of a point apart, close enough for clusterIntoLines to give each pair one line.

const SIZE_PT = 12;
const LEADING_PT = 15;
// Fixture text advances half an em per letter; the word space is Helvetica's own (278/1000 em), the narrowest gap the reader treats as a word break.
const CHAR_EM = 1 / 2;
const SPACE_EM = 278 / 1000;
const CHAR_PT = CHAR_EM * SIZE_PT;
const SPACE_PT = SPACE_EM * SIZE_PT;
const LEFT_COLUMN_X = 56.7;
const RIGHT_COLUMN_X = 303;
const COLUMN_WIDTH = 240;
// Each fixture column ends at least one gutter short of the next, as the source's do: 56.7 + 240 leaves 6.3pt before 303.
const RIGHT_BASELINE_OFFSET = 0.05;

function advancePt(value: string, sizePt: number): number {
  const spaces = value.split(" ").length - 1;
  return ((value.length - spaces) * CHAR_EM + spaces * SPACE_EM) * sizePt;
}

function text(
  value: string,
  xPt: number,
  yPt: number,
  options: { sizePt?: number; bold?: boolean } = {},
): LayoutText {
  const sizePt = options.sizePt ?? SIZE_PT;
  return {
    kind: "text",
    text: value,
    xPt,
    yPt,
    font: {
      family: "Helvetica",
      weight: options.bold === true ? "bold" : "normal",
      style: "normal",
    },
    sizePt,
    color: { r: 0, g: 0, b: 0 },
    widthPt: advancePt(value, sizePt),
  };
}

// Sets paragraphs ragged-right into a column `widthPt` wide, greedily filling each line, one item per line (or per word when `perWord` is set, as some producers paint each word separately), with a blank line between paragraphs. Returns the items and each paragraph's text as the reader should rebuild it: its lines joined by a space.
function setColumn(
  paragraphs: readonly string[],
  xPt: number,
  topYPt: number,
  options: { widthPt?: number; perWord?: boolean } = {},
): { items: LayoutText[]; expected: string[] } {
  const widthPt = options.widthPt ?? COLUMN_WIDTH;
  const items: LayoutText[] = [];
  const expected: string[] = [];
  let yPt = topYPt;
  for (const paragraph of paragraphs) {
    const lines: string[][] = [[]];
    let usedPt = 0;
    for (const word of paragraph.split(" ")) {
      const wordPt = word.length * CHAR_PT;
      const current = lines.at(-1)!;
      if (current.length > 0 && usedPt + SPACE_PT + wordPt > widthPt) {
        lines.push([word]);
        usedPt = wordPt;
      } else {
        usedPt += (current.length > 0 ? SPACE_PT : 0) + wordPt;
        current.push(word);
      }
    }
    for (const words of lines) {
      if (options.perWord === true) {
        let wordX = xPt;
        for (const word of words) {
          items.push(text(word, wordX, yPt));
          wordX += word.length * CHAR_PT + SPACE_PT;
        }
      } else {
        items.push(text(words.join(" "), xPt, yPt));
      }
      yPt -= LEADING_PT;
    }
    expected.push(lines.map((words) => words.join(" ")).join(" "));
    yPt -= LEADING_PT;
  }
  return { items, expected };
}

const LEFT_PARAGRAPHS = [
  "Employers must assess the risks to workers and any others who may be affected by their work or business, so that they can decide what measures are needed to protect them.",
  "Where the work involves contractors, the client should check that each contractor has the skills, knowledge and experience to carry out the work safely before it starts.",
];
const RIGHT_PARAGRAPHS = [
  "Records of the assessment should identify the hazards found, the people who might be harmed and how, and what the organisation is already doing to control the risks.",
  "The assessment should be reviewed whenever there is reason to suspect it is no longer valid, or after a significant change to the work, the equipment or the people involved.",
];

function docFrom(
  items: LayoutItem[],
  images: Record<string, LayoutImageAsset> = {},
): LayoutDocument {
  return {
    formatVersion: 1,
    metadata: {},
    pages: [{ widthPt: 595.3, heightPt: 841.9, items }],
    images,
  };
}

function blocksOf(
  doc: ReturnType<typeof reconstructWordprocessing>,
): ContentBlock[] {
  if (doc.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing document");
  }
  return doc.sections.flatMap((section) => section.blocks);
}

function paragraphText(block: ContentParagraph): string {
  return block.runs.map((run) => run.text).join("");
}

function paragraphTexts(doc: LayoutDocument): string[] {
  return blocksOf(reconstructWordprocessing(doc))
    .filter((b): b is ContentParagraph => b.kind === "paragraph")
    .map(paragraphText);
}

function twoColumns(perWord = false): {
  items: LayoutText[];
  left: string[];
  right: string[];
} {
  const left = setColumn(LEFT_PARAGRAPHS, LEFT_COLUMN_X, 700, { perWord });
  const right = setColumn(
    RIGHT_PARAGRAPHS,
    RIGHT_COLUMN_X,
    700 + RIGHT_BASELINE_OFFSET,
    { perWord },
  );
  // Content-stream order, as the source paints it: the left column top to bottom, then the right.
  return {
    items: [...left.items, ...right.items],
    left: left.expected,
    right: right.expected,
  };
}

describe("reconstructWordprocessing: column reading order", () => {
  it("reads two prose columns whose baselines line up as the left column and then the right, not interleaved line by line", () => {
    const { items, left, right } = twoColumns();
    expect(paragraphTexts(docFrom(items))).toEqual([...left, ...right]);
  });

  it("reads the columns in order when the producer paints every word as its own item", () => {
    const { items, left, right } = twoColumns(true);
    expect(paragraphTexts(docFrom(items))).toEqual([...left, ...right]);
  });

  it("reads a full-width heading above two columns first, then each column in turn", () => {
    const { items, left, right } = twoColumns();
    const heading = text(
      "Managing risks and risk assessment at work for employers",
      LEFT_COLUMN_X,
      740,
      { sizePt: 18, bold: true },
    );
    expect(paragraphTexts(docFrom([heading, ...items]))).toEqual([
      heading.text,
      ...left,
      ...right,
    ]);
  });

  it("reads a full-width passage between two column bands after the columns above it and before the columns below it", () => {
    const upper = twoColumns();
    // The passage spans both columns: it is set at the full width the two columns and their gutter cover.
    const passage = setColumn(
      [
        "Case study: a site manager found that a change to the delivery schedule meant vehicles and pedestrians shared the same route at the busiest time of the day.",
      ],
      LEFT_COLUMN_X,
      520,
      { widthPt: RIGHT_COLUMN_X + COLUMN_WIDTH - LEFT_COLUMN_X },
    );
    const lowerLeft = setColumn([LEFT_PARAGRAPHS[0]!], LEFT_COLUMN_X, 400);
    const lowerRight = setColumn(
      [RIGHT_PARAGRAPHS[0]!],
      RIGHT_COLUMN_X,
      400 + RIGHT_BASELINE_OFFSET,
    );
    expect(
      paragraphTexts(
        docFrom([
          ...upper.items,
          ...passage.items,
          ...lowerLeft.items,
          ...lowerRight.items,
        ]),
      ),
    ).toEqual([
      ...upper.left,
      ...upper.right,
      ...passage.expected,
      ...lowerLeft.expected,
      ...lowerRight.expected,
    ]);
  });

  it("reads columns of uneven length in full, the longer column's lines below the shorter one's end included", () => {
    const left = setColumn(LEFT_PARAGRAPHS, LEFT_COLUMN_X, 700);
    const right = setColumn(
      [RIGHT_PARAGRAPHS[0]!],
      RIGHT_COLUMN_X,
      700 + RIGHT_BASELINE_OFFSET,
    );
    expect(paragraphTexts(docFrom([...left.items, ...right.items]))).toEqual([
      ...left.expected,
      ...right.expected,
    ]);
  });

  it("places an image set in the right column after the left column's text and before the right column's text beneath it", () => {
    const left = setColumn(LEFT_PARAGRAPHS, LEFT_COLUMN_X, 700);
    const right = setColumn(RIGHT_PARAGRAPHS, RIGHT_COLUMN_X, 600);
    const blocks = blocksOf(
      reconstructWordprocessing(
        docFrom(
          [
            ...left.items,
            {
              kind: "image",
              imageId: "figure",
              xPt: RIGHT_COLUMN_X,
              yPt: 620,
              widthPt: COLUMN_WIDTH,
              heightPt: 90,
            },
            ...right.items,
          ],
          {
            figure: { format: "png", base64: "AAAA", widthPx: 10, heightPx: 4 },
          },
        ),
      ),
    );
    expect(
      blocks.map((block) =>
        block.kind === "paragraph" ? paragraphText(block) : block.kind,
      ),
    ).toEqual([...left.expected, "image", ...right.expected]);
  });

  it("leaves a single column exactly as clustering the whole page reads it", () => {
    const column = setColumn(
      [...LEFT_PARAGRAPHS, ...RIGHT_PARAGRAPHS],
      LEFT_COLUMN_X,
      760,
      { widthPt: RIGHT_COLUMN_X + COLUMN_WIDTH - LEFT_COLUMN_X },
    );
    expect(paragraphTexts(docFrom(column.items))).toEqual(column.expected);
  });

  it("leaves a grid of equal-width figures read across its rows", () => {
    const columns = [60, 180, 300, 420];
    const items: LayoutText[] = [];
    const rows: string[] = [];
    for (let row = 0; row < 6; row++) {
      const cells = columns.map(
        (_, column) => `${String(row + 1)}.${String(column + 1)}0`,
      );
      columns.forEach((xPt, column) => {
        items.push(text(cells[column]!, xPt, 700 - row * LEADING_PT));
      });
      rows.push(cells.join("\t"));
    }
    expect(paragraphTexts(docFrom(items))).toEqual([rows.join(" ")]);
  });

  it("leaves a table of wide columns holding short ragged cells read across its rows", () => {
    const cells = [
      ["Lifting operations", "Yes"],
      ["Work at height", "Not applicable"],
      ["Confined spaces", "See note 4"],
      ["Hot work", "Permit required"],
      ["Excavations", "Yes"],
    ];
    const items = cells.flatMap(([label, value], row) => [
      text(label!, LEFT_COLUMN_X, 700 - row * LEADING_PT),
      text(
        value!,
        RIGHT_COLUMN_X,
        700 + RIGHT_BASELINE_OFFSET - row * LEADING_PT,
      ),
    ]);
    // The cells are tens of points apart, beyond the reader's two-em tab gap, so each row reads as one tab-separated line.
    expect(paragraphTexts(docFrom(items))).toEqual([
      cells.map((row) => row.join("\t")).join(" "),
    ]);
  });

  it("leaves a table of short codes beside long descriptions read across its rows", () => {
    const cells = [
      ["G81", "Framework for design and planning of new housing developments"],
      ["G99", "Requirements for the connection of generation equipment"],
      ["P28", "Planning limits for voltage fluctuations caused by equipment"],
      [
        "P29",
        "Planning limits for voltage unbalance on the transmission system",
      ],
    ];
    const items = cells.flatMap(([code, description], row) => [
      text(code!, LEFT_COLUMN_X, 700 - row * LEADING_PT),
      text(description!, 120, 700 - row * LEADING_PT),
    ]);
    expect(paragraphTexts(docFrom(items))).toEqual([
      cells.map((row) => row.join("\t")).join(" "),
    ]);
  });
});

describe("reconstructPresentation: column reading order", () => {
  it("builds each prose column into its own text shapes, the left column's first", () => {
    const { items, left, right } = twoColumns();
    const doc = reconstructPresentation(docFrom(items));
    if (doc.kind !== "presentation") {
      throw new Error("expected a presentation document");
    }
    const shapeTexts = doc.slides[0]!.shapes.map((shape) =>
      shape.blocks
        .filter((b): b is ContentParagraph => b.kind === "paragraph")
        .map(paragraphText)
        .join(" "),
    );
    // The blank line between paragraphs ends a text block, so each paragraph is its own shape.
    expect(shapeTexts).toEqual([...left, ...right]);
  });
});
