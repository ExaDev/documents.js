import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentEmbeddedObjectBlock,
  ContentImageBlock,
  ContentParagraph,
} from "document-schema.js";
import { el } from "../../xml/fragment";
import { bytesToBase64 } from "byte-codec";
import { COMPOUND_FILE_MAGIC } from "archive-codec";
import { zipPackage } from "../../zip";
import { oleObjectBin } from "../../test-support/cfb";
import { minimalXlsxBytes } from "../../test-support/embedded";
import { PNG_SIGNATURE } from "../../image/sniff";
import { readPptxContent } from "./read";
const IMAGE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
function asParagraph(block: ContentBlock | undefined): ContentParagraph {
  if (block?.kind !== "paragraph") {
    throw new Error("expected a paragraph block");
  }
  return block;
}

function asImage(block: ContentBlock | undefined): ContentImageBlock {
  if (block?.kind !== "image") {
    throw new Error("expected an image block");
  }
  return block;
}

// A depth-first search for the first element named tag whose own attribute attrName equals attrValue — used to mutate one specific p:cNvPr in place within buildFixturePackage's already-parsed slide tree, rather than duplicating the whole fixture to exercise a single attribute variant.
function asEmbeddedObject(
  block: ContentBlock | undefined,
): ContentEmbeddedObjectBlock {
  if (block?.kind !== "embeddedObject") {
    throw new Error("expected an embeddedObject block");
  }
  return block;
}

const SLIDE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
function rels(
  entries: readonly {
    id: string;
    type: string;
    target: string;
    external?: boolean;
  }[],
): XmlElement {
  return el(
    "Relationships",
    {},
    entries.map((e) =>
      el(
        "Relationship",
        e.external === true
          ? { Id: e.id, Type: e.type, Target: e.target, TargetMode: "External" }
          : { Id: e.id, Type: e.type, Target: e.target },
      ),
    ),
  );
}

// Only the PNG magic-byte signature matters to sniffImageFormat — the rest is arbitrary filler, not a real encoded image.
function tinyPngBase64(): string {
  const bytes = new Uint8Array([...PNG_SIGNATURE, 0, 0, 0, 0]);
  return bytesToBase64(bytes);
}

function oleFixturePackage(
  payloadTarget = "../embeddings/oleObject1.xlsx",
  frameCount = 1,
): Package {
  const choiceOleObj = el(
    "p:oleObj",
    { spid: "3", "r:id": "rIdOle", progId: "Excel.Sheet.12", showAsIcon: "0" },
    [el("p:embed")],
  );
  const fallbackOleObj = el(
    "p:oleObj",
    { spid: "3", "r:id": "rIdOle", progId: "Excel.Sheet.12" },
    [
      el("p:pic", {}, [
        el("p:nvPicPr", {}, [
          el("p:cNvPr", { id: "4", name: "Fallback Picture" }),
          el("p:cNvPicPr"),
          el("p:nvPr"),
        ]),
        el("p:blipFill", {}, [el("a:blip", { "r:embed": "rIdFallback" })]),
      ]),
    ],
  );
  const oleFrame = (index: number): XmlElement =>
    el("p:graphicFrame", {}, [
      el("p:nvGraphicFramePr", {}, [
        el("p:cNvPr", { id: String(index + 2), name: `Object ${index + 1}` }),
      ]),
      el("p:xfrm", {}, [
        el("a:off", { x: "914400", y: "1828800" }),
        el("a:ext", { cx: "4572000", cy: "2743200" }),
      ]),
      el("a:graphic", {}, [
        el(
          "a:graphicData",
          { uri: "http://schemas.openxmlformats.org/presentationml/2006/ole" },
          [
            el("mc:AlternateContent", {}, [
              el("mc:Choice", { Requires: "v" }, [choiceOleObj]),
              el("mc:Fallback", {}, [fallbackOleObj]),
            ]),
          ],
        ),
      ]),
    ]);
  const slide = el("p:sld", {}, [
    el("p:cSld", {}, [
      el(
        "p:spTree",
        {},
        Array.from({ length: frameCount }, (_, index) => oleFrame(index)),
      ),
    ]),
  ]);
  const presentation = el("p:presentation", {}, [
    el("p:sldIdLst", {}, [el("p:sldId", { id: "256", "r:id": "rId1" })]),
  ]);
  const presentationRels = rels([
    { id: "rId1", type: SLIDE_REL, target: "slides/slide1.xml" },
  ]);
  const slideRels = rels([
    {
      id: "rIdOle",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject",
      target: payloadTarget,
    },
    { id: "rIdFallback", type: IMAGE_REL, target: "../media/oleFallback.png" },
  ]);

  return {
    parts: {
      "ppt/presentation.xml": { kind: "xml", nodes: [presentation] },
      "ppt/_rels/presentation.xml.rels": {
        kind: "xml",
        nodes: [presentationRels],
      },
      "ppt/slides/slide1.xml": { kind: "xml", nodes: [slide] },
      "ppt/slides/_rels/slide1.xml.rels": { kind: "xml", nodes: [slideRels] },
      "ppt/media/oleFallback.png": { kind: "binary", base64: tinyPngBase64() },
    },
  };
}

describe("readPptxContent: OLE graphic frames", () => {
  it("reads the fallback picture as an image block sized to the frame", () => {
    const doc = readPptxContent(oleFixturePackage());
    const oleShape = doc.slides[0]?.shapes.find((s) => s.name === "Object 1");
    const image = asImage(oleShape?.blocks[0]);
    expect(image.format).toBe("png");
    expect(image.base64).toBe(tinyPngBase64());
    const FIXTURE_OLE_FRAME_WIDTH_PT = 360; // the fixture's own p:xfrm/a:ext for the OLE graphic frame
    const FIXTURE_OLE_FRAME_HEIGHT_PT = 216;
    expect(image.widthPt).toBe(FIXTURE_OLE_FRAME_WIDTH_PT);
    expect(image.heightPt).toBe(FIXTURE_OLE_FRAME_HEIGHT_PT);
  });

  it("records the object's progId as a paragraph when no fallback picture resolves", () => {
    // The fallback relationship points at a part the package does not carry.
    const pkg = oleFixturePackage();
    delete pkg.parts["ppt/media/oleFallback.png"];
    const doc = readPptxContent(pkg);
    const oleShape = doc.slides[0]?.shapes.find((s) => s.name === "Object 1");
    expect(oleShape?.frame).toEqual({
      xPt: 72,
      yPt: 144,
      widthPt: 360,
      heightPt: 216,
    });
    expect(asParagraph(oleShape?.blocks[0]).runs[0]?.text).toBe(
      "Excel.Sheet.12",
    );
  });

  it("keeps the frame's geometry with empty content when neither picture nor progId is present", () => {
    // The p:oleObj carries no progId and the graphicData holds no fallback picture at all.
    const bareFrame = el("p:graphicFrame", {}, [
      el("p:nvGraphicFramePr", {}, [
        el("p:cNvPr", { id: "2", name: "Object 1" }),
      ]),
      el("p:xfrm", {}, [
        el("a:off", { x: "914400", y: "1828800" }),
        el("a:ext", { cx: "4572000", cy: "2743200" }),
      ]),
      el("a:graphic", {}, [
        el(
          "a:graphicData",
          { uri: "http://schemas.openxmlformats.org/presentationml/2006/ole" },
          [el("p:oleObj", { spid: "3" })],
        ),
      ]),
    ]);
    const slide = el("p:sld", {}, [
      el("p:cSld", {}, [el("p:spTree", {}, [bareFrame])]),
    ]);
    const presentation = el("p:presentation", {}, [
      el("p:sldIdLst", {}, [el("p:sldId", { id: "256", "r:id": "rId1" })]),
    ]);
    const pkg: Package = {
      parts: {
        "ppt/presentation.xml": { kind: "xml", nodes: [presentation] },
        "ppt/_rels/presentation.xml.rels": {
          kind: "xml",
          nodes: [
            rels([
              { id: "rId1", type: SLIDE_REL, target: "slides/slide1.xml" },
            ]),
          ],
        },
        "ppt/slides/slide1.xml": { kind: "xml", nodes: [slide] },
      },
    };
    const doc = readPptxContent(pkg);
    const oleShape = doc.slides[0]?.shapes.find((s) => s.name === "Object 1");
    expect(oleShape?.frame).toEqual({
      xPt: 72,
      yPt: 144,
      widthPt: 360,
      heightPt: 216,
    });
    expect(oleShape?.blocks).toEqual([]);
  });

  it("assigns sourcePath to the fallback image block", () => {
    const doc = readPptxContent(oleFixturePackage());
    const oleShape = doc.slides[0]?.shapes.find((s) => s.name === "Object 1");
    expect(asImage(oleShape?.blocks[0]).sourcePath).toBe(
      "slides[0].shapes[0].blocks[0]",
    );
  });

  it("recovers a ZIP-payload OLE object as an embeddedObject block alongside the fallback picture", () => {
    // The payload part the fixture's rIdOle already targets now really exists: a minimal xlsx, as a modern producer writes an embedded workbook.
    const pkg = oleFixturePackage();
    pkg.parts["ppt/embeddings/oleObject1.xlsx"] = {
      kind: "binary",
      base64: bytesToBase64(minimalXlsxBytes()),
    };
    const doc = readPptxContent(pkg);
    const oleShape = doc.slides[0]?.shapes.find((s) => s.name === "Object 1");
    // Both blocks: the picture every renderer displays, and the recovered sub-document's content.
    expect(asImage(oleShape?.blocks[0]).format).toBe("png");
    const embedded = asEmbeddedObject(oleShape?.blocks[1]);
    expect(embedded.objectKind).toBe("spreadsheet");
    expect(embedded.frame).toEqual({
      xPt: 72,
      yPt: 144,
      widthPt: 360,
      heightPt: 216,
    });
    // The nested document is the genuinely decoded workbook, not just an envelope block.
    const sheet =
      embedded.document.kind === "spreadsheet"
        ? embedded.document.sheets[0]
        : undefined;
    expect(sheet?.name).toBe("Embedded");
    expect(sheet?.cells[0]?.value).toEqual({
      kind: "string",
      value: "Recovered cell",
    });
  });

  it("recovers a classic compound-file .bin payload (an OLE-packaged xlsx) as an embeddedObject block alongside the fallback picture", () => {
    // The legacy real-world spelling: rIdOle targets ../embeddings/oleObject1.bin, whose bytes are a CFB compound file carrying the embedded xlsx as an OLE-packaged 'Package' stream. The frame lands on the same two blocks the direct-ZIP spelling produces: the fallback picture plus the recovered sub-document, sized to the frame's own geometry.
    const pkg = oleFixturePackage("../embeddings/oleObject1.bin");
    pkg.parts["ppt/embeddings/oleObject1.bin"] = {
      kind: "binary",
      base64: bytesToBase64(oleObjectBin(minimalXlsxBytes())),
    };
    const doc = readPptxContent(pkg);
    const oleShape = doc.slides[0]?.shapes.find((s) => s.name === "Object 1");
    expect(asImage(oleShape?.blocks[0]).format).toBe("png");
    const embedded = asEmbeddedObject(oleShape?.blocks[1]);
    expect(embedded.objectKind).toBe("spreadsheet");
    expect(embedded.frame).toEqual({
      xPt: 72,
      yPt: 144,
      widthPt: 360,
      heightPt: 216,
    });
    const sheet =
      embedded.document.kind === "spreadsheet"
        ? embedded.document.sheets[0]
        : undefined;
    expect(sheet?.cells[0]?.value).toEqual({
      kind: "string",
      value: "Recovered cell",
    });
  });

  it("keeps a malformed compound-file .bin payload on exactly the fallback-picture behaviour, with no embedded block and no slide-read failure", () => {
    // rIdOle retargeted at a part whose bytes carry the OLE/CFB magic but no walkable structure — the named CompoundFileFormatError the decode throws is a property of the embedded payload, degraded to nothing rather than poisoning the host slide read (the #737 failure policy extended to the CFB gate).
    const pkg = oleFixturePackage("../embeddings/oleObject1.bin");
    // Four arbitrary trailing bytes standing in for whatever real header content would normally follow the signature; their exact values carry no meaning, so they simply count upward.
    const TRAILING_BYTE_COUNT = 4;
    const arbitraryTrailingBytes = Array.from(
      { length: TRAILING_BYTE_COUNT },
      (_unused, index) => index + 1,
    );
    const malformedCompoundFileBytes = new Uint8Array([
      ...COMPOUND_FILE_MAGIC,
      ...arbitraryTrailingBytes,
    ]);
    pkg.parts["ppt/embeddings/oleObject1.bin"] = {
      kind: "binary",
      base64: bytesToBase64(malformedCompoundFileBytes),
    };
    const doc = readPptxContent(pkg);
    const oleShape = doc.slides[0]?.shapes.find((s) => s.name === "Object 1");
    expect(oleShape?.blocks).toHaveLength(1);
    expect(asImage(oleShape?.blocks[0]).format).toBe("png");
  });

  it("keeps the fallback-picture behaviour when the payload is a ZIP but not a recognisable package, so the host read is never poisoned", () => {
    // A ZIP payload that fails to decode as one of the three OOXML flavours (here: a plain archive) must be a non-event for the host slide, exactly like a non-ZIP payload — one bad embedded object can never fail the whole document read.
    const pkg = oleFixturePackage("../embeddings/payload.zip");
    pkg.parts["ppt/embeddings/payload.zip"] = {
      kind: "binary",
      base64: bytesToBase64(
        zipPackage({
          "readme.txt": new TextEncoder().encode("not a document package"),
        }),
      ),
    };
    const doc = readPptxContent(pkg);
    const oleShape = doc.slides[0]?.shapes.find((s) => s.name === "Object 1");
    expect(oleShape?.blocks).toHaveLength(1);
    expect(asImage(oleShape?.blocks[0]).format).toBe("png");
  });

  it("decodes an embeddings part shared by two OLE frames once, both blocks carrying the same recovered document", () => {
    // Copy-pasted objects point two frames at one embeddings part: the payload is one part of one package, so it is decoded once per read and both blocks share the recovered nested document object rather than each holding an independently decoded copy of identical bytes.
    const pkg = oleFixturePackage("../embeddings/oleObject1.xlsx", 2);
    pkg.parts["ppt/embeddings/oleObject1.xlsx"] = {
      kind: "binary",
      base64: bytesToBase64(minimalXlsxBytes()),
    };
    const doc = readPptxContent(pkg);
    const first = asEmbeddedObject(
      doc.slides[0]?.shapes.find((s) => s.name === "Object 1")?.blocks[1],
    );
    const second = asEmbeddedObject(
      doc.slides[0]?.shapes.find((s) => s.name === "Object 2")?.blocks[1],
    );
    expect(second.objectKind).toBe("spreadsheet");
    expect(second.document).toBe(first.document);
  });
});

// One body shape whose paragraphs exercise every a:pPr/@lvl spelling: absent (both as no a:pPr at all and as an a:pPr carrying no lvl), an explicit zero (distinct from absent: present-and-valid, so it emits), a real outline level, and the three malformed spellings that must degrade to no list (readOutlineLevel in src/typed/pptx/read.ts).
