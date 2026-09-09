import {
  assembleTree,
  flattenTree,
  type ContentDocument,
  type ContentSheetPrintSettings,
  type ContentTable,
  type DocumentTree,
} from "document-schema.js";

import { decodePackage as decodeOdfPackage } from "odf.js";
import { decodePackage as decodeOoxmlPackage, readXlsxContent } from "ooxml.js";
import { createFontMeasurer, createFontRegistry, readPdf } from "pdf-codec";
import { describe, expect, it } from "vitest";
import { openDocx } from "../edit/docx/editor";
import { openOdg } from "../edit/odg/editor";
import { openOdp } from "../edit/odp/editor";
import { openOds } from "../edit/ods/editor";
import { openOdt } from "../edit/odt/editor";
import { openPptx } from "../edit/pptx/editor";
import { decodeMarkdownText } from "../markdown/text";
import { readOdgContent } from "../odf/odg/read";
import { readOdpContent } from "../odf/odp/read";
import { readOdsContent } from "../odf/ods/read";
import { readOdtContent } from "../odf/odt/read";
import { minimalDocxBytes } from "../test-support/docx";
import { minimalOdgBytes } from "../test-support/odg";
import { minimalOdpBytes } from "../test-support/odp";
import { minimalOdsBytes } from "../test-support/ods";
import { minimalOdtBytes } from "../test-support/odt";
import { docxToPdf, markdownToPdf, odtToDocx } from "./convert";
import { NOMINAL_TEXT_SIZE_PT } from "../layout/shared";
import { buildDocumentBytes, layoutDocumentFromPackage } from "./from-package";
import type { LayoutItem, LayoutRect, LayoutText } from "pdf-codec";

function wordprocessingPackage(): DocumentTree {
  return assembleTree(readOdtContent(decodeOdfPackage(minimalOdtBytes())));
}

function presentationPackage(): DocumentTree {
  return assembleTree(readOdpContent(decodeOdfPackage(minimalOdpBytes())));
}

function spreadsheetPackage(): DocumentTree {
  return assembleTree(readOdsContent(decodeOdfPackage(minimalOdsBytes())));
}

function drawingPackage(): DocumentTree {
  return assembleTree(readOdgContent(decodeOdfPackage(minimalOdgBytes())));
}

describe("buildDocumentBytes", () => {
  it("builds real docx bytes from a wordprocessing package", () => {
    const bytes = buildDocumentBytes(wordprocessingPackage(), "docx");
    const text = openDocx(bytes)
      .paragraphs()
      .map((p) => p.text)
      .join(" ");
    expect(text).toContain("Hello from odt");
  });

  it("builds real odt bytes from a wordprocessing package", () => {
    const bytes = buildDocumentBytes(wordprocessingPackage(), "odt");
    const text = openOdt(bytes)
      .paragraphs()
      .map((p) => p.text)
      .join(" ");
    expect(text).toContain("Hello from odt");
  });

  it("builds real markdown bytes from a wordprocessing package", () => {
    const bytes = buildDocumentBytes(wordprocessingPackage(), "markdown");
    expect(decodeMarkdownText(bytes)).toContain("Hello from odt");
  });

  it("builds real pptx bytes from a presentation package", () => {
    const bytes = buildDocumentBytes(presentationPackage(), "pptx");
    const text = openPptx(bytes)
      .slides()
      .flatMap((s) => s.shapes())
      .map((s) => s.text)
      .join(" ");
    expect(text.length).toBeGreaterThan(0);
  });

  it("builds real odp bytes from a presentation package", () => {
    const bytes = buildDocumentBytes(presentationPackage(), "odp");
    const text = openOdp(bytes)
      .slides()
      .flatMap((s) => s.shapes())
      .map((s) => s.text)
      .join(" ");
    expect(text.length).toBeGreaterThan(0);
  });

  it("builds real ods bytes from a spreadsheet package", () => {
    const bytes = buildDocumentBytes(spreadsheetPackage(), "ods");
    const sheet = openOds(bytes).sheets()[0];
    expect(sheet).toBeDefined();
  });

  it("builds real odg bytes from a drawing package", () => {
    const bytes = buildDocumentBytes(drawingPackage(), "odg");
    const page = openOdg(bytes).pages()[0];
    expect(page).toBeDefined();
  });

  // The pdf target rebuilds the pdf-codec view from the package's own fused positions (layoutDocumentFromPackage, the frames-to-layout inverse) and writes it -- the package carries no LayoutDocument any more, only each node's own frames plus the pages array.
  it("writes PDF bytes rebuilt from a frame-stamped package", () => {
    let captured: DocumentTree | undefined;
    docxToPdf(minimalDocxBytes(), {
      onDocument: (pkg) => {
        captured = pkg;
      },
    });
    if (captured === undefined) {
      throw new Error("expected docxToPdf to report a package via onDocument");
    }
    const bytes = buildDocumentBytes(captured, "pdf");
    const layout = readPdf(bytes);
    expect(layout.pages.length).toBe(captured.pages?.length);
    // The rebuilt page carries the stamped text back as real positioned text: a multi-frame run re-renders as one text item per recorded frame (the wrap re-derivation), so a run's own words all survive the package -> pdf round trip -- verbatim for a single-frame run, and fragment-by-fragment along the recorded placements for a wrapped one.
    const capturedContent = flattenTree(captured);
    if (capturedContent.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const texts = layout.pages.flatMap((page) =>
      page.items
        .filter(
          (item): item is Extract<LayoutItem, { kind: "text" }> =>
            item.kind === "text",
        )
        .map((item) => item.text),
    );
    const runTexts = capturedContent.sections
      .flatMap((section) => section.blocks)
      .flatMap((block) =>
        block.kind === "paragraph" ? block.runs.map((run) => run.text) : [],
      )
      .filter((text) => text.length > 0);
    const joined = texts.join(" ").replace(/\s+/g, " ").trim();
    for (const runText of runTexts) {
      expect(joined).toContain(runText.replace(/\s+/g, " ").trim());
    }
  });

  it("throws when asked for pdf from a package with no pages (a bridge conversion dump)", () => {
    let captured: DocumentTree | undefined;
    odtToDocx(minimalOdtBytes(), {
      onDocument: (pkg) => {
        captured = pkg;
      },
    });
    if (captured === undefined) {
      throw new Error("expected odtToDocx to report a package via onDocument");
    }
    expect(captured.pages).toBeUndefined();
    expect(() => buildDocumentBytes(captured!, "pdf")).toThrow(/has no pages/);
  });

  it("builds real xlsx bytes from a spreadsheet package", () => {
    const bytes = buildDocumentBytes(spreadsheetPackage(), "xlsx");
    const content = readXlsxContent(decodeOoxmlPackage(bytes));
    expect(content.kind).toBe("spreadsheet");
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(content.sheets.length).toBeGreaterThan(0);
    expect(content.sheets[0]?.cells.length).toBeGreaterThan(0);
  });

  it("throws for the unsupported odf target", () => {
    expect(() => buildDocumentBytes(wordprocessingPackage(), "odf")).toThrow(
      /no ContentDocument-to-odf builder/,
    );
  });
});

// The frames-to-layout inverse's own two cell-background call sites (emitTableCell, emitSheetCell), each carrying the identical resolved-colour guard engine.ts/sheets.ts/slides.ts already cover: a cell's background renders as a LayoutRect only when resolveCellFillColor actually resolves a colour, not merely when the cell declares a background object at all. A frame is hand-stamped directly onto each cell here (rather than run through a real layout pass) since layoutDocumentFromPackage only ever reads the frames a package already carries.
describe("layoutDocumentFromPackage: cell background rects", () => {
  function rectItems(items: readonly LayoutItem[]): LayoutRect[] {
    return items.filter((i): i is LayoutRect => i.kind === "rect");
  }

  it("emits no rect for a table cell whose pattern fill resolves to no colour (emitTableCell)", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [50],
      rows: [
        {
          cells: [
            {
              blocks: [],
              background: { kind: "pattern", patternType: "gray125" },
              frames: [
                { pageIndex: 0, xPt: 0, yPt: 0, widthPt: 50, heightPt: 20 },
              ],
            },
          ],
        },
      ],
    };
    const content: Extract<ContentDocument, { kind: "wordprocessing" }> = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 200, heightPt: 200 },
          margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          blocks: [table],
        },
      ],
    };
    const pkg: DocumentTree = assembleTree(content, [
      { widthPt: 200, heightPt: 200 },
    ]);
    const layout = layoutDocumentFromPackage(pkg);
    expect(rectItems(layout.pages[0]!.items)).toHaveLength(0);
  });

  it("emits no rect for a sheet cell whose pattern fill resolves to no colour (emitSheetCell)", () => {
    const printSettings: ContentSheetPrintSettings = {
      pageSize: { widthPt: 200, heightPt: 200 },
      margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
      gridlines: false,
      headers: false,
      pageOrder: "downThenOver",
    };
    const content: Extract<ContentDocument, { kind: "spreadsheet" }> = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [
            {
              row: 0,
              column: 0,
              value: { kind: "string", value: "A" },
              displayText: "A",
              background: { kind: "pattern", patternType: "gray125" },
              frames: [
                { pageIndex: 0, xPt: 0, yPt: 0, widthPt: 50, heightPt: 20 },
              ],
            },
          ],
          columns: [],
          rows: [],
          images: [],
          printSettings,
        },
      ],
    };
    const pkg: DocumentTree = assembleTree(content, [
      { widthPt: 200, heightPt: 200 },
    ]);
    const layout = layoutDocumentFromPackage(pkg);
    expect(rectItems(layout.pages[0]!.items)).toHaveLength(0);
  });
});

describe("layoutDocumentFromPackage: wrap re-derivation (#964)", () => {
  it("re-renders a multi-frame run as one item per frame, each at that frame's recorded position", () => {
    let captured: DocumentTree | undefined;
    docxToPdf(minimalDocxBytes(), {
      onDocument: (pkg) => {
        captured = pkg;
      },
    });
    if (captured === undefined) {
      throw new Error("expected docxToPdf to report a package via onDocument");
    }
    const content = flattenTree(captured);
    if (content.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const layout = layoutDocumentFromPackage(captured);
    const multiFrameRun = content.sections
      .flatMap((section) => section.blocks)
      .flatMap((block) => (block.kind === "paragraph" ? block.runs : []))
      .find((run) => (run.frames?.length ?? 0) > 1);
    if (multiFrameRun === undefined) {
      throw new Error("expected the fixture to carry a multi-frame run");
    }
    const frames = multiFrameRun.frames!;
    const items = layout.pages
      .flatMap((page) => page.items)
      .filter(
        (item): item is LayoutText =>
          item.kind === "text" &&
          frames.some(
            (frame) => item.xPt === frame.xPt && item.yPt === frame.yPt,
          ),
      );
    // One item per recorded frame, at the frame's own position, and the fragments join back to the run's whole text (whitespace-normalised -- the wrap points themselves are not data).
    expect(items).toHaveLength(frames.length);
    const joined = items
      .map((item) => item.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    expect(joined).toBe(multiFrameRun.text.replace(/\s+/g, " ").trim());
  });

  it("re-derives a many-frame run in linear work, one fragment per frame", () => {
    // The per-frame consumer atomises once and consumes incrementally rather than re-wrapping the whole remaining suffix per frame -- quadratic work over a many-frame run an untrusted from_package caller can shape. 200 one-word frames each carry their own word, and the run's whole text joins back.
    const words = Array.from(
      { length: 200 },
      (_, i) => `w${String(i).padStart(3, "0")}`,
    );
    const text = words.join(" ");
    // Frame widths derive from the same registry-backed measurer the walk itself measures through (the drift-free pairing from-package's own module comment states), each one hair wider than its word: one word fits a frame exactly, a second word never does -- deterministic one-word-per-frame regardless of which substitute face the registry resolves.
    const measure = createFontMeasurer(createFontRegistry({}));
    const wordFont = {
      family: "Helvetica",
      weight: "normal" as const,
      style: "normal" as const,
    };
    const frames = words.map((word, i) => ({
      pageIndex: 0,
      xPt: 10 + i,
      yPt: 700 - i,
      widthPt:
        measure.widthOfTextAtSize(word, wordFont, NOMINAL_TEXT_SIZE_PT) + 1,
      heightPt: 12,
    }));
    const content: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [{ kind: "paragraph", runs: [{ text, frames }] }],
        },
      ],
    };
    const layout = layoutDocumentFromPackage(
      assembleTree(content, [{ widthPt: 612, heightPt: 792 }]),
    );
    const texts = layout.pages
      .flatMap((page) => page.items)
      .filter((item): item is Extract<LayoutItem, { kind: "text" }> => {
        return item.kind === "text";
      });
    expect(texts).toHaveLength(frames.length);
    expect(texts.map((item) => item.text).join(" ")).toBe(text);
  });
});

describe("buildDocumentBytes: embedded formulas re-typeset (#964)", () => {
  it("re-typesets a formula block's recorded MathML so the rebuilt PDF reads back the same math as the original render", () => {
    const source = new TextEncoder().encode("Before\n\n$$\nx^2\n$$\n\nAfter");
    const original = readPdf(markdownToPdf(source));
    let captured: DocumentTree | undefined;
    markdownToPdf(source, {
      onDocument: (pkg) => {
        captured = pkg;
      },
    });
    if (captured === undefined) {
      throw new Error("expected markdownToPdf to report a package");
    }
    const rebuilt = readPdf(buildDocumentBytes(captured, "pdf"));
    const textItems = (layout: typeof original): string[] =>
      layout.pages.flatMap((page) =>
        page.items
          .filter(
            (item): item is Extract<LayoutItem, { kind: "text" }> =>
              item.kind === "text",
          )
          .map((item) => item.text),
      );
    // The original render's formula glyphs read back through the math font's ToUnicode as "x2"; the rebuild's re-typeset formula must read back the same, which it can only do if the recorded MathML was genuinely re-laid-out into writePdf's formulas channel (a dropped formula leaves nothing on the page at all).
    expect(textItems(rebuilt)).toEqual(textItems(original));
  });

  it("still renders no math channel for a formula with no MathML of its own", () => {
    // Hand-built tree: a formula block whose source carried no MathML (mathml: []) has nothing to re-typeset, so the rebuilt PDF carries no math font group.
    const pkg = assembleTree({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph",
              runs: [
                {
                  text: "Before",
                  frames: [
                    {
                      pageIndex: 0,
                      xPt: 72,
                      yPt: 700,
                      widthPt: 40,
                      heightPt: 12,
                    },
                  ],
                },
              ],
            },
            {
              kind: "embeddedObject",
              objectKind: "formula",
              frame: { xPt: 100, yPt: 600, widthPt: 50, heightPt: 20 },
              document: {
                kind: "formula",
                metadata: {},
                formula: { mathml: [] },
              },
              frames: [
                {
                  pageIndex: 0,
                  xPt: 100,
                  yPt: 600,
                  widthPt: 50,
                  heightPt: 20,
                },
              ],
            },
          ],
        },
      ],
    });
    pkg.pages = [{ widthPt: 612, heightPt: 792 }];
    const layout = readPdf(buildDocumentBytes(pkg, "pdf"));
    // Nothing of the formula renders: the page's only text is the paragraph around it, exactly as the original pass would have left a MathML-less formula.
    const texts = layout.pages.flatMap((page) =>
      page.items
        .filter(
          (item): item is Extract<LayoutItem, { kind: "text" }> =>
            item.kind === "text",
        )
        .map((item) => item.text),
    );
    expect(texts).toEqual(["Before"]);
  });
});
