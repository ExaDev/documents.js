import { decodePackage, zipPackage } from "odf.js";
import { encodePng } from "byte-codec";
import { describe, expect, it } from "vitest";
import { readOdtContent } from "./read";

// Real-fixture convention (src/test-support/odt.ts's own top comment): hand-authored XML, zipped via odf.js's own zipPackage, never through this package's own writer -- proving detection against independently-plausible raw markup rather than merely round-tripping this package's own output back through itself (src/edit/odt/content.test.ts already does that).

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

// A genuine, decodable 2x2 PNG -- readDrawImageBlock sniffs the actual bytes and returns undefined for anything it cannot recognise as a real image format.
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

// A real inline image: an as-char anchored draw:frame>draw:image sitting directly inside a paragraph that ALSO carries real text -- the shape LibreOffice writes for "insert image" at a cursor position inside a sentence, and the shape readOdtContent must turn into [paragraph, image], never consuming the paragraph (contrast the formula/vector cases, where a paragraph carrying NOTHING but the embedded object is replaced outright).
function odtBytes(): Uint8Array<ArrayBuffer> {
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
    const pkg = decodePackage(odtBytes());
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
