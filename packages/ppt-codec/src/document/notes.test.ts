import { describe, expect, it } from "vitest";
import { PptFormatError } from "../errors";
import { readRecordAt } from "../record/tree";
import {
  OfficeArtClientAnchor,
  OfficeArtClientTextbox,
  OfficeArtDgContainer,
  OfficeArtFSP,
  OfficeArtFSPGR,
  OfficeArtSpContainer,
  OfficeArtSpgrContainer,
  RT_Drawing,
  RT_Notes,
  RT_NotesAtom,
  RT_SlideListWithText,
  RT_SlidePersistAtom,
  RT_TextCharsAtom,
  RT_TextHeaderAtom,
  SLIDE_LIST_INSTANCE_NOTES,
} from "../record/types";
import {
  asciiBytes,
  concatBytes,
  i32le,
  u16le,
  u32le,
  utf16le,
  writeAtom as atom,
  writeContainer as container,
} from "../record/write";
import { TEXT_TYPE_NOTES, TEXT_TYPE_OTHER } from "../text/atoms";
import {
  NOTES_MASTER_SLIDE_ID_REF,
  readNotesContainerAtom,
  readNotesAtom,
  readNotesText,
} from "./notes";
import { readNotesListWithText } from "./notes-list";

// Every fixture here is assembled from [MS-PPT]'s own field-layout tables rather than captured from a producer, matching the discipline the package README states for every other read-path suite.
//
// [MS-PPT] 2.5.7 NotesAtom: recVer 0x1, recLen 0x8, then slideIdRef (4 bytes), slideFlags (2 bytes), unused (2 bytes). https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/9bb3e352-1014-477b-b286-cd43127c3b74
function notesAtom(
  slideIdRef: number,
  slideFlags = 0,
): Uint8Array<ArrayBuffer> {
  return atom(
    RT_NotesAtom,
    concatBytes(u32le(slideIdRef), u16le(slideFlags), u16le(0)),
    { recVer: 0x1 },
  );
}

// [MS-PPT] 2.4.14.7 NotesPersistAtom: recLen 0x14, then persistIdRef, the reserved1/fNonOutlineData/reserved2 flags word, reserved3, notesId, reserved4 -- the same 20 bytes a SlidePersistAtom spends, but with reserved3 where that record states cTexts.
function notesPersistAtom(
  persistIdRef: number,
  notesId: number,
  reserved3 = 0,
): Uint8Array<ArrayBuffer> {
  return atom(
    RT_SlidePersistAtom,
    concatBytes(
      u32le(persistIdRef),
      u32le(0),
      i32le(reserved3),
      u32le(notesId),
      u32le(0),
    ),
  );
}

function fsp(spid: number, flags: number): Uint8Array<ArrayBuffer> {
  return atom(OfficeArtFSP, concatBytes(u32le(spid), u32le(flags)), {
    recVer: 0x2,
  });
}

const patriarch = container(OfficeArtSpContainer, [
  atom(OfficeArtFSPGR, new Uint8Array(16), { recVer: 0x1 }),
  // fGroup | fPatriarch, the outermost group every drawing carries.
  fsp(1, (1 << 0) | (1 << 2)),
]);

interface NotesShapeOptions {
  readonly spid: number;
  readonly text?: string;
  readonly textType?: number;
  readonly anchored?: boolean;
}

function notesShape({
  spid,
  text,
  textType = TEXT_TYPE_OTHER,
  anchored = true,
}: NotesShapeOptions): Uint8Array<ArrayBuffer> {
  const children = [fsp(spid, 0)];
  if (anchored) {
    children.push(
      atom(
        OfficeArtClientAnchor,
        concatBytes(i32le(2160), i32le(288), i32le(5472), i32le(4104)),
      ),
    );
  }
  const textbox = [atom(RT_TextHeaderAtom, u32le(textType))];
  if (text !== undefined) {
    textbox.push(atom(RT_TextCharsAtom, utf16le(text)));
  }
  children.push(container(OfficeArtClientTextbox, textbox));
  return container(OfficeArtSpContainer, children);
}

function notesContainer(
  slideIdRef: number,
  shapes: readonly Uint8Array<ArrayBuffer>[],
): Uint8Array<ArrayBuffer> {
  return container(RT_Notes, [
    notesAtom(slideIdRef),
    container(RT_Drawing, [
      container(OfficeArtDgContainer, [
        container(OfficeArtSpgrContainer, [patriarch, ...shapes]),
      ]),
    ]),
  ]);
}

describe("readNotesAtom", () => {
  it("reads the slide the notes belong to, and the master-inheritance flags after it", () => {
    expect(readNotesAtom(readRecordAt(notesAtom(0x0104, 0x0003), 0))).toEqual({
      slideIdRef: 0x0104,
      slideFlags: 0x0003,
    });
  });

  it("reads a notes master's own reserved slideIdRef rather than treating it as a slide", () => {
    expect(
      readNotesAtom(readRecordAt(notesAtom(NOTES_MASTER_SLIDE_ID_REF), 0))
        .slideIdRef,
    ).toBe(NOTES_MASTER_SLIDE_ID_REF);
  });

  it("rejects a record whose type is not RT_NotesAtom", () => {
    expect(() =>
      readNotesAtom(readRecordAt(atom(RT_TextHeaderAtom, u32le(0)), 0)),
    ).toThrow(PptFormatError);
  });

  it("rejects a NotesAtom shorter than its mandated 0x8 bytes", () => {
    expect(() =>
      readNotesAtom(
        readRecordAt(atom(RT_NotesAtom, u32le(0x0104), { recVer: 0x1 }), 0),
      ),
    ).toThrow(PptFormatError);
  });
});

describe("readNotesContainerAtom", () => {
  it("finds the NotesAtom a NotesContainer carries", () => {
    const bytes = notesContainer(0x0101, [
      notesShape({ spid: 2, text: "Some notes" }),
    ]);
    expect(readNotesContainerAtom(readRecordAt(bytes, 0)).slideIdRef).toBe(
      0x0101,
    );
  });

  it("rejects a container whose type is not RT_Notes", () => {
    expect(() =>
      readNotesContainerAtom(readRecordAt(container(RT_Drawing, []), 0)),
    ).toThrow(PptFormatError);
  });

  it("rejects a NotesContainer with no NotesAtom, since nothing else states which slide it belongs to", () => {
    expect(() =>
      readNotesContainerAtom(readRecordAt(container(RT_Notes, []), 0)),
    ).toThrow(PptFormatError);
  });
});

describe("readNotesText", () => {
  it("reads the text a notes shape stores on its own client textbox", () => {
    const bytes = notesContainer(0x0100, [
      notesShape({ spid: 2, text: "Remember to mention the budget." }),
    ]);
    expect(readNotesText(readRecordAt(bytes, 0))).toBe(
      "Remember to mention the budget.",
    );
  });

  it("splits the stored carriage returns into newline-separated paragraphs", () => {
    const bytes = notesContainer(0x0100, [
      notesShape({ spid: 2, text: "First line\rSecond line\rThird line" }),
    ]);
    expect(readNotesText(readRecordAt(bytes, 0))).toBe(
      "First line\nSecond line\nThird line",
    );
  });

  it("reads a notes body a producer stored with Tx_TYPE_OTHER rather than Tx_TYPE_NOTES", () => {
    // LibreOffice's own `--convert-to ppt` output stores the notes body on a plain, un-placeholdered text box whose TextHeaderAtom states Tx_TYPE_OTHER, so keying on the notes text type would recover nothing from a real file.
    const other = notesContainer(0x0100, [
      notesShape({
        spid: 2,
        text: "Written by Impress",
        textType: TEXT_TYPE_OTHER,
      }),
    ]);
    const notes = notesContainer(0x0100, [
      notesShape({
        spid: 2,
        text: "Written by PowerPoint",
        textType: TEXT_TYPE_NOTES,
      }),
    ]);
    expect(readNotesText(readRecordAt(other, 0))).toBe("Written by Impress");
    expect(readNotesText(readRecordAt(notes, 0))).toBe("Written by PowerPoint");
  });

  it("skips a placeholder whose client textbox carries a header but no text atom", () => {
    // The spelling LibreOffice writes for a notes page with no notes: a PT_NotesBody placeholder whose textbox holds only a TextHeaderAtom.
    const bytes = notesContainer(0x0100, [
      notesShape({ spid: 2, textType: TEXT_TYPE_NOTES }),
    ]);
    expect(readNotesText(readRecordAt(bytes, 0))).toBe("");
  });

  it("reads an unanchored shape's text, which read.ts's own slide walk would drop", () => {
    const bytes = notesContainer(0x0100, [
      notesShape({
        spid: 2,
        text: "Positioned by the notes master",
        anchored: false,
      }),
    ]);
    expect(readNotesText(readRecordAt(bytes, 0))).toBe(
      "Positioned by the notes master",
    );
  });

  it("joins several shapes' text bodies in document order", () => {
    const bytes = notesContainer(0x0100, [
      notesShape({ spid: 2, text: "Top box" }),
      notesShape({ spid: 3, text: "Bottom box" }),
    ]);
    expect(readNotesText(readRecordAt(bytes, 0))).toBe("Top box\nBottom box");
  });

  it("reports no text for a NotesContainer carrying no drawing at all", () => {
    const bytes = container(RT_Notes, [notesAtom(0x0100)]);
    expect(readNotesText(readRecordAt(bytes, 0))).toBe("");
  });
});

describe("readNotesListWithText", () => {
  it("reads each notes slide's persist reference and notes id", () => {
    const bytes = container(
      RT_SlideListWithText,
      [notesPersistAtom(7, 0x0100), notesPersistAtom(8, 0x0101)],
      { recInstance: SLIDE_LIST_INSTANCE_NOTES },
    );
    expect(
      readNotesListWithText(readRecordAt(bytes, 0)).map((persist) => [
        persist.persistIdRef,
        persist.notesId,
      ]),
    ).toEqual([
      [7, 0x0100],
      [8, 0x0101],
    ]);
  });

  it("ignores the field a SlidePersistAtom would spend on cTexts, which is reserved here", () => {
    // A NotesPersistAtom's third field is reserved3, not cTexts: reading it as a text count would make this list look as though it carried placeholder texts, which [MS-PPT] 2.4.14.6 gives it no grammar for.
    const bytes = container(
      RT_SlideListWithText,
      [notesPersistAtom(7, 0x0100, 3)],
      { recInstance: SLIDE_LIST_INSTANCE_NOTES },
    );
    expect(readNotesListWithText(readRecordAt(bytes, 0))).toEqual([
      { persistIdRef: 7, notesId: 0x0100 },
    ]);
  });

  it("rejects a container whose type is not RT_SlideListWithText", () => {
    expect(() =>
      readNotesListWithText(readRecordAt(container(RT_Notes, []), 0)),
    ).toThrow(PptFormatError);
  });

  it("rejects a NotesPersistAtom shorter than its mandated 0x14 bytes", () => {
    const bytes = container(
      RT_SlideListWithText,
      [atom(RT_SlidePersistAtom, asciiBytes("short"))],
      { recInstance: SLIDE_LIST_INSTANCE_NOTES },
    );
    expect(() => readNotesListWithText(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
    );
  });
});
