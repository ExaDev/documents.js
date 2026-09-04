import {
  OfficeArtClientAnchor,
  OfficeArtClientTextbox,
  OfficeArtDgContainer,
  OfficeArtFSP,
  OfficeArtFSPGR,
  OfficeArtSpContainer,
  OfficeArtSpgrContainer,
  RT_CurrentUserAtom,
  RT_Document,
  RT_DocumentAtom,
  RT_Drawing,
  RT_Environment,
  RT_FontCollection,
  RT_FontEntityAtom,
  RT_Notes,
  RT_NotesAtom,
  RT_OutlineTextRefAtom,
  RT_PersistDirectoryAtom,
  RT_Slide,
  RT_SlideListWithText,
  RT_SlidePersistAtom,
  RT_TextBytesAtom,
  RT_TextHeaderAtom,
  RT_UserEditAtom,
  SLIDE_LIST_INSTANCE_NOTES,
  SLIDE_LIST_INSTANCE_SLIDES,
} from "../record/types";
import {
  asciiBytes,
  concatBytes,
  i16le,
  i32le,
  u8,
  u16le,
  u32le,
  utf16le,
  writeAtom as atom,
  writeContainer as container,
} from "../record/write";
import { CURRENT_USER_HEADER_TOKEN_PLAIN } from "../stream/current-user";
import {
  TEXT_TYPE_BODY,
  TEXT_TYPE_OTHER,
  TEXT_TYPE_TITLE,
} from "../text/atoms";

// A whole synthetic presentation: the two [MS-PPT] streams of a one-slide document carrying a title placeholder (whose text lives in the document's slide list, reached by an OutlineTextRefAtom), a plain text box (whose text lives on the shape), and -- when asked for -- a notes slide of its own in a separate persist object reached through the document's notes list. Assembled from the same record builders the per-record suites use, so the end-to-end test exercises the real offset arithmetic -- the persist directory, the edit chain, and every cross-stream reference -- rather than a stubbed one.

// [MS-PPT] 2.4.2 DocumentAtom's 40-byte body: slideSize and notesSize as PointStructs, serverZoom as a RatioStruct, two persist references, firstSlideNumber, slideSizeType, four bool1 bytes.
function documentAtom(
  slideWidth: number,
  slideHeight: number,
): Uint8Array<ArrayBuffer> {
  return atom(
    RT_DocumentAtom,
    concatBytes(
      i32le(slideWidth),
      i32le(slideHeight),
      i32le(slideWidth),
      i32le(slideHeight),
      i32le(1),
      i32le(2),
      u32le(0),
      u32le(0),
      u16le(1),
      u16le(0),
      new Uint8Array(4),
    ),
    { recVer: 0x1 },
  );
}

function fontEntityAtom(faceName: string): Uint8Array<ArrayBuffer> {
  const name = new Uint8Array(64);
  name.set(utf16le(faceName).subarray(0, 62));
  return atom(RT_FontEntityAtom, concatBytes(name, new Uint8Array(4)));
}

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

function fsp(spid: number, flags: number): Uint8Array<ArrayBuffer> {
  return atom(OfficeArtFSP, concatBytes(u32le(spid), u32le(flags)), {
    recVer: 0x2,
  });
}

function clientAnchor(
  top: number,
  left: number,
  right: number,
  bottom: number,
): Uint8Array<ArrayBuffer> {
  return atom(
    OfficeArtClientAnchor,
    concatBytes(i16le(top), i16le(left), i16le(right), i16le(bottom)),
  );
}

export interface SyntheticPresentation {
  readonly currentUserStream: Uint8Array<ArrayBuffer>;
  readonly powerPointDocumentStream: Uint8Array<ArrayBuffer>;
}

export interface SyntheticPresentationOptions {
  readonly slideWidth?: number;
  readonly slideHeight?: number;
  readonly titleText?: string;
  readonly bodyText?: string;
  readonly fontName?: string;
  readonly encrypted?: boolean;
  // Speaker notes for the one slide. Absent means the document carries no notes list and no NotesContainer at all, which is how a real presentation with no notes is stored.
  readonly notesText?: string;
}

export function syntheticPresentation(
  options: SyntheticPresentationOptions = {},
): SyntheticPresentation {
  const {
    slideWidth = 5760,
    slideHeight = 4320,
    titleText = "Quarterly review",
    bodyText = "First point\rSecond point",
    fontName = "Arial",
    encrypted = false,
    notesText,
  } = options;

  const USER_NAME = "Ada";

  const DOCUMENT_PERSIST_ID = 1;
  const SLIDE_PERSIST_ID = 2;
  const NOTES_PERSIST_ID = 3;
  const SLIDE_ID = 256;
  const NOTES_ID = 512;

  const documentChildren = [
    documentAtom(slideWidth, slideHeight),
    container(RT_Environment, [
      container(RT_FontCollection, [fontEntityAtom(fontName)]),
    ]),
    container(
      RT_SlideListWithText,
      [
        slidePersistAtom(SLIDE_PERSIST_ID, 1, SLIDE_ID),
        atom(RT_TextHeaderAtom, u32le(TEXT_TYPE_TITLE)),
        textBytesAtom(titleText),
      ],
      { recInstance: SLIDE_LIST_INSTANCE_SLIDES },
    ),
  ];
  if (notesText !== undefined) {
    // [MS-PPT] 2.4.14.6: the notes list holds NotesPersistAtom records alone, distinguished from the slide and master lists by rh.recInstance. [MS-PPT] 2.4.14.7's own field order puts a reserved word where a SlidePersistAtom states cTexts, and the notes identifier -- not a slide identifier -- at offset 12.
    documentChildren.push(
      container(
        RT_SlideListWithText,
        [
          atom(
            RT_SlidePersistAtom,
            concatBytes(
              u32le(NOTES_PERSIST_ID),
              u32le(0),
              i32le(0),
              u32le(NOTES_ID),
              u32le(0),
            ),
          ),
        ],
        { recInstance: SLIDE_LIST_INSTANCE_NOTES },
      ),
    );
  }
  const documentContainer = container(RT_Document, documentChildren);

  const slideContainer = container(RT_Slide, [
    container(RT_Drawing, [
      container(OfficeArtDgContainer, [
        container(OfficeArtSpgrContainer, [
          container(OfficeArtSpContainer, [
            atom(OfficeArtFSPGR, new Uint8Array(16), { recVer: 0x1 }),
            // fGroup | fPatriarch, the outermost group every drawing carries.
            fsp(1, (1 << 0) | (1 << 2)),
          ]),
          // The title placeholder: its text is not here, only a reference to the first text of this slide's entry in the document's slide list.
          container(OfficeArtSpContainer, [
            fsp(2, 0),
            clientAnchor(360, 480, 5280, 1080),
            container(OfficeArtClientTextbox, [
              atom(RT_OutlineTextRefAtom, i32le(0)),
            ]),
          ]),
          // An ordinary text box, whose text is stored on the shape itself.
          container(OfficeArtSpContainer, [
            fsp(3, 0),
            clientAnchor(1440, 480, 5280, 3960),
            container(OfficeArtClientTextbox, [
              atom(RT_TextHeaderAtom, u32le(TEXT_TYPE_BODY)),
              textBytesAtom(bodyText),
            ]),
          ]),
        ]),
      ]),
    ]),
  ]);

  // [MS-PPT] 2.5.6 NotesContainer: a NotesAtom naming the presentation slide these notes belong to, then a DrawingContainer holding the notes text on a plain text box's own client textbox -- the spelling a real producer writes (verified against LibreOffice's own `--convert-to ppt` output), rather than a placeholder reached through the notes list, which [MS-PPT] 2.4.14.6 gives no texts to reach into.
  const notesContainer =
    notesText === undefined
      ? undefined
      : container(RT_Notes, [
          atom(RT_NotesAtom, concatBytes(u32le(SLIDE_ID), u16le(0), u16le(0)), {
            recVer: 0x1,
          }),
          container(RT_Drawing, [
            container(OfficeArtDgContainer, [
              container(OfficeArtSpgrContainer, [
                container(OfficeArtSpContainer, [
                  atom(OfficeArtFSPGR, new Uint8Array(16), { recVer: 0x1 }),
                  fsp(1, (1 << 0) | (1 << 2)),
                ]),
                container(OfficeArtSpContainer, [
                  fsp(2, 0),
                  clientAnchor(2160, 288, 5472, 4104),
                  container(OfficeArtClientTextbox, [
                    atom(RT_TextHeaderAtom, u32le(TEXT_TYPE_OTHER)),
                    textBytesAtom(notesText),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]);

  const persistObjects = [
    { persistId: DOCUMENT_PERSIST_ID, bytes: documentContainer },
    { persistId: SLIDE_PERSIST_ID, bytes: slideContainer },
  ];
  if (notesContainer !== undefined) {
    persistObjects.push({
      persistId: NOTES_PERSIST_ID,
      bytes: notesContainer,
    });
  }
  const persistEntries: Uint8Array<ArrayBuffer>[] = [];
  let persistOffset = 0;
  for (const object of persistObjects) {
    // One PersistDirectoryEntry per object (cPersist 0x001), the same one-run-per-entry form stream/persist-write.ts emits.
    persistEntries.push(
      concatBytes(u32le(object.persistId | (1 << 20)), u32le(persistOffset)),
    );
    persistOffset += object.bytes.length;
  }

  const persistDirectoryOffset = persistOffset;
  const persistDirectory = atom(
    RT_PersistDirectoryAtom,
    concatBytes(...persistEntries),
  );
  const userEditOffset = persistDirectoryOffset + persistDirectory.length;
  const userEdit = atom(
    RT_UserEditAtom,
    concatBytes(
      u32le(SLIDE_ID),
      u16le(0),
      u8(0x00),
      u8(0x03),
      u32le(0),
      u32le(persistDirectoryOffset),
      u32le(DOCUMENT_PERSIST_ID),
      u32le(persistObjects.length + 1),
      u16le(0),
      u16le(0),
    ),
  );

  const ansiUserName = asciiBytes(USER_NAME);
  const currentUserAtom = atom(
    RT_CurrentUserAtom,
    concatBytes(
      u32le(0x00000014),
      u32le(encrypted ? 0xf3d1c4df : CURRENT_USER_HEADER_TOKEN_PLAIN),
      u32le(userEditOffset),
      u16le(ansiUserName.length),
      u16le(0x03f4),
      u8(0x03),
      u8(0x00),
      u16le(0),
      ansiUserName,
      u32le(0x00000008),
      utf16le(USER_NAME),
    ),
  );

  return {
    // Padded past the compound-file writer's own minimum stream size; every byte after the atom is outside its recLen and is therefore never read.
    currentUserStream: concatBytes(currentUserAtom, new Uint8Array(64)),
    powerPointDocumentStream: concatBytes(
      ...persistObjects.map((object) => object.bytes),
      persistDirectory,
      userEdit,
    ),
  };
}
