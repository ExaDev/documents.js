import type { ContentShape, PageSize } from "document-schema.js";
import { writeDrawingWithClientData } from "../drawing/shapes-write";
import {
  DEFAULT_INSET_LEFT_RIGHT_PT,
  DEFAULT_INSET_TOP_BOTTOM_PT,
} from "../read";
import {
  concatBytes,
  i32le,
  u8,
  u16le,
  u32le,
  writeAtom,
  writeContainer,
} from "../record/write";
import {
  OfficeArtClientData,
  RT_ColorSchemeAtom,
  RT_MainMaster,
  RT_PlaceholderAtom,
  RT_SlideAtom,
  RT_SlideListWithText,
  RT_SlidePersistAtom,
  RT_TextMasterStyleAtom,
  SLIDE_LIST_INSTANCE_MASTERS,
} from "../record/types";
import {
  TEXT_TYPE_BODY,
  TEXT_TYPE_NOTES,
  TEXT_TYPE_TITLE,
} from "../text/atoms";

// The one main master slide this writer produces, and the SlideAtom every slide needs in order to name it.
//
// WHY A WRITER OF PLAIN TEXT-BOX SLIDES WRITES A MASTER AT ALL. Speaker notes are the reason. [MS-PPT] 3.5.3 states the notes-to-slide association as the NotesAtom's own slideIdRef, but a real consumer follows the opposite link -- the notesIdRef field of the slide's own SlideAtom (confirmed directly: a file carrying only the spec's stated link has its notes silently dropped by LibreOffice, and the same file with notesIdRef additionally set has them imported onto the right slides). A SlideContainer's SlideAtom is therefore mandatory for notes to reach any consumer, and [MS-PPT] 2.5.2 makes masterIdRef "MUST NOT be 0x00000000 if the record that contains this SlideAtom record is a SlideContainer" -- so the master is a prerequisite the notes linkage drags in, not a separate feature bolted on beside it. Without it a slide has no conformant SlideAtom to carry notesIdRef in, and a consumer reading the file finds no slides at all.
//
// [MS-PPT] 2.5.3 MainMasterContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/e2f5fbf3-d790-487e-b96b-5ccdee0f0aa8 [MS-PPT] 2.5.2 SlideAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/57e11e6c-e550-4c43-80b6-72731eee8abd

// [MS-PPT] 2.13.28 SlideLayoutType. A slide this writer produces carries no placeholder shapes at all, which is exactly SL_Blank's own AllBlank rule ("8PT_None"); the master carries the five SL_TitleBody requires of a main master.
const SL_TITLE_BODY = 0x00000001;
const SL_BLANK = 0x00000010;

// [MS-PPT] 2.13.21 PlaceholderEnum, the members SL_TitleBody's MasterVariant rule names in its own order: "PT_MasterTitle PT_MasterBody PT_MasterDate PT_MasterFooter PT_MasterSlideNumber 3PT_None".
const PT_NONE = 0x00;
const PT_MASTER_TITLE = 0x01;
const PT_MASTER_BODY = 0x02;
const PT_MASTER_DATE = 0x07;
const PT_MASTER_SLIDE_NUMBER = 0x08;
const PT_MASTER_FOOTER = 0x09;
const MASTER_PLACEHOLDER_TYPES = [
  PT_MASTER_TITLE,
  PT_MASTER_BODY,
  PT_MASTER_DATE,
  PT_MASTER_FOOTER,
  PT_MASTER_SLIDE_NUMBER,
];

// [MS-PPT] 2.5.2: rgPlaceholderTypes is always eight bytes, whatever the layout names fewer.
const PLACEHOLDER_TYPE_COUNT = 8;

// [MS-PPT] 2.13.22 PlaceholderSize: PS_Full, "the full size of the master body text placeholder shape".
const PS_FULL = 0x00;

// [MS-PPT] 2.13.7 SlideFlags: fMasterObjects, fMasterScheme, fMasterBackground. Every slide this writer produces inherits all three from the master, which is what makes the master's own colour scheme and background the document's.
const SLIDE_FOLLOWS_MASTER = 0b111;

// The master's own identifier. [MS-PPT] 2.2.13 MasterId requires a main master's identifier to be at least 0x80000000, which is also what keeps it out of the SlideId range slides are numbered from.
export const MASTER_SLIDE_ID = 0x80000000;

// The master placeholder rectangles, as fractions of the slide. A master's placeholders are prompts rather than content -- nothing is drawn for one on a slide that instantiates no placeholder of that type, which every slide this writer produces is (SL_Blank) -- so these proportions decide nothing a reader or a renderer of this writer's own output can observe. They exist because a placeholder shape without an anchor has no rectangle at all, and are the conventional thirds a real master divides its page into: a title band across the top, the body beneath it, and the date/footer/slide-number row along the bottom.
const TITLE_TOP = 0.06;
const TITLE_HEIGHT = 0.16;
const BODY_TOP = 0.26;
const BODY_HEIGHT = 0.6;
const FOOTER_TOP = 0.92;
const FOOTER_HEIGHT = 0.05;
const SIDE_MARGIN = 0.05;
const FOOTER_COLUMN_WIDTH = 0.28;

function placeholderFrames(size: PageSize): readonly ContentShape["frame"][] {
  const { widthPt: w, heightPt: h } = size;
  const margin = w * SIDE_MARGIN;
  const contentWidth = w - margin * 2;
  const footerColumn = w * FOOTER_COLUMN_WIDTH;
  return [
    {
      xPt: margin,
      yPt: h * TITLE_TOP,
      widthPt: contentWidth,
      heightPt: h * TITLE_HEIGHT,
    },
    {
      xPt: margin,
      yPt: h * BODY_TOP,
      widthPt: contentWidth,
      heightPt: h * BODY_HEIGHT,
    },
    {
      xPt: margin,
      yPt: h * FOOTER_TOP,
      widthPt: footerColumn,
      heightPt: h * FOOTER_HEIGHT,
    },
    {
      xPt: (w - footerColumn) / 2,
      yPt: h * FOOTER_TOP,
      widthPt: footerColumn,
      heightPt: h * FOOTER_HEIGHT,
    },
    {
      xPt: w - margin - footerColumn,
      yPt: h * FOOTER_TOP,
      widthPt: footerColumn,
      heightPt: h * FOOTER_HEIGHT,
    },
  ];
}

// [MS-PPT] 2.9.22 PlaceholderAtom, recLen 0x8: position (signed 32-bit, unique among the slide's own placeholders), placementId, size, then two unused bytes. Carried inside the OfficeArtClientData container [MS-ODRAW] gives every shape for its host's private data.
function placeholderClientData(
  position: number,
  placementId: number,
): Uint8Array<ArrayBuffer> {
  return writeContainer(OfficeArtClientData, [
    writeAtom(
      RT_PlaceholderAtom,
      concatBytes(i32le(position), u8(placementId), u8(PS_FULL), u16le(0)),
    ),
  ]);
}

// [MS-PPT] 2.5.2's 0x18-byte SlideAtom, recVer 0x2.
export function writeSlideAtom(options: {
  readonly geom: number;
  readonly placeholderTypes: readonly number[];
  readonly masterIdRef: number;
  readonly notesIdRef: number;
  readonly slideFlags: number;
}): Uint8Array<ArrayBuffer> {
  const types = new Uint8Array(PLACEHOLDER_TYPE_COUNT);
  types.set(options.placeholderTypes.slice(0, PLACEHOLDER_TYPE_COUNT));
  return writeAtom(
    RT_SlideAtom,
    concatBytes(
      i32le(options.geom),
      types,
      u32le(options.masterIdRef),
      u32le(options.notesIdRef),
      u16le(options.slideFlags),
      u16le(0), // unused
    ),
    { recVer: 0x2 },
  );
}

// A presentation slide's own SlideAtom: no placeholder shapes of its own (every shape this writer emits is a plain text box), following the one master this writer wrote, and naming its notes slide when it has one.
export function writeSlideAtomForSlide(
  notesIdRef: number,
): Uint8Array<ArrayBuffer> {
  return writeSlideAtom({
    geom: SL_BLANK,
    placeholderTypes: [PT_NONE],
    masterIdRef: MASTER_SLIDE_ID,
    notesIdRef,
    slideFlags: SLIDE_FOLLOWS_MASTER,
  });
}

// [MS-PPT] 2.9.51 SlideSchemeColorSchemeAtom: recVer 0x0, recInstance 0x001, recLen 0x20, eight ColorStructs of red/green/blue/unused. The eight slots are, in the spec's own order, background, text, shadow, title text, fill, accent, accent-and-hyperlink and accent-and-followed-hyperlink -- PowerPoint's own default light scheme, since this writer has no scheme of its own to state and every slide it writes inherits this one.
const DEFAULT_SCHEME_COLORS: readonly (readonly [number, number, number])[] = [
  [0xff, 0xff, 0xff], // background
  [0x00, 0x00, 0x00], // text
  [0x80, 0x80, 0x80], // shadow
  [0x00, 0x00, 0x00], // title text
  [0xbb, 0xe0, 0xe3], // fill
  [0x33, 0x33, 0x99], // accent
  [0x00, 0x00, 0xcc], // accent and hyperlink
  [0x80, 0x00, 0x80], // accent and followed hyperlink
];

function writeColorSchemeAtom(): Uint8Array<ArrayBuffer> {
  return writeAtom(
    RT_ColorSchemeAtom,
    concatBytes(
      ...DEFAULT_SCHEME_COLORS.map(
        ([red, green, blue]) => new Uint8Array([red, green, blue, 0]),
      ),
    ),
    { recInstance: 0x001 },
  );
}

// [MS-PPT] 2.9.31 TextMasterStyleAtom: rh.recInstance is the TextTypeEnum member the formatting applies to, and cLevels "MUST be less than or equal to 0x0005" with each level present if and only if cLevels exceeds its index -- so cLevels 0x0000 is a complete record stating no level of its own, which is exactly this master's position: it overrides nothing, and every level falls through to the DocumentTextInfoContainer's own styles as 2.9.31 specifies. 2.5.3 requires at least a title (0x000) and a body (0x001) item, plus a notes (0x002) item for the master the first MasterPersistAtom names -- which this master always is, being the only one.
function writeTextMasterStyleAtom(textType: number): Uint8Array<ArrayBuffer> {
  return writeAtom(RT_TextMasterStyleAtom, u16le(0), {
    recInstance: textType,
  });
}

// The MainMasterContainer itself: the five placeholder shapes SL_TitleBody's own MasterVariant rule requires of a main master, each anchored and each carrying nothing, since this writer has no master content to put in them.
export function writeMainMaster(
  size: PageSize,
  fontIndexOf: (family: string) => number,
): Uint8Array<ArrayBuffer> {
  const placeholders = MASTER_PLACEHOLDER_TYPES.map((placementId, index) => {
    const frame = placeholderFrames(size)[index];
    if (frame === undefined) {
      throw new Error(
        "internal error: the main master states more placeholder types than it has rectangles for",
      );
    }
    return {
      shape: {
        frame,
        // The insets a read of this shape would report; a master placeholder holds no text of its own, so nothing depends on them beyond ContentShape requiring all four.
        insetLeftPt: DEFAULT_INSET_LEFT_RIGHT_PT,
        insetTopPt: DEFAULT_INSET_TOP_BOTTOM_PT,
        insetRightPt: DEFAULT_INSET_LEFT_RIGHT_PT,
        insetBottomPt: DEFAULT_INSET_TOP_BOTTOM_PT,
        blocks: [],
      } satisfies ContentShape,
      clientData: placeholderClientData(index, placementId),
    };
  });
  return writeContainer(RT_MainMaster, [
    writeSlideAtom({
      geom: SL_TITLE_BODY,
      placeholderTypes: MASTER_PLACEHOLDER_TYPES,
      // [MS-PPT] 2.5.2: both MUST be 0x00000000 when the SlideAtom's container is a MainMasterContainer -- a master follows no master, and has no notes slide.
      masterIdRef: 0,
      notesIdRef: 0,
      slideFlags: 0,
    }),
    writeTextMasterStyleAtom(TEXT_TYPE_TITLE),
    writeTextMasterStyleAtom(TEXT_TYPE_BODY),
    writeTextMasterStyleAtom(TEXT_TYPE_NOTES),
    writeDrawingWithClientData(placeholders, fontIndexOf),
    writeColorSchemeAtom(),
  ]);
}

// [MS-PPT] 2.4.14.1 MasterListWithTextContainer and 2.4.14.2 MasterPersistAtom: the same RT_SlidePersistAtom and 0x14 length the slide and notes lists use, told apart by rh.recInstance alone, with the master's own identifier where a SlidePersistAtom states its slideId.
export function writeMasterListWithText(
  persistIdRef: number,
): Uint8Array<ArrayBuffer> {
  return writeContainer(
    RT_SlideListWithText,
    [
      writeAtom(
        RT_SlidePersistAtom,
        concatBytes(
          u32le(persistIdRef),
          u32le(0), // reserved flags
          i32le(0), // reserved
          u32le(MASTER_SLIDE_ID),
          u32le(0), // reserved
        ),
      ),
    ],
    { recInstance: SLIDE_LIST_INSTANCE_MASTERS },
  );
}
