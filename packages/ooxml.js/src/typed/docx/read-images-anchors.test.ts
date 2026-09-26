import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentEmbeddedObjectBlock,
  ContentImageBlock,
  ContentParagraph,
} from "document-schema.js";
import { COMPOUND_FILE_MAGIC } from "archive-codec";
import { el } from "../../xml/fragment";
import { bytesToBase64 } from "byte-codec";
import { zipPackage } from "../../zip";
import { oleObjectBin } from "../../test-support/cfb";
import { minimalXlsxBytes } from "../../test-support/embedded";
import { readDocxContent } from "./read";
const IMAGE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const OLE_OBJECT_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject";
const PICTURE_GRAPHIC_URI =
  "http://schemas.openxmlformats.org/drawingml/2006/picture";

// A genuine, minimal 1x1 transparent PNG — real magic bytes, so sniffImageFormat actually recognises it, not a placeholder string.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// wp:inline and wp:anchor share the identical wp:extent/wp:docPr/a:graphic/a:graphicData/pic:pic/pic:blipFill/a:blip shape — only the outer container tag differs (and, for wp:anchor, the wp:positionH/wp:positionV elements this fixture doesn't set — see the dedicated "wp:anchor floating image position" describe block below for those).
function drawingElement(
  containerTag: "wp:inline" | "wp:anchor",
  rId: string,
  altText: string,
  extent: Readonly<{ cx: string; cy: string }> = { cx: "914400", cy: "457200" },
): XmlElement {
  return el("w:drawing", {}, [
    el(containerTag, {}, [
      el("wp:extent", extent), // default 1in x 0.5in -> 72pt x 36pt
      el("wp:docPr", { id: "1", name: "Picture 1", descr: altText }),
      el("a:graphic", {}, [
        el("a:graphicData", { uri: PICTURE_GRAPHIC_URI }, [
          el("pic:pic", {}, [
            el("pic:blipFill", {}, [el("a:blip", { "r:embed": rId })]),
          ]),
        ]),
      ]),
    ]),
  ]);
}

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

function asParagraph(block: ContentBlock | undefined): ContentParagraph {
  if (block?.kind !== "paragraph") {
    throw new Error("expected a paragraph block");
  }
  return block;
}

// The two construct-boundary markers have no sourcePath field at all (a boundary is not content), so reading one off an unnarrowed ContentBlock no longer type-checks — this narrows past them for the assertions below, which only ever look at real content blocks.
function sourcePathOf(block: ContentBlock | undefined): string | undefined {
  if (
    block === undefined ||
    block.kind === "constructStart" ||
    block.kind === "constructEnd"
  ) {
    return undefined;
  }
  return block.sourcePath;
}

function asImage(block: ContentBlock | undefined): ContentImageBlock {
  if (block?.kind !== "image") {
    throw new Error("expected an image block");
  }
  return block;
}

function asEmbeddedObject(
  block: ContentBlock | undefined,
): ContentEmbeddedObjectBlock {
  if (block?.kind !== "embeddedObject") {
    throw new Error("expected an embeddedObject block");
  }
  return block;
}

function oleObjectFixturePackage(
  oleRel: Readonly<{ target: string; external?: boolean }>,
  extraRuns: readonly XmlElement[] = [],
  dxaOrig = "1920",
): Package {
  const objectRun = el("w:r", {}, [
    el("w:object", { "w:dxaOrig": dxaOrig, "w:dyaOrig": "1200" }, [
      el(
        "v:shape",
        {
          id: "_x0000_i1025",
          type: "#_x0000_t75",
          style: "width:96pt;height:60pt",
        },
        [el("v:imagedata", { "r:id": "rIdPreview", "o:title": "" })],
      ),
      el("o:OLEObject", {
        Type: "Embed",
        ProgID: "Excel.Sheet.12",
        ShapeID: "_x0000_i1025",
        DrawAspect: "Content",
        ObjectID: "_1702998213",
        "r:id": "rIdOle",
      }),
    ]),
  ]);
  const paragraph = el("w:p", {}, [objectRun, ...extraRuns]);
  const body = el("w:body", {}, [
    paragraph,
    el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
  ]);
  const documentRels = rels([
    oleRel.external === true
      ? {
          id: "rIdOle",
          type: OLE_OBJECT_REL,
          target: oleRel.target,
          external: true,
        }
      : { id: "rIdOle", type: OLE_OBJECT_REL, target: oleRel.target },
    { id: "rIdPreview", type: IMAGE_REL, target: "media/olePreview.png" },
  ]);
  return {
    parts: {
      "word/document.xml": {
        kind: "xml",
        nodes: [el("w:document", {}, [body])],
      },
      "word/_rels/document.xml.rels": { kind: "xml", nodes: [documentRels] },
      "word/media/olePreview.png": { kind: "binary", base64: TINY_PNG_BASE64 },
    },
  };
}

describe("readDocxContent: embedded OLE objects", () => {
  it("recovers a ZIP-payload OLE object as an embeddedObject block carrying the genuinely decoded sub-document", () => {
    // The payload part rIdOle targets now really exists: a minimal xlsx, as a modern producer writes an embedded workbook.
    const pkg = oleObjectFixturePackage({
      target: "embeddings/oleObject1.xlsx",
    });
    pkg.parts["word/embeddings/oleObject1.xlsx"] = {
      kind: "binary",
      base64: bytesToBase64(minimalXlsxBytes()),
    };
    const doc = readDocxContent(pkg);
    // The paragraph contributes its own (run-text-empty) block, then the object's recovered content as a sibling — the same lifting convention an inline image follows. The VML preview has no reader, so it adds no image block.
    expect(doc.sections[0]?.blocks).toHaveLength(2);
    const embedded = asEmbeddedObject(doc.sections[0]?.blocks[1]);
    expect(embedded.objectKind).toBe("spreadsheet");
    // w:object's own w:dxaOrig/w:dyaOrig (twips) size the block; an inline flow object has no absolute position, so the frame sits at the origin.
    expect(embedded.frame).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 96,
      heightPt: 60,
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
    expect(sourcePathOf(doc.sections[0]?.blocks[1])).toBe(
      "sections[0].blocks[1]",
    );
  });

  it("lifts an object and a drawing from one paragraph in their markup encounter order", () => {
    // A drawing run after the object run (reusing the fixture's own preview image part) must lift its image block after the object's embedded block, not before it.
    const pkg = oleObjectFixturePackage(
      { target: "embeddings/oleObject1.xlsx" },
      [
        el("w:r", {}, [
          drawingElement("wp:inline", "rIdPreview", "Drawing after the object"),
        ]),
      ],
    );
    pkg.parts["word/embeddings/oleObject1.xlsx"] = {
      kind: "binary",
      base64: bytesToBase64(minimalXlsxBytes()),
    };
    const doc = readDocxContent(pkg);
    // The object's own paragraph, the embedded object block, and the lifted drawing image after it.
    const EXPECTED_BLOCK_COUNT = 3;
    expect(doc.sections[0]?.blocks).toHaveLength(EXPECTED_BLOCK_COUNT);
    expect(asEmbeddedObject(doc.sections[0]?.blocks[1]).objectKind).toBe(
      "spreadsheet",
    );
    expect(asImage(doc.sections[0]?.blocks[2]).altText).toBe(
      "Drawing after the object",
    );
  });

  it("recovers a classic compound-file .bin payload (an OLE-packaged xlsx) as an embeddedObject block", () => {
    // The legacy real-world spelling: rIdOle targets embeddings/oleObject1.bin, whose bytes are a CFB compound file carrying the embedded xlsx as an OLE-packaged 'Package' stream. The recovery must land on the same embeddedObject block the direct-ZIP spelling produces, sized identically from w:object's own geometry.
    const pkg = oleObjectFixturePackage({
      target: "embeddings/oleObject1.bin",
    });
    pkg.parts["word/embeddings/oleObject1.bin"] = {
      kind: "binary",
      base64: bytesToBase64(oleObjectBin(minimalXlsxBytes())),
    };
    const doc = readDocxContent(pkg);
    expect(doc.sections[0]?.blocks).toHaveLength(2);
    const embedded = asEmbeddedObject(doc.sections[0]?.blocks[1]);
    expect(embedded.objectKind).toBe("spreadsheet");
    expect(embedded.frame).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 96,
      heightPt: 60,
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

  it("keeps a malformed compound-file .bin payload skipped, with no embedded block and no host-read failure", () => {
    // rIdOle retargeted at a part whose bytes carry the OLE/CFB magic but no walkable structure — the named CompoundFileFormatError this decode throws is a property of the embedded payload, degraded to nothing rather than failing the paragraph, section, or document around it (the #737 failure policy extended to the CFB gate).
    const pkg = oleObjectFixturePackage({
      target: "embeddings/oleObject1.bin",
    });
    // Arbitrary filler bytes with no meaning of their own beyond being distinct values after the two ignorable ones (0x01, 0x02) above them.
    const ARBITRARY_FILLER_BYTE_3 = 0x03;
    const ARBITRARY_FILLER_BYTE_4 = 0x04;
    pkg.parts["word/embeddings/oleObject1.bin"] = {
      kind: "binary",
      // The genuine CFB/OLE2 magic, followed by arbitrary filler bytes with no walkable compound-file structure behind them, matching the CompoundFileFormatError this decode is expected to throw and degrade past. The filler bytes' own values carry no meaning; they simply count upward.
      base64: bytesToBase64(
        new Uint8Array([
          ...COMPOUND_FILE_MAGIC,
          0x01,
          0x02,
          ARBITRARY_FILLER_BYTE_3,
          ARBITRARY_FILLER_BYTE_4,
        ]),
      ),
    };
    const doc = readDocxContent(pkg);
    expect(doc.sections[0]?.blocks).toHaveLength(1);
    // The w:r carrying the object reads as an empty-text run, exactly as it did before embedded recovery existed.
    const paragraph = asParagraph(doc.sections[0]?.blocks[0]);
    expect(paragraph.runs).toHaveLength(1);
    expect(paragraph.runs[0]?.text).toBe("");
  });

  it("skips an externally-linked OLE object (TargetMode External) without resolving its target", () => {
    // A linked object's relationship target is a URI, not a package part — the same part-lookup convention the image path applies leaves the paragraph as it was, and no ZIP detection ever runs against the link.
    const pkg = oleObjectFixturePackage({
      target: "file:///C:/data/Book1.xlsx",
      external: true,
    });
    const doc = readDocxContent(pkg);
    expect(doc.sections[0]?.blocks).toHaveLength(1);
  });

  it("skips a ZIP payload that is not a recognisable OOXML package without poisoning the host read", () => {
    // A ZIP payload that fails to decode as one of the three OOXML flavours (here: a plain archive) is skipped exactly like a non-ZIP payload — one bad embedded object can never fail the whole document read.
    const pkg = oleObjectFixturePackage({ target: "embeddings/payload.zip" });
    pkg.parts["word/embeddings/payload.zip"] = {
      kind: "binary",
      base64: bytesToBase64(
        zipPackage({
          "readme.txt": new TextEncoder().encode("not a document package"),
        }),
      ),
    };
    const doc = readDocxContent(pkg);
    expect(doc.sections[0]?.blocks).toHaveLength(1);
    const paragraph = asParagraph(doc.sections[0]?.blocks[0]);
    expect(paragraph.runs).toHaveLength(1);
    expect(paragraph.runs[0]?.text).toBe("");
  });

  it("skips a w:object whose w:dxaOrig is not numeric, rather than emitting a NaN-sized frame", () => {
    // Malformed geometry degrades to no block, the tier every other numeric attribute reader here degrades on (readOutlineLevel's malformed @lvl is the family's own example): a NaN widthPt would emit a ContentEmbeddedObjectBlock no schema validator accepts, poisoning the whole section for every downstream consumer.
    const pkg = oleObjectFixturePackage(
      { target: "embeddings/oleObject1.xlsx" },
      [],
      "not-a-number",
    );
    pkg.parts["word/embeddings/oleObject1.xlsx"] = {
      kind: "binary",
      base64: bytesToBase64(minimalXlsxBytes()),
    };
    const doc = readDocxContent(pkg);
    expect(doc.sections[0]?.blocks).toHaveLength(1);
  });
});

// Every element with the given tag anywhere in the node forest — the write-side assertions below need to reach a w:object nested inside w:body > w:p > w:r, far below the part root.
describe("readDocxContent: malformed image geometry", () => {
  it("skips a w:drawing whose wp:extent carries a non-numeric EMU value, rather than emitting a NaN-sized image", () => {
    // The pre-existing parity hazard the embedded-object path would otherwise have widened: Number('nine') is NaN, and a NaN widthPt image block fails ContentImageBlock's own geometry schema for every downstream validator.
    const pkg = oleObjectFixturePackage(
      { target: "embeddings/oleObject1.xlsx" },
      [
        el("w:r", {}, [
          drawingElement("wp:inline", "rIdPreview", "Broken extent", {
            cx: "nine",
            cy: "457200",
          }),
        ]),
      ],
    );
    const doc = readDocxContent(pkg);
    // No embeddings part ships, so the object contributes nothing either — the paragraph's own block is all that remains.
    expect(doc.sections[0]?.blocks).toHaveLength(1);
  });
});

// A wp:anchor whose wp:positionH/wp:positionV carry whatever position children the caller supplies — everything else (extent, docPr, the picture chain, the relationship, the media part) is the identical minimal shape drawingElement builds above, just with the position elements spliced in.
