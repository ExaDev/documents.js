import { flattenTree } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { PptEncryptedError, PptFormatError } from "./errors";
import {
  CURRENT_USER_STREAM,
  POWERPOINT_DOCUMENT_STREAM,
  readPpt,
  readPptContent,
  readPptStreams,
} from "./read";
import { compoundFile } from "./test-support/compound-file";
import { syntheticPresentation } from "./test-support/presentation";

function pptFile(
  options: Parameters<typeof syntheticPresentation>[0] = {},
): Uint8Array<ArrayBuffer> {
  const { currentUserStream, powerPointDocumentStream } =
    syntheticPresentation(options);
  return compoundFile([
    { name: CURRENT_USER_STREAM, bytes: currentUserStream },
    { name: POWERPOINT_DOCUMENT_STREAM, bytes: powerPointDocumentStream },
  ]);
}

describe("readPptStreams", () => {
  it("reads the slide size in points, converted from the document's master units", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ slideWidth: 5760, slideHeight: 4320 });
    const [slide] = readPptStreams(
      currentUserStream,
      powerPointDocumentStream,
    ).slides;
    // 5760 and 4320 master units at 576 per inch are 10 x 7.5 inches, the classic 4:3 slide -- 720 x 540 points.
    expect(slide?.size).toEqual({ widthPt: 720, heightPt: 540 });
  });

  it("resolves a placeholder shape's text through its OutlineTextRefAtom into the document's slide list", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ titleText: "Quarterly review" });
    const [slide] = readPptStreams(
      currentUserStream,
      powerPointDocumentStream,
    ).slides;
    expect(slide?.shapes[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Quarterly review" }] },
    ]);
  });

  it("reads a text box's own text, splitting it into a paragraph per carriage return", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ bodyText: "First point\rSecond point" });
    const [slide] = readPptStreams(
      currentUserStream,
      powerPointDocumentStream,
    ).slides;
    expect(slide?.shapes[1]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "First point" }] },
      { kind: "paragraph", runs: [{ text: "Second point" }] },
    ]);
  });

  it("places each shape at its client anchor, converted to points", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    const [slide] = readPptStreams(
      currentUserStream,
      powerPointDocumentStream,
    ).slides;
    // The title's anchor is top 360, left 480, right 5280, bottom 1080 master units.
    expect(slide?.shapes[0]?.frame).toEqual({
      xPt: 60,
      yPt: 45,
      widthPt: 600,
      heightPt: 90,
    });
  });

  it("skips the patriarch group, leaving only the two content shapes", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    const [slide] = readPptStreams(
      currentUserStream,
      powerPointDocumentStream,
    ).slides;
    expect(slide?.shapes).toHaveLength(2);
  });

  it("refuses an encrypted document by name rather than failing as malformed", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ encrypted: true });
    expect(() =>
      readPptStreams(currentUserStream, powerPointDocumentStream),
    ).toThrow(PptEncryptedError);
  });
});

describe("readPptContent", () => {
  it("reads a whole compound file, from its first byte to the slide's text", () => {
    const { slides } = readPptContent(pptFile());
    expect(slides).toHaveLength(1);
    expect(slides[0]?.shapes[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Quarterly review" }] },
    ]);
  });

  it("reports an empty metadata record, since document properties live outside every [MS-PPT] record", () => {
    expect(readPptContent(pptFile()).metadata).toEqual({});
  });

  it("rejects a compound file missing the PowerPoint Document stream", () => {
    const { currentUserStream } = syntheticPresentation();
    const bytes = compoundFile([
      { name: CURRENT_USER_STREAM, bytes: currentUserStream },
    ]);
    expect(() => readPptContent(bytes)).toThrow(PptFormatError);
  });
});

describe("readPpt", () => {
  it("produces a presentation DocumentTree that flattens back to the same content", () => {
    const bytes = pptFile();
    const tree = readPpt(bytes);
    expect(tree.kind).toBe("presentation");
    expect(flattenTree(tree)).toEqual({
      kind: "presentation",
      metadata: {},
      slides: readPptContent(bytes).slides,
    });
  });
});
