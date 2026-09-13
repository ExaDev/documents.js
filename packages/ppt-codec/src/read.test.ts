import { writeSummaryInformationStream } from "archive-codec";
import { encodePng } from "byte-codec";
import {
  ContentDocumentSchema,
  DocumentTreeSchema,
  flattenTree,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "./base64";
import { PptEncryptedError } from "./errors";
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

  it("produces exactly the title and body shapes when no picture or table is added", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    const [slide] = readPptStreams(
      currentUserStream,
      powerPointDocumentStream,
    ).slides;
    expect(slide?.shapes).toHaveLength(2);
  });

  it("splits the default body text's own carriage return into two paragraphs", () => {
    // No bodyText option given at all, unlike every other test in this file that exercises paragraph-splitting behaviour -- this is the one test pinning the fixture's own default value, "First point\rSecond point", rather than a value a test supplied explicitly.
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    const [slide] = readPptStreams(
      currentUserStream,
      powerPointDocumentStream,
    ).slides;
    expect(slide?.shapes[1]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "First point" }] },
      { kind: "paragraph", runs: [{ text: "Second point" }] },
    ]);
  });

  it("states no rotationDeg at all for an unrotated plain shape, rather than an explicit undefined", () => {
    // toEqual treats an explicit rotationDeg: undefined as equal to the key being absent, so an object-shape comparison alone can't tell the two apart -- only checking the key's own presence can.
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    const [slide] = readPptStreams(
      currentUserStream,
      powerPointDocumentStream,
    ).slides;
    const shape = slide?.shapes[0];
    expect(shape === undefined ? false : "rotationDeg" in shape).toBe(false);
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

  describe("tables", () => {
    it("reads a native table group as one shape carrying a table block, with the grid derived from the cells' own rectangles", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({
          table: {
            rows: [
              ["A1", "B1"],
              ["A2", "B2"],
            ],
          },
        });
      const [slide] = readPptStreams(
        currentUserStream,
        powerPointDocumentStream,
      ).slides;
      // The fourth shape of the fixture after the title reference and the body: the table.
      const table = slide?.shapes[2];
      expect(table?.frame).toEqual({
        xPt: 180,
        yPt: 250,
        widthPt: 432,
        heightPt: 120,
      });
      expect(table?.blocks).toEqual([
        {
          kind: "table",
          rows: [
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "A1" }] }] },
                { blocks: [{ kind: "paragraph", runs: [{ text: "B1" }] }] },
              ],
              heightPt: 60,
            },
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "A2" }] }] },
                { blocks: [{ kind: "paragraph", runs: [{ text: "B2" }] }] },
              ],
              heightPt: 60,
            },
          ],
          columnWidthsPt: [216, 216],
        },
      ]);
    });

    it("derives the grid from each cell's own rectangle, not from the document order the cells arrive in, and ignores gridline shapes among them", () => {
      // The cells are emitted in reverse document order (row 2 before row 1, and within each row, its second column before its first) -- if the grid were read off document order rather than sorted by each cell's own top/left, this would come back transposed or reversed. Two degenerate gridline shapes (the real spelling a genuine PowerPoint-authored table carries) sit among them; a reader that treated them as cells would plant a phantom row or column.
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({
          table: {
            rows: [
              ["A1", "B1"],
              ["A2", "B2"],
            ],
            reverseCellOrder: true,
            includeGridlineShapes: true,
          },
        });
      const [slide] = readPptStreams(
        currentUserStream,
        powerPointDocumentStream,
      ).slides;
      const table = slide?.shapes[2]?.blocks[0];
      expect(table).toEqual({
        kind: "table",
        rows: [
          {
            cells: [
              { blocks: [{ kind: "paragraph", runs: [{ text: "A1" }] }] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "B1" }] }] },
            ],
            heightPt: 60,
          },
          {
            cells: [
              { blocks: [{ kind: "paragraph", runs: [{ text: "A2" }] }] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "B2" }] }] },
            ],
            heightPt: 60,
          },
        ],
        columnWidthsPt: [216, 216],
      });
    });

    it("reads a ragged table's missing grid positions as empty cells", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({
          table: { rows: [["only cell"]] },
        });
      const [slide] = readPptStreams(
        currentUserStream,
        powerPointDocumentStream,
      ).slides;
      const table = slide?.shapes[2]?.blocks[0];
      expect(table).toMatchObject({
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "only cell" }] }],
              },
            ],
          },
        ],
      });
    });

    it("states no rotationDeg at all for an unrotated table, rather than an explicit undefined", () => {
      // toEqual treats an explicit rotationDeg: undefined as equal to the key being absent, so an object-shape comparison alone can't tell the two apart -- only checking the key's own presence can.
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({
          table: { rows: [["x"]] },
        });
      const [slide] = readPptStreams(
        currentUserStream,
        powerPointDocumentStream,
      ).slides;
      const table = slide?.shapes[2];
      expect(table === undefined ? false : "rotationDeg" in table).toBe(false);
    });

    it("reads a rotated table group's rotation onto the table shape", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({
          table: { rows: [["x"]], rotationDeg: 90 },
        });
      const [slide] = readPptStreams(
        currentUserStream,
        powerPointDocumentStream,
      ).slides;
      expect(slide?.shapes[2]?.rotationDeg).toBe(90);
    });
  });

  it("refuses an encrypted document by name rather than failing as malformed", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ encrypted: true });
    expect(() =>
      readPptStreams(currentUserStream, powerPointDocumentStream),
    ).toThrow(/marks this document as RC4 CryptoAPI-encrypted/);
  });

  it("rejects a document whose CurrentUserAtom claims encryption but whose current UserEditAtom carries no encryptSessionPersistIdRef", () => {
    // `encrypted: true` alone flips only the headerToken, never adding the trailing UserEditAtom field a genuine RC4 CryptoAPI session needs -- supplying a password here reaches past the missing-password check into this one instead.
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ encrypted: true });
    expect(() =>
      readPptStreams(currentUserStream, powerPointDocumentStream, "anything"),
    ).toThrow(/carries no encryptSessionPersistIdRef/);
  });

  describe("malformed input", () => {
    it("rejects a client textbox with neither an OutlineTextRefAtom nor a TextHeaderAtom", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ bodyTextboxMissingHeader: true });
      expect(() =>
        readPptStreams(currentUserStream, powerPointDocumentStream),
      ).toThrow(/carry no TextHeaderAtom/);
    });

    it("rejects an OutlineTextRefAtom too short to carry its own index field", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ titleOutlineRefTooShort: true });
      expect(() =>
        readPptStreams(currentUserStream, powerPointDocumentStream),
      ).toThrow(/fewer than the 4 its index field needs/);
    });

    it("rejects an OutlineTextRefAtom index beyond the slide's own text list", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ titleOutlineRefOutOfRange: true });
      expect(() =>
        readPptStreams(currentUserStream, powerPointDocumentStream),
      ).toThrow(/which has only 1 texts in the slide list/);
    });

    it("resolves the outline text at a non-zero index, not just the first", () => {
      // The one scenario that can tell a little-endian index read apart from a big-endian one: at index 0 the two agree, so only a genuinely non-zero index proves the byte order this reader assumes.
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ secondSlideListText: "Forward-looking" });
      const [slide] = readPptStreams(
        currentUserStream,
        powerPointDocumentStream,
      ).slides;
      expect(slide?.shapes[0]?.blocks).toEqual([
        { kind: "paragraph", runs: [{ text: "Forward-looking" }] },
      ]);
    });

    it("rejects a document persist object that is not RT_Document", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ documentRecordTypeMismatch: true });
      expect(() =>
        readPptStreams(currentUserStream, powerPointDocumentStream),
      ).toThrow(/not RT_Document/);
    });

    it("rejects a document container with no DocumentAtom", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ documentMissingDocumentAtom: true });
      expect(() =>
        readPptStreams(currentUserStream, powerPointDocumentStream),
      ).toThrow(/has no DocumentAtom/);
    });

    it("rejects a master persist object that is not RT_MainMaster", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ masterRecordTypeMismatch: true });
      expect(() =>
        readPptStreams(currentUserStream, powerPointDocumentStream),
      ).toThrow(/not the RT_MainMaster/);
    });

    it("rejects a MainMasterContainer with no SlideSchemeColorSchemeAtom", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ masterMissingColorScheme: true });
      expect(() =>
        readPptStreams(currentUserStream, powerPointDocumentStream),
      ).toThrow(/has no SlideSchemeColorSchemeAtom/);
    });

    it("rejects a slide persist object that is not RT_Slide", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ slideRecordTypeMismatch: true });
      expect(() =>
        readPptStreams(currentUserStream, powerPointDocumentStream),
      ).toThrow(/not the RT_Slide/);
    });

    it("rejects a SlideContainer with no SlideAtom", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ slideMissingSlideAtom: true });
      expect(() =>
        readPptStreams(currentUserStream, powerPointDocumentStream),
      ).toThrow(/has no SlideAtom/);
    });

    it("rejects a slide whose SlideAtom names a masterIdRef the master list does not contain", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ slideMasterIdRefMismatch: true });
      // Pins the exact stated value, not just that some rejection fires: the fixture's own masterIdRef is the real master ID (0x80000000, [MS-PPT] 2.2.13's own MasterId minimum) plus one, 2147483649 -- a regex matching only the surrounding words would pass identically for any other wrong value, including the real master ID minus one.
      expect(() =>
        readPptStreams(currentUserStream, powerPointDocumentStream),
      ).toThrow(
        /names masterIdRef 2147483649, which the master list does not contain/,
      );
    });

    it("names the UserEditAtom's own docPersistIdRef when it references no persist object", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ omitPersistObject: "document" });
      expect(() =>
        readPptStreams(currentUserStream, powerPointDocumentStream),
      ).toThrow(/UserEditAtom\.docPersistIdRef references persist object/);
    });

    it("names the master's own persist ID when it references no persist object", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ omitPersistObject: "master" });
      expect(() =>
        readPptStreams(currentUserStream, powerPointDocumentStream),
      ).toThrow(/MasterPersistAtom for master \d+ references persist object/);
    });

    it("names the slide's own persist ID when it references no persist object", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({ omitPersistObject: "slide" });
      expect(() =>
        readPptStreams(currentUserStream, powerPointDocumentStream),
      ).toThrow(/SlidePersistAtom for slide \d+ references persist object/);
    });

    it("names the notes slide's own persist ID when it references no persist object", () => {
      const { currentUserStream, powerPointDocumentStream } =
        syntheticPresentation({
          omitPersistObject: "notes",
          notesText: "Mention the budget revision.",
        });
      expect(() =>
        readPptStreams(currentUserStream, powerPointDocumentStream),
      ).toThrow(
        /NotesPersistAtom for notes slide \d+ references persist object/,
      );
    });
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
    expect(() => readPptContent(bytes)).toThrow(
      `compound file has no "${POWERPOINT_DOCUMENT_STREAM}" stream, which [MS-PPT] requires of every PowerPoint binary document`,
    );
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
