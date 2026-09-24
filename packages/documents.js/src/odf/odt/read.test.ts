import type {
  ContentBlock,
  ContentDocument,
  ContentVector,
} from "document-schema.js";
import { decodePackage, zipPackage } from "odf.js";
import { encodePng } from "byte-codec";
import { describe, expect, it } from "vitest";
import { readOdtContent } from "./read";

// Real-fixture convention (src/test-support/odt.ts's own top comment): hand-authored XML, zipped via odf.js's own zipPackage, never through this package's own writer — proving detection against independently-plausible raw markup rather than merely round-tripping this package's own output back through itself (src/edit/odt/content.test.ts already does that).
//
// Every expectation below is hand-computed from the block-counting mirror documented at the top of read.ts (one block per text:p/text:h, one per text:list-item paragraph at every nesting level, one per table:table, text:section transparent, everything else nothing) plus spliceBlocks' one-forward-pass contract (src/model/block-splice.ts): a placement's `index` names the ORIGINAL block position it lands before, and a consumed index drops that original block outright.

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
const FO_NS =
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';

// The embedded sub-object convention every formula fixture below uses: a draw:frame whose draw:object references "./ObjectN", whose own MathML lives at "ObjectN/content.xml" (the same office:body > office:math > math:math shape src/convert/formula.test.ts builds).
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

function absoluteImageFrame(): string {
  return `<draw:frame svg:x="10pt" svg:y="12pt" svg:width="100pt" svg:height="50pt"><draw:image xlink:href="Pictures/image1.png"/></draw:frame>`;
}

// Two vector primitives with exact point geometry: draw:rect and draw:ellipse both carry the same four svg:x/y/width/height attributes, so both resolve through parseBox to the exact frames asserted below.
const RECT_XML =
  '<draw:rect svg:x="10pt" svg:y="20pt" svg:width="30pt" svg:height="40pt"/>';
const ELLIPSE_XML =
  '<draw:ellipse svg:x="50pt" svg:y="60pt" svg:width="25pt" svg:height="15pt"/>';

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
function readOdt(
  bodyInner: string,
  options: OdtFixtureOptions = {},
): {
  readonly blocks: readonly ContentBlock[];
  readonly content: ContentDocument;
} {
  const content = readOdtContent(decodePackage(odtBytes(bodyInner, options)));
  if (content.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing ContentDocument");
  }
  if (content.sections.length !== 1) {
    throw new Error(
      `expected exactly one section, got ${content.sections.length}`,
    );
  }
  return { blocks: content.sections[0]!.blocks, content };
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

function drawingVectorsOf(
  block: ContentBlock | undefined,
): readonly ContentVector[] {
  if (
    block?.kind !== "embeddedObject" ||
    block.objectKind !== "drawing" ||
    block.document.kind !== "drawing"
  ) {
    throw new Error("expected a drawing embedded-object block");
  }
  return block.document.pages[0]?.vectors ?? [];
}

// The frame of a boxed vector kind (rect/ellipse/path): `line` carries endpoints instead, so it is excluded by the guard rather than asserted away.
function vectorFrameOf(vector: ContentVector | undefined): {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
} {
  if (
    vector?.kind !== "rect" &&
    vector?.kind !== "ellipse" &&
    vector?.kind !== "path"
  ) {
    throw new Error("expected a boxed vector (rect/ellipse/path)");
  }
  return vector.frame;
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
    const { blocks } = readOdt(
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
    const { blocks } = readOdt(
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
    const { blocks } = readOdt(
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
    const { blocks } = readOdt(
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
    const { blocks } = readOdt(
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
    const { blocks } = readOdt(
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
    const { blocks } = readOdt(
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
    const { blocks } = readOdt(
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
    const { blocks } = readOdt(
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
    const { blocks } = readOdt(
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
    const { blocks } = readOdt(
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
    const { blocks } = readOdt(
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

  it("treats a text:h heading exactly like a text:p for detection: its objects follow the heading block", () => {
    // One heading carrying an inline formula, an inline image, and a vector primitive: all three walks must count the heading as their block, so all three placements share index 1 (formula, drawing, image in the combined list's own order).
    const { blocks } = readOdt(
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

describe("readOdtContent: vector placement", () => {
  it("replaces a paragraph carrying nothing but a vector primitive with one drawing block sized to the section's own page", () => {
    // The drawing block wraps a one-page drawing ContentDocument whose page is the SECTION's page (A4 default, from document-schema.js's PAGE_SIZE_A4), and whose vectors keep their recovered page-relative geometry.
    const { blocks } = readOdt(
      "<text:p>Before</text:p>" +
        `<text:p>${RECT_XML}</text:p>` +
        "<text:p>After</text:p>",
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
    expect(blocks[1]).toMatchObject({
      kind: "embeddedObject",
      objectKind: "drawing",
      sourcePath: "sections[0].blocks[1]",
      frame: { xPt: 0, yPt: 0, widthPt: 595.28, heightPt: 841.89 },
    });
    const vectors = drawingVectorsOf(blocks[1]);
    expect(vectors.map((vector) => vector.kind)).toEqual(["rect"]);
    expect(vectorFrameOf(vectors[0])).toEqual({
      xPt: 10,
      yPt: 20,
      widthPt: 30,
      heightPt: 40,
    });
  });

  it("keeps a paragraph that carries text beside the vector, placing the drawing block after it", () => {
    // Real text means the paragraph is content of its own; consuming it here would silently drop the label.
    const { blocks } = readOdt(
      `<text:p>Label ${RECT_XML}</text:p>` + "<text:p>After</text:p>",
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
    expect(paragraphText(blocks[0])).toContain("Label");
  });

  it("groups every vector of one paragraph into a single drawing block, in document order", () => {
    // "All vectors within one container become one drawing block" is the write side's own convention: two primitives, one placement, one block.
    const { blocks } = readOdt(
      "<text:p>Before</text:p>" +
        `<text:p>${RECT_XML}${ELLIPSE_XML}</text:p>` +
        "<text:p>After</text:p>",
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
    const vectors = drawingVectorsOf(blocks[1]);
    expect(vectors.map((vector) => vector.kind)).toEqual(["rect", "ellipse"]);
    expect(vectorFrameOf(vectors[0])).toEqual({
      xPt: 10,
      yPt: 20,
      widthPt: 30,
      heightPt: 40,
    });
    expect(vectorFrameOf(vectors[1])).toEqual({
      xPt: 50,
      yPt: 60,
      widthPt: 25,
      heightPt: 15,
    });
  });

  it("places a bare vector primitive that is a direct child of office:text between the blocks either side of it", () => {
    const { blocks } = readOdt(
      `<text:p>Before</text:p>${RECT_XML}<text:p>After</text:p>`,
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
    expect(blocks[1]).toMatchObject({
      objectKind: "drawing",
      sourcePath: "sections[0].blocks[1]",
    });
  });

  it("places a vector primitive sitting directly among a table's own children after the table's single block", () => {
    // The table branch's detection is collectContainerVectors(node.children): odf.js's own readDrawPageContent walks only shape elements at the level it is handed, so this sees a primitive DIRECTLY among the table's children (synthetic as markup, but exactly the branch's contract) and places it one past the table's own block.
    const { blocks } = readOdt(
      "<text:p>Before</text:p>" +
        `<table:table><table:table-row><table:table-cell><text:p>Cell</text:p></table:table-cell></table:table-row>${RECT_XML}</table:table>` +
        "<text:p>After</text:p>",
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "table",
      "embeddedObject",
      "paragraph",
    ]);
    expect(blocks[2]).toMatchObject({
      objectKind: "drawing",
      sourcePath: "sections[0].blocks[2]",
    });
  });

  it("does not detect a vector nested inside a table cell: the table branch's walk is shallow where the formula walk's is deep", () => {
    // A draw:rect inside a cell's paragraph is beneath the level collectContainerVectors walks, so no drawing block appears at all. This is the genuine formula/vector asymmetry at table scope (collectFormulaFrames recurses through any element; readDrawPageContent recognises only shape elements directly), pinned as-is.
    const { blocks } = readOdt(
      "<text:p>Before</text:p>" +
        `<table:table><table:table-row><table:table-cell><text:p>${RECT_XML}</text:p></table:table-cell></table:table-row></table:table>` +
        "<text:p>After</text:p>",
    );
    expect(blockKinds(blocks)).toEqual(["paragraph", "table", "paragraph"]);
  });

  it("places a vector inside a list item's paragraph after that paragraph's own block", () => {
    const { blocks } = readOdt(
      "<text:list>" +
        `<text:list-item><text:p>Item ${RECT_XML}</text:p></text:list-item>` +
        "</text:list>" +
        "<text:p>After</text:p>",
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
    expect(blocks[1]).toMatchObject({
      objectKind: "drawing",
      sourcePath: "sections[0].blocks[1]",
    });
  });

  it("places a bare vector element sitting directly inside a text:list-item at the current index", () => {
    const { blocks } = readOdt(
      "<text:list>" +
        `<text:list-item><text:p>Item</text:p>${RECT_XML}</text:list-item>` +
        "</text:list>" +
        "<text:p>After</text:p>",
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
    expect(blocks[1]).toMatchObject({
      objectKind: "drawing",
      sourcePath: "sections[0].blocks[1]",
    });
  });

  it("places a vector inside a text:section after the section's own counted paragraph", () => {
    // Same marker-block shape as the formula case above: the consumed index eats the constructStart marker and the drawing block lands before the empty paragraph.
    const { blocks } = readOdt(
      "<text:p>Before</text:p>" +
        `<text:section text:name="Sect"><text:p>${RECT_XML}</text:p></text:section>`,
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
      "constructEnd",
    ]);
  });

  it("never consumes a paragraph whose only vector-tagged child resolves no vector (a geometry-less draw:rect)", () => {
    // A draw:rect with no svg:x/y/width/height at all is a vector TAG but resolves no vector, so the paragraph keeps its own (empty) block and no drawing block appears for it. Treating "vector-tagged children present" as enough to consume would drop this paragraph outright with nothing in its place.
    const { blocks } = readOdt(
      "<text:p>Intro</text:p>" +
        "<text:p><draw:rect/></text:p>" +
        `<text:p>${inlineImageFrame()}</text:p>` +
        "<text:p>Outro</text:p>",
      { withImage: true },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "paragraph",
      "paragraph",
      "image",
      "paragraph",
    ]);
  });
});

describe("readOdtContent: image placement", () => {
  it("never consumes the paragraph an image is found in, even when the image is all it carries", () => {
    // The one deliberate divergence from the formula/vector walks: ContentImageBlock has nowhere to record inline membership, so the (empty) paragraph block stays and the image follows it: four blocks, not three.
    const { blocks } = readOdt(
      "<text:p>Before</text:p>" +
        `<text:p>${inlineImageFrame()}</text:p>` +
        "<text:p>After</text:p>",
      { withImage: true },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "paragraph",
      "image",
      "paragraph",
    ]);
    expect(paragraphText(blocks[1])).toBe("");
    expect(blocks[2]).toMatchObject({
      kind: "image",
      format: "png",
      widthPt: 100,
      heightPt: 50,
      sourcePath: "sections[0].blocks[2]",
    });
  });

  it("places an absolutely-positioned image frame that is a direct child of office:text between the blocks either side of it", () => {
    const { blocks } = readOdt(
      `<text:p>Before</text:p>${absoluteImageFrame()}<text:p>After</text:p>`,
      { withImage: true },
    );
    expect(blockKinds(blocks)).toEqual(["paragraph", "image", "paragraph"]);
    expect(blocks[1]).toMatchObject({
      kind: "image",
      widthPt: 100,
      heightPt: 50,
      sourcePath: "sections[0].blocks[1]",
    });
  });

  it("places an image found inside a table cell immediately after the table's own single block", () => {
    const { blocks } = readOdt(
      "<text:p>Before</text:p>" +
        `<table:table><table:table-row><table:table-cell><text:p>${inlineImageFrame()}</text:p></table:table-cell></table:table-row></table:table>` +
        "<text:p>After</text:p>",
      { withImage: true },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "table",
      "image",
      "paragraph",
    ]);
    expect(blocks[2]).toMatchObject({
      kind: "image",
      sourcePath: "sections[0].blocks[2]",
    });
  });

  it("places an image inside a list item's paragraph after that paragraph's own block", () => {
    const { blocks } = readOdt(
      "<text:list>" +
        `<text:list-item><text:p>Item ${inlineImageFrame()}</text:p></text:list-item>` +
        "</text:list>" +
        "<text:p>After</text:p>",
      { withImage: true },
    );
    expect(blockKinds(blocks)).toEqual(["paragraph", "image", "paragraph"]);
    expect(blocks[1]).toMatchObject({
      kind: "image",
      sourcePath: "sections[0].blocks[1]",
    });
  });

  it("places a bare image frame sitting directly inside a text:list-item at the current index", () => {
    const { blocks } = readOdt(
      "<text:list>" +
        `<text:list-item><text:p>Item</text:p>${absoluteImageFrame()}</text:list-item>` +
        "</text:list>" +
        "<text:p>After</text:p>",
      { withImage: true },
    );
    expect(blockKinds(blocks)).toEqual(["paragraph", "image", "paragraph"]);
    expect(blocks[1]).toMatchObject({
      kind: "image",
      sourcePath: "sections[0].blocks[1]",
    });
  });

  it("places an image inside a text:section after the section's own counted paragraph, inside the construct markers", () => {
    // Images never consume, so the marker blocks survive untouched here: constructStart, image, paragraph, constructEnd, paragraph.
    const { blocks } = readOdt(
      `<text:section text:name="Sect"><text:p>${inlineImageFrame()}</text:p></text:section>` +
        "<text:p>After</text:p>",
      { withImage: true },
    );
    expect(blockKinds(blocks)).toEqual([
      "constructStart",
      "image",
      "paragraph",
      "constructEnd",
      "paragraph",
    ]);
    expect(blocks[1]).toMatchObject({
      kind: "image",
      sourcePath: "sections[0].blocks[1]",
    });
  });
});

describe("readOdtContent: the three detection passes merge into one splice", () => {
  it("interleaves a formula before an image by true block position, with the image's paragraph kept", () => {
    // Formula paragraph first: the formula replaces its own (consumed) paragraph, the image's paragraph is kept, so Intro, formula, empty paragraph, image, Outro.
    const { blocks } = readOdt(
      "<text:p>Intro</text:p>" +
        `<text:p>${inlineFormulaFrame("Object 1")}</text:p>` +
        `<text:p>${inlineImageFrame()}</text:p>` +
        "<text:p>Outro</text:p>",
      { objects: [["Object 1", "<math:mn>7</math:mn>"]], withImage: true },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
      "image",
      "paragraph",
    ]);
    expect(blocks[1]).toMatchObject({
      objectKind: "formula",
      sourcePath: "sections[0].blocks[1]",
    });
    expect(blocks[3]).toMatchObject({
      kind: "image",
      sourcePath: "sections[0].blocks[3]",
    });
  });

  it("interleaves an image before a formula by true block position (the reverse concatenation order)", () => {
    // The formula pass's placements are concatenated ahead of the image pass's, so this ordering is the one that needs the combined list actually SORTED by index: image at position 2, formula replacing its own paragraph at position 3.
    const { blocks } = readOdt(
      "<text:p>Intro</text:p>" +
        `<text:p>${inlineImageFrame()}</text:p>` +
        `<text:p>${inlineFormulaFrame("Object 1")}</text:p>` +
        "<text:p>Outro</text:p>",
      { objects: [["Object 1", "<math:mn>7</math:mn>"]], withImage: true },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "paragraph",
      "image",
      "embeddedObject",
      "paragraph",
    ]);
    expect(blocks[2]).toMatchObject({
      kind: "image",
      sourcePath: "sections[0].blocks[2]",
    });
    expect(blocks[3]).toMatchObject({
      objectKind: "formula",
      sourcePath: "sections[0].blocks[3]",
    });
  });

  it("never consumes an empty or whitespace-only paragraph that carries no detected object at all", () => {
    // An empty recognised-element list must mean "not this walk's paragraph": the whitespace-only and truly empty paragraphs are ordinary content here and must survive alongside the image splice.
    const { blocks } = readOdt(
      "<text:p>Intro</text:p>" +
        "<text:p> </text:p>" +
        "<text:p></text:p>" +
        `<text:p>${inlineImageFrame()}</text:p>` +
        "<text:p>Outro</text:p>",
      { withImage: true },
    );
    expect(blockKinds(blocks)).toEqual([
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "image",
      "paragraph",
    ]);
  });
});

describe("readOdtContent: the multi-section defensive guard", () => {
  // The shape odf.js's own read.test.ts uses for a mid-document page-style switch: two master pages, a paragraph style naming the second. odf.js splits two ContentSections, and this module's detection passes skip the document outright (see read.ts's own top-of-file comment: a defensive guard, not an expected real-world case), so an embedded formula in either section arrives as no block at all.
  const STYLES_XML =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-styles ${OFFICE_NS} ${STYLE_NS} ${FO_NS}>` +
    "<office:automatic-styles>" +
    '<style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="210mm" fo:page-height="297mm"/></style:page-layout>' +
    '<style:page-layout style:name="PM2"><style:page-layout-properties fo:page-width="297mm" fo:page-height="210mm"/></style:page-layout>' +
    "</office:automatic-styles>" +
    "<office:master-styles>" +
    '<style:master-page style:name="Standard" style:page-layout-name="PM1"/>' +
    '<style:master-page style:name="Landscape" style:page-layout-name="PM2"/>' +
    "</office:master-styles>" +
    "</office:document-styles>";
  const LANDSCAPE_PARA_STYLE =
    '<style:style style:name="LandscapePara" style:family="paragraph" style:master-page-name="Landscape"/>';

  it("skips the formula/image/vector passes entirely for a document read into two sections", () => {
    const content = readOdtContent(
      decodePackage(
        odtBytes(
          "<text:p>First</text:p>" +
            `<text:p text:style-name="LandscapePara">${inlineFormulaFrame("Object 1")}</text:p>`,
          {
            objects: [["Object 1", "<math:mn>7</math:mn>"]],
            extraXmlPart: ["styles.xml", STYLES_XML],
            automaticStyles: LANDSCAPE_PARA_STYLE,
          },
        ),
      ),
    );
    if (content.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    // The split itself: two sections, the second landscape-sized (297mm x 210mm), proving the fixture genuinely produced the multi-section shape the guard exists for.
    expect(content.sections).toHaveLength(2);
    expect(content.sections[1]?.pageSize.widthPt).toBeCloseTo(841.8898, 3);
    expect(content.sections[1]?.pageSize.heightPt).toBeCloseTo(595.2756, 3);
    for (const section of content.sections) {
      expect(blockKinds(section.blocks)).toEqual(["paragraph"]);
    }
  });
});
