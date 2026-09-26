import type { ContentBlock } from "document-schema.js";
import { decodePackage, zipPackage } from "odf.js";
import { encodePng } from "byte-codec";
import { describe, expect, it } from "vitest";
import { readOdtContent } from "./read";
function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

// A genuine, decodable 2x2 PNG — readDrawImageBlock sniffs the actual bytes and returns undefined for anything it cannot recognise as a real image format.
function tinyPngBytes(): Uint8Array<ArrayBuffer> {
  return encodePng({
    width: 2,
    height: 2,
    channels: 3,
    data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
  });
}

const OFFICE_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"';
const TEXT_NS = 'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';
const DRAW_NS =
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"';
const SVG_NS =
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
const XLINK_NS = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const TABLE_NS =
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"';
const STYLE_NS =
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"';
function formulaObjectXml(mathMlInner: string): Uint8Array<ArrayBuffer> {
  return enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${OFFICE_NS} xmlns:math="http://www.w3.org/1998/Math/MathML"><office:body><office:math><math:math xmlns:math="http://www.w3.org/1998/Math/MathML">${mathMlInner}</math:math></office:math></office:body></office:document-content>`,
  );
}

// A formula frame anchored inline in the text flow (as-char, 28pt x 14pt, no svg:x/y): flowAnchoredFrameBox resolves it to a zero-origin box of exactly that declared size.
function inlineFormulaFrame(objectName: string): string {
  return `<draw:frame text:anchor-type="as-char" svg:width="28pt" svg:height="14pt"><draw:object xlink:href="./${objectName}"/></draw:frame>`;
}

// A formula frame absolutely positioned at (10pt, 12pt), the shape odf.js's own readDrawFrame resolves directly.
function absoluteFormulaFrame(objectName: string): string {
  return `<draw:frame svg:x="10pt" svg:y="12pt" svg:width="28pt" svg:height="14pt"><draw:object xlink:href="./${objectName}"/></draw:frame>`;
}

// An image frame anchored inline (100pt x 50pt, as the existing real-inline-image fixture above uses) and one absolutely positioned at (10pt, 12pt).
function inlineImageFrame(): string {
  return `<draw:frame text:anchor-type="as-char" svg:width="100pt" svg:height="50pt"><draw:image xlink:href="Pictures/image1.png"/></draw:frame>`;
}

const RECT_XML =
  '<draw:rect svg:x="10pt" svg:y="20pt" svg:width="30pt" svg:height="40pt"/>';
interface OdtFixtureOptions {
  // Embedded formula sub-objects as [directory name, MathML inner] pairs.
  readonly objects?: readonly (readonly [string, string])[];
  // Adds the real decodable PNG image part image frames reference.
  readonly withImage?: boolean;
  // A whole extra part (path plus XML bytes), e.g. a styles.xml.
  readonly extraXmlPart?: readonly [string, string];
  // Extra office:automatic-styles entries inside content.xml.
  readonly automaticStyles?: string;
}

function odtBytes(
  bodyInner: string,
  options: OdtFixtureOptions = {},
): Uint8Array<ArrayBuffer> {
  const contentXml = enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${OFFICE_NS} ${TEXT_NS} ${DRAW_NS} ${SVG_NS} ${XLINK_NS} ${TABLE_NS} ${STYLE_NS}>` +
      (options.automaticStyles === undefined
        ? ""
        : `<office:automatic-styles>${options.automaticStyles}</office:automatic-styles>`) +
      `<office:body><office:text>${bodyInner}</office:text></office:body></office:document-content>`,
  );
  return zipPackage([
    [
      "mimetype",
      { bytes: enc("application/vnd.oasis.opendocument.text"), stored: true },
    ],
    ["content.xml", { bytes: contentXml }],
    ...(options.extraXmlPart === undefined
      ? []
      : [
          [
            options.extraXmlPart[0],
            { bytes: enc(options.extraXmlPart[1]) },
          ] as const,
        ]),
    ...(options.objects ?? []).map(
      ([name, mathMlInner]) =>
        [
          `${name}/content.xml`,
          { bytes: formulaObjectXml(mathMlInner) },
        ] as const,
    ),
    ...(options.withImage === true
      ? ([["Pictures/image1.png", { bytes: tinyPngBytes() }]] as const)
      : []),
  ]);
}

// Every fixture is decoded and read INSIDE its it() body, fresh per call: a describe-scope read would execute during vitest collection and be attributed to no test, silently turning its mutants' classification into no-coverage.
function readOdtBlocks(
  bodyInner: string,
  options: OdtFixtureOptions = {},
): readonly ContentBlock[] {
  const content = readOdtContent(decodePackage(odtBytes(bodyInner, options)));
  if (content.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing ContentDocument");
  }
  if (content.sections.length !== 1) {
    throw new Error(
      `expected exactly one section, got ${content.sections.length}`,
    );
  }
  return content.sections[0]!.blocks;
}

function blockKinds(blocks: readonly ContentBlock[]): string[] {
  return blocks.map((block) => block.kind);
}

function paragraphText(block: ContentBlock | undefined): string {
  if (block?.kind !== "paragraph") {
    throw new Error("expected a paragraph block");
  }
  return block.runs.map((run) => run.text).join("");
}

function mathmlTagOf(block: ContentBlock | undefined): string {
  if (
    block?.kind !== "embeddedObject" ||
    block.objectKind !== "formula" ||
    block.document.kind !== "formula"
  ) {
    throw new Error("expected a formula embedded-object block");
  }
  const first = block.document.formula.mathml[0];
  if (first?.type !== "element") {
    throw new Error("expected an element MathML root node");
  }
  return first.tag;
}

// A real inline image: an as-char anchored draw:frame>draw:image sitting directly inside a paragraph that ALSO carries real text — the shape LibreOffice writes for "insert image" at a cursor position inside a sentence, and the shape readOdtContent must turn into [paragraph, image], never consuming the paragraph (contrast the formula/vector cases, where a paragraph carrying NOTHING but the embedded object is replaced outright).
function odtBytesLegacy(): Uint8Array<ArrayBuffer> {
  const contentXml = enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${OFFICE_NS} ${TEXT_NS} ${DRAW_NS} ${SVG_NS} ${XLINK_NS}>` +
      "<office:body><office:text>" +
      "<text:p>Some text" +
      '<draw:frame text:anchor-type="as-char" svg:width="100pt" svg:height="50pt"><draw:image xlink:href="Pictures/image1.png"/></draw:frame>' +
      "</text:p>" +
      "<text:p>After</text:p>" +
      "</office:text></office:body></office:document-content>",
  );
  return zipPackage([
    [
      "mimetype",
      { bytes: enc("application/vnd.oasis.opendocument.text"), stored: true },
    ],
    ["content.xml", { bytes: contentXml }],
    ["Pictures/image1.png", { bytes: tinyPngBytes() }],
  ]);
}

describe("readOdtContent: a real inline image", () => {
  it("produces [paragraph, image] as two adjacent blocks, with the paragraph never consumed", () => {
    const pkg = decodePackage(odtBytesLegacy());
    const content = readOdtContent(pkg);
    if (content.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = content.sections[0]!.blocks;
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "image",
      "paragraph",
    ]);
    expect(blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "Some text" }],
    });
    expect(blocks[1]).toMatchObject({
      kind: "image",
      format: "png",
      widthPt: 100,
      heightPt: 50,
    });
    expect(blocks[2]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "After" }],
    });
  });
});

describe("readOdtContent: formula placement", () => {
  it("replaces a paragraph carrying nothing but a display formula, keeping the formula's own declared frame", () => {
    // odf.js's own reader produces three paragraph blocks (the middle one empty); the formula walk consumes the middle one and splices the formula block in its place, so the blank paragraph beside every display formula never appears.
    const blocks = readOdtBlocks(
      "<text:p>Intro</text:p>" +
        `<text:p>${inlineFormulaFrame("Object 1")}</text:p>` +
        "<text:p>Outro</text:p>",
      { objects: [["Object 1", "<math:mn>7</math:mn>"]] },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
    expect(blocks[1]).toMatchObject({
      kind: "embeddedObject",
      objectKind: "formula",
      sourcePath: "sections[0].blocks[1]",
      frame: { xPt: 0, yPt: 0, widthPt: 28, heightPt: 14 },
    });
    expect(mathmlTagOf(blocks[1])).toBe("math:mn");
  });

  it("keeps a paragraph that carries real text around an inline formula, placing the formula right after it", () => {
    // "Two ... three" is genuine paragraph content, so the paragraph is never consumed: the block sequence is paragraph, paragraph, formula, paragraph.
    const blocks = readOdtBlocks(
      "<text:p>One</text:p>" +
        `<text:p>Two ${inlineFormulaFrame("Object 1")} three</text:p>` +
        "<text:p>Four</text:p>",
      { objects: [["Object 1", "<math:mn>7</math:mn>"]] },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
    expect(paragraphText(blocks[1])).toContain("Two");
    expect(paragraphText(blocks[1])).toContain("three");
    expect(blocks[2]).toMatchObject({
      objectKind: "formula",
      sourcePath: "sections[0].blocks[2]",
    });
  });

  it("treats whitespace-only text between formula frames as no content of the paragraph's own (still consumed)", () => {
    // The two surrounding text nodes trim to nothing, so the paragraph is still nothing but the formula: three blocks, not four. An untrimmed check would see " " as content and leave the empty paragraph in place.
    const blocks = readOdtBlocks(
      "<text:p>Before</text:p>" +
        `<text:p> ${inlineFormulaFrame("Object 1")} </text:p>` +
        "<text:p>After</text:p>",
      { objects: [["Object 1", "<math:mn>7</math:mn>"]] },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
  });

  it("tolerates XML comment nodes between a paragraph's formula frames (still consumed)", () => {
    // A comment child is neither text nor an element, so it is skipped rather than counted as unrecognised content: the paragraph carrying only the frame and comments is still replaced outright.
    const blocks = readOdtBlocks(
      "<text:p>Before</text:p>" +
        `<text:p><!--edge-->${inlineFormulaFrame("Object 1")}<!--case--></text:p>` +
        "<text:p>After</text:p>",
      { objects: [["Object 1", "<math:mn>7</math:mn>"]] },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
  });

  it("keeps a paragraph that mixes a formula frame with another element of its own", () => {
    // A text:span carrying text is content the paragraph owns; only whitespace and the recognised frames themselves may surround them, so this paragraph is not consumed and keeps its text.
    const blocks = readOdtBlocks(
      "<text:p>Before</text:p>" +
        `<text:p><text:span>note</text:span>${inlineFormulaFrame("Object 1")}</text:p>` +
        "<text:p>After</text:p>",
      { objects: [["Object 1", "<math:mn>7</math:mn>"]] },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
    expect(paragraphText(blocks[1])).toContain("note");
  });

  it("places two formula frames of one paragraph as two adjacent blocks, in document order", () => {
    const blocks = readOdtBlocks(
      "<text:p>Before</text:p>" +
        `<text:p>${inlineFormulaFrame("Object 1")}${inlineFormulaFrame("Object 2")}</text:p>` +
        "<text:p>After</text:p>",
      {
        objects: [
          ["Object 1", "<math:mn>7</math:mn>"],
          ["Object 2", "<math:msqrt><math:mi>x</math:mi></math:msqrt>"],
        ],
      },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "embeddedObject",
      "embeddedObject",
      "paragraph",
    ]);
    expect(blocks[1]).toMatchObject({
      objectKind: "formula",
      sourcePath: "sections[0].blocks[1]",
    });
    expect(blocks[2]).toMatchObject({
      objectKind: "formula",
      sourcePath: "sections[0].blocks[2]",
    });
    expect(mathmlTagOf(blocks[1])).toBe("math:mn");
    expect(mathmlTagOf(blocks[2])).toBe("math:msqrt");
  });

  it("places an absolutely-positioned formula frame that is a direct child of office:text between the blocks either side of it", () => {
    // A top-level draw:frame contributes no block of its own, so the formula belongs at the current index: exactly between the two paragraphs. Its geometry comes from odf.js's own readDrawFrame, i.e. the literal svg:x/y/width/height.
    const blocks = readOdtBlocks(
      "<text:p>Before</text:p>" +
        absoluteFormulaFrame("Object 1") +
        "<text:p>After</text:p>",
      { objects: [["Object 1", "<math:mn>7</math:mn>"]] },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
    expect(blocks[1]).toMatchObject({
      objectKind: "formula",
      sourcePath: "sections[0].blocks[1]",
      frame: { xPt: 10, yPt: 12, widthPt: 28, heightPt: 14 },
    });
  });

  it("places a formula found inside a table cell immediately after the table's own single block", () => {
    // One table:table is exactly one ContentBlock regardless of its cells; the deep detection walk still finds the formula inside the cell, and its insertion point is counted one past the table.
    const blocks = readOdtBlocks(
      "<text:p>Before</text:p>" +
        `<table:table><table:table-row><table:table-cell><text:p>Cell ${inlineFormulaFrame("Object 1")}</text:p></table:table-cell></table:table-row></table:table>` +
        "<text:p>After</text:p>",
      { objects: [["Object 1", "<math:mn>7</math:mn>"]] },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "table",
      "embeddedObject",
      "paragraph",
    ]);
    expect(blocks[2]).toMatchObject({
      objectKind: "formula",
      sourcePath: "sections[0].blocks[2]",
    });
  });

  it("places a formula inside a text:section after the section's own counted paragraph", () => {
    // odf.js reads a text:section as a division construct, so its flat block list carries constructStart/constructEnd marker blocks around the section's content: [paragraph, constructStart, paragraph, constructEnd]. The mirror walk counts pre-marker blocks, so the consumed index lands on the constructStart marker and the formula is spliced before the empty paragraph: paragraph, formula, paragraph, constructEnd. Pinned exactly as the current mirror behaves.
    const blocks = readOdtBlocks(
      "<text:p>Before</text:p>" +
        `<text:section text:name="Sect"><text:p>${inlineFormulaFrame("Object 1")}</text:p></text:section>`,
      { objects: [["Object 1", "<math:mn>7</math:mn>"]] },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
      "constructEnd",
    ]);
    expect(blocks[1]).toMatchObject({
      objectKind: "formula",
      sourcePath: "sections[0].blocks[1]",
    });
  });

  it("unwraps a text:list into one block per item paragraph, placing a formula after the item that carries it", () => {
    const blocks = readOdtBlocks(
      "<text:list>" +
        "<text:list-item><text:p>Item one</text:p></text:list-item>" +
        `<text:list-item><text:p>Item two ${inlineFormulaFrame("Object 1")}</text:p></text:list-item>` +
        "</text:list>" +
        "<text:p>After</text:p>",
      { objects: [["Object 1", "<math:mn>7</math:mn>"]] },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
    expect(blocks[2]).toMatchObject({
      objectKind: "formula",
      sourcePath: "sections[0].blocks[2]",
    });
  });

  it("descends a nested text:list, placing the formula after the inner item's paragraph", () => {
    // The inner list's paragraphs are blocks of the same flat flow: Outer, Inner, formula, After.
    const blocks = readOdtBlocks(
      "<text:list>" +
        "<text:list-item>" +
        "<text:p>Outer</text:p>" +
        "<text:list>" +
        `<text:list-item><text:p>Inner ${inlineFormulaFrame("Object 1")}</text:p></text:list-item>` +
        "</text:list>" +
        "</text:list-item>" +
        "</text:list>" +
        "<text:p>After</text:p>",
      { objects: [["Object 1", "<math:mn>7</math:mn>"]] },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
    expect(blocks[2]).toMatchObject({
      objectKind: "formula",
      sourcePath: "sections[0].blocks[2]",
    });
  });

  it("places a bare formula frame sitting directly inside a text:list-item at the current index (it contributes no block of its own)", () => {
    // The list's blocks are the item paragraphs alone; the frame after the paragraph inside the same list item lands between the item's paragraph and the following block.
    const blocks = readOdtBlocks(
      "<text:list>" +
        `<text:list-item><text:p>Item</text:p>${absoluteFormulaFrame("Object 1")}</text:list-item>` +
        "</text:list>" +
        "<text:p>After</text:p>",
      { objects: [["Object 1", "<math:mn>7</math:mn>"]] },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
    expect(blocks[1]).toMatchObject({
      objectKind: "formula",
      sourcePath: "sections[0].blocks[1]",
    });
  });

  it("treats a text:h heading inside a list item exactly like the list's paragraphs for detection", () => {
    // odf.js's own list walker emits one block per item paragraph OR heading, so a heading carrying an inline formula, vector, and image counts one block and all three placements follow it. Heading-in-a-list-item is exactly the shape odf.js's readOdfListParagraphs explicitly supports for text:h, so it is pinned here for every detection walk.
    const blocks = readOdtBlocks(
      "<text:list>" +
        `<text:list-item><text:h text:outline-level="2">Head ${inlineFormulaFrame("Object 1")} ${RECT_XML} ${inlineImageFrame()}</text:h></text:list-item>` +
        "</text:list>" +
        "<text:p>After</text:p>",
      { objects: [["Object 1", "<math:mn>7</math:mn>"]], withImage: true },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "embeddedObject",
      "embeddedObject",
      "image",
      "paragraph",
    ]);
    expect(blocks[0]).toMatchObject({ kind: "paragraph", headingLevel: 2 });
    expect(blocks[1]).toMatchObject({
      objectKind: "formula",
      sourcePath: "sections[0].blocks[1]",
    });
    expect(blocks[2]).toMatchObject({
      objectKind: "drawing",
      sourcePath: "sections[0].blocks[2]",
    });
    expect(blocks[3]).toMatchObject({
      kind: "image",
      sourcePath: "sections[0].blocks[3]",
    });
  });

  it("ignores a stray paragraph sitting directly inside text:list (not inside a text:list-item)", () => {
    // A text:p that is a DIRECT child of text:list is not a text:list-item, so odf.js's own list walker contributes no block for it and every detection walk skips it whole: no formula, drawing, or image block appears anywhere. (The walk iterates list items only, exactly as the upstream reader does.)
    const blocks = readOdtBlocks(
      "<text:list>" +
        "<text:list-item><text:p>Item</text:p></text:list-item>" +
        `<text:p>Stray ${inlineFormulaFrame("Object 1")} ${RECT_XML} ${inlineImageFrame()}</text:p>` +
        "</text:list>" +
        "<text:p>After</text:p>",
      { objects: [["Object 1", "<math:mn>7</math:mn>"]], withImage: true },
    );
    expect(blockKinds(blocks)).toEqual(["paragraph", "paragraph"]);
    expect(paragraphText(blocks[0])).toContain("Item");
    expect(paragraphText(blocks[1])).toContain("After");
  });

  it("treats a text:h heading exactly like a text:p for detection: its objects follow the heading block", () => {
    // One heading carrying an inline formula, an inline image, and a vector primitive: all three walks must count the heading as their block, so all three placements share index 1 (formula, drawing, image in the combined list's own order).
    const blocks = readOdtBlocks(
      `<text:h text:outline-level="2">Head ${inlineFormulaFrame("Object 1")}${inlineImageFrame()}${RECT_XML}</text:h>` +
        "<text:p>After</text:p>",
      { objects: [["Object 1", "<math:mn>7</math:mn>"]], withImage: true },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "embeddedObject",
      "embeddedObject",
      "image",
      "paragraph",
    ]);
    expect(blocks[0]).toMatchObject({ kind: "paragraph", headingLevel: 2 });
    expect(blocks[1]).toMatchObject({
      objectKind: "formula",
      sourcePath: "sections[0].blocks[1]",
    });
    expect(blocks[2]).toMatchObject({
      objectKind: "drawing",
      sourcePath: "sections[0].blocks[2]",
    });
    expect(blocks[3]).toMatchObject({
      kind: "image",
      sourcePath: "sections[0].blocks[3]",
    });
  });
});
