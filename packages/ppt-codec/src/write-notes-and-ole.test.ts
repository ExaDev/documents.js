// Speaker notes and OLE embedded objects, the two writePptContent concerns that own their own top-level describes rather than sitting inside the round-trip one. Split from write.test.ts; shared fixtures live in test-support/write-fixtures.ts.

import {
  type ContentDocument,
  type ContentShape,
  assembleTree,
  flattenTree,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { readNotesContainerAtom } from "./document/notes";
import { readExternalOleEmbeds } from "./ole/embedded";
import { readNotesListWithText } from "./document/notes-list";
import { readSlideListWithText } from "./document/slide-list";
import { type PptDiagnostic, PptDiagnosticCodes } from "./diagnostics";
import { readPptContent, readPpt, readPptStreams } from "./read";
import { childRecords, readRecordAt } from "./record/tree";
import {
  RT_ColorSchemeAtom,
  RT_Notes,
  SLIDE_LIST_INSTANCE_NOTES,
  SLIDE_LIST_INSTANCE_SLIDES,
} from "./record/types";
import { readCurrentUserAtom } from "./stream/current-user";
import { buildPersistDirectory } from "./stream/persist";
import { writePpt, writePptContent, writePptStreams } from "./write";

// The primary verification method this package's own README already establishes for its record fixtures: write real records, then read them back through the package's own existing reader, and assert the recovered content equals what was written. A round trip through readPptContent proves the writer's bytes are genuinely conformant [MS-PPT] — not merely internally self-consistent — because the reader was built and tested entirely independently of the writer, against the specification alone.
import {
  listWithInstance,
  recordTypesIn,
  requireRecord,
  slide,
  topLevelRecords,
} from "./test-support/write-fixtures";

describe("speaker notes", () => {
  it("round-trips a slide's speaker notes", () => {
    const document = {
      metadata: {},
      slides: [slide({ notes: "Remember to mention the budget." })],
    };
    const { slides } = readPptContent(writePptContent(document));
    expect(slides[0]?.notes).toBe("Remember to mention the budget.");
  });

  it("round-trips notes carrying several paragraphs", () => {
    const notes = "Open with the summary.\nThen the three risks.\nClose early.";
    const { slides } = readPptContent(
      writePptContent({ metadata: {}, slides: [slide({ notes })] }),
    );
    expect(slides[0]?.notes).toBe(notes);
  });

  it("keeps each slide's own notes with that slide", () => {
    const document = {
      metadata: {},
      slides: [
        slide({ notes: "Notes for the first slide." }),
        slide({ notes: "Different notes, second slide." }),
        slide({ notes: "Third slide, third note." }),
      ],
    };
    const { slides } = readPptContent(writePptContent(document));
    expect(slides.map((s) => s.notes)).toEqual([
      "Notes for the first slide.",
      "Different notes, second slide.",
      "Third slide, third note.",
    ]);
  });

  it("gives a slide with no notes no NotesContainer at all, rather than an empty one", () => {
    const { powerPointDocumentStream } = writePptStreams({
      metadata: {},
      slides: [slide(), slide()],
    });
    // A fabricated empty NotesContainer would be a real notes slide that happens to say nothing — a different fact from the absent notes slide the input actually describes, and one no round trip could tell apart from it.
    expect(recordTypesIn(powerPointDocumentStream)).not.toContain(RT_Notes);
  });

  it("writes no notes SlideListWithText at all when no slide carries notes", () => {
    const { powerPointDocumentStream } = writePptStreams({
      metadata: {},
      slides: [slide(), slide()],
    });
    const document = readRecordAt(powerPointDocumentStream, 0);
    expect(
      listWithInstance(document, SLIDE_LIST_INSTANCE_NOTES),
    ).toBeUndefined();
  });

  it("writes a NotesContainer only for the slides that carry notes", () => {
    const { powerPointDocumentStream } = writePptStreams({
      metadata: {},
      slides: [
        slide({ notes: "Only this slide has notes." }),
        slide(),
        slide({ notes: "And this one." }),
      ],
    });
    const types = recordTypesIn(powerPointDocumentStream);
    expect(types.filter((type) => type === RT_Notes)).toHaveLength(2);
  });

  it("reads back nothing for the slides between two that carry notes", () => {
    const document = {
      metadata: {},
      slides: [slide({ notes: "First." }), slide(), slide({ notes: "Third." })],
    };
    const { slides } = readPptContent(writePptContent(document));
    expect(slides.map((s) => s.notes)).toEqual(["First.", "", "Third."]);
  });

  it("names the last slide's own id in the UserEditAtom, not the second slide's", () => {
    const { currentUserStream, powerPointDocumentStream } = writePptStreams({
      metadata: {},
      slides: [slide(), slide(), slide()],
    });
    const { offsetToCurrentEdit } = readCurrentUserAtom(currentUserStream);
    const { currentEdit } = buildPersistDirectory(
      powerPointDocumentStream,
      offsetToCurrentEdit,
    );
    // FIRST_SLIDE_ID (256) + 3 slides, 0-indexed: the third slide's own id is 258.
    expect(currentEdit.lastSlideIdRef).toBe(258);
  });

  it("keeps every persist identifier below the seed a next edit would mint from", () => {
    // [MS-PPT] 2.3.3: persistIdSeed is the identifier a subsequent user edit would allocate, so every entry already in the directory has to sit below it. Notes slides take persist identifiers of their own after the slides', which is what makes a seed derived from the slide count alone wrong.
    const { currentUserStream, powerPointDocumentStream } = writePptStreams({
      metadata: {},
      slides: [
        slide({ notes: "First." }),
        slide({ notes: "Second." }),
        slide({ notes: "Third." }),
      ],
    });
    const { offsetToCurrentEdit } = readCurrentUserAtom(currentUserStream);
    const { directory, currentEdit } = buildPersistDirectory(
      powerPointDocumentStream,
      offsetToCurrentEdit,
    );
    expect(currentEdit.persistIdSeed).toBeGreaterThan(
      Math.max(...directory.keys()),
    );
  });

  it("gives a notes slide an identifier no slide's own identifier can collide with", () => {
    // NotesId and SlideId are separate identifier spaces ([MS-PPT] 2.2.14 and 2.2.26). A reader pairing the two lists would mis-associate every notes slide if one writer's notes ids happened to reuse its slide ids.
    const { powerPointDocumentStream } = writePptStreams({
      metadata: {},
      slides: Array.from({ length: 4 }, (_unused, index) =>
        slide({ notes: `Notes ${index}` }),
      ),
    });
    const document = readRecordAt(powerPointDocumentStream, 0);
    const slideIds = readSlideListWithText(
      requireRecord(
        listWithInstance(document, SLIDE_LIST_INSTANCE_SLIDES),
        "slide list",
      ),
    ).map((persist) => persist.slideId);
    const notesIds = readNotesListWithText(
      requireRecord(
        listWithInstance(document, SLIDE_LIST_INSTANCE_NOTES),
        "notes list",
      ),
    ).map((persist) => persist.notesId);
    expect(notesIds).toHaveLength(slideIds.length);
    expect(notesIds.filter((id) => slideIds.includes(id))).toEqual([]);
  });

  it("compacts notesId assignment by counting only the earlier slides that actually carry notes", () => {
    // slide 2 (index 2, no notes) must not count towards the base a later notes-carrying slide's own id is offset from — and the two notes-carrying slides before it (0 and 1) must both count, not merely whichever of "has notes" or "has no notes" a flipped comparison would count instead.
    const { powerPointDocumentStream } = writePptStreams({
      metadata: {},
      slides: [
        slide({ notes: "First." }),
        slide({ notes: "Second." }),
        slide(),
        slide({ notes: "Fourth." }),
      ],
    });
    const document = readRecordAt(powerPointDocumentStream, 0);
    const notesIds = readNotesListWithText(
      requireRecord(
        listWithInstance(document, SLIDE_LIST_INSTANCE_NOTES),
        "notes list",
      ),
    ).map((persist) => persist.notesId);
    expect(notesIds).toEqual([512, 513, 514]);
  });

  it("names each notes slide's own presentation slide in its NotesAtom", () => {
    const { powerPointDocumentStream } = writePptStreams({
      metadata: {},
      slides: [slide(), slide({ notes: "Second slide's notes." })],
    });
    const document = readRecordAt(powerPointDocumentStream, 0);
    const secondSlideId = readSlideListWithText(
      requireRecord(
        listWithInstance(document, SLIDE_LIST_INSTANCE_SLIDES),
        "slide list",
      ),
    )[1]?.slideId;
    const notesContainer = requireRecord(
      topLevelRecords(powerPointDocumentStream).find(
        (record) => record.header.recType === RT_Notes,
      ),
      "NotesContainer",
    );
    expect(readNotesContainerAtom(notesContainer).slideIdRef).toBe(
      secondSlideId,
    );
  });

  it("mints every slide id well clear of the 0x80000000 MasterId range readNotesBySlideId relies on staying unreachable", () => {
    // read.ts's own readNotesBySlideId keys a notes container by slideIdRef, and [MS-PPT] 2.2.13 reserves 0x80000000 and above for MasterId — a real producer's own notes-master entry can state a slideIdRef up in that range (LibreOffice writes 0x80000001) rather than the spec-mandated 0x00000000. That lookup only stays unambiguous because this writer's own slide ids (FIRST_SLIDE_ID + index, see write.ts's own note beside that constant) never reach anywhere near it. Pinned here rather than only in a comment, so a future change to the minting base or increment fails a test instead of silently drifting toward the reserved range.
    const { powerPointDocumentStream } = writePptStreams({
      metadata: {},
      slides: Array.from({ length: 5 }, () => slide()),
    });
    const document = readRecordAt(powerPointDocumentStream, 0);
    const slideIds = readSlideListWithText(
      requireRecord(
        listWithInstance(document, SLIDE_LIST_INSTANCE_SLIDES),
        "slide list",
      ),
    ).map((persist) => persist.slideId);
    for (const slideId of slideIds) {
      expect(slideId).toBeLessThan(0x80000000);
    }
  });

  it("gives each notes slide the colour scheme its own NotesAtom says it does not inherit", () => {
    // [MS-PPT] 2.5.6 lists a NotesContainer's slideSchemeColorSchemeAtom without the "optional" its slideNameAtom and slideProgTagsContainer carry, and makes the notes master's scheme apply only "if notesAtom.slideFlags.fMasterScheme is set". This writer leaves that bit clear, since it writes no notes master to inherit from, so the notes slide has to state a scheme of its own or name one that does not exist.
    const { powerPointDocumentStream } = writePptStreams({
      metadata: {},
      slides: [slide({ notes: "Notes needing a colour scheme." })],
    });
    const notesContainer = requireRecord(
      topLevelRecords(powerPointDocumentStream).find(
        (record) => record.header.recType === RT_Notes,
      ),
      "NotesContainer",
    );
    expect(readNotesContainerAtom(notesContainer).slideFlags & 0b010).toBe(0);
    const scheme = requireRecord(
      childRecords(notesContainer).find(
        (record) => record.header.recType === RT_ColorSchemeAtom,
      ),
      "SlideSchemeColorSchemeAtom",
    );
    // [MS-PPT] 2.9.51: rh.recInstance MUST be 0x001, and rh.recLen MUST be 0x00000020 — eight four-byte ColorStructs.
    expect(scheme.header.recInstance).toBe(0x001);
    expect(scheme.data.length).toBe(0x20);
  });

  it("round-trips notes through the tree form as well as the flat one", () => {
    const content: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [slide({ notes: "Notes that must survive decomposition." })],
    };
    const tree = assembleTree(content);
    expect(flattenTree(readPpt(writePpt(tree)))).toEqual(flattenTree(tree));
  });
});

describe("OLE embedded objects", () => {
  function shapeWithEmbed(document: ContentDocument): ContentShape {
    return {
      frame: { xPt: 72, yPt: 72, widthPt: 200, heightPt: 150 },
      insetLeftPt: 0,
      insetTopPt: 0,
      insetRightPt: 0,
      insetBottomPt: 0,
      blocks: [
        {
          kind: "embeddedObject",
          objectKind: "spreadsheet",
          document,
          frame: { xPt: 72, yPt: 72, widthPt: 200, heightPt: 150 },
        },
      ],
    };
  }

  const embeddedSpreadsheet: ContentDocument = {
    kind: "spreadsheet",
    metadata: {},
    sheets: [
      {
        name: "Sheet1",
        cells: [],
        columns: [],
        rows: [],
        images: [],
        printSettings: {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          gridlines: false,
          headers: false,
          pageOrder: "downThenOver",
        },
      },
    ],
  };

  it("round-trips a shape's embedded object through injected serialise/decode ports", () => {
    const storageBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const content: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [slide({ shapes: [shapeWithEmbed(embeddedSpreadsheet)] })],
    };
    const bytes = writePptContent(
      { metadata: content.metadata, slides: content.slides },
      {
        serialiseEmbeddedObject: (document) =>
          document === embeddedSpreadsheet ? storageBytes : undefined,
      },
    );
    const read = readPptContent(bytes, undefined, {
      decodeEmbeddedObject: (recovered, progId) =>
        Array.from(recovered).every(
          (byte, index) => byte === storageBytes[index],
        ) && recovered.length === storageBytes.length
          ? { objectKind: "spreadsheet", document: embeddedSpreadsheet }
          : (() => {
              throw new Error(`unexpected storage bytes/progId: ${progId}`);
            })(),
    });
    expect(read.slides[0]?.shapes[0]?.blocks).toEqual([
      {
        kind: "embeddedObject",
        objectKind: "spreadsheet",
        document: embeddedSpreadsheet,
        frame: { xPt: 72, yPt: 72, widthPt: 200, heightPt: 150 },
      },
    ]);
    // Excel.Sheet.8 is ExOleObjSubTypeEnum's own ProgID for the spreadsheet kind ([MS-PPT] 2.10.14) — confirming the writer actually stated it, not merely that the decode port ignored whatever arrived.
    let seenProgId: string | undefined;
    readPptContent(bytes, undefined, {
      decodeEmbeddedObject: (_bytes, progId) => {
        seenProgId = progId;
        return { objectKind: "spreadsheet", document: embeddedSpreadsheet };
      },
    });
    expect(seenProgId).toBe("Excel.Sheet.8");
  });

  it("drops the embedded object silently when no serialise port is supplied, matching the writer's existing silent-drop policy for other unwritable blocks", () => {
    const content: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [slide({ shapes: [shapeWithEmbed(embeddedSpreadsheet)] })],
    };
    const bytes = writePptContent({
      metadata: content.metadata,
      slides: content.slides,
    });
    const read = readPptContent(bytes);
    expect(read.slides[0]?.shapes[0]?.blocks).toEqual([]);
  });

  it("drops the embedded object silently when a serialise port declines this document, and writes no ExObjListContainer at all when nothing serialised", () => {
    const content: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [slide({ shapes: [shapeWithEmbed(embeddedSpreadsheet)] })],
    };
    const bytes = writePptContent(
      { metadata: content.metadata, slides: content.slides },
      { serialiseEmbeddedObject: () => undefined },
    );
    const read = readPptContent(bytes);
    expect(read.slides[0]?.shapes[0]?.blocks).toEqual([]);
  });

  it("reads no embedded block when no decode port is supplied, even though the file genuinely carries one", () => {
    const content: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [slide({ shapes: [shapeWithEmbed(embeddedSpreadsheet)] })],
    };
    const bytes = writePptContent(
      { metadata: content.metadata, slides: content.slides },
      { serialiseEmbeddedObject: () => new Uint8Array([9, 9, 9]) },
    );
    const read = readPptContent(bytes);
    expect(read.slides[0]?.shapes[0]?.blocks).toEqual([]);
  });

  it("fires no block-dropped diagnostic for an embeddedObject block a serialise port actually recovered bytes for", () => {
    const content: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [slide({ shapes: [shapeWithEmbed(embeddedSpreadsheet)] })],
    };
    const diagnostics: PptDiagnostic[] = [];
    writePptContent(
      { metadata: content.metadata, slides: content.slides },
      {
        serialiseEmbeddedObject: () => new Uint8Array([1, 2, 3]),
        sink: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      },
    );
    expect(diagnostics).toEqual([]);
  });

  it("mints a distinct exObjId and persistId for a second embedded object, rather than colliding with the first", () => {
    const secondDocument: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [],
    };
    const content: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [
        slide({
          shapes: [
            shapeWithEmbed(embeddedSpreadsheet),
            shapeWithEmbed(secondDocument),
          ],
        }),
      ],
    };
    const { currentUserStream, powerPointDocumentStream } = writePptStreams(
      { metadata: content.metadata, slides: content.slides },
      {
        serialiseEmbeddedObject: (document) =>
          document === embeddedSpreadsheet
            ? new Uint8Array([1])
            : new Uint8Array([2]),
      },
    );
    const read = readPptStreams(
      currentUserStream,
      powerPointDocumentStream,
      undefined,
      undefined,
      {
        decodeEmbeddedObject: (recovered) =>
          recovered[0] === 1
            ? { objectKind: "spreadsheet", document: embeddedSpreadsheet }
            : { objectKind: "wordprocessing", document: secondDocument },
      },
    );
    const [first, second] = read.slides[0]?.shapes ?? [];
    expect(first?.blocks[0]).toMatchObject({ document: embeddedSpreadsheet });
    expect(second?.blocks[0]).toMatchObject({ document: secondDocument });
    // exObjId is otherwise write-only from this round trip's own point of view — both the write and the matching read side use whatever value was minted internally, so a wrong-but-still-unique id (e.g. -1/0 instead of 1/2) would round-trip identically above. Reading the two ExOleObjAtom entries back directly is the only way to prove the actual minted values are 1 and 2.
    const documentRecord = topLevelRecords(powerPointDocumentStream)[0];
    if (documentRecord === undefined) {
      throw new Error("expected the DocumentContainer first");
    }
    const embeds = readExternalOleEmbeds(childRecords(documentRecord));
    expect([...embeds.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("offsets an OLE embed's own persist id past every notes persist object, not merely past every slide", () => {
    // Two of three slides carry notes, and the embed sits on the third: FIRST_SLIDE_PERSIST_ID + slides.length + notesCount is the only sum landing exactly past every already-used slide (3-5) and notes (6-7) persist id at 8. A wrong sign, a bare notesIdRefs.length (3, one too many), or an inverted notes-having/notes-less count (1, one too few) would each land somewhere a plain collision check might miss — reading the embed's own persistIdRef back directly is what actually pins the value.
    const content: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [
        slide({ notes: "First slide has notes." }),
        slide({ notes: "Second slide has notes." }),
        slide({ shapes: [shapeWithEmbed(embeddedSpreadsheet)] }),
      ],
    };
    const { powerPointDocumentStream } = writePptStreams(
      { metadata: content.metadata, slides: content.slides },
      { serialiseEmbeddedObject: () => new Uint8Array([1]) },
    );
    const documentRecord = topLevelRecords(powerPointDocumentStream)[0];
    if (documentRecord === undefined) {
      throw new Error("expected the DocumentContainer first");
    }
    const embeds = readExternalOleEmbeds(childRecords(documentRecord));
    const [embed] = embeds.values();
    expect(embed?.persistIdRef).toBe(8);
  });

  it("fires a block-dropped diagnostic for an embeddedObject block a serialise port declines", () => {
    const content: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [slide({ shapes: [shapeWithEmbed(embeddedSpreadsheet)] })],
    };
    const diagnostics: PptDiagnostic[] = [];
    writePptContent(
      { metadata: content.metadata, slides: content.slides },
      {
        serialiseEmbeddedObject: () => undefined,
        sink: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      },
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: PptDiagnosticCodes.BLOCK_DROPPED }),
    ]);
  });
});
