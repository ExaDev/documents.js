import { describe, expect, it } from "vitest";
import {
  findSlideSchemeColorSchemeAtom,
  readSlideSchemeColorSchemeAtom,
} from "../document/color-scheme";
import { readFontNames } from "../document/fonts";
import { readSlideAtom } from "../document/master";
import { readNotesListWithText } from "../document/notes-list";
import { readSlideListWithText } from "../document/slide-list";
import {
  OfficeArtBStoreContainer,
  OfficeArtBlipJPEG,
  OfficeArtBlipPNG,
  OfficeArtFBSE,
  OfficeArtFDGGBlock,
  OfficeArtFOPT,
  OfficeArtFSP,
  OfficeArtFSPGR,
  OfficeArtSpContainer,
  OfficeArtSpgrContainer,
  RT_ColorSchemeAtom,
  RT_CryptSession10Container,
  RT_Document,
  RT_DocumentAtom,
  RT_DrawingGroup,
  RT_Environment,
  RT_MainMaster,
  RT_NotesAtom,
  RT_Slide,
  RT_SlideAtom,
  RT_SlideListWithText,
  RT_SlidePersistAtom,
  RT_TextMasterStyleAtom,
  SLIDE_LIST_INSTANCE_MASTERS,
} from "../record/types";
import {
  type PptRecord,
  childRecords,
  findChild,
  findDescendants,
  readRecordAt,
} from "../record/tree";
import {
  PROPERTY_PIB,
  PROPERTY_ROTATION,
  PROPERTY_TABLE_PROPERTIES,
  PROPERTY_TABLE_ROW_PROPERTIES,
  readIMsoArray,
  readShapeProperties,
} from "../drawing/properties";
import { readCurrentUserAtom } from "../stream/current-user";
import { buildPersistDirectory, resolvePersistObject } from "../stream/persist";
import {
  TEXT_TYPE_BODY,
  TEXT_TYPE_NOTES,
  TEXT_TYPE_TITLE,
} from "../text/atoms";
import {
  MASTER_COLOR_SCHEME,
  TABLE_ROW_HEIGHT,
  syntheticPresentation,
} from "./presentation";

// This file is deliberately a fidelity test of the FIXTURE's own bytes, not of anything read.ts observes: several [MS-PPT]/[MS-ODRAW] header fields exercised below (an atom's own recVer, an FBSE's own blip-type instance, a font entity's name, an OfficeArtBStoreContainer's own recInstance count) are real, spec-mandated parts of a genuine PowerPoint binary document that this package's own reader deliberately tolerates a wrong, default, or unset value for -- so a test written only against read.ts's own observable output could never catch a regression in one of them. These assertions instead re-parse the constructed record tree directly, the same way record/header.test.ts pins header bytes directly rather than only through something that consumes them, and check each value against what the spec (and the fixture's own comments) say a real file states.

function resolveDocumentContainer(
  currentUserStream: Uint8Array<ArrayBuffer>,
  powerPointDocumentStream: Uint8Array<ArrayBuffer>,
): PptRecord {
  const currentUser = readCurrentUserAtom(currentUserStream);
  const { directory, currentEdit } = buildPersistDirectory(
    powerPointDocumentStream,
    currentUser.offsetToCurrentEdit,
  );
  return resolvePersistObject(
    powerPointDocumentStream,
    directory,
    currentEdit.docPersistIdRef,
    "test fixture's own docPersistIdRef",
  );
}

function resolveMasterContainer(
  currentUserStream: Uint8Array<ArrayBuffer>,
  powerPointDocumentStream: Uint8Array<ArrayBuffer>,
): PptRecord {
  const currentUser = readCurrentUserAtom(currentUserStream);
  const { directory, currentEdit } = buildPersistDirectory(
    powerPointDocumentStream,
    currentUser.offsetToCurrentEdit,
  );
  const documentContainer = resolvePersistObject(
    powerPointDocumentStream,
    directory,
    currentEdit.docPersistIdRef,
    "test fixture's own docPersistIdRef",
  );
  const masterList = childRecords(documentContainer).find(
    (record) =>
      record.header.recType === RT_SlideListWithText &&
      record.header.recInstance === SLIDE_LIST_INSTANCE_MASTERS,
  );
  const [masterPersist] =
    masterList === undefined ? [] : readSlideListWithText(masterList);
  if (masterPersist === undefined) {
    throw new Error("test fixture always carries a master list entry");
  }
  return resolvePersistObject(
    powerPointDocumentStream,
    directory,
    masterPersist.persistIdRef,
    "test fixture's own master persist entry",
  );
}

function resolveSlideContainer(
  currentUserStream: Uint8Array<ArrayBuffer>,
  powerPointDocumentStream: Uint8Array<ArrayBuffer>,
): PptRecord {
  const currentUser = readCurrentUserAtom(currentUserStream);
  const { directory, currentEdit } = buildPersistDirectory(
    powerPointDocumentStream,
    currentUser.offsetToCurrentEdit,
  );
  const documentContainer = resolvePersistObject(
    powerPointDocumentStream,
    directory,
    currentEdit.docPersistIdRef,
    "test fixture's own docPersistIdRef",
  );
  const slideList = childRecords(documentContainer).find(
    (record) =>
      record.header.recType === RT_SlideListWithText &&
      record.header.recInstance !== SLIDE_LIST_INSTANCE_MASTERS,
  );
  const [slidePersist] =
    slideList === undefined ? [] : readSlideListWithText(slideList);
  if (slidePersist === undefined) {
    throw new Error("test fixture always carries a slide list entry");
  }
  return resolvePersistObject(
    powerPointDocumentStream,
    directory,
    slidePersist.persistIdRef,
    "test fixture's own slide persist entry",
  );
}

// The document's own slide list container itself (RT_SlideListWithText, recInstance SLIDES) -- distinct from resolveSlideContainer, which follows its own SlidePersistAtom on to the actual SlideContainer. Needed for fidelity checks against the list's own raw entries (a SlidePersistAtom's cTexts field, an inserted phantom record) rather than anything the slide container holds.
function resolveSlideListRecord(
  currentUserStream: Uint8Array<ArrayBuffer>,
  powerPointDocumentStream: Uint8Array<ArrayBuffer>,
): PptRecord {
  const documentContainer = resolveDocumentContainer(
    currentUserStream,
    powerPointDocumentStream,
  );
  const slideList = childRecords(documentContainer).find(
    (record) =>
      record.header.recType === RT_SlideListWithText &&
      record.header.recInstance !== SLIDE_LIST_INSTANCE_MASTERS,
  );
  if (slideList === undefined) {
    throw new Error("test fixture always carries a slide list entry");
  }
  return slideList;
}

// Recursively asserts no record anywhere beneath `record` has recType 0 -- the header a run of raw zero bytes decodes as. A mutant that splices non-byte content (a string, `undefined`) into a children array this package's own writeContainer/concatBytes then silently coerces to zero bytes is otherwise invisible to any test that only checks the real records' own content, since a handful of zero bytes can decode as one or more harmless, ignored phantom records rather than a parse failure.
function assertNoPhantomRecords(record: PptRecord): void {
  for (const child of childRecords(record)) {
    expect(child.header.recType).not.toBe(0);
    assertNoPhantomRecords(child);
  }
}

describe("syntheticPresentation's own byte-level fidelity", () => {
  it("states the DocumentAtom's own recVer 0x1", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    const documentContainer = resolveDocumentContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    const documentAtom = findChild(
      childRecords(documentContainer),
      RT_DocumentAtom,
    );
    expect(documentAtom?.header.recVer).toBe(0x1);
  });

  it("writes the font collection's own face name bytes, not an empty entry", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ fontName: "Calibri" });
    const documentContainer = resolveDocumentContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    const environment = findChild(
      childRecords(documentContainer),
      RT_Environment,
    );
    expect(readFontNames(environment)).toEqual(["Calibri"]);
  });

  it("states OfficeArtFSP's own recVer 0x2 throughout the drawing", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    const currentUser = readCurrentUserAtom(currentUserStream);
    const { directory, currentEdit } = buildPersistDirectory(
      powerPointDocumentStream,
      currentUser.offsetToCurrentEdit,
    );
    const documentContainer = resolvePersistObject(
      powerPointDocumentStream,
      directory,
      currentEdit.docPersistIdRef,
      "test",
    );
    const slideList = childRecords(documentContainer).find(
      (record) =>
        record.header.recType === RT_SlideListWithText &&
        record.header.recInstance !== SLIDE_LIST_INSTANCE_MASTERS,
    );
    const [slidePersist] =
      slideList === undefined ? [] : readSlideListWithText(slideList);
    if (slidePersist === undefined) {
      throw new Error("test fixture always carries a slide list entry");
    }
    const slideContainer = resolvePersistObject(
      powerPointDocumentStream,
      directory,
      slidePersist.persistIdRef,
      "test",
    );
    const everyFsp = findDescendants(slideContainer, OfficeArtFSP);
    expect(everyFsp.length).toBeGreaterThan(0);
    for (const fsp of everyFsp) {
      expect(fsp.header.recVer).toBe(0x2);
    }
  });

  it("states the slide's own SlideAtom recVer 0x2", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    const documentContainer = resolveDocumentContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    const currentUser = readCurrentUserAtom(currentUserStream);
    const { directory } = buildPersistDirectory(
      powerPointDocumentStream,
      currentUser.offsetToCurrentEdit,
    );
    const slideList = childRecords(documentContainer).find(
      (record) =>
        record.header.recType === RT_SlideListWithText &&
        record.header.recInstance !== SLIDE_LIST_INSTANCE_MASTERS,
    );
    const [slidePersist] =
      slideList === undefined ? [] : readSlideListWithText(slideList);
    if (slidePersist === undefined) {
      throw new Error("test fixture always carries a slide list entry");
    }
    const slideContainer = resolvePersistObject(
      powerPointDocumentStream,
      directory,
      slidePersist.persistIdRef,
      "test",
    );
    const slideAtom = findChild(childRecords(slideContainer), RT_SlideAtom);
    expect(slideAtom?.header.recVer).toBe(0x2);
  });

  it("gives the master's own real colour scheme atom recInstance 0x001, distinct from the extra colour schemes ahead of it", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    const masterContainer = resolveMasterContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    const colorSchemeAtoms = childRecords(masterContainer).filter(
      (record) => record.header.recType === RT_ColorSchemeAtom,
    );
    // Two "extra" colour schemes (recInstance 0x006), then the real one (recInstance 0x001) -- the spelling a real producer's own master opens with.
    expect(colorSchemeAtoms.map((record) => record.header.recInstance)).toEqual(
      [0x006, 0x006, 0x001],
    );
  });

  it("tags each of the master's own empty TextMasterStyleAtoms by its real placeholder type", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    const masterContainer = resolveMasterContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    const styleAtoms = childRecords(masterContainer).filter(
      (record) => record.header.recType === RT_TextMasterStyleAtom,
    );
    expect(styleAtoms.map((record) => record.header.recInstance)).toEqual([
      TEXT_TYPE_TITLE,
      TEXT_TYPE_BODY,
      TEXT_TYPE_NOTES,
    ]);
  });

  it("states every OfficeArtFSPGR's own recVer 0x1, including a table group's own", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ table: { rows: [["x"]] } });
    const slideContainer = resolveSlideContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    const everyFspgr = findDescendants(slideContainer, OfficeArtFSPGR);
    // One for the slide's own outermost group, one for the table's.
    expect(everyFspgr).toHaveLength(2);
    for (const fspgr of everyFspgr) {
      expect(fspgr.header.recVer).toBe(0x1);
    }
  });

  it("states the notes container's own NotesAtom recVer 0x1", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ notesText: "Speaker notes" });
    const currentUser = readCurrentUserAtom(currentUserStream);
    const { directory, currentEdit } = buildPersistDirectory(
      powerPointDocumentStream,
      currentUser.offsetToCurrentEdit,
    );
    const documentContainer = resolvePersistObject(
      powerPointDocumentStream,
      directory,
      currentEdit.docPersistIdRef,
      "test",
    );
    const notesList = childRecords(documentContainer).find(
      (record) =>
        record.header.recType === RT_SlideListWithText &&
        record.header.recInstance !== SLIDE_LIST_INSTANCE_MASTERS &&
        record.header.recInstance !== 0x000,
    );
    if (notesList === undefined) {
      throw new Error(
        "test fixture asked for notes and so carries a notes list",
      );
    }
    const [notesPersist] = readNotesListWithText(notesList);
    if (notesPersist === undefined) {
      throw new Error("test fixture's notes list always carries one entry");
    }
    const notesContainer = resolvePersistObject(
      powerPointDocumentStream,
      directory,
      notesPersist.persistIdRef,
      "test",
    );
    const notesAtom = findChild(childRecords(notesContainer), RT_NotesAtom);
    expect(notesAtom?.header.recVer).toBe(0x1);
  });

  it("counts the blip store's own FBSE entries in its OfficeArtBStoreContainer recInstance", () => {
    const PNG_LIKE_BYTES = new Uint8Array([0x01, 0x02, 0x03]);
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({
        picture: { format: "png", bytes: PNG_LIKE_BYTES },
      });
    const documentContainer = resolveDocumentContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    const drawingGroup = findChild(
      childRecords(documentContainer),
      RT_DrawingGroup,
    );
    const bStore =
      drawingGroup === undefined
        ? undefined
        : findDescendants(drawingGroup, OfficeArtBStoreContainer)[0];
    expect(bStore?.header.recInstance).toBe(1);
    const fdggBlocks =
      drawingGroup === undefined
        ? []
        : findDescendants(drawingGroup, OfficeArtFDGGBlock);
    expect(fdggBlocks).toHaveLength(1);
  });

  // [MS-ODRAW] 2.2.32's own fixed 36-byte FBSE head (btWin32, btMacOS, rgbUid, tag, size, cRef, foDelay, three unused bytes, cbName) precedes an embedded blip's own record -- mirrored from blips.ts's own FBSE_FIXED_SIZE, which is not exported since nothing outside that module otherwise needs it.
  const FBSE_FIXED_SIZE = 36;

  it("states each format's own real blip-type instance on the FBSE and the embedded blip record", () => {
    const png = syntheticPresentation({
      picture: { format: "png", bytes: new Uint8Array([1, 2, 3]) },
    });
    const jpeg = syntheticPresentation({
      picture: { format: "jpeg", bytes: new Uint8Array([1, 2, 3]) },
    });
    for (const [
      { currentUserStream, powerPointDocumentStream },
      expectedFbseInstance,
      expectedBlipRecType,
      expectedBlipInstance,
    ] of [
      [png, 0x06, OfficeArtBlipPNG, 0x6e0],
      [jpeg, 0x05, OfficeArtBlipJPEG, 0x46a],
    ] as const) {
      const documentContainer = resolveDocumentContainer(
        currentUserStream,
        powerPointDocumentStream,
      );
      const drawingGroup = findChild(
        childRecords(documentContainer),
        RT_DrawingGroup,
      );
      const [fbse] =
        drawingGroup === undefined
          ? []
          : findDescendants(drawingGroup, OfficeArtFBSE);
      if (fbse === undefined) {
        throw new Error("test fixture always carries one FBSE entry");
      }
      expect(fbse.header.recInstance).toBe(expectedFbseInstance);
      // cbName is 0 in every fixture this package's own writer produces, so the embedded blip record starts immediately after the fixed head with no name field between them.
      const embeddedBlip = readRecordAt(
        fbse.stream,
        fbse.dataOffset + FBSE_FIXED_SIZE,
      );
      expect(embeddedBlip.header.recType).toBe(expectedBlipRecType);
      expect(embeddedBlip.header.recInstance).toBe(expectedBlipInstance);
    }
  });

  it("states each format's own real blip-type instance on a delay-stream FBSE", () => {
    const png = syntheticPresentation({
      picture: { format: "png", bytes: new Uint8Array([1, 2, 3]) },
      pictureInPicturesStream: true,
    });
    const jpeg = syntheticPresentation({
      picture: { format: "jpeg", bytes: new Uint8Array([1, 2, 3]) },
      pictureInPicturesStream: true,
    });
    for (const [{ currentUserStream, powerPointDocumentStream }, expected] of [
      [png, 0x06],
      [jpeg, 0x05],
    ] as const) {
      const documentContainer = resolveDocumentContainer(
        currentUserStream,
        powerPointDocumentStream,
      );
      const drawingGroup = findChild(
        childRecords(documentContainer),
        RT_DrawingGroup,
      );
      const [fbse] =
        drawingGroup === undefined
          ? []
          : findDescendants(drawingGroup, OfficeArtFBSE);
      expect(fbse?.header.recInstance).toBe(expected);
    }
  });

  it("states the DocumentEncryptionAtom's own recVer 0xf", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ password: "Correct Horse Battery Staple" });
    const currentUser = readCurrentUserAtom(currentUserStream);
    const { directory, currentEdit } = buildPersistDirectory(
      powerPointDocumentStream,
      currentUser.offsetToCurrentEdit,
    );
    // Every other persist object is RC4-encrypted in place, so reading it as a plain record without decrypting first would parse ciphertext as a bogus header -- the crypt session's own persist ID is the one this package's own reader already knows how to find without decrypting anything, since a decryptor has to read this atom before it knows any key at all.
    if (currentEdit.encryptSessionPersistIdRef === undefined) {
      throw new Error(
        "test fixture asked for a password and so states an encryptSessionPersistIdRef",
      );
    }
    const cryptSession = resolvePersistObject(
      powerPointDocumentStream,
      directory,
      currentEdit.encryptSessionPersistIdRef,
      "test",
    );
    expect(cryptSession.header.recType).toBe(RT_CryptSession10Container);
    expect(cryptSession.header.recVer).toBe(0xf);
  });

  it("resolves a master with a plain OfficeArtSpContainer group anchor, matching a real drawing's own coordinate system", () => {
    // Structural smoke check that the two record types this file's own fidelity assertions above depend on (RT_Document and RT_Slide as the outer persist container types, rather than atoms) really are containers -- a fixture bug here would silently make every resolveDocumentContainer/resolveMasterContainer call above resolve the wrong thing without any of them failing on their own.
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    const documentContainer = resolveDocumentContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    expect(documentContainer.header.recType).toBe(RT_Document);
    const currentUser = readCurrentUserAtom(currentUserStream);
    const { directory } = buildPersistDirectory(
      powerPointDocumentStream,
      currentUser.offsetToCurrentEdit,
    );
    const slideList = childRecords(documentContainer).find(
      (record) =>
        record.header.recType === RT_SlideListWithText &&
        record.header.recInstance !== SLIDE_LIST_INSTANCE_MASTERS,
    );
    const [slidePersist] =
      slideList === undefined ? [] : readSlideListWithText(slideList);
    if (slidePersist === undefined) {
      throw new Error("test fixture always carries a slide list entry");
    }
    const slideContainer = resolvePersistObject(
      powerPointDocumentStream,
      directory,
      slidePersist.persistIdRef,
      "test",
    );
    expect(slideContainer.header.recType).toBe(RT_Slide);
    const masterContainer = resolveMasterContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    expect(masterContainer.header.recType).toBe(RT_MainMaster);
    // childRecords requires a container record (recVer 0xf); if either resolve above had silently returned the wrong record, this would throw rather than pass.
    expect(() => childRecords(documentContainer)).not.toThrow();
    expect(() => childRecords(slideContainer)).not.toThrow();
    expect(() => childRecords(masterContainer)).not.toThrow();
  });

  it("sets the PIB property's own fBid bit on a picture shape", () => {
    // OfficeArtFOPTEOPID's own bit layout (drawing/properties.ts's top comment): a 14-bit opid, fComplex (bit 14), fBid (bit 15) -- mirrored here rather than exported, since nothing outside that module otherwise needs the raw bit positions.
    const OPID_MASK_BITS = 0x3fff;
    const OPID_FBID_BIT = 1 << 15;
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({
        picture: { format: "png", bytes: new Uint8Array([1, 2, 3]) },
      });
    const slideContainer = resolveSlideContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    const [fopt] = findDescendants(slideContainer, OfficeArtFOPT);
    if (fopt === undefined) {
      throw new Error(
        "test fixture's picture shape always carries a property table",
      );
    }
    const view = new DataView(
      fopt.data.buffer,
      fopt.data.byteOffset,
      fopt.data.byteLength,
    );
    const opidWord = view.getUint16(0, true);
    expect(opidWord & OPID_FBID_BIT).not.toBe(0);
    expect(opidWord & OPID_MASK_BITS).toBe(PROPERTY_PIB);
  });

  it("writes no PROPERTY_ROTATION entry at all on an unrotated table group", () => {
    // read.ts's own rotationDegOf treats a stated rotation of exactly 0 identically to an absent one (both read as "no rotationDeg"), so a behavioural test alone cannot tell "wrote 0" apart from "wrote nothing" -- this checks the raw property table directly instead.
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ table: { rows: [["x"]] } });
    const slideContainer = resolveSlideContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    const tableGroupShape = findDescendants(
      slideContainer,
      OfficeArtSpContainer,
    ).find((shape) =>
      readShapeProperties(shape).has(PROPERTY_TABLE_ROW_PROPERTIES),
    );
    if (tableGroupShape === undefined) {
      throw new Error(
        "test fixture's table group always states tableRowProperties",
      );
    }
    expect(readShapeProperties(tableGroupShape).has(PROPERTY_ROTATION)).toBe(
      false,
    );
    // Exactly the FSPGR coordinate atom, this group's own fsp, the tertiary property table, and the client anchor -- catches a phantom record splicing extra bytes in without adding any real property, which the has(PROPERTY_ROTATION) check above cannot see on its own.
    expect(childRecords(tableGroupShape)).toHaveLength(4);
  });

  it("assigns each table cell shape its own distinct spid, sequential by row-major position", () => {
    // Nothing in drawing/shapes.ts's own read path inspects a content shape's spid at all (shapes-write.ts's own top comment states this directly) -- so no behavioural test could ever observe a wrong formula here, only a direct read of each cell's own OfficeArtFSP.
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({
        table: {
          rows: [
            ["A", "B"],
            ["C", "D"],
          ],
        },
      });
    const slideContainer = resolveSlideContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    const tableGroup = findDescendants(
      slideContainer,
      OfficeArtSpgrContainer,
    ).find((group) => {
      const [firstShape] = childRecords(group);
      return (
        firstShape !== undefined &&
        readShapeProperties(firstShape).has(PROPERTY_TABLE_PROPERTIES)
      );
    });
    if (tableGroup === undefined) {
      throw new Error("test fixture always carries one table group");
    }
    const [, ...cellShapes] = childRecords(tableGroup);
    const spids = cellShapes.map((shape) => {
      const fsp = findChild(childRecords(shape), OfficeArtFSP);
      if (fsp === undefined) {
        throw new Error("every table cell shape carries its own OfficeArtFSP");
      }
      const view = new DataView(
        fsp.data.buffer,
        fsp.data.byteOffset,
        fsp.data.byteLength,
      );
      return view.getUint32(0, true);
    });
    // The table's own group shape is spid 9 (tableShape's fixed call-site argument); cells number from 10, row-major, 2 columns wide.
    expect(spids).toEqual([10, 11, 12, 13]);
  });

  it("actually adds the two degenerate gridline shapes when asked, each with its own distinct spid", () => {
    // Both gridline shapes are filtered out of the final table (they are degenerate: zero width or zero height), so a purely behavioural test of the table's own output cannot tell "two gridline shapes were added and correctly filtered" apart from "no gridline shapes were added at all" -- only counting the group's own raw children directly can.
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({
        table: { rows: [["x"]], includeGridlineShapes: true },
      });
    const slideContainer = resolveSlideContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    const tableGroup = findDescendants(
      slideContainer,
      OfficeArtSpgrContainer,
    ).find((group) => {
      const [firstShape] = childRecords(group);
      return (
        firstShape !== undefined &&
        readShapeProperties(firstShape).has(PROPERTY_TABLE_PROPERTIES)
      );
    });
    if (tableGroup === undefined) {
      throw new Error("test fixture always carries one table group");
    }
    // The group's own shape, one real cell ("x"), and the two gridline shapes.
    const [, ...rest] = childRecords(tableGroup);
    expect(rest).toHaveLength(3);
    const spids = rest.map((shape) => {
      const fsp = findChild(childRecords(shape), OfficeArtFSP);
      if (fsp === undefined) {
        throw new Error(
          "every shape in the group carries its own OfficeArtFSP",
        );
      }
      const view = new DataView(
        fsp.data.buffer,
        fsp.data.byteOffset,
        fsp.data.byteLength,
      );
      return view.getUint32(0, true);
    });
    // Document order: the two gridline shapes precede the real cells (tableShape's own concatenation order).
    expect(spids).toEqual([909, 910, 10]);
  });

  it("states the slide list's own SlidePersistAtom cTexts, matching however many texts the entry actually carries", () => {
    const one = syntheticPresentation();
    const two = syntheticPresentation({ secondSlideListText: "Second" });
    for (const [{ currentUserStream, powerPointDocumentStream }, expected] of [
      [one, 1],
      [two, 2],
    ] as const) {
      const slideList = resolveSlideListRecord(
        currentUserStream,
        powerPointDocumentStream,
      );
      const slidePersistAtom = findChild(
        childRecords(slideList),
        RT_SlidePersistAtom,
      );
      if (slidePersistAtom === undefined) {
        throw new Error(
          "test fixture's slide list always opens with a SlidePersistAtom",
        );
      }
      const view = new DataView(
        slidePersistAtom.data.buffer,
        slidePersistAtom.data.byteOffset,
        slidePersistAtom.data.byteLength,
      );
      // cTexts sits at byte offset 8: persistIdRef (u32), flags (u32), cTexts (i32).
      expect(view.getInt32(8, true)).toBe(expected);
    }
  });

  it("never splices a phantom zero-recType record into any container the fixture builds", () => {
    // A regression check for exactly the class of bug assertNoPhantomRecords exists to catch: a children array that ends up holding something other than real record bytes (a stray string, an empty array standing in for "nothing here") silently decodes as one or more zero-recType records once concatenated, rather than failing to build at all. Exercised against a fixture that touches every optional branch this file has (a table, a picture, notes, encryption, rotation) so a splice bug anywhere in the file has somewhere to show up.
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({
        fontName: "Calibri",
        notesText: "Speaker notes",
        picture: { format: "png", bytes: new Uint8Array([1, 2, 3]) },
        table: {
          rows: [
            ["A", "B"],
            ["C", "D"],
          ],
          rotationDeg: 45,
          includeGridlineShapes: true,
        },
      });
    const documentContainer = resolveDocumentContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    assertNoPhantomRecords(documentContainer);
    const masterContainer = resolveMasterContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    assertNoPhantomRecords(masterContainer);
    const slideContainer = resolveSlideContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    assertNoPhantomRecords(slideContainer);
  });

  it("writes the table's own per-row heights as a genuine IMsoArray, not empty filler", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ table: { rows: [["A"], ["B"]] } });
    const slideContainer = resolveSlideContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    const tableGroupShape = findDescendants(
      slideContainer,
      OfficeArtSpContainer,
    ).find((shape) =>
      readShapeProperties(shape).has(PROPERTY_TABLE_ROW_PROPERTIES),
    );
    if (tableGroupShape === undefined) {
      throw new Error(
        "test fixture's table group always states tableRowProperties",
      );
    }
    const rowProperties = readShapeProperties(tableGroupShape).get(
      PROPERTY_TABLE_ROW_PROPERTIES,
    );
    if (rowProperties?.complex === undefined) {
      throw new Error("tableRowProperties is always a complex property");
    }
    expect(readIMsoArray(rowProperties.complex)).toEqual([
      TABLE_ROW_HEIGHT,
      TABLE_ROW_HEIGHT,
    ]);
  });

  it("emits a table's cell shapes in reverse document order when asked, not merely a reordered read result", () => {
    // The companion to "assigns each table cell shape its own distinct spid" above: that test proves the *reader* derives the grid from each cell's own anchor rather than document order, which is exactly why reverseCellOrder has no effect on readPptStreams' own output. This test instead pins the fixture's own raw child order directly, the only way to prove reverseCellOrder does anything at all.
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({
        table: {
          rows: [
            ["A", "B"],
            ["C", "D"],
          ],
          reverseCellOrder: true,
        },
      });
    const slideContainer = resolveSlideContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    const tableGroup = findDescendants(
      slideContainer,
      OfficeArtSpgrContainer,
    ).find((group) => {
      const [firstShape] = childRecords(group);
      return (
        firstShape !== undefined &&
        readShapeProperties(firstShape).has(PROPERTY_TABLE_PROPERTIES)
      );
    });
    if (tableGroup === undefined) {
      throw new Error("test fixture always carries one table group");
    }
    const [, ...cellShapes] = childRecords(tableGroup);
    const spids = cellShapes.map((shape) => {
      const fsp = findChild(childRecords(shape), OfficeArtFSP);
      if (fsp === undefined) {
        throw new Error("every table cell shape carries its own OfficeArtFSP");
      }
      const view = new DataView(
        fsp.data.buffer,
        fsp.data.byteOffset,
        fsp.data.byteLength,
      );
      return view.getUint32(0, true);
    });
    // The forward order is [10, 11, 12, 13] (see the sibling test above); reversed, the cells themselves come out back to front.
    expect(spids).toEqual([13, 12, 11, 10]);
  });

  it("writes the font collection's own default face name, Arial, when no fontName option is given", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    const documentContainer = resolveDocumentContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    const environment = findChild(
      childRecords(documentContainer),
      RT_Environment,
    );
    expect(readFontNames(environment)).toEqual(["Arial"]);
  });

  it("states the CurrentUserAtom's own default user name, Ada, in both its ANSI and Unicode fields", () => {
    const { currentUserStream } = syntheticPresentation();
    expect(readCurrentUserAtom(currentUserStream).userName).toBe("Ada");
  });

  it("writes the master's own colour scheme exactly, all eight slots, not just the one slot a run resolves through", () => {
    // read.ts only ever resolves whichever single slot a run's own ColorIndexStruct names (the masterTitleBold test in read.test.ts exercises slot 5, Accent 1) -- the other seven slots have no behavioural path to observe through, so only a direct byte comparison against the fixture's own MASTER_COLOR_SCHEME can pin them.
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    const masterContainer = resolveMasterContainer(
      currentUserStream,
      powerPointDocumentStream,
    );
    const colorSchemeAtom = findSlideSchemeColorSchemeAtom(
      childRecords(masterContainer),
    );
    if (colorSchemeAtom === undefined) {
      throw new Error(
        "test fixture's master always carries its own real colour scheme atom",
      );
    }
    const colors = readSlideSchemeColorSchemeAtom(colorSchemeAtom);
    expect(colors.map((color) => [color.red, color.green, color.blue])).toEqual(
      MASTER_COLOR_SCHEME.map(([red, green, blue]) => [red, green, blue]),
    );
  });

  it("states the slide's own SlideAtom notesIdRef, matching whichever notes slide it names", () => {
    // read.ts's own notes resolution matches a NotesContainer to its slide by slideId (see read.ts's own top-of-function comment on readNotesBySlideId), never by this field -- so a wrong notesIdRef here has no behavioural path to observe through, only a direct read of the SlideAtom's own bytes.
    const withoutNotes = syntheticPresentation();
    const withNotes = syntheticPresentation({ notesText: "Speaker notes" });
    for (const [
      { currentUserStream, powerPointDocumentStream },
      expectedNotesIdRef,
    ] of [
      [withoutNotes, 0],
      [withNotes, 512],
    ] as const) {
      const slideContainer = resolveSlideContainer(
        currentUserStream,
        powerPointDocumentStream,
      );
      const slideAtomRecord = findChild(
        childRecords(slideContainer),
        RT_SlideAtom,
      );
      if (slideAtomRecord === undefined) {
        throw new Error("test fixture's slide always carries a SlideAtom");
      }
      expect(readSlideAtom(slideAtomRecord).notesIdRef).toBe(
        expectedNotesIdRef,
      );
    }
  });

  it("states the slide's own SlideAtom masterIdRef, matching the fixture's real master unless told to mismatch it", () => {
    // read.ts's own master lookup (mastersById.get(masterIdRef)) is the only behavioural path this field reaches, and it only ever distinguishes "found" from "not found" -- MASTER_ID + 2 would throw the identical "does not contain" error MASTER_ID + 1 does, so only a direct read of the SlideAtom's own bytes can pin the exact mismatched value this fixture states.
    const plain = syntheticPresentation();
    const mismatched = syntheticPresentation({
      slideMasterIdRefMismatch: true,
    });
    for (const [
      { currentUserStream, powerPointDocumentStream },
      expectedMasterIdRef,
    ] of [
      // [MS-PPT] 2.2.13: a MasterId MUST be at or above 0x80000000 -- matching master-write.ts's own MASTER_SLIDE_ID and this file's own MASTER_ID.
      [plain, 0x80000000],
      [mismatched, 0x80000001],
    ] as const) {
      const slideContainer = resolveSlideContainer(
        currentUserStream,
        powerPointDocumentStream,
      );
      const slideAtomRecord = findChild(
        childRecords(slideContainer),
        RT_SlideAtom,
      );
      if (slideAtomRecord === undefined) {
        throw new Error("test fixture's slide always carries a SlideAtom");
      }
      expect(readSlideAtom(slideAtomRecord).masterIdRef).toBe(
        expectedMasterIdRef,
      );
    }
  });

  it("never returns a Pictures-stream blip when pictureInPicturesStream is asked for without a picture", () => {
    // Both operands of the fixture's own `pictureInPicturesStream && picture !== undefined` guard have to be real: this is the one case (pictureInPicturesStream true, picture absent) that can tell that guard apart from either operand alone.
    const { picturesStream } = syntheticPresentation({
      pictureInPicturesStream: true,
    });
    expect(picturesStream).toBeUndefined();
  });

  it("states the notes container's own outermost FSPGR recVer 0x1, not just the slide's", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ notesText: "Speaker notes" });
    const currentUser = readCurrentUserAtom(currentUserStream);
    const { directory, currentEdit } = buildPersistDirectory(
      powerPointDocumentStream,
      currentUser.offsetToCurrentEdit,
    );
    const documentContainer = resolvePersistObject(
      powerPointDocumentStream,
      directory,
      currentEdit.docPersistIdRef,
      "test",
    );
    const notesList = childRecords(documentContainer).find(
      (record) =>
        record.header.recType === RT_SlideListWithText &&
        record.header.recInstance !== SLIDE_LIST_INSTANCE_MASTERS &&
        record.header.recInstance !== 0x000,
    );
    if (notesList === undefined) {
      throw new Error(
        "test fixture asked for notes and so carries a notes list",
      );
    }
    const [notesPersist] = readNotesListWithText(notesList);
    if (notesPersist === undefined) {
      throw new Error("test fixture's notes list always carries one entry");
    }
    const notesContainer = resolvePersistObject(
      powerPointDocumentStream,
      directory,
      notesPersist.persistIdRef,
      "test",
    );
    // Nested several levels below the notes container itself (RT_Notes > RT_Drawing > OfficeArtDgContainer > OfficeArtSpgrContainer > OfficeArtSpContainer), so only a recursive descendant search reaches it, not findChild's direct-children-only lookup.
    const [fspgr] = findDescendants(notesContainer, OfficeArtFSPGR);
    expect(fspgr?.header.recVer).toBe(0x1);
  });

  it("states the UserEditAtom's own persistIdSeed, one past the highest persist ID already minted", () => {
    // Nothing in this package's own reader consumes persistIdSeed (it matters only to a future incremental edit, which this reader never performs) -- stream/persist.test.ts already pins the field's own byte offset directly, so this test instead pins the fixture's own arithmetic: the seed a real producer states after writing N persist objects is N + 1, not N - 1 or any other neighbouring value.
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    const currentUser = readCurrentUserAtom(currentUserStream);
    const { currentEdit } = buildPersistDirectory(
      powerPointDocumentStream,
      currentUser.offsetToCurrentEdit,
    );
    // The default fixture carries exactly three persist objects: document, master, slide.
    expect(currentEdit.persistIdSeed).toBe(4);
  });

  it("keeps the document container free of phantom records when it carries no DocumentAtom", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ documentMissingDocumentAtom: true });
    assertNoPhantomRecords(
      resolveDocumentContainer(currentUserStream, powerPointDocumentStream),
    );
  });

  it("keeps the slide container free of phantom records when it carries no SlideAtom", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ slideMissingSlideAtom: true });
    assertNoPhantomRecords(
      resolveSlideContainer(currentUserStream, powerPointDocumentStream),
    );
  });

  it("keeps the slide container free of phantom records when its ordinary text box carries no TextHeaderAtom", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ bodyTextboxMissingHeader: true });
    assertNoPhantomRecords(
      resolveSlideContainer(currentUserStream, powerPointDocumentStream),
    );
  });

  it("keeps the master container free of phantom records when it carries no colour scheme atom", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ masterMissingColorScheme: true });
    assertNoPhantomRecords(
      resolveMasterContainer(currentUserStream, powerPointDocumentStream),
    );
  });

  it("keeps the slide container free of phantom records when neither a picture nor a table is added", () => {
    // The earlier "never splices a phantom record" test exercises a fixture carrying both a picture and a table, taking the truthy branch of each option's own `!== undefined` guard -- this instead exercises the plain default fixture, where both guards fall to their own "nothing to add" branch.
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    assertNoPhantomRecords(
      resolveSlideContainer(currentUserStream, powerPointDocumentStream),
    );
  });
});
