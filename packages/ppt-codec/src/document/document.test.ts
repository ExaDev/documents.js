import { describe, expect, it } from "vitest";
import { PptFormatError } from "../errors";
import { readRecordAt } from "../record/tree";
import {
  RT_DocumentAtom,
  RT_Environment,
  RT_FontCollection,
  RT_FontEntityAtom,
  RT_SlideListWithText,
  RT_SlidePersistAtom,
  RT_StyleTextPropAtom,
  RT_TextBytesAtom,
  RT_TextHeaderAtom,
  SLIDE_LIST_INSTANCE_SLIDES,
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
import { readDocumentAtom } from "./document-atom";
import { readFontNames } from "./fonts";
import { readSlideListWithText } from "./slide-list";

// [MS-PPT] 2.4.2 DocumentAtom: recVer 0x1, recLen 0x28, then slideSize and notesSize as PointStructs (x then y, signed 32-bit), serverZoom as a RatioStruct, two persist references, firstSlideNumber, slideSizeType, and four bool1 bytes. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/121f2728-3497-4a0a-829e-6f416fee2ee6
function documentAtom(options: {
  slideX?: number;
  slideY?: number;
  notesMasterPersistIdRef?: number;
}): Uint8Array<ArrayBuffer> {
  const { slideX = 5760, slideY = 4320, notesMasterPersistIdRef = 0 } = options;
  return atom(
    RT_DocumentAtom,
    concatBytes(
      i32le(slideX),
      i32le(slideY),
      i32le(5760),
      i32le(4320),
      i32le(1),
      i32le(2),
      u32le(notesMasterPersistIdRef),
      u32le(0),
      u16le(1),
      u16le(0),
      new Uint8Array(4),
    ),
    { recVer: 0x1 },
  );
}

// [MS-PPT] 2.4.14.5 SlidePersistAtom: recLen 0x14, then persistIdRef, a flags word, cTexts, slideId and a reserved word. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/48dce412-9692-4f93-aeb7-3d9fdd3a0a5a
function slidePersistAtom(
  persistIdRef: number,
  cTexts: number,
  slideId: number,
): Uint8Array<ArrayBuffer> {
  return atom(
    RT_SlidePersistAtom,
    concatBytes(
      u32le(persistIdRef),
      u32le(0),
      i32le(cTexts),
      u32le(slideId),
      u32le(0),
    ),
  );
}

function textBytesAtom(text: string): Uint8Array<ArrayBuffer> {
  return atom(RT_TextBytesAtom, asciiBytes(text));
}

describe("readDocumentAtom", () => {
  it("reads the slide size, whose PointStruct is x then y in master units", () => {
    const record = readRecordAt(
      documentAtom({ slideX: 5760, slideY: 4320 }),
      0,
    );
    expect(readDocumentAtom(record).slideSize).toEqual({ x: 5760, y: 4320 });
  });

  it("reads the notes master persist reference that follows serverZoom", () => {
    const record = readRecordAt(
      documentAtom({ notesMasterPersistIdRef: 9 }),
      0,
    );
    expect(readDocumentAtom(record).notesMasterPersistIdRef).toBe(9);
  });

  it("rejects a record whose type is not RT_DocumentAtom", () => {
    expect(() =>
      readDocumentAtom(readRecordAt(atom(RT_TextHeaderAtom, u32le(0)), 0)),
    ).toThrow(PptFormatError);
  });

  it("rejects a DocumentAtom shorter than its mandated 0x28 bytes", () => {
    expect(() =>
      readDocumentAtom(
        readRecordAt(
          atom(RT_DocumentAtom, new Uint8Array(16), { recVer: 0x1 }),
          0,
        ),
      ),
    ).toThrow(PptFormatError);
  });
});

describe("readSlideListWithText", () => {
  it("reads each slide's persist reference and slide id, in list order", () => {
    const bytes = container(
      RT_SlideListWithText,
      [slidePersistAtom(4, 0, 256), slidePersistAtom(5, 0, 257)],
      { recInstance: SLIDE_LIST_INSTANCE_SLIDES },
    );
    expect(
      readSlideListWithText(readRecordAt(bytes, 0)).map((s) => [
        s.persistIdRef,
        s.slideId,
      ]),
    ).toEqual([
      [4, 256],
      [5, 257],
    ]);
  });

  it("groups the records after each TextHeaderAtom into that header's own text", () => {
    const bytes = container(
      RT_SlideListWithText,
      [
        slidePersistAtom(4, 2, 256),
        atom(RT_TextHeaderAtom, u32le(0)),
        textBytesAtom("A title"),
        atom(RT_TextHeaderAtom, u32le(1)),
        textBytesAtom("Some body"),
        atom(RT_StyleTextPropAtom, new Uint8Array(0)),
      ],
      { recInstance: SLIDE_LIST_INSTANCE_SLIDES },
    );
    const [slide] = readSlideListWithText(readRecordAt(bytes, 0));
    expect(slide?.texts.map((t) => t.textType)).toEqual([0, 1]);
    expect(slide?.texts[1]?.records.map((r) => r.header.recType)).toEqual([
      RT_TextBytesAtom,
      RT_StyleTextPropAtom,
    ]);
  });

  it("assigns each text to the slide whose persist atom precedes it", () => {
    const bytes = container(
      RT_SlideListWithText,
      [
        slidePersistAtom(4, 1, 256),
        atom(RT_TextHeaderAtom, u32le(0)),
        textBytesAtom("First"),
        slidePersistAtom(5, 1, 257),
        atom(RT_TextHeaderAtom, u32le(0)),
        textBytesAtom("Second"),
      ],
      { recInstance: SLIDE_LIST_INSTANCE_SLIDES },
    );
    const slides = readSlideListWithText(readRecordAt(bytes, 0));
    expect(slides).toHaveLength(2);
    expect(slides[0]?.texts).toHaveLength(1);
    expect(slides[1]?.texts).toHaveLength(1);
  });

  it("rejects a text header appearing before any slide persist atom", () => {
    const bytes = container(
      RT_SlideListWithText,
      [atom(RT_TextHeaderAtom, u32le(0))],
      { recInstance: SLIDE_LIST_INSTANCE_SLIDES },
    );
    expect(() => readSlideListWithText(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
    );
  });
});

describe("readFontNames", () => {
  // [MS-PPT] 2.9.x FontEntityAtom: recLen 0x44, opening with a 64-byte UTF-16 lfFaceName whose unused tail is null-padded. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/b5946b70-2fbc-4f7b-a119-b31fcbeb1794
  function fontEntityAtom(faceName: string): Uint8Array<ArrayBuffer> {
    const name = new Uint8Array(64);
    name.set(utf16le(faceName).subarray(0, 62));
    return atom(RT_FontEntityAtom, concatBytes(name, new Uint8Array(4)));
  }

  it("reads each typeface name, truncated at its terminating null", () => {
    const bytes = container(RT_Environment, [
      container(RT_FontCollection, [
        fontEntityAtom("Arial"),
        fontEntityAtom("Times New Roman"),
      ]),
    ]);
    expect(readFontNames(readRecordAt(bytes, 0))).toEqual([
      "Arial",
      "Times New Roman",
    ]);
  });

  it("indexes fonts by their position in the collection, which is what a FontIndexRef names", () => {
    const bytes = container(RT_Environment, [
      container(RT_FontCollection, [
        fontEntityAtom("Arial"),
        fontEntityAtom("Wingdings"),
      ]),
    ]);
    expect(readFontNames(readRecordAt(bytes, 0))[1]).toBe("Wingdings");
  });

  it("returns nothing when the environment carries no font collection", () => {
    expect(
      readFontNames(readRecordAt(container(RT_Environment, []), 0)),
    ).toEqual([]);
  });
});
