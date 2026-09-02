import {
  assembleTree,
  flattenTree,
  type DocumentTree,
} from "document-schema.js";
import { decodePackage as decodeOdfPackage } from "odf.js";
import {
  buildXlsxPackageFromContent,
  decodePackage as decodeOoxmlPackage,
  encodePackage as encodeOoxmlPackage,
  readXlsxContent,
  type Package as OoxmlPackage,
} from "ooxml.js";
import { el, txt } from "ooxml.js/xml/fragment";
import { readPdf } from "pdf-codec";
import { describe, expect, it } from "vitest";
import { docxToPdf, odsToXlsx } from "./convert";
import { readCsvContent } from "../csv/read";
import { decodeCsvText, encodeCsvText } from "../csv/text";
import { createOds } from "../edit/ods/editor";
import { readMarkdownContent } from "../markdown/read";
import { decodeMarkdownText, encodeMarkdownText } from "../markdown/text";
import { readOdfFormulaContent } from "../odf/formula/read";
import { readOdgContent } from "../odf/odg/read";
import { readOdpContent } from "../odf/odp/read";
import { readOdsContent } from "../odf/ods/read";
import { readOdtContent } from "../odf/odt/read";
import { readDocxContent } from "../ooxml/docx/read";
import { readPptxContent } from "../ooxml/pptx/read";
import { decodeDocumentPackage, encodeDocumentPackage } from "../package-codec";
import { readSvgContent } from "../svg/read";
import { decodeSvgText, encodeSvgText } from "../svg/text";
import { FRACTION_FORMULA, odfFormulaBytes } from "../test-support/odf";
import { minimalDocxBytes } from "../test-support/docx";
import { minimalOdgBytes } from "../test-support/odg";
import { minimalOdpBytes } from "../test-support/odp";
import { minimalOdsBytes } from "../test-support/ods";
import { minimalOdtBytes } from "../test-support/odt";
import { richMarkdownTextWithFrontMatter } from "../test-support/markdown";
import { minimalPptxBytes } from "../test-support/pptx";
import { convertDocument } from "./composition-to-pdf";
import {
  pdfToDocx,
  readDocumentMetadata,
  readNativeDocumentTree,
} from "./from-pdf";

// Each case proves readDocumentMetadata(format, bytes) dispatches to exactly the same underlying reader every ergonomic conversion in this package already uses for that format, matching its own .metadata output exactly -- the underlying readers' own metadata extraction is already covered elsewhere (their own read.test.ts files), so this file's job is the dispatch table, not metadata resolution itself.

describe("readDocumentMetadata", () => {
  it("docx: matches readDocxContent(...).metadata", () => {
    const bytes = minimalDocxBytes();
    expect(readDocumentMetadata("docx", bytes)).toEqual(
      readDocxContent(decodeOoxmlPackage(bytes)).metadata,
    );
  });

  it("pptx: matches readPptxContent(...).metadata", () => {
    const bytes = minimalPptxBytes();
    expect(readDocumentMetadata("pptx", bytes)).toEqual(
      readPptxContent(decodeOoxmlPackage(bytes)).metadata,
    );
  });

  it("odt: matches readOdtContent(...).metadata", () => {
    const bytes = minimalOdtBytes();
    expect(readDocumentMetadata("odt", bytes)).toEqual(
      readOdtContent(decodeOdfPackage(bytes)).metadata,
    );
  });

  it("odp: matches readOdpContent(...).metadata", () => {
    const bytes = minimalOdpBytes();
    expect(readDocumentMetadata("odp", bytes)).toEqual(
      readOdpContent(decodeOdfPackage(bytes)).metadata,
    );
    expect(readDocumentMetadata("odp", bytes).title).toBe("My Presentation");
  });

  it("ods: matches readOdsContent(...).metadata", () => {
    const bytes = minimalOdsBytes();
    expect(readDocumentMetadata("ods", bytes)).toEqual(
      readOdsContent(decodeOdfPackage(bytes)).metadata,
    );
  });

  it("odg: matches readOdgContent(...).metadata", () => {
    const bytes = minimalOdgBytes();
    expect(readDocumentMetadata("odg", bytes)).toEqual(
      readOdgContent(decodeOdfPackage(bytes)).metadata,
    );
    expect(readDocumentMetadata("odg", bytes).title).toBe("My Drawing");
  });

  it("odf: matches readOdfFormulaContent(...).metadata", () => {
    const bytes = odfFormulaBytes(FRACTION_FORMULA);
    expect(readDocumentMetadata("odf", bytes)).toEqual(
      readOdfFormulaContent(decodeOdfPackage(bytes)).metadata,
    );
  });

  it("markdown: matches readMarkdownContent(...).metadata, with front-matter now surfaced by default", () => {
    // readMarkdownContent now defaults frontMatter: true (src/markdown/read.ts), so a leading YAML front-matter block's title/author reach ContentDocument.metadata by default -- readDocumentMetadata dispatches through readMarkdownContent, so the title from the fixture's front matter is genuinely surfaced here, not dropped.
    const text = richMarkdownTextWithFrontMatter();
    const bytes = encodeMarkdownText(text);
    expect(readDocumentMetadata("markdown", bytes)).toEqual(
      readMarkdownContent(decodeMarkdownText(bytes)).metadata,
    );
    expect(readDocumentMetadata("markdown", bytes).title).toBe("Sample Report");
  });

  it("pdf: matches readPdf(...).metadata", () => {
    const bytes = docxToPdf(minimalDocxBytes());
    expect(readDocumentMetadata("pdf", bytes)).toEqual(readPdf(bytes).metadata);
  });

  // xlsx now reads its own docProps the way every other content format does (#744) -- the PDF-preview exception is gone. The preview never reported workbook facts at all: for a file carrying no timestamps of its own it stamped createdIso/modifiedIso at the render moment and a producer naming the preview PDF's writer, which is why this case's predecessor needed fake timers to pass -- a metadata read whose answer changes with wall-clock is reporting its own execution, not the document. What a workbook genuinely declares still arrives: ooxml.js maps docProps/core.xml's dcterms:created/dcterms:modified straight through and app.xml's Application onto creator, while producer stays unset (the schema's own rule: a PDF-only concept no semantic reader ever sets).
  it("xlsx: matches readXlsxContent(...).metadata", () => {
    const bytes = odsToXlsx(minimalOdsBytes());
    expect(readDocumentMetadata("xlsx", bytes)).toEqual(
      readXlsxContent(decodeOoxmlPackage(bytes)).metadata,
    );
  });

  it("xlsx: reports the workbook's own core.xml timestamps, and no producer", () => {
    const base = odsToXlsx(minimalOdsBytes());
    const content = readXlsxContent(decodeOoxmlPackage(base));
    const stamped = encodeOoxmlPackage(
      buildXlsxPackageFromContent({
        ...content,
        metadata: {
          ...content.metadata,
          title: "Stamped workbook",
          createdIso: "2024-01-02T03:04:05Z",
          modifiedIso: "2024-02-03T04:05:06Z",
        },
      }),
    );
    const metadata = readDocumentMetadata("xlsx", stamped);
    expect(metadata.title).toBe("Stamped workbook");
    expect(metadata.createdIso).toBe("2024-01-02T03:04:05Z");
    expect(metadata.modifiedIso).toBe("2024-02-03T04:05:06Z");
    expect(metadata.producer).toBeUndefined();
  });
});

// Each case proves readNativeDocumentTree(format, bytes) dispatches to exactly the same underlying reader every ergonomic conversion in this package already uses for that format, decomposed into tree form via assembleTree with no bridging, no cross-variant transform, and (for every format but pdf) no layout pass at all -- unlike ConversionResult.package/onDocument, which report whatever hop actually produced a REQUESTED conversion's output (see this file's own from-pdf.ts module comment, and ExaDev/documents.js#823, for why that can be a different, lossy shape).
describe("readNativeDocumentTree", () => {
  it("docx: matches assembleTree(readDocxContent(...))", () => {
    const bytes = minimalDocxBytes();
    expect(readNativeDocumentTree("docx", bytes)).toEqual(
      assembleTree(readDocxContent(decodeOoxmlPackage(bytes))),
    );
  });

  it("pptx: matches assembleTree(readPptxContent(...))", () => {
    const bytes = minimalPptxBytes();
    expect(readNativeDocumentTree("pptx", bytes)).toEqual(
      assembleTree(readPptxContent(decodeOoxmlPackage(bytes))),
    );
  });

  it("odt: matches assembleTree(readOdtContent(...))", () => {
    const bytes = minimalOdtBytes();
    expect(readNativeDocumentTree("odt", bytes)).toEqual(
      assembleTree(readOdtContent(decodeOdfPackage(bytes))),
    );
  });

  it("odp: matches assembleTree(readOdpContent(...))", () => {
    const bytes = minimalOdpBytes();
    expect(readNativeDocumentTree("odp", bytes)).toEqual(
      assembleTree(readOdpContent(decodeOdfPackage(bytes))),
    );
  });

  it("ods: matches assembleTree(readOdsContent(...))", () => {
    const bytes = minimalOdsBytes();
    expect(readNativeDocumentTree("ods", bytes)).toEqual(
      assembleTree(readOdsContent(decodeOdfPackage(bytes))),
    );
  });

  it("odg: matches assembleTree(readOdgContent(...))", () => {
    const bytes = minimalOdgBytes();
    expect(readNativeDocumentTree("odg", bytes)).toEqual(
      assembleTree(readOdgContent(decodeOdfPackage(bytes))),
    );
  });

  it("markdown: matches assembleTree(readMarkdownContent(...))", () => {
    const text = richMarkdownTextWithFrontMatter();
    const bytes = encodeMarkdownText(text);
    expect(readNativeDocumentTree("markdown", bytes)).toEqual(
      assembleTree(readMarkdownContent(decodeMarkdownText(bytes))),
    );
  });

  it("csv: matches assembleTree(readCsvContent(...))", () => {
    const bytes = encodeCsvText("Name,Age\nAlice,30\n");
    expect(readNativeDocumentTree("csv", bytes)).toEqual(
      assembleTree(readCsvContent(decodeCsvText(bytes))),
    );
  });

  it("svg: matches assembleTree(readSvgContent(...))", () => {
    const bytes = encodeSvgText(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100pt" height="60pt" viewBox="0 0 100 60"><rect x="0" y="0" width="10" height="10"/></svg>',
    );
    expect(readNativeDocumentTree("svg", bytes)).toEqual(
      assembleTree(readSvgContent(decodeSvgText(bytes))),
    );
  });

  it("xlsx: matches assembleTree(readXlsxContent(...)) -- the direct dispatch path, no bridging hop of any kind", () => {
    const bytes = odsToXlsx(minimalOdsBytes());
    expect(readNativeDocumentTree("xlsx", bytes)).toEqual(
      assembleTree(readXlsxContent(decodeOoxmlPackage(bytes))),
    );
  });

  it("odf: reads the formula content directly with no invented page geometry -- unlike odfToPdf's own onDocument report, whose one A4 page is an artefact of the rendering pass, not a fact about the formula document itself", () => {
    const bytes = odfFormulaBytes(FRACTION_FORMULA);
    const tree = readNativeDocumentTree("odf", bytes);
    expect(tree.kind).toBe("formula");
    expect(tree.pages).toBeUndefined();
    expect(tree).toEqual(
      assembleTree(readOdfFormulaContent(decodeOdfPackage(bytes))),
    );
  });

  it("pdf: reconstructs the identical wordprocessing tree pdfToDocx's own onDocument capture reports, pages/frames and document-level tables included -- pdf is the one format whose native representation genuinely IS positioned layout", () => {
    const pdfBytes = docxToPdf(minimalDocxBytes());

    let captured: DocumentTree | undefined;
    pdfToDocx(pdfBytes, {
      onDocument: (pkg) => {
        captured = pkg;
      },
    });
    if (captured === undefined) {
      throw new Error("expected pdfToDocx to report a DocumentTree");
    }

    expect(readNativeDocumentTree("pdf", pdfBytes)).toEqual(captured);
    expect(captured.pages).toBeDefined();
  });

  // The regression test for ExaDev/documents.js#823's Ask 1: a real xlsx workbook with cell values, a formula, a merged range, and a comment -- exactly the data the issue reports the OLD --dump-package path losing entirely once a cross-variant bridge (here, xlsx -> markdown, which shares no ContentDocument variant and so composes through a pdf pivot) is in the picture. buildXlsxPackageFromContent/OdsSheet have no write path for a comment (see ooxml.js's own documented cell-comment asymmetry, "read but do not write"), so the comment part is spliced onto the real xlsx package by hand, mirroring ooxml.js's own comments.test.ts synthetic-package convention -- every other fact (cells, the merge, the formula) comes from the real xlsx writer, unedited.
  const REL_COMMENTS =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";

  function buildRichXlsxFixture(): Uint8Array<ArrayBuffer> {
    const editor = createOds();
    const sheet = editor.sheets()[0];
    if (sheet === undefined) {
      throw new Error("createOds() did not produce a default sheet");
    }
    // A1:B1, merged, carries the label a comment will anchor to below.
    sheet.mergeCells(0, 0, 1, 2).value = {
      kind: "string",
      value: "Total",
    };
    sheet.cell(0, 2).value = { kind: "number", value: 3 };
    sheet.cell(1, 2).value = { kind: "number", value: 4 };
    const formulaCell = sheet.cell(2, 2);
    formulaCell.value = { kind: "number", value: 7 };
    formulaCell.formula = "SUM(C1:C2)";

    const base = decodeDocumentPackage("xlsx", odsToXlsx(editor.toBytes()));
    const commented: OoxmlPackage = {
      parts: {
        ...base.parts,
        "xl/worksheets/_rels/sheet1.xml.rels": {
          kind: "xml",
          nodes: [
            el("Relationships", {}, [
              el("Relationship", {
                Id: "rId1",
                Type: REL_COMMENTS,
                Target: "../comments1.xml",
              }),
            ]),
          ],
        },
        "xl/comments1.xml": {
          kind: "xml",
          nodes: [
            el("comments", {}, [
              el("authors", {}, [el("author", {}, [txt("Reviewer")])]),
              el("commentList", {}, [
                el("comment", { ref: "A1", authorId: "0" }, [
                  el("text", {}, [
                    el("r", {}, [
                      el("t", {}, [txt("A note on the total cell")]),
                    ]),
                  ]),
                ]),
              ]),
            ]),
          ],
        },
      },
    };
    return encodeDocumentPackage("xlsx", commented);
  }

  it("xlsx: returns the native spreadsheet tree with real A1/formula/merged-range/comment data, unlike the wordprocessing tree a cross-variant bridge to markdown reports for the identical bytes (ExaDev/documents.js#823)", () => {
    const bytes = buildRichXlsxFixture();

    // The bug as reported: composing through a pdf pivot (xlsx and markdown share no ContentDocument variant) reports the PIVOT's own wordprocessing-shaped tree, not the workbook -- confirming the contrast readNativeDocumentTree exists to fix is real, not assumed.
    let bridged: DocumentTree | undefined;
    convertDocument("xlsx", "markdown", bytes, {
      onDocument: (pkg) => {
        bridged = pkg;
      },
    });
    expect(bridged?.kind).toBe("wordprocessing");

    const tree = readNativeDocumentTree("xlsx", bytes);
    expect(tree.kind).toBe("spreadsheet");
    expect(tree.pages).toBeUndefined(); // content-only -- no layout pass ran, regardless of any --to target

    const flat = flattenTree(tree);
    if (flat.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const cells = flat.sheets[0]?.cells ?? [];
    const anchor = cells.find((cell) => cell.row === 0 && cell.column === 0);
    expect(anchor?.value).toEqual({ kind: "string", value: "Total" });
    expect(anchor?.colSpan).toBe(2); // the merged range A1:B1
    expect(anchor?.comment).toEqual({
      text: "A note on the total cell",
      author: "Reviewer",
    });
    const formulaCell = cells.find(
      (cell) => cell.row === 2 && cell.column === 2,
    );
    expect(formulaCell?.formula).toBe("SUM(C1:C2)");
    expect(formulaCell?.value).toEqual({ kind: "number", value: 7 });
  });
});
