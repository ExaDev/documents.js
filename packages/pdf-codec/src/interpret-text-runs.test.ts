import { describe, expect, it } from "vitest";
import type { PdfDiagnostic, PdfDiagnosticSink } from "./diagnostics";
import type { FontMetricsPort, PdfObjectResolver } from "./interpret-types";
import { interpretContentStream } from "./interpret";
import type { PdfDict, PdfObject } from "./objects";
import { asDict, pdfDict } from "./objects";

function collectDiagnostics(): {
  sink: PdfDiagnosticSink;
  diagnostics: PdfDiagnostic[];
} {
  const diagnostics: PdfDiagnostic[] = [];
  return {
    sink: (d) => {
      diagnostics.push(d);
    },
    diagnostics,
  };
}

function textBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function fixedWidthFontMetrics(
  widthPer1000 = 500,
  byteLengthConsumed = 1,
): FontMetricsPort {
  return {
    glyphAdvance: () => ({ widthPer1000, byteLengthConsumed }),
    isVertical: () => false,
  };
}

function makeResolver(objects: Map<number, PdfObject>): PdfObjectResolver {
  const resolve = (obj: PdfObject | undefined): PdfObject | undefined =>
    obj?.kind === "ref" ? objects.get(obj.num) : obj;
  const resolveDict = (obj: PdfObject | undefined): PdfDict | undefined =>
    asDict(resolve(obj));
  return { resolve, resolveDict };
}

const EMPTY_RESOURCES = pdfDict({});

// How one text-showing operator is cut into runs: a TJ array's adjustments, character spacing and word spacing, summed into the gap between two glyphs, decide where one run ends and the next starts and where each is reported. Split from interpret.test.ts, whose helpers it repeats.

describe("interpretContentStream: where a text run ends and starts", () => {
  it("folds a TJ array's numeric kerning adjustments into one combined run", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td [(A) -100 (V)] TJ ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toHaveLength(1);
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a single combined text item");
    }
    expect(Array.from(item.codes)).toEqual(Array.from(textBytes("AV")));
    // 'A' (5) + kerning adjustment (100/1000 * 10 = 1) + 'V' (5) = 11.
    expect(item.endMatrix).toEqual([10, 0, 0, 10, 11, 0]);
  });

  it("ends the run at a TJ adjustment wide enough to be a word space, so the gap between the two items carries it", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td [(A) -250 (V)] TJ ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [first, second] = items;
    if (first?.kind !== "text" || second?.kind !== "text") {
      throw new Error("expected two text items");
    }
    expect(items).toHaveLength(2);
    expect(Array.from(first.codes)).toEqual(Array.from(textBytes("A")));
    expect(Array.from(second.codes)).toEqual(Array.from(textBytes("V")));
    // 'A' ends at 5, the adjustment moves the pen 250/1000 * 10 = 2.5 on, so 'V' starts at 7.5 and ends at 12.5.
    expect(first.startMatrix).toEqual([10, 0, 0, 10, 0, 0]);
    expect(first.endMatrix).toEqual([10, 0, 0, 10, 5, 0]);
    expect(second.startMatrix).toEqual([10, 0, 0, 10, 7.5, 0]);
    expect(second.endMatrix).toEqual([10, 0, 0, 10, 12.5, 0]);
  });

  it("ends the run at an adjustment of exactly one eighth of an em, the narrowest word space", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td [(A) -125 (V)] TJ ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toHaveLength(2);
  });

  it("keeps the run whole for an adjustment just under an eighth of an em", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td [(A) -124 (V)] TJ ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toHaveLength(1);
  });

  it("keeps the run whole for a wide adjustment that pulls the next glyph back rather than opening a gap", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td [(A) 250 (V)] TJ ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toHaveLength(1);
  });

  it("starts a run after an adjustment that precedes its first string, where its first glyph is painted", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td [-250 (A)] TJ ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(items).toHaveLength(1);
    // The adjustment moves the pen 250/1000 * 10 = 2.5 on before 'A' is painted, so the run covers 2.5 to 7.5 and the gap before it stays a gap.
    expect(item.startMatrix).toEqual([10, 0, 0, 10, 2.5, 0]);
    expect(item.endMatrix).toEqual([10, 0, 0, 10, 7.5, 0]);
  });

  it("starts a run after a leading adjustment too narrow to be a word space as well", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td [-50 (A)] TJ ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(item.startMatrix).toEqual([10, 0, 0, 10, 0.5, 0]);
    expect(item.endMatrix).toEqual([10, 0, 0, 10, 5.5, 0]);
  });

  it("keeps a run's start at its first glyph across a kerning adjustment inside it", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td [(A) -50 (V)] TJ ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(items).toHaveLength(1);
    expect(item.startMatrix).toEqual([10, 0, 0, 10, 0, 0]);
    expect(item.endMatrix).toEqual([10, 0, 0, 10, 10.5, 0]);
  });

  it("ends a run where a wide character spacing opens a gap that no adjustment takes back, and only there", () => {
    // A table row set the way some typesetters set one: a character spacing of half an em after every glyph, taken back by a 500 adjustment between the glyphs of each figure, so the only gaps left are between the figures, one of which falls inside the string (83).
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td 5 Tc [(3) 500 (83) 500 (3)] TJ ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [first, second] = items;
    if (first?.kind !== "text" || second?.kind !== "text") {
      throw new Error("expected two text items");
    }
    expect(items).toHaveLength(2);
    expect(Array.from(first.codes)).toEqual(Array.from(textBytes("38")));
    expect(Array.from(second.codes)).toEqual(Array.from(textBytes("33")));
    // Each figure ends where its last glyph's width does, so the whole 5-unit spacing after it lies between the two items.
    expect(first.startMatrix).toEqual([10, 0, 0, 10, 0, 0]);
    expect(first.endMatrix).toEqual([10, 0, 0, 10, 10, 0]);
    expect(second.startMatrix).toEqual([10, 0, 0, 10, 15, 0]);
    expect(second.endMatrix).toEqual([10, 0, 0, 10, 25, 0]);
  });

  it("ends a run after each glyph of a plain string set under a word-wide character spacing, as if each glyph were placed on its own", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td 5 Tc (AB) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [first, second] = items;
    if (first?.kind !== "text" || second?.kind !== "text") {
      throw new Error("expected two text items");
    }
    expect(items).toHaveLength(2);
    expect(first.endMatrix).toEqual([10, 0, 0, 10, 5, 0]);
    expect(second.startMatrix).toEqual([10, 0, 0, 10, 10, 0]);
  });

  it("keeps a run whole under a character spacing narrower than a word space", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td 1 Tc (AB) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toHaveLength(1);
  });

  it("keeps a run whole across the word spacing a space glyph takes, since the space character already marks that word", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td 5 Tw (A B) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toHaveLength(1);
  });

  it("ends a run where an adjustment steps the next glyph back past the start of the one before, so each run's glyphs advance along the line", () => {
    // An equation set by stepping back across it: 'V' is drawn 15 units back from where 'A' left the pen, ten units to the left of 'A' itself.
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td [(A) 1500 (V)] TJ ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [first, second] = items;
    if (first?.kind !== "text" || second?.kind !== "text") {
      throw new Error("expected two text items");
    }
    expect(items).toHaveLength(2);
    expect(first.startMatrix).toEqual([10, 0, 0, 10, 0, 0]);
    expect(first.endMatrix).toEqual([10, 0, 0, 10, 5, 0]);
    expect(second.startMatrix).toEqual([10, 0, 0, 10, -10, 0]);
    expect(second.endMatrix).toEqual([10, 0, 0, 10, -5, 0]);
  });

  it("keeps a run whole when an adjustment overlaps the next glyph with the one before but still starts it further along", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td [(A) 400 (V)] TJ ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toHaveLength(1);
  });

  it("keeps a run whole when an adjustment sets the next glyph exactly over the one before, as an overprinted accent is", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td [(A) 500 (V)] TJ ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toHaveLength(1);
  });

  it("sums consecutive adjustments, so two narrow ones that open a word-wide gap between them end the run", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td [(A) -100 -100 (V)] TJ ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toHaveLength(2);
  });
});
