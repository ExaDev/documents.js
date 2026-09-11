import { writeSummaryInformationStream } from "archive-codec";
import { encodePng } from "byte-codec";
import {
  ContentDocumentSchema,
  DocumentTreeSchema,
  flattenTree,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "./base64";
import { PptEncryptedError, PptFormatError } from "./errors";
import {
  CURRENT_USER_STREAM,
  POWERPOINT_DOCUMENT_STREAM,
  SUMMARY_INFORMATION_STREAM,
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

/** The same synthetic presentation pptFile builds, with a real "\x05SummaryInformation" stream added beside it -- composed with archive-codec's own writeSummaryInformationStream rather than by extending test-support/compound-file.ts, which stays a pure [MS-CFB]-only fixture builder. */
function pptFileWithMetadata(
  metadata: Parameters<typeof writeSummaryInformationStream>[0],
  options: Parameters<typeof syntheticPresentation>[0] = {},
): Uint8Array<ArrayBuffer> {
  const { currentUserStream, powerPointDocumentStream } =
    syntheticPresentation(options);
  return compoundFile([
    { name: CURRENT_USER_STREAM, bytes: currentUserStream },
    { name: POWERPOINT_DOCUMENT_STREAM, bytes: powerPointDocumentStream },
    {
      name: SUMMARY_INFORMATION_STREAM,
      bytes: writeSummaryInformationStream(metadata),
    },
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

  it("resolves a title run's bold and colour from the master's own style cascade and colour scheme, when the run itself states neither", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ masterTitleBold: true });
    const [slide] = readPptStreams(
      currentUserStream,
      powerPointDocumentStream,
    ).slides;
    // The title placeholder's own text carries no StyleTextPropAtom at all (see syntheticPresentation's own construction) -- every field below comes from the master's TITLE-type TextMasterStyleAtom level 0, not from the run itself.
    expect(slide?.shapes[0]?.blocks).toEqual([
      {
        kind: "paragraph",
        runs: [
          {
            text: "Quarterly review",
            bold: true,
            // Accent 1 (colour-scheme slot 0x05) resolved against the master's own colour scheme -- see MASTER_COLOR_SCHEME's own comment in test-support/presentation.ts.
            color: { r: 0x1a / 255, g: 0x4b / 255, b: 0x8c / 255 },
          },
        ],
      },
    ]);
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

  describe("picture shapes", () => {
    const PNG = encodePng({
      width: 1,
      height: 1,
      channels: 3,
      data: new Uint8Array([0x40, 0x80, 0xc0]),
    });
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

    it("reads a picture shape as an image block sized to its frame, through the document's blip store", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ picture: { format: "png", bytes: PNG } });
      const [slide] = readPptStreams(
        currentUserStream,
        powerPointDocumentStream,
      ).slides;
      // The third shape of the fixture: the picture, anchored top 360 left 1440 right 2160 bottom 2880 master units -- 45pt down, 180pt across, 100pt wide, 90pt tall.
      expect(slide?.shapes[2]).toEqual({
        frame: { xPt: 180, yPt: 45, widthPt: 100, heightPt: 90 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
        blocks: [
          {
            kind: "image",
            format: "png",
            base64: bytesToBase64(PNG),
            widthPt: 100,
            heightPt: 90,
          },
        ],
      });
    });

    it("reads a JPEG blip with its format from the record type, never from the payload's bytes", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ picture: { format: "jpeg", bytes: JPEG } });
      const [slide] = readPptStreams(
        currentUserStream,
        powerPointDocumentStream,
      ).slides;
      expect(slide?.shapes[2]?.blocks[0]).toMatchObject({
        kind: "image",
        format: "jpeg",
        base64: bytesToBase64(JPEG),
      });
    });

    it("resolves a delay-stream blip through the Pictures stream at the FBSE's foDelay", () => {
      const { currentUserStream, powerPointDocumentStream, picturesStream } =
        syntheticPresentation({
          picture: { format: "png", bytes: PNG },
          pictureInPicturesStream: true,
        });
      const document = readPptContent(
        compoundFile([
          { name: CURRENT_USER_STREAM, bytes: currentUserStream },
          {
            name: POWERPOINT_DOCUMENT_STREAM,
            bytes: powerPointDocumentStream,
          },
          ...(picturesStream === undefined
            ? []
            : [{ name: "Pictures", bytes: picturesStream }]),
        ]),
      );
      expect(document.slides[0]?.shapes[2]?.blocks[0]).toMatchObject({
        kind: "image",
        format: "png",
        base64: bytesToBase64(PNG),
      });
    });

    it("keeps a picture shape's geometry with empty content when no Pictures stream is supplied for a delay-stream blip", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({
          picture: { format: "png", bytes: PNG },
          pictureInPicturesStream: true,
        });
      const [slide] = readPptStreams(
        currentUserStream,
        powerPointDocumentStream,
      ).slides;
      expect(slide?.shapes[2]?.blocks).toEqual([]);
      expect(slide?.shapes[2]?.frame).toBeDefined();
    });
  });

  it("refuses an encrypted document by name rather than failing as malformed", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ encrypted: true });
    expect(() =>
      readPptStreams(currentUserStream, powerPointDocumentStream),
    ).toThrow(PptEncryptedError);
  });

  describe("RC4 CryptoAPI-encrypted presentations", () => {
    const PASSWORD = "Correct Horse Battery Staple";

    it("refuses a genuinely encrypted document given no password", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ password: PASSWORD });
      expect(() =>
        readPptStreams(currentUserStream, powerPointDocumentStream),
      ).toThrow(PptEncryptedError);
    });

    it("refuses a genuinely encrypted document given the wrong password", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ password: PASSWORD });
      expect(() =>
        readPptStreams(
          currentUserStream,
          powerPointDocumentStream,
          "wrong password",
        ),
      ).toThrow(PptEncryptedError);
    });

    it("decrypts a presentation given the correct password, matching an unencrypted read of the same content", () => {
      const plain = syntheticPresentation({ notesText: "Speaker notes" });
      const encrypted = syntheticPresentation({
        password: PASSWORD,
        notesText: "Speaker notes",
      });
      const decrypted = readPptStreams(
        encrypted.currentUserStream,
        encrypted.powerPointDocumentStream,
        PASSWORD,
      );
      const expected = readPptStreams(
        plain.currentUserStream,
        plain.powerPointDocumentStream,
      );
      expect(decrypted).toEqual(expected);
    });
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

  it('reports an empty metadata record when the container carries no "\\x05SummaryInformation" stream', () => {
    expect(readPptContent(pptFile()).metadata).toEqual({});
  });

  it("rejects a compound file missing the PowerPoint Document stream", () => {
    const { currentUserStream } = syntheticPresentation();
    const bytes = compoundFile([
      { name: CURRENT_USER_STREAM, bytes: currentUserStream },
    ]);
    expect(() => readPptContent(bytes)).toThrow(PptFormatError);
  });

  describe("speaker notes", () => {
    it("resolves a slide's notes through the notes list and its own persist object", () => {
      const bytes = pptFile({ notesText: "Mention the budget revision." });
      expect(readPptContent(bytes).slides[0]?.notes).toBe(
        "Mention the budget revision.",
      );
    });

    it("splits the notes' stored carriage returns into newline-separated paragraphs", () => {
      const bytes = pptFile({ notesText: "Open here\rThen close" });
      expect(readPptContent(bytes).slides[0]?.notes).toBe(
        "Open here\nThen close",
      );
    });

    it("reports no notes for a presentation carrying no notes list at all", () => {
      expect(readPptContent(pptFile()).slides[0]?.notes).toBe("");
    });

    it("keeps a notes slide's own text out of the slide's shapes", () => {
      // The failure this guards against is the one real LibreOffice verification caught in odf.js's own odp writer: notes landing on the visible slide rather than in the notes container.
      const bytes = pptFile({ notesText: "Never shown on the slide." });
      const [slide] = readPptContent(bytes).slides;
      const shapeText = slide?.shapes.flatMap((shape) =>
        shape.blocks.flatMap((block) =>
          block.kind === "paragraph" ? block.runs.map((run) => run.text) : [],
        ),
      );
      expect(shapeText).not.toContain("Never shown on the slide.");
    });
  });

  describe("metadata", () => {
    it('reads title/author/dates from a real "\\x05SummaryInformation" stream', () => {
      const bytes = pptFileWithMetadata({
        title: "Quarterly review",
        author: "Cornelius",
        createdIso: "2024-05-01T00:00:00.000Z",
      });
      expect(readPptContent(bytes).metadata).toEqual({
        title: "Quarterly review",
        author: "Cornelius",
        createdIso: "2024-05-01T00:00:00.000Z",
      });
    });
  });
});

describe("the shared schema accepts what the reader produces", () => {
  // toEqual on a plain object proves the reader built what this suite expected; parsing proves it built what document-schema.js actually requires -- a missing ContentShape inset, or a slide without its required notes, would satisfy the first check and fail this one.
  it("parses the flat form as a presentation ContentDocument", () => {
    const { metadata, slides } = readPptContent(pptFile());
    expect(() =>
      ContentDocumentSchema.parse({ kind: "presentation", metadata, slides }),
    ).not.toThrow();
  });

  it("parses the tree form as a DocumentTree", () => {
    expect(() => DocumentTreeSchema.parse(readPpt(pptFile()))).not.toThrow();
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
