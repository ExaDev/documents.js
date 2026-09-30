import { describe, expect, it } from "vitest";
import type { LayoutText } from "pdf-codec";
import { reconstructWordprocessing } from "./reconstruct";
import {
  clusterIntoLines,
  estimateModalLineSpacing,
  fontSizesClose,
  modeOf,
  paragraphToContentParagraph,
  textItemVerticalExtent,
} from "./reconstruct-lines";

// The measurement edges of line clustering, pinned against the exported helpers directly: ordering of lines and items out of scrambled input, the mode's empty and tied cases, the modal-spacing fallbacks at the three-line threshold, the size-closeness boundaries at exactly one point and exactly the 0.15 ratio, the exact run frames a line stamps (the shared Helvetica vertical metrics), the line-join space, the heading's dropped bold key, and the paragraph-break indent signal at exactly one em.

const BLACK = { r: 0, g: 0, b: 0 };

function text(overrides: {
  text: string;
  xPt: number;
  yPt: number;
  widthPt?: number;
  bold?: boolean;
  italic?: boolean;
}): LayoutText {
  return {
    kind: "text",
    text: overrides.text,
    xPt: overrides.xPt,
    yPt: overrides.yPt,
    font: {
      family: "Helvetica",
      weight: overrides.bold === true ? "bold" : "normal",
      style: overrides.italic === true ? "italic" : "normal",
    },
    sizePt: 12,
    color: BLACK,
    ...(overrides.widthPt !== undefined ? { widthPt: overrides.widthPt } : {}),
  };
}

describe("clusterIntoLines ordering", () => {
  it("lines come out baseline-descending and items left-to-right, whatever order they arrived in", () => {
    const lines = clusterIntoLines([
      text({ text: "right", xPt: 100, yPt: 700, widthPt: 30 }),
      text({ text: "left", xPt: 50, yPt: 700, widthPt: 20 }),
      text({ text: "upper", xPt: 50, yPt: 724, widthPt: 30 }),
    ]);
    expect(
      lines.map((line) => [line.baselineY, line.items.map((i) => i.text)]),
    ).toEqual([
      [724, ["upper"]],
      [700, ["left", "right"]],
    ]);
  });
});

describe("modeOf", () => {
  it("an empty sample modes to zero", () => {
    expect(modeOf([], 0.5)).toBe(0);
  });

  it("a count tie keeps the first-occurring bucket", () => {
    expect(modeOf([12, 24, 12, 24], 0.5)).toBe(12);
    expect(modeOf([24, 12, 24, 12], 0.5)).toBe(24);
  });
});

describe("estimateModalLineSpacing", () => {
  it("below three lines the spacing is the dominant size on the nominal ratio", () => {
    const lines = clusterIntoLines([
      text({ text: "a", xPt: 0, yPt: 700, widthPt: 5 }),
      text({ text: "b", xPt: 0, yPt: 688, widthPt: 5 }),
    ]);
    expect(estimateModalLineSpacing(lines)).toBeCloseTo(14.4, 10);
  });

  it("a repeated gap modes, and with no repetition the smallest gap stands in", () => {
    const repeated = clusterIntoLines([
      text({ text: "a", xPt: 0, yPt: 700, widthPt: 5 }),
      text({ text: "b", xPt: 0, yPt: 688, widthPt: 5 }),
      text({ text: "c", xPt: 0, yPt: 676, widthPt: 5 }),
      text({ text: "d", xPt: 0, yPt: 626, widthPt: 5 }),
    ]);
    expect(estimateModalLineSpacing(repeated)).toBe(12);
    const distinct = clusterIntoLines([
      text({ text: "a", xPt: 0, yPt: 700, widthPt: 5 }),
      text({ text: "b", xPt: 0, yPt: 670, widthPt: 5 }),
      text({ text: "c", xPt: 0, yPt: 620, widthPt: 5 }),
    ]);
    expect(estimateModalLineSpacing(distinct)).toBe(30);
  });
});

describe("fontSizesClose", () => {
  it("closes at exactly one point and at exactly the ratio bound, and no further", () => {
    expect(fontSizesClose(99, 100)).toBe(true);
    expect(fontSizesClose(85, 100)).toBe(true);
    expect(fontSizesClose(84, 100)).toBe(false);
  });
});

describe("textItemVerticalExtent", () => {
  it("the standard-14 vertical metrics, in points at the given size", () => {
    expect(textItemVerticalExtent(text({ text: "x", xPt: 0, yPt: 0 }))).toEqual(
      { ascentPt: 8.616, descentPt: 2.484 },
    );
  });
});

describe("paragraphToContentParagraph", () => {
  it("stamps each line's exact frame and joins lines with a trailing space on the earlier run", () => {
    const para = paragraphToContentParagraph(
      {
        lines: clusterIntoLines([
          text({ text: "one", xPt: 50, yPt: 700, widthPt: 20 }),
          text({ text: "two", xPt: 50, yPt: 676, widthPt: 20 }),
        ]),
      },
      0,
      undefined,
    );
    expect(para.runs.map((r) => r.text)).toEqual(["one ", "two"]);
    expect(para.runs[0]?.frames).toEqual([
      { pageIndex: 0, xPt: 50, yPt: 697.516, widthPt: 20, heightPt: 11.1 },
    ]);
    expect(para.runs[1]?.frames).toEqual([
      { pageIndex: 0, xPt: 50, yPt: 673.516, widthPt: 20, heightPt: 11.1 },
    ]);
  });

  it("alignment reads as left while every line starts within the tolerance, exactly on it included", () => {
    const aligned = paragraphToContentParagraph(
      {
        lines: clusterIntoLines([
          text({ text: "a", xPt: 50, yPt: 700, widthPt: 20 }),
          text({ text: "b", xPt: 52, yPt: 676, widthPt: 20 }),
        ]),
      },
      0,
      undefined,
    );
    expect(aligned.alignment).toBe("left");
    const ragged = paragraphToContentParagraph(
      {
        lines: clusterIntoLines([
          text({ text: "a", xPt: 50, yPt: 700, widthPt: 20 }),
          text({ text: "b", xPt: 52.5, yPt: 676, widthPt: 20 }),
        ]),
      },
      0,
      undefined,
    );
    expect(ragged.alignment).toBeUndefined();
  });

  it("an inferred heading drops the run's bold key outright and keeps everything else", () => {
    const heading = paragraphToContentParagraph(
      {
        lines: clusterIntoLines([
          text({
            text: "Title",
            xPt: 50,
            yPt: 700,
            widthPt: 30,
            bold: true,
            italic: true,
          }),
        ]),
      },
      0,
      1,
    );
    expect(heading.styleId).toBe("Heading1");
    expect(heading.headingLevel).toBe(1);
    expect(heading.runs[0]).toStrictEqual({
      text: "Title",
      italic: true,
      fontFamily: "Helvetica",
      sizePt: 12,
      color: BLACK,
      frames: [
        { pageIndex: 0, xPt: 50, yPt: 697.516, widthPt: 30, heightPt: 11.1 },
      ],
    });
  });
});

describe("the paragraph-break indent signal", () => {
  function paragraphsOf(x2: number): string[] {
    const doc = reconstructWordprocessing({
      formatVersion: 1,
      metadata: {},
      images: {},
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          items: [
            text({ text: "aa", xPt: 50, yPt: 700, widthPt: 20 }),
            text({ text: "bb", xPt: x2, yPt: 676, widthPt: 20 }),
            text({ text: "cc", xPt: 50, yPt: 652, widthPt: 20 }),
          ],
        },
      ],
    });
    if (doc.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    return doc.sections.flatMap((s) =>
      s.blocks
        .filter(
          (b): b is Extract<typeof b, { kind: "paragraph" }> =>
            b.kind === "paragraph",
        )
        .map((p) => p.runs.map((r) => r.text).join("")),
    );
  }

  it("an indent of exactly one em is still the same paragraph; past it, the paragraph breaks", () => {
    expect(paragraphsOf(62)).toEqual(["aa bb cc"]);
    expect(paragraphsOf(62.5)).toEqual(["aa", "bb cc"]);
  });
});
