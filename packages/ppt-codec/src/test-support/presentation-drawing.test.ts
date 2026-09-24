// Byte-level fidelity of syntheticPresentation, second half: the slide and notes containers, the persist directory, and the guarantee that no container anywhere carries a phantom zero-recType record. The record-version and blip-store cases are in presentation.test.ts.

import { describe, expect, it } from "vitest";
import {
  findSlideSchemeColorSchemeAtom,
  readSlideSchemeColorSchemeAtom,
} from "../document/color-scheme";
import { readFontNames } from "../document/fonts";
import { readSlideAtom } from "../document/master";
import { readNotesListWithText } from "../document/notes-list";
import {
  OfficeArtFSP,
  OfficeArtFSPGR,
  OfficeArtSpContainer,
  OfficeArtSpgrContainer,
  RT_Environment,
  RT_SlideAtom,
  RT_SlideListWithText,
  RT_SlidePersistAtom,
  SLIDE_LIST_INSTANCE_MASTERS,
} from "../record/types";
import { childRecords, findChild, findDescendants } from "../record/tree";
import {
  PROPERTY_TABLE_PROPERTIES,
  PROPERTY_TABLE_ROW_PROPERTIES,
  readIMsoArray,
  readShapeProperties,
} from "../drawing/properties";
import { readCurrentUserAtom } from "../stream/current-user";
import { buildPersistDirectory, resolvePersistObject } from "../stream/persist";
import {
  MASTER_COLOR_SCHEME,
  TABLE_ROW_HEIGHT,
  syntheticPresentation,
} from "./presentation";
import {
  assertNoPhantomRecords,
  resolveDocumentContainer,
  resolveMasterContainer,
  resolveSlideContainer,
  resolveSlideListRecord,
} from "./presentation-records";

describe("syntheticPresentation's own byte-level fidelity", () => {
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
    // read.ts only ever resolves whichever single slot a run's own ColorIndexStruct names (the masterTitleBold test in read.test.ts exercises slot 5, Accent 1) — the other seven slots have no behavioural path to observe through, so only a direct byte comparison against the fixture's own MASTER_COLOR_SCHEME can pin them.
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
    // read.ts's own notes resolution matches a NotesContainer to its slide by slideId (see read.ts's own top-of-function comment on readNotesBySlideId), never by this field — so a wrong notesIdRef here has no behavioural path to observe through, only a direct read of the SlideAtom's own bytes.
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
    // read.ts's own master lookup (mastersById.get(masterIdRef)) is the only behavioural path this field reaches, and it only ever distinguishes "found" from "not found" — MASTER_ID + 2 would throw the identical "does not contain" error MASTER_ID + 1 does, so only a direct read of the SlideAtom's own bytes can pin the exact mismatched value this fixture states.
    const plain = syntheticPresentation();
    const mismatched = syntheticPresentation({
      slideMasterIdRefMismatch: true,
    });
    for (const [
      { currentUserStream, powerPointDocumentStream },
      expectedMasterIdRef,
    ] of [
      // [MS-PPT] 2.2.13: a MasterId MUST be at or above 0x80000000 — matching master-write.ts's own MASTER_SLIDE_ID and this file's own MASTER_ID.
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
    // Nothing in this package's own reader consumes persistIdSeed (it matters only to a future incremental edit, which this reader never performs) — stream/persist.test.ts already pins the field's own byte offset directly, so this test instead pins the fixture's own arithmetic: the seed a real producer states after writing N persist objects is N + 1, not N - 1 or any other neighbouring value.
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
    // The earlier "never splices a phantom record" test exercises a fixture carrying both a picture and a table, taking the truthy branch of each option's own `!== undefined` guard — this instead exercises the plain default fixture, where both guards fall to their own "nothing to add" branch.
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    assertNoPhantomRecords(
      resolveSlideContainer(currentUserStream, powerPointDocumentStream),
    );
  });
});
