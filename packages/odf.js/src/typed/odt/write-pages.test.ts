import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentDocument,
  ContentSection,
} from "document-schema.js";
import { PAGE_SIZE_A4, PAGE_SIZE_LETTER } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import type { Package } from "../../model/package";
import { buildXml } from "../../xml/build";
import {
  attrValue,
  childrenWithTag,
  findChildElement,
  rootElement,
} from "../../xml/query";
import { assertNeverContentBlockKind, writeOdtContent } from "./write";

// The write side's XML-shape suite: what writeOdtContent actually emits, construct by construct. The round-trip suite beside it (write-round-trip.test.ts) proves the output reads back as the document it came from; this one proves the output is the ODF a real consumer expects, which a round trip through one package's own reader cannot — a writer and reader that agreed on the same wrong spelling would round-trip perfectly and open nowhere.
//
// The one spelling this file pins hardest, style:master-page-name's position, is exactly that case: it was verified against LibreOffice directly rather than against this package's own reader (see the master-page describe block below).

const MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

function section(blocks: readonly ContentBlock[]): ContentSection {
  return { pageSize: PAGE_SIZE_A4, margins: MARGINS, blocks: [...blocks] };
}

function documentOf(blocks: readonly ContentBlock[]): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [section(blocks)],
  };
}

function partRoot(pkg: Package, path: string): XmlElement {
  const part = pkg.parts[path];
  if (part?.kind !== "xml") {
    throw new Error(`expected an XML part at ${path}`);
  }
  const root = rootElement(part.nodes);
  if (root === undefined) {
    throw new Error(`expected a root element in ${path}`);
  }
  return root;
}

function partXml(pkg: Package, path: string): string {
  const part = pkg.parts[path];
  if (part?.kind !== "xml") {
    throw new Error(`expected an XML part at ${path}`);
  }
  return buildXml(part.nodes);
}

function textBody(pkg: Package): XmlElement {
  const body = findChildElement(
    partRoot(pkg, "content.xml").children,
    "office:body",
  );
  const text =
    body === undefined
      ? undefined
      : findChildElement(body.children, "office:text");
  if (text === undefined) {
    throw new Error("expected office:body/office:text");
  }
  return text;
}

function bodyElements(pkg: Package): XmlElement[] {
  return textBody(pkg).children.filter(
    (node): node is XmlElement => node.type === "element",
  );
}

function contentAutomaticStyles(pkg: Package): XmlElement {
  const container = findChildElement(
    partRoot(pkg, "content.xml").children,
    "office:automatic-styles",
  );
  if (container === undefined) {
    throw new Error("expected content.xml office:automatic-styles");
  }
  return container;
}

function styleNamed(
  container: XmlElement,
  name: string,
  family: string,
): XmlElement {
  const found = childrenWithTag(container, "style:style").find(
    (style) =>
      attrValue(style, "style:name") === name &&
      attrValue(style, "style:family") === family,
  );
  if (found === undefined) {
    throw new Error(`expected a ${family} style named ${name}`);
  }
  return found;
}

function paragraphOf(pkg: Package, index: number): XmlElement {
  const element = bodyElements(pkg)[index];
  if (element === undefined) {
    throw new Error(`expected a body element at index ${index}`);
  }
  return element;
}

describe("writeOdtContent: page geometry and section boundaries", () => {
  const pkg = writeOdtContent({
    kind: "wordprocessing",
    metadata: {},
    sections: [
      {
        pageSize: PAGE_SIZE_A4,
        margins: MARGINS,
        blocks: [{ kind: "paragraph", runs: [{ text: "first" }] }],
      },
      {
        pageSize: PAGE_SIZE_LETTER,
        margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
        breakType: "nextPage",
        blocks: [
          {
            kind: "paragraph",
            runs: [{ text: "second" }],
            alignment: "center",
          },
        ],
      },
    ],
  });
  const stylesRoot = partRoot(pkg, "styles.xml");

  it("writes one page layout per section, carrying its own size and margins", () => {
    const automatic = findChildElement(
      stylesRoot.children,
      "office:automatic-styles",
    );
    const layouts = childrenWithTag(automatic!, "style:page-layout");
    expect(layouts.map((layout) => attrValue(layout, "style:name"))).toEqual([
      "PM1",
      "PM2",
    ]);
    expect(
      buildXml(childrenWithTag(layouts[1]!, "style:page-layout-properties")),
    ).toBe(
      '<style:page-layout-properties fo:page-width="612pt" fo:page-height="792pt"' +
        ' style:print-orientation="portrait" fo:margin-top="36pt" fo:margin-right="36pt"' +
        ' fo:margin-bottom="36pt" fo:margin-left="36pt"></style:page-layout-properties>',
    );
  });

  it("writes one master page per section, each naming its own page layout", () => {
    const masterStyles = findChildElement(
      stylesRoot.children,
      "office:master-styles",
    );
    expect(
      childrenWithTag(masterStyles!, "style:master-page").map((page) => [
        attrValue(page, "style:name"),
        attrValue(page, "style:page-layout-name"),
      ]),
    ).toEqual([
      ["MP1", "PM1"],
      ["MP2", "PM2"],
    ]);
  });

  // The placement this test pins was verified against LibreOffice itself, not against this package's own reader: a flat-ODF document carrying style:master-page-name on style:style renders its second page at the second master page's own size and survives a re-save verbatim, while the identical document carrying it on style:paragraph-properties renders one page and has the attribute stripped outright. Writing it in the second position would round-trip perfectly through odf.js and open as a single-page document everywhere else.
  it("states a section's page-style switch as style:master-page-name on the style:style element itself", () => {
    const named = findChildElement(stylesRoot.children, "office:styles");
    // Preformatted_20_Text is minted unconditionally, once per document (ExaDev/documents.js#1020) — it precedes MP2Start here only because it is pushed first, not because ordering is itself load-bearing for either style.
    expect(buildXml(childrenWithTag(named!, "style:style"))).toBe(
      '<style:style style:name="Preformatted_20_Text"' +
        ' style:family="paragraph"></style:style>' +
        '<style:style style:name="MP2Start" style:family="paragraph"' +
        ' style:master-page-name="MP2"></style:style>',
    );
  });

  it("reaches the switch from the section's first paragraph, through its own automatic style's parent", () => {
    const second = writeOdtContent({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: PAGE_SIZE_A4,
          margins: MARGINS,
          blocks: [{ kind: "paragraph", runs: [{ text: "first" }] }],
        },
        {
          pageSize: PAGE_SIZE_LETTER,
          margins: MARGINS,
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "second" }],
              alignment: "center",
            },
          ],
        },
      ],
    });
    const paragraph = paragraphOf(second, 1);
    const styleName = attrValue(paragraph, "text:style-name");
    expect(styleName).toBe("P1");
    expect(
      attrValue(
        styleNamed(contentAutomaticStyles(second), "P1", "paragraph"),
        "style:parent-style-name",
      ),
    ).toBe("MP2Start");
  });

  it("references the break style directly when the section's first paragraph has no formatting of its own", () => {
    expect(attrValue(paragraphOf(pkg, 1), "text:style-name")).toBe("P1");
    const plain = writeOdtContent({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: PAGE_SIZE_A4,
          margins: MARGINS,
          blocks: [{ kind: "paragraph", runs: [{ text: "first" }] }],
        },
        {
          pageSize: PAGE_SIZE_LETTER,
          margins: MARGINS,
          blocks: [{ kind: "paragraph", runs: [{ text: "second" }] }],
        },
      ],
    });
    expect(attrValue(paragraphOf(plain, 1), "text:style-name")).toBe(
      "MP2Start",
    );
  });

  it("opens an empty paragraph to carry the switch when a section starts with something that cannot", () => {
    const startsWithTable = writeOdtContent({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: PAGE_SIZE_A4,
          margins: MARGINS,
          blocks: [{ kind: "paragraph", runs: [{ text: "first" }] }],
        },
        {
          pageSize: PAGE_SIZE_LETTER,
          margins: MARGINS,
          blocks: [
            {
              kind: "table",
              columns: [{ widthPt: 40 }],
              rows: [{ cells: [{ blocks: [] }] }],
            },
          ],
        },
      ],
    });
    const elements = bodyElements(startsWithTable);
    expect(elements.map((element) => element.tag)).toEqual([
      "text:p",
      "text:p",
      "table:table",
    ]);
    expect(attrValue(elements[1]!, "text:style-name")).toBe("MP2Start");
  });
});

describe("writeOdtContent: page breaks", () => {
  it("folds a page-break block onto the following paragraph's own style", () => {
    const pkg = writeOdtContent(
      documentOf([
        { kind: "paragraph", runs: [{ text: "before" }] },
        { kind: "pageBreak" },
        { kind: "paragraph", runs: [{ text: "after" }] },
      ]),
    );
    const elements = bodyElements(pkg);
    expect(elements).toHaveLength(2);
    const style = styleNamed(contentAutomaticStyles(pkg), "P1", "paragraph");
    expect(
      attrValue(
        childrenWithTag(style, "style:paragraph-properties")[0]!,
        "fo:break-before",
      ),
    ).toBe("page");
    expect(attrValue(elements[1]!, "text:style-name")).toBe("P1");
  });

  it("opens an empty paragraph for a break with nothing after it to carry one", () => {
    const pkg = writeOdtContent(
      documentOf([
        { kind: "paragraph", runs: [{ text: "before" }] },
        { kind: "pageBreak" },
      ]),
    );
    const elements = bodyElements(pkg);
    expect(elements).toHaveLength(2);
    expect(buildXml([elements[1]!])).toBe(
      '<text:p text:style-name="P1"></text:p>',
    );
  });

  it("keeps two consecutive breaks as two breaks rather than collapsing them", () => {
    const pkg = writeOdtContent(
      documentOf([
        { kind: "paragraph", runs: [{ text: "before" }] },
        { kind: "pageBreak" },
        { kind: "pageBreak" },
        { kind: "paragraph", runs: [{ text: "after" }] },
      ]),
    );
    const elements = bodyElements(pkg);
    const expectedElementCount = 3;
    expect(elements).toHaveLength(expectedElementCount);
    expect(attrValue(elements[1]!, "text:style-name")).toBe("P1");
    expect(attrValue(elements[2]!, "text:style-name")).toBe("P1");
  });
});

describe("writeOdtContent: metadata", () => {
  it("writes each stated field into meta.xml, in ODF's own element vocabulary", () => {
    const pkg = writeOdtContent({
      kind: "wordprocessing",
      metadata: {
        title: "A title",
        author: "An author",
        subject: "A subject",
        keywords: ["alpha", "beta"],
        creator: "odf.js",
        createdIso: "2026-01-02T03:04:05Z",
        modifiedIso: "2026-02-03T04:05:06Z",
        language: "en-GB",
      },
      sections: [section([{ kind: "paragraph", runs: [{ text: "x" }] }])],
    });
    expect(partXml(pkg, "meta.xml")).toContain(
      "<office:meta><meta:generator>odf.js</meta:generator>" +
        "<dc:title>A title</dc:title><dc:subject>A subject</dc:subject>" +
        "<meta:keyword>alpha</meta:keyword><meta:keyword>beta</meta:keyword>" +
        "<meta:initial-creator>An author</meta:initial-creator>" +
        "<meta:creation-date>2026-01-02T03:04:05Z</meta:creation-date>" +
        "<dc:date>2026-02-03T04:05:06Z</dc:date>" +
        "<dc:language>en-GB</dc:language></office:meta>",
    );
  });

  it("writes an empty office:meta for a document that states nothing", () => {
    const pkg = writeOdtContent(
      documentOf([{ kind: "paragraph", runs: [{ text: "x" }] }]),
    );
    expect(partXml(pkg, "meta.xml")).toContain("<office:meta></office:meta>");
  });
});

// Every refusal below is a construct that carries real meaning: writing the document without it would produce an .odt that silently lost content the caller handed in. The residue channel is the one deliberate exception, and it is stated in normaliseOdtContent rather than refused, because residue is opaque by construction.
describe("writeOdtContent: what it refuses rather than dropping", () => {
  it("refuses a construct boundary marker for a kind with no writer (an office:forms control)", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "constructStart",
            descriptor: {
              kind: "contentControl",
              controlType: "plainText",
            },
          },
          { kind: "paragraph", runs: [{ text: "x" }] },
          { kind: "constructEnd" },
        ]),
      ),
    ).toThrow(/does not yet wrap/);
  });

  it("refuses a run-level construct extent no writer resolves yet", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "paragraph",
            runs: [{ text: "x" }],
            constructs: [
              {
                descriptor: {
                  kind: "anchor",
                  anchorType: "footnote",
                  name: "note1",
                  definition: "note:note1",
                },
                startRun: 0,
                endRun: 1,
              },
            ],
          },
        ]),
      ),
    ).toThrow(/run-level construct extent this writer does not spell back yet/);
  });

  it("refuses an embedded chart object — the one kind with no write-side serialiser", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "embeddedObject",
            objectKind: "chart",
            frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
            document: {
              kind: "drawing",
              metadata: {},
              pages: [],
            },
          },
        ]),
      ),
    ).toThrow(/no write-side serialiser/);
  });

  it("refuses a table cell carrying a block kind the table reader could not read back", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "table",
            columns: [{ widthPt: 40 }],
            rows: [
              {
                cells: [
                  {
                    blocks: [
                      {
                        kind: "image",
                        format: "png",
                        base64:
                          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
                        widthPt: 10,
                        heightPt: 10,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ]),
      ),
    ).toThrow(/table cell/);
  });

  it("refuses a document of the wrong kind", () => {
    expect(() =>
      writeOdtContent({ kind: "presentation", metadata: {}, slides: [] }),
    ).toThrow(/expected a 'wordprocessing' document/);
  });

  it("refuses a document with no sections rather than inventing page geometry", () => {
    expect(() =>
      writeOdtContent({ kind: "wordprocessing", metadata: {}, sections: [] }),
    ).toThrow(/no page geometry/);
  });
});

describe("assertNeverContentBlockKind", () => {
  it("throws naming the unhandled kind, proving normaliseOdtContent's own exhaustiveness guard actually fires at runtime", () => {
    let caught: unknown;
    try {
      assertNeverContentBlockKind({ kind: "bogus" } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'normaliseOdtContent: unhandled ContentBlock kind {"kind":"bogus"}',
    );
  });
});
