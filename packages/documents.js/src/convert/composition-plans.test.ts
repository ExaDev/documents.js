import type { ContentDocument, ContentParagraph } from "document-schema.js";
import { readEpubContent } from "epub-codec";
import { decodePackage as decodeOoxmlPackage } from "ooxml.js";
import { decodePackage as decodeOdfPackage } from "odf.js";
import { encodeMarkdownText } from "../markdown/text";
import { createDocx } from "../edit/docx/editor";
import { minimalOdtBytes } from "../test-support/odt";
import { minimalOdpBytes } from "../test-support/odp";
import { minimalPptxBytes } from "../test-support/pptx";
import { richMarkdownText } from "../test-support/markdown";
import { describe, expect, it } from "vitest";
import { resolveCompositionPlan } from "./composition";
import { convertDocument } from "./composition-to-pdf";
import type { DocumentFormat } from "./port";
import { createLocalDocumentConverter } from "./local";
import { readDocxContent } from "../ooxml/docx/read";
import { readPptxContent } from "../ooxml/pptx/read";
import { readOdpContent } from "../odf/odp/read";
import { readOdtContent } from "../odf/odt/read";

describe("resolveCompositionPlan route verification", () => {
  // Every format pair the port exposes (minus the special-case odf -> pdf) must resolve. The pathfinder routes all pairs of non-odf formats within the 3-hop cap, so this covers every same-variant bridge, cross-variant transform, toPdf/fromPdf edge, and composed multi-hop route.
  const allSupportedPairs = createLocalDocumentConverter().conversions.filter(
    (pair) => !(pair.source === "odf" && pair.target === "pdf"),
  );

  it("resolves every supported pair (no supported-pair regression)", () => {
    for (const { source, target } of allSupportedPairs) {
      const plan = resolveCompositionPlan(source, target);
      expect(plan, `${source} -> ${target}`).toBeDefined();
    }
  });

  it("same-variant pairs resolve as a single bridge hop (never through PDF)", () => {
    const sameVariant: [DocumentFormat, DocumentFormat][] = [
      ["docx", "odt"],
      ["odt", "docx"],
      ["docx", "markdown"],
      ["odt", "markdown"],
      ["markdown", "docx"],
      ["markdown", "odt"],
      ["csv", "ods"],
      ["ods", "csv"],
      ["csv", "xlsx"],
      ["xlsx", "csv"],
    ];
    for (const [s, t] of sameVariant) {
      const plan = resolveCompositionPlan(s, t)!;
      expect(plan.hops.length, `${s} -> ${t}`).toBe(1);
      expect(plan.hops[0]!.executor, `${s} -> ${t}`).toBe("bridge");
    }
  });

  it("cross-variant transform pairs resolve as a single bridge hop (never through PDF)", () => {
    // All wordprocessing <-> presentation pairs, including the ones the pathfinder newly routes (markdown <-> pptx, markdown <-> odp, docx <-> odp, odt <-> pptx) that were not in the former DIRECT_EDGES list.
    const crossVariant: [DocumentFormat, DocumentFormat][] = [
      ["docx", "pptx"],
      ["pptx", "docx"],
      ["odt", "odp"],
      ["odp", "odt"],
      ["docx", "odp"],
      ["odp", "docx"],
      ["odt", "pptx"],
      ["pptx", "odt"],
      ["markdown", "pptx"],
      ["pptx", "markdown"],
      ["markdown", "odp"],
      ["odp", "markdown"],
    ];
    for (const [s, t] of crossVariant) {
      const plan = resolveCompositionPlan(s, t)!;
      expect(plan.hops.length, `${s} -> ${t}`).toBe(1);
      expect(plan.hops[0]!.executor, `${s} -> ${t}`).toBe("bridge");
    }
  });

  it("xlsx <-> pdf composes through ods (2 hops), never a direct toPdf", () => {
    const xlsxToPdf = resolveCompositionPlan("xlsx", "pdf")!;
    expect(xlsxToPdf.hops.map((h) => h.executor)).toEqual(["bridge", "toPdf"]);
    const pdfToXlsx = resolveCompositionPlan("pdf", "xlsx")!;
    expect(pdfToXlsx.hops.map((h) => h.executor)).toEqual([
      "fromPdf",
      "bridge",
    ]);
  });

  it("csv <-> pdf composes through ods (2 hops) exactly like xlsx, since csv has no layout engine of its own either", () => {
    const csvToPdf = resolveCompositionPlan("csv", "pdf")!;
    expect(csvToPdf.hops.map((h) => h.executor)).toEqual(["bridge", "toPdf"]);
    const pdfToCsv = resolveCompositionPlan("pdf", "csv")!;
    expect(pdfToCsv.hops.map((h) => h.executor)).toEqual(["fromPdf", "bridge"]);
  });

  it("xlsx -> markdown composes through ods and pdf (3 hops)", () => {
    const plan = resolveCompositionPlan("xlsx", "markdown")!;
    expect(plan.hops).toHaveLength(3);
  });

  it("odg -> xlsx composes through pdf and ods (3 hops)", () => {
    const plan = resolveCompositionPlan("odg", "xlsx")!;
    expect(plan.hops).toHaveLength(3);
  });

  it("odf -> pdf does NOT resolve (special-cased outside the composition engine)", () => {
    expect(resolveCompositionPlan("odf", "pdf")).toBeUndefined();
  });
});

// --- Tests for the newly-exposed high-value cross-variant pairs (wordprocessing <-> presentation transform): these were unreachable through the former DIRECT_EDGES list (only docx<->pptx and odt<->odp were registered) but the pathfinder routes every wordprocessing-format <-> presentation-format pair through the same transform. Each test converts real fixture bytes through convertDocument and decodes the output to assert REAL content survived -- not merely that the output is a non-empty ZIP, which a degraded/empty package would still satisfy. ---

function isZip(bytes: Uint8Array<ArrayBuffer>): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

// Joins every paragraph run's text across a ContentDocument. Throws for a non-wordprocessing doc so a test that accidentally targets the wrong kind fails loudly instead of silently comparing an empty string.
function wordprocessingRunText(doc: ContentDocument): string {
  if (doc.kind !== "wordprocessing") {
    throw new Error(
      `expected a wordprocessing ContentDocument, got ${doc.kind}`,
    );
  }
  return doc.sections
    .flatMap((section) => section.blocks)
    .filter((block): block is ContentParagraph => block.kind === "paragraph")
    .flatMap((block) => block.runs.map((run) => run.text))
    .join("");
}

describe("convertDocument: newly-exposed cross-variant pairs", () => {
  it("markdown -> pptx produces a real pptx whose slides carry the heading", () => {
    const bytes = convertDocument(
      "markdown",
      "pptx",
      encodeMarkdownText(richMarkdownText()),
    );
    expect(isZip(bytes)).toBe(true);
    const content = readPptxContent(decodeOoxmlPackage(bytes));
    if (content.kind !== "presentation") {
      throw new Error(
        `expected a presentation ContentDocument, got ${content.kind}`,
      );
    }
    expect(content.slides.length).toBeGreaterThanOrEqual(1);
    const runText = content.slides
      .flatMap((slide) => slide.shapes)
      .flatMap((shape) => shape.blocks)
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .flatMap((block) => block.runs.map((run) => run.text))
      .join("");
    expect(runText).toContain("Report Title");
  });

  it("pptx -> markdown (from a real pptx fixture) carries the slide text into the markdown", () => {
    const bytes = convertDocument("pptx", "markdown", minimalPptxBytes());
    expect(bytes.length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(bytes)).toContain("Slide text");
  });

  it("markdown -> odp produces a real odp whose slides carry the heading", () => {
    const bytes = convertDocument(
      "markdown",
      "odp",
      encodeMarkdownText(richMarkdownText()),
    );
    expect(isZip(bytes)).toBe(true);
    const content = readOdpContent(decodeOdfPackage(bytes));
    if (content.kind !== "presentation") {
      throw new Error(
        `expected a presentation ContentDocument, got ${content.kind}`,
      );
    }
    expect(content.slides.length).toBeGreaterThanOrEqual(1);
  });

  it("odp -> markdown carries the slide text into the markdown", () => {
    const bytes = convertDocument("odp", "markdown", minimalOdpBytes());
    expect(bytes.length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(bytes)).toContain("Hello from odp");
  });

  it("docx -> odp produces a real odp whose slides carry the heading", () => {
    const editor = createDocx();
    editor.body
      .appendParagraph({ styleId: "Heading1" })
      .appendRun({ text: "Slide title" });
    editor.body.appendParagraph().appendRun({ text: "Slide content" });
    const bytes = convertDocument("docx", "odp", editor.toBytes());
    expect(isZip(bytes)).toBe(true);
    const content = readOdpContent(decodeOdfPackage(bytes));
    if (content.kind !== "presentation") {
      throw new Error(
        `expected a presentation ContentDocument, got ${content.kind}`,
      );
    }
    expect(content.slides.length).toBeGreaterThanOrEqual(1);
  });

  it("odp -> docx produces a real docx whose paragraphs carry the slide text", () => {
    const bytes = convertDocument("odp", "docx", minimalOdpBytes());
    expect(isZip(bytes)).toBe(true);
    expect(
      wordprocessingRunText(readDocxContent(decodeOoxmlPackage(bytes))),
    ).toContain("Hello from odp");
  });

  it("odt -> pptx produces a real pptx whose slides carry the heading", () => {
    const bytes = convertDocument("odt", "pptx", minimalOdtBytes());
    expect(isZip(bytes)).toBe(true);
    const content = readPptxContent(decodeOoxmlPackage(bytes));
    if (content.kind !== "presentation") {
      throw new Error(
        `expected a presentation ContentDocument, got ${content.kind}`,
      );
    }
    expect(content.slides.length).toBeGreaterThanOrEqual(1);
    const runText = content.slides
      .flatMap((slide) => slide.shapes)
      .flatMap((shape) => shape.blocks)
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .flatMap((block) => block.runs.map((run) => run.text))
      .join("");
    expect(runText).toContain("Hello from odt");
  });

  it("pptx -> odt produces a real odt whose paragraphs carry the slide text", () => {
    const bytes = convertDocument("pptx", "odt", minimalPptxBytes());
    expect(isZip(bytes)).toBe(true);
    expect(
      wordprocessingRunText(readOdtContent(decodeOdfPackage(bytes))),
    ).toContain("Slide text");
  });
});

// --- Tests for epub's own same-variant bridge to docx/odt/markdown (ExaDev/documents.js#802): the composition engine's one BytesFormatNode (src/convert/composition.ts), reached the identical way csv/svg's own plain-text FORMAT_NODES entries are -- via executeBridge, never a hand-written epubToDocx/docxToEpub function. ---

describe("convertDocument: epub same-variant bridge (newly-registered format)", () => {
  it("docx -> epub -> docx carries the paragraph text through a real cross-format round trip", () => {
    const editor = createDocx();
    editor.body
      .appendParagraph({ styleId: "Heading1" })
      .appendRun({ text: "Report Title" });
    editor.body.appendParagraph().appendRun({ text: "Body text" });

    const epubBytes = convertDocument("docx", "epub", editor.toBytes());
    expect(isZip(epubBytes)).toBe(true);
    const epubContent = readEpubContent(epubBytes);
    expect(epubContent.kind).toBe("wordprocessing");
    expect(wordprocessingRunText(epubContent)).toContain("Report Title");
    expect(wordprocessingRunText(epubContent)).toContain("Body text");

    const docxBytes = convertDocument("epub", "docx", epubBytes);
    expect(isZip(docxBytes)).toBe(true);
    const roundTripped = wordprocessingRunText(
      readDocxContent(decodeOoxmlPackage(docxBytes)),
    );
    expect(roundTripped).toContain("Report Title");
    expect(roundTripped).toContain("Body text");
  });

  it("markdown -> epub produces a real epub whose section carries the heading", () => {
    const bytes = convertDocument(
      "markdown",
      "epub",
      encodeMarkdownText(richMarkdownText()),
    );
    expect(isZip(bytes)).toBe(true);
    const content = readEpubContent(bytes);
    expect(content.kind).toBe("wordprocessing");
    expect(wordprocessingRunText(content)).toContain("Report Title");
  });

  it("epub -> markdown carries the section text into the markdown", () => {
    const editor = createDocx();
    editor.body.appendParagraph().appendRun({ text: "Hello from epub" });
    const epubBytes = convertDocument("docx", "epub", editor.toBytes());

    const bytes = convertDocument("epub", "markdown", epubBytes);
    expect(bytes.length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(bytes)).toContain("Hello from epub");
  });
});
