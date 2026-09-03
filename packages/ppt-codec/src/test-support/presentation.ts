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
  RT_OutlineTextRefAtom,
  RT_PersistDirectoryAtom,
  RT_Slide,
  RT_SlideListWithText,
  RT_SlidePersistAtom,
  RT_TextBytesAtom,
  RT_TextHeaderAtom,
  RT_UserEditAtom,
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
import { TEXT_TYPE_BODY, TEXT_TYPE_TITLE } from "../text/atoms";

// A whole synthetic presentation: the two [MS-PPT] streams of a one-slide document carrying a title placeholder (whose text lives in the document's slide list, reached by an OutlineTextRefAtom) and a plain text box (whose text lives on the shape). Assembled from the same record builders the per-record suites use, so the end-to-end test exercises the real offset arithmetic -- the persist directory, the edit chain, and every cross-stream reference -- rather than a stubbed one.

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
  } = options;

  const USER_NAME = "Ada";

  const DOCUMENT_PERSIST_ID = 1;
  const SLIDE_PERSIST_ID = 2;

  const documentContainer = container(RT_Document, [
    documentAtom(slideWidth, slideHeight),
    container(RT_Environment, [
      container(RT_FontCollection, [fontEntityAtom(fontName)]),
    ]),
    container(
      RT_SlideListWithText,
      [
        slidePersistAtom(SLIDE_PERSIST_ID, 1, 256),
        atom(RT_TextHeaderAtom, u32le(TEXT_TYPE_TITLE)),
        textBytesAtom(titleText),
      ],
      { recInstance: SLIDE_LIST_INSTANCE_SLIDES },
    ),
  ]);

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

  const persistDirectoryOffset =
    documentContainer.length + slideContainer.length;
  const persistDirectory = atom(
    RT_PersistDirectoryAtom,
    concatBytes(
      u32le(DOCUMENT_PERSIST_ID | (2 << 20)),
      u32le(0),
      u32le(documentContainer.length),
    ),
  );
  const userEditOffset = persistDirectoryOffset + persistDirectory.length;
  const userEdit = atom(
    RT_UserEditAtom,
    concatBytes(
      u32le(256),
      u16le(0),
      u8(0x00),
      u8(0x03),
      u32le(0),
      u32le(persistDirectoryOffset),
      u32le(DOCUMENT_PERSIST_ID),
      u32le(SLIDE_PERSIST_ID + 1),
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
      documentContainer,
      slideContainer,
      persistDirectory,
      userEdit,
    ),
  };
}
