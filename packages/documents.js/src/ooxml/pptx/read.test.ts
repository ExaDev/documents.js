import { describe, expect, it } from "vitest";
import { writeDocContent } from "doc-codec";
import {
  minimalPptxPackage,
  pptxWithLegacyOleObjectPackage,
} from "../../test-support/pptx";
import { readPptxContent } from "./read";

// readPptxContent is now a thin adapter over ooxml.js's own readPptxContent (the flat reader; the bare readPptx name reads the tree-form DocumentTree since ooxml.js 4.0.0): placeholder -> layout -> master -> theme inheritance, the run-property cascade, and group-transform flattening all live upstream in ooxml.js now, with their own test coverage there. These tests exercise only the wrapping this file is actually responsible for -- ContentDocument's discriminant/formatVersion, the metadata/slides passthrough -- not the OOXML semantics readPptx itself resolves.

describe("readPptxContent", () => {
  it("wraps ooxml.js's readPptxContent into a presentation ContentDocument", () => {
    const doc = readPptxContent(minimalPptxPackage());
    expect(doc.kind).toBe("presentation");
  });

  it("passes slides through from ooxml.js's readPptxContent unchanged, including slide size and shape text", () => {
    const doc = readPptxContent(minimalPptxPackage());
    if (doc.kind !== "presentation") {
      throw new Error("expected a presentation document");
    }
    expect(doc.slides).toHaveLength(1);
    expect(doc.slides[0]?.size).toEqual({ widthPt: 960, heightPt: 540 });
    const shape = doc.slides[0]?.shapes[0];
    const paragraph = shape?.blocks[0];
    expect(
      paragraph?.kind === "paragraph" ? paragraph.runs[0]?.text : undefined,
    ).toBe("Slide text");
  });

  it("spreads metadata from ooxml.js's readPptxContent, leaving LayoutMetadata's PDF-only producer field unset", () => {
    const doc = readPptxContent(minimalPptxPackage());
    // The fixture package carries no docProps/core.xml, so every field is undefined -- confirming the mapping doesn't invent a value, not merely that it round-trips one.
    expect(doc.metadata).toEqual({});
    expect(doc.metadata.producer).toBeUndefined();
  });

  // ExaDev/documents.js#921: a p:graphicFrame's p:oleObj whose payload is a classic OLE compound file holding native legacy streams (not a ZIP, and not a ZIP wrapped in the compound file's own "Package" stream) used to stay opaque -- ooxml.js's own readPptxContent already builds a real ContentShape for the frame (from its display picture, absent here), but nothing appended the recovered sub-document to its blocks. This second-pass splice (legacy-embedded.ts's spliceSlideLegacyEmbeddedObjects) recovers it by trying doc-codec/xls-codec/ppt-codec directly on the payload bytes, and appends it exactly where a ZIP-payload embedding's own recovered block already lands (readOleEmbeddedObject, ooxml.js's typed/pptx/read.ts).
  it("recovers a classic-OLE-compound-file .doc embedding as an embeddedObject block appended to the frame's own shape", () => {
    const payload = writeDocContent({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [{ kind: "paragraph", runs: [{ text: "Legacy doc text" }] }],
        },
      ],
    });
    const doc = readPptxContent(pptxWithLegacyOleObjectPackage(payload));
    if (doc.kind !== "presentation") {
      throw new Error("expected a presentation document");
    }
    const shape = doc.slides[0]?.shapes[0];
    // The p:graphicFrame carries no display picture, so the upstream reader's own fallback (readGraphicFrameShape, ooxml.js) already emitted one block naming the p:oleObj's own progId -- the recovered embedding is APPENDED beside it, the identical convention the ZIP-payload case follows (readOleEmbeddedObject there, "blocks.push(embedded)").
    expect(shape?.blocks).toHaveLength(2);
    const embedded = shape?.blocks[1];
    if (embedded?.kind !== "embeddedObject") {
      throw new Error("expected an embeddedObject block");
    }
    expect(embedded.objectKind).toBe("wordprocessing");
    expect(embedded.frame).toEqual(shape?.frame);
    const paragraph =
      embedded.document.kind === "wordprocessing"
        ? embedded.document.sections[0]?.blocks[0]
        : undefined;
    expect(
      paragraph?.kind === "paragraph" ? paragraph.runs[0]?.text : undefined,
    ).toBe("Legacy doc text");
  });
});
