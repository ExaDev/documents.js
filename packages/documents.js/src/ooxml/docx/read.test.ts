import { describe, expect, it } from "vitest";
import type { ContentBlock } from "document-schema.js";
import type { Package, XmlNode } from "ooxml.js";
import {
  childrenWithTag,
  decodePackage,
  readDocxContent as readDocxFlat,
  rootElement,
  zipPackage,
} from "ooxml.js";
import { writeXlsContent } from "xls-codec";
import {
  docxWithLegacyOleObjectPackage,
  docxWithTableCellEquationPackage,
  minimalDocxPackage,
  renamedMainPartDocxPackage,
} from "../../test-support/docx";
import { spliceDocxEmbeddedObjects } from "./embedded-objects";
import { docxMainPartPath } from "./parts";
import { readDocxContent } from "./read";

// readDocxContent is now a thin adapter over ooxml.js's own readDocxContent (the flat reader; the bare readDocx name reads the tree-form DocumentTree since ooxml.js 4.0.0): the WordprocessingML style cascade, theme resolution, and document-order section/block walking all live upstream in ooxml.js now, with their own test coverage there. These tests exercise only the wrapping this file is actually responsible for — ContentDocument's discriminant/formatVersion, the metadata/sections passthrough — not the OOXML semantics readDocx itself resolves.

function docxPackageOfBody(bodyXml: string): Package {
  const xml = (source: string): Uint8Array<ArrayBuffer> =>
    new TextEncoder().encode(source);
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return decodePackage(
    zipPackage({
      "[Content_Types].xml": xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "_rels/.rels": xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      "word/document.xml": xml(documentXml),
    }),
  );
}

const EQUATION_PARAGRAPH =
  "<w:p><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p>";
function bodyChildrenOf(pkg: Package): readonly XmlNode[] {
  const root = rootElement(pkg.parts[docxMainPartPath(pkg)]);
  if (root === undefined) {
    throw new Error("expected a main document part");
  }
  const body = childrenWithTag(root, "w:body")[0];
  if (body === undefined) {
    throw new Error("expected a w:body");
  }
  return body.children;
}

const PLAIN_PARAGRAPH = "<w:p><w:r><w:t>p</w:t></w:r></w:p>";
const GRID_3 =
  '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>';

// A horizontal merge is one w:tc carrying w:gridSpan, with no element for the column it reaches, while the dense ContentTable row holds an entry for every column. The equation in the last w:tc of the first two rows belongs to the cell at grid column 2, not to the second entry of the row, and the third row is plain so a splice pass has nothing to change in it.
function mergedTableWithEquationsPackage(): Package {
  const equationCell = `<w:tc>${EQUATION_PARAGRAPH}</w:tc>`;
  const plainCell = `<w:tc>${PLAIN_PARAGRAPH}</w:tc>`;
  return docxPackageOfBody(
    `<w:tbl>${GRID_3}<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Big</w:t></w:r></w:p></w:tc>${equationCell}</w:tr><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge/></w:tcPr><w:p/></w:tc>${equationCell}</w:tr><w:tr>${plainCell}${plainCell}${plainCell}</w:tr></w:tbl>`,
  );
}

describe("readDocxContent", () => {
  it("wraps ooxml.js's readDocxContent into a wordprocessing ContentDocument", () => {
    const doc = readDocxContent(minimalDocxPackage());
    expect(doc.kind).toBe("wordprocessing");
  });

  it("passes sections through from ooxml.js's readDocxContent unchanged, including a paragraph and a table", () => {
    const doc = readDocxContent(minimalDocxPackage());
    if (doc.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    expect(doc.sections).toHaveLength(1);
    const [paragraph, table] = doc.sections[0]?.blocks ?? [];
    if (paragraph?.kind !== "paragraph" || table?.kind !== "table") {
      throw new Error("expected a paragraph followed by a table");
    }
    expect(paragraph.runs[0]?.text).toBe("Hello, world!");
    expect(table.columns).toEqual([{ widthPt: 225 }, { widthPt: 225 }]);
    const firstCellBlock = table.rows[0]?.cells[0]?.blocks[0];
    expect(
      firstCellBlock?.kind === "paragraph"
        ? firstCellBlock.runs[0]?.text
        : undefined,
    ).toBe("A1");
  });

  it("spreads metadata from ooxml.js's readDocxContent, leaving LayoutMetadata's PDF-only producer field unset", () => {
    const doc = readDocxContent(minimalDocxPackage());
    // The fixture package carries no docProps/core.xml, so every field is undefined — confirming the mapping doesn't invent a value, not merely that it round-trips one.
    expect(doc.metadata).toEqual({});
    expect(doc.metadata.producer).toBeUndefined();
  });

  it("propagates the upstream reader's own error for a package with no word/document.xml", () => {
    expect(() => readDocxContent({ parts: {} })).toThrow(/word\/document\.xml/);
  });

  it("reads a body the package names word/document2.xml, splicing an equation through that part's own relationships", () => {
    const doc = readDocxContent(renamedMainPartDocxPackage());
    if (doc.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    const table = doc.sections[0]?.blocks.find(
      (block) => block.kind === "table",
    );
    if (table?.kind !== "table") {
      throw new Error("expected a table");
    }
    const cells = table.rows[0]?.cells ?? [];
    expect(cells[0]?.blocks.some((block) => block.kind === "paragraph")).toBe(
      true,
    );
    // The splice pass walks the resolved body part's own markup; reading the conventional path instead would find no part, leave the equation unspliced, and lose it silently.
    expect(
      cells[1]?.blocks.some(
        (block) =>
          block.kind === "embeddedObject" && block.objectKind === "formula",
      ),
    ).toBe(true);
  });

  it("recovers an equation embedded in a table cell, splicing the formula into that cell's own blocks", () => {
    // collectBodyParagraphs used to exclude w:tbl entirely, so an m:oMath inside a table cell had no paragraph-ordinal correspondence and was silently dropped. The fix descends into each table's cells and splices at the cell level.
    const doc = readDocxContent(docxWithTableCellEquationPackage());
    if (doc.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    const table = doc.sections[0]?.blocks.find(
      (block) => block.kind === "table",
    );
    if (table?.kind !== "table") {
      throw new Error("expected a table");
    }
    const cells = table.rows[0]?.cells ?? [];
    // The first cell is ordinary text and is left exactly as the upstream reader read it.
    expect(cells[0]?.blocks.some((block) => block.kind === "paragraph")).toBe(
      true,
    );
    // The second cell's equation-only paragraph is recovered as a real formula embedded-object block in THAT cell's own blocks.
    expect(
      cells[1]?.blocks.some(
        (block) =>
          block.kind === "embeddedObject" && block.objectKind === "formula",
      ),
    ).toBe(true);
  });

  it("splices an equation into the cell at the grid column its w:tc occupies when an earlier cell in the row is horizontally merged", () => {
    const doc = readDocxContent(mergedTableWithEquationsPackage());
    if (doc.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    const table = doc.sections[0]?.blocks.find(
      (block) => block.kind === "table",
    );
    if (table?.kind !== "table") {
      throw new Error("expected a table");
    }
    const hasFormula = (blocks: readonly { kind: string }[]): boolean =>
      blocks.some((block) => block.kind === "embeddedObject");
    expect(
      table.rows.map((row) => row.cells.map((cell) => hasFormula(cell.blocks))),
    ).toEqual([
      [false, false, true],
      [false, false, true],
      [false, false, false],
    ]);
    const formulaPaths = table.rows.map((row) => {
      const block = row.cells[2]?.blocks[0];
      return block?.kind === "embeddedObject" ? block.sourcePath : undefined;
    });
    expect(formulaPaths).toEqual([
      "sections[0].blocks[0].rows[0].cells[2].blocks[0]",
      "sections[0].blocks[0].rows[1].cells[2].blocks[0]",
      undefined,
    ]);
  });

  it("splices equations into the cells of a table nested in a cell, and after several paragraphs of the same cell", () => {
    const nested = `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc>${EQUATION_PARAGRAPH}</w:tc></w:tr></w:tbl>`;
    const pkg = docxPackageOfBody(
      // The first cell holds two paragraphs, the equation second, then a nested table; the second holds nothing but a nested table (and the paragraph OOXML requires a cell to end with), so the nested table is the only thing there for the pass to change.
      `<w:tbl>${GRID_3}<w:tr><w:tc>${PLAIN_PARAGRAPH}${EQUATION_PARAGRAPH}${nested}${nested}<w:p><w:r><w:t>t</w:t></w:r><m:oMath><m:r><m:t>y</m:t></m:r></m:oMath></w:p></w:tc><w:tc>${nested}<w:p/></w:tc><w:tc><w:p><w:r><w:t>t</w:t></w:r><m:oMath><m:r><m:t>z</m:t></m:r></m:oMath></w:p></w:tc></w:tr></w:tbl>`,
    );
    const doc = readDocxContent(pkg);
    if (doc.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    const table = doc.sections[0]?.blocks[0];
    if (table?.kind !== "table") {
      throw new Error("expected a table");
    }
    const [first, second, third] = table.rows[0]?.cells ?? [];
    expect(first?.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "embeddedObject",
      "table",
      "table",
      "paragraph",
      "embeddedObject",
    ]);
    // An equation set inline in a paragraph with other text is inserted after that paragraph, which is itself left in place, so nothing in this cell is consumed or rebuilt but the list still grows.
    expect(third?.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "embeddedObject",
    ]);
    const innerOf = (blocks: readonly ContentBlock[] | undefined): string[] => {
      const inner = blocks?.find((block) => block.kind === "table");
      return inner?.kind === "table"
        ? (inner.rows[0]?.cells[0]?.blocks.map((block) => block.kind) ?? [])
        : [];
    };
    expect(innerOf(first?.blocks)).toEqual(["embeddedObject"]);
    expect(innerOf(second?.blocks)).toEqual(["embeddedObject"]);
    const innerTable = first?.blocks[2];
    if (innerTable?.kind !== "table") {
      throw new Error("expected a nested table");
    }
    const formula = innerTable.rows[0]?.cells[0]?.blocks[0];
    expect(
      formula?.kind === "embeddedObject" ? formula.sourcePath : undefined,
    ).toBe(
      "sections[0].blocks[0].rows[0].cells[0].blocks[2].rows[0].cells[0].blocks[0]",
    );
    // Each of the two sibling tables is matched to its own w:tbl, so the second one is spliced as well.
    const secondInner = first?.blocks[3];
    expect(secondInner?.kind === "table" ? innerOf([secondInner]) : []).toEqual(
      ["embeddedObject"],
    );
  });

  it("keeps every cell, row and table the splice pass had nothing to change as the very object the upstream reader produced", () => {
    const pkg = mergedTableWithEquationsPackage();
    const upstream = readDocxFlat(pkg);
    const [spliced] = spliceDocxEmbeddedObjects(
      upstream.sections,
      bodyChildrenOf(pkg),
      pkg,
    );
    const before = upstream.sections[0]?.blocks[0];
    const after = spliced?.blocks[0];
    if (before?.kind !== "table" || after?.kind !== "table") {
      throw new Error("expected a table");
    }
    // The rows carrying an equation are rebuilt around it; the plain row is the same object, and within a rebuilt row the cells with nothing to splice are too.
    expect(after).not.toBe(before);
    expect(after.rows[0]).not.toBe(before.rows[0]);
    expect(after.rows[0]?.cells[0]).toBe(before.rows[0]?.cells[0]);
    expect(after.rows[0]?.cells[2]).not.toBe(before.rows[0]?.cells[2]);
    expect(after.rows[2]).toBe(before.rows[2]);
    const plain = readDocxFlat(minimalDocxPackage());
    const plainPkg = minimalDocxPackage();
    const [plainSpliced] = spliceDocxEmbeddedObjects(
      plain.sections,
      bodyChildrenOf(plainPkg),
      plainPkg,
    );
    expect(plainSpliced?.blocks[1]).toBe(plain.sections[0]?.blocks[1]);
  });

  // ExaDev/documents.js#921: a w:object whose payload is a classic OLE compound file holding native legacy streams (not a ZIP, and not a ZIP wrapped in the compound file's own "Package" stream) used to stay opaque — ooxml.js's own readDocxContent has no reader for that shape at all, so the paragraph carrying the w:object recovered nothing. This second-pass splice (embedded-objects.ts's collectParagraphOleObjects/resolveLegacyOleObject) recovers it by trying doc-codec/xls-codec/ ppt-codec directly on the payload bytes.
  it("recovers a classic-OLE-compound-file .xls embedding as an embeddedObject block, consuming its own now-empty paragraph", () => {
    const payload = writeXlsContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [
            {
              row: 0,
              column: 0,
              value: { kind: "string", value: "Legacy cell" },
              displayText: "Legacy cell",
            },
          ],
          columns: [],
          rows: [],
          images: [],
          printSettings: {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 54, rightPt: 50.4, bottomPt: 54, leftPt: 50.4 },
            gridlines: false,
            headers: false,
            pageOrder: "downThenOver",
          },
        },
      ],
    });
    const doc = readDocxContent(docxWithLegacyOleObjectPackage(payload));
    if (doc.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    // The w:object was the paragraph's own only content, so the recovered block replaces it rather than sitting alongside an empty paragraph — the same consumption rule an equation-only or vector-only paragraph already gets.
    expect(doc.sections[0]?.blocks).toHaveLength(1);
    const embedded = doc.sections[0]?.blocks[0];
    if (embedded?.kind !== "embeddedObject") {
      throw new Error("expected an embeddedObject block");
    }
    expect(embedded.objectKind).toBe("spreadsheet");
    // w:object's own w:dxaOrig="1920"/w:dyaOrig="1200" (twips) size the block.
    expect(embedded.frame).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 96,
      heightPt: 60,
    });
    expect(
      embedded.document.kind === "spreadsheet"
        ? embedded.document.sheets[0]?.cells[0]?.value
        : undefined,
    ).toEqual({ kind: "string", value: "Legacy cell" });
  });
});
