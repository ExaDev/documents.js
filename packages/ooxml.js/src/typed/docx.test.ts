import { describe, expect, it } from "vitest";
import { decodePackage, zipPackage } from "../index";
import { readDocxContent } from "./docx/read";

// Integration-level coverage for readDocxContent, exercised through a real zip round trip (decodePackage(zipPackage(...))) rather than raw Package/XmlElement fixtures -- the deep style-cascade, table-merge, and section-boundary coverage lives in ./docx/read.test.ts and ./docx/styles.test.ts. This file replaces the pre-existing flat-shape (paragraphs/tables/hyperlinks) test suite, which asserted a shape readDocxContent no longer has -- see the BREAKING CHANGE described in DocxDocument's own doc comment.

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

const CONTENT_TYPES_DOCX = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
);

const ROOT_RELS_DOCX = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
);

// Paragraph 1: one bold run. Paragraph 2: one run whose text holds an ampersand entity, exercising entity decoding.
const DOCUMENT_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold run</w:t></w:r></w:p><w:p><w:r><w:t>Tom &amp; Jerry</w:t></w:r></w:p></w:body></w:document>',
);

function docxParts(): Record<string, Uint8Array<ArrayBuffer>> {
  return {
    "[Content_Types].xml": CONTENT_TYPES_DOCX,
    "_rels/.rels": ROOT_RELS_DOCX,
    "word/document.xml": DOCUMENT_XML,
  };
}

describe("readDocxContent", () => {
  it("projects paragraphs into a single section, with runs carrying the bold toggle and decoded entities", () => {
    const result = readDocxContent(decodePackage(zipPackage(docxParts())));
    expect(result.sections).toHaveLength(1);
    const blocks = result.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);

    const first = blocks[0];
    const second = blocks[1];
    if (first?.kind !== "paragraph" || second?.kind !== "paragraph") {
      throw new Error("expected paragraph blocks");
    }

    expect(first.runs[0]?.text).toBe("Bold run");
    expect(first.runs[0]?.bold).toBe(true);
    expect(first.runs[0]?.italic).toBeUndefined();

    expect(second.runs[0]?.text).toBe("Tom & Jerry");
    expect(second.runs[0]?.bold).toBeUndefined();
  });

  it("throws when word/document.xml is missing", () => {
    const pkg = decodePackage(
      zipPackage({
        "[Content_Types].xml": CONTENT_TYPES_DOCX,
        "_rels/.rels": ROOT_RELS_DOCX,
      }),
    );
    expect(() => readDocxContent(pkg)).toThrow(/word\/document\.xml/);
  });
});

// A representative package exercising the expanded constructs: a 2x2 table, a hyperlink resolved through the document rels, a header, a footer, a comment, a real footnote plus a separator footnote, and a numbered list paragraph -- all still document-order-preserved through readDocxContent's sections, unlike the old flat paragraphs/tables/hyperlinks arrays.
const RICH_CONTENT_TYPES = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
);

const RICH_ROOT_RELS = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
);

const RICH_DOCUMENT_RELS = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>',
);

const RICH_DOCUMENT_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:hyperlink r:id="rId9"><w:r><w:t>link text</w:t></w:r></w:hyperlink></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>list item</w:t></w:r></w:p></w:body></w:document>',
);

const RICH_HEADER_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header text</w:t></w:r></w:p></w:hdr>',
);

const RICH_FOOTER_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Footer text</w:t></w:r></w:p></w:ftr>',
);

const RICH_COMMENTS_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="Ann"><w:p><w:r><w:t>comment text</w:t></w:r></w:p></w:comment></w:comments>',
);

const RICH_FOOTNOTES_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="-1" w:type="separator"><w:p><w:r><w:t></w:t></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:t>real footnote</w:t></w:r></w:p></w:footnote></w:footnotes>',
);

function richDocxParts(): Record<string, Uint8Array<ArrayBuffer>> {
  return {
    "[Content_Types].xml": RICH_CONTENT_TYPES,
    "_rels/.rels": RICH_ROOT_RELS,
    "word/_rels/document.xml.rels": RICH_DOCUMENT_RELS,
    "word/document.xml": RICH_DOCUMENT_XML,
    "word/header1.xml": RICH_HEADER_XML,
    "word/footer1.xml": RICH_FOOTER_XML,
    "word/comments.xml": RICH_COMMENTS_XML,
    "word/footnotes.xml": RICH_FOOTNOTES_XML,
  };
}

describe("readDocxContent expanded constructs", () => {
  it("projects a 2x2 table into rows of cells, each carrying its paragraph text, in document order among the section's blocks", () => {
    const result = readDocxContent(decodePackage(zipPackage(richDocxParts())));
    const blocks = result.sections[0]?.blocks ?? [];
    const tableBlock = blocks[0];
    if (tableBlock?.kind !== "table") {
      throw new Error("expected the first block to be a table");
    }
    const rows = tableBlock.rows;
    expect(rows).toHaveLength(2);

    function cellText(
      table: typeof rows,
      rowIndex: number,
      cellIndex: number,
    ): string | undefined {
      const cell = table[rowIndex]?.cells[cellIndex];
      const block = cell?.blocks[0];
      return block?.kind === "paragraph" ? block.runs[0]?.text : undefined;
    }
    expect(cellText(rows, 0, 0)).toBe("A1");
    expect(cellText(rows, 0, 1)).toBe("B1");
    expect(cellText(rows, 1, 0)).toBe("A2");
    expect(cellText(rows, 1, 1)).toBe("B2");
  });

  it("resolves a hyperlink target through the document rels part", () => {
    const result = readDocxContent(decodePackage(zipPackage(richDocxParts())));
    const blocks = result.sections[0]?.blocks ?? [];
    const hyperlinkPara = blocks[1];
    if (hyperlinkPara?.kind !== "paragraph") {
      throw new Error("expected a paragraph block");
    }
    expect(hyperlinkPara.runs[0]?.text).toBe("link text");
    expect(hyperlinkPara.runs[0]?.hyperlink).toBe("https://example.com");
  });

  it("reads header and footer parts as block flow, unreferenced ones included", () => {
    // This fixture's header/footer parts carry no relationships at all (RICH_DOCUMENT_RELS holds only the hyperlink) -- the part walk still surfaces them.
    const result = readDocxContent(decodePackage(zipPackage(richDocxParts())));
    expect(result.headerFooterParts).toEqual([
      {
        path: "word/footer1.xml",
        kind: "footer",
        blocks: [{ kind: "paragraph", runs: [{ text: "Footer text" }] }],
      },
      {
        path: "word/header1.xml",
        kind: "header",
        blocks: [{ kind: "paragraph", runs: [{ text: "Header text" }] }],
      },
    ]);
  });

  it("reads comment author and text from word/comments.xml", () => {
    const result = readDocxContent(decodePackage(zipPackage(richDocxParts())));
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]?.author).toBe("Ann");
    expect(result.comments[0]?.text).toBe("comment text");
  });

  it("reads footnotes and skips separator and continuation marks", () => {
    const result = readDocxContent(decodePackage(zipPackage(richDocxParts())));
    expect(result.footnotes).toHaveLength(1);
    expect(result.footnotes[0]?.text).toBe("real footnote");
    expect(result.footnotes[0]?.type).toBeUndefined();
  });

  it("reads list membership from a paragraph w:numPr", () => {
    const result = readDocxContent(decodePackage(zipPackage(richDocxParts())));
    const blocks = result.sections[0]?.blocks ?? [];
    const listParagraph = blocks.find(
      (b) => b.kind === "paragraph" && b.list !== undefined,
    );
    expect(
      listParagraph?.kind === "paragraph" ? listParagraph.list : undefined,
    ).toEqual({ numId: "1", level: 0 });
  });

  // w:ilvl's w:val is a raw XML attribute string; readListMembership must coerce it with Number() rather than passing it through, or ContentListMembership.level (typed as z.number()) silently holds a string at runtime.
  it("coerces w:ilvl to a number, not the raw XML attribute string", () => {
    const documentXml = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="2"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>nested item</w:t></w:r></w:p></w:body></w:document>',
    );
    const result = readDocxContent(
      decodePackage(
        zipPackage({
          "[Content_Types].xml": CONTENT_TYPES_DOCX,
          "_rels/.rels": ROOT_RELS_DOCX,
          "word/document.xml": documentXml,
        }),
      ),
    );
    const blocks = result.sections[0]?.blocks ?? [];
    const list = blocks[0]?.kind === "paragraph" ? blocks[0].list : undefined;
    expect(typeof list?.level).toBe("number");
    expect(list?.level).toBe(2);
  });

  it("a table-cell paragraph appears once, nested under the table block, not duplicated at the section's own block level", () => {
    const documentXml = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Body paragraph</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell paragraph</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
    );
    const result = readDocxContent(
      decodePackage(
        zipPackage({
          "[Content_Types].xml": CONTENT_TYPES_DOCX,
          "_rels/.rels": ROOT_RELS_DOCX,
          "word/document.xml": documentXml,
        }),
      ),
    );

    const blocks = result.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    expect(
      blocks[0]?.kind === "paragraph" ? blocks[0].runs[0]?.text : undefined,
    ).toBe("Body paragraph");
    expect(blocks[1]?.kind).toBe("table");
    const table = blocks[1];
    if (table?.kind !== "table") {
      throw new Error("expected a table block");
    }
    const cellBlock = table.rows[0]?.cells[0]?.blocks[0];
    expect(
      cellBlock?.kind === "paragraph" ? cellBlock.runs[0]?.text : undefined,
    ).toBe("Cell paragraph");
  });

  // Regression guard: a paragraph wrapped in a w:sdt content control (not inside a table) is genuine body-level reading-order content and must still appear among the section's own blocks -- now bracketed by the contentControl construct's own marker pair rather than unwrapped anonymously.
  it("still includes a paragraph nested inside a w:sdt content control", () => {
    const documentXml = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:sdt><w:sdtContent><w:p><w:r><w:t>SDT paragraph</w:t></w:r></w:p></w:sdtContent></w:sdt></w:body></w:document>',
    );
    const result = readDocxContent(
      decodePackage(
        zipPackage({
          "[Content_Types].xml": CONTENT_TYPES_DOCX,
          "_rels/.rels": ROOT_RELS_DOCX,
          "word/document.xml": documentXml,
        }),
      ),
    );

    const blocks = result.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(3);
    expect(
      blocks[0]?.kind === "constructStart" ? blocks[0].descriptor : undefined,
    ).toEqual({ kind: "contentControl", controlType: "richText" });
    expect(
      blocks[1]?.kind === "paragraph" ? blocks[1].runs[0]?.text : undefined,
    ).toBe("SDT paragraph");
    expect(blocks[2]?.kind).toBe("constructEnd");
  });
});
