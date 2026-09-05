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
import { readPdf } from "pdf-codec";
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
import { docxToPdf, odtToDocx } from "./convert";
import { buildDocumentBytes, layoutDocumentFromPackage } from "./from-package";
import type { LayoutItem, LayoutRect } from "pdf-codec";

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
    // The rebuilt page carries the stamped text back as real positioned text: each run renders once, whole, at its first recorded frame, so every run's own text survives the package -> pdf round trip verbatim.
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
    for (const runText of runTexts) {
      expect(texts).toContain(runText);
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
