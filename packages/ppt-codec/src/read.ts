import {
  readCompoundFile,
  readSummaryInformation,
  summaryInformationToLayoutMetadata,
} from "archive-codec";
import {
  type ContentBlock,
  type ContentDocument,
  type ContentEmbeddedObjectKind,
  type ContentShape,
  type ContentSlide,
  type ContentTable,
  type ContentTableCell,
  type DocumentTree,
  type LayoutMetadata,
  type PageSize,
  assembleTree,
} from "document-schema.js";
import { buildParagraphs } from "./content";
import { bytesToBase64 } from "./base64";
import {
  findSlideSchemeColorSchemeAtom,
  readSlideSchemeColorSchemeAtom,
} from "./document/color-scheme";
import { readDocumentAtom } from "./document/document-atom";
import { readFontNames } from "./document/fonts";
import {
  type MasterInfo,
  buildMasterStyleTable,
  readSlideAtom,
} from "./document/master";
import { readNotesListWithText } from "./document/notes-list";
import { readNotesContainerAtom, readNotesText } from "./document/notes";
import {
  type SlidePersist,
  readSlideListWithText,
} from "./document/slide-list";
import { type PptBlip, blipForPib, readBlipStore } from "./drawing/blips";
import {
  PROPERTY_DX_TEXT_LEFT,
  PROPERTY_DX_TEXT_RIGHT,
  PROPERTY_DY_TEXT_BOTTOM,
  PROPERTY_DY_TEXT_TOP,
  PROPERTY_PIB,
  type ShapeProperty,
} from "./drawing/properties";
import { type PptTable, readDrawingShapes } from "./drawing/shapes";
import { decryptPptDocumentStream } from "./encryption";
import { PptEncryptedError, PptFormatError } from "./errors";
import {
  type ExternalOleEmbed,
  readExObjIdRef,
  readExternalOleEmbeds,
  resolveOleObjectStorage,
} from "./ole/embedded";
import { type PptRecord, childRecords, findChild } from "./record/tree";
import {
  RT_Document,
  RT_DocumentAtom,
  RT_Drawing,
  RT_Environment,
  RT_MainMaster,
  RT_OutlineTextRefAtom,
  RT_Slide,
  RT_SlideAtom,
  RT_SlideListWithText,
  RT_StyleTextPropAtom,
  RT_TextHeaderAtom,
  RT_TextMasterStyleAtom,
  SLIDE_LIST_INSTANCE_MASTERS,
  SLIDE_LIST_INSTANCE_NOTES,
  SLIDE_LIST_INSTANCE_SLIDES,
} from "./record/types";
import { readCurrentUserAtom } from "./stream/current-user";
import { buildPersistDirectory, resolvePersistObject } from "./stream/persist";
import {
  characterCountOf,
  readTextBody,
  readTextHeaderAtom,
} from "./text/atoms";
import {
  type MasterTextStyleAtom,
  type RgbColor,
  type StyleTextProps,
  readStyleTextPropAtom,
  readTextMasterStyleAtom,
} from "./text/style";
import { POINTS_PER_INCH, emuToPoints, masterUnitsToPoints } from "./units";

// The read path, top to bottom: an [MS-CFB] compound file's two required streams, the persist directory that says which of the file's appended edits is live, the document container that edit names, and then each slide's drawing and text mapped onto document-schema.js's presentation content model -- the same ContentSlide/ContentShape/ContentParagraph/ContentRun vocabulary ooxml.js's pptx reader and odf.js's odp reader produce, so a .ppt reaches every consumer of that schema without a second representation of a slide existing anywhere. [MS-PPT] 2.1.1 Current User Stream: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/76cfa657-07a6-464b-81ab-4c017c611f64 [MS-PPT] 2.1.2 PowerPoint Document Stream: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/1fc22d56-28f9-4818-bd45-67c2bf721ccf

// [MS-PPT] 2.1.1/2.1.2: both stream names are mandated exactly, including the space.
export const CURRENT_USER_STREAM = "Current User";
export const POWERPOINT_DOCUMENT_STREAM = "PowerPoint Document";
// [MS-PPT] 2.1.3: the optional stream a producer moves blips into when they are not embedded in the blip store itself -- genuinely optional, since an FBSE may carry its blip inline instead. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/150a72bc-487f-467e-994e-01270dfaf9bf
export const PICTURES_STREAM = "Pictures";

/** The [MS-OLEPS] Property Set Stream a .ppt's title/author/dates live in when present ([MS-OSHARED] 2.3.3.2.2) -- a genuinely optional stream, unlike the two above, since a valid PowerPoint binary document need not carry document properties at all. */
export const SUMMARY_INFORMATION_STREAM = "\x05SummaryInformation";

// PowerPoint's own default text insets: 0.1 inch left and right, 0.05 inch top and bottom -- the same figures ECMA-376 later wrote into a:bodyPr's defaults, and the ones ooxml.js applies to a pptx shape stating none. A per-shape override lives in the shape's OfficeArtFOPT text properties (dxTextLeft/dyTextTop/dxTextRight/dyTextBottom -- insetsForShape below reads them). Exported because the write side needs them too: ContentShape requires all four insets, and a shape the writer builds for itself (a notes body, a master placeholder) has to state the same defaults a read of that shape would report rather than invent its own.
export const DEFAULT_INSET_LEFT_RIGHT_PT = 0.1 * POINTS_PER_INCH;
export const DEFAULT_INSET_TOP_BOTTOM_PT = 0.05 * POINTS_PER_INCH;

interface ShapeInsets {
  readonly insetLeftPt: number;
  readonly insetTopPt: number;
  readonly insetRightPt: number;
  readonly insetBottomPt: number;
}

// A shape's own text insets: each of the four OfficeArtFOPT properties overrides its own default independently (a producer that only narrows the left margin still gets the standard 0.05in top/bottom), and a picture -- having no text body of its own -- falls back to zero on whichever side its own properties leave unstated, rather than to the text-shape default (see the isPicture comment above this function's call sites).
function insetsForShape(
  properties: ReadonlyMap<number, ShapeProperty>,
  isPicture: boolean,
): ShapeInsets {
  const defaultLeftRight = isPicture ? 0 : DEFAULT_INSET_LEFT_RIGHT_PT;
  const defaultTopBottom = isPicture ? 0 : DEFAULT_INSET_TOP_BOTTOM_PT;
  const emuOrDefault = (opid: number, fallback: number): number => {
    const property = properties.get(opid);
    return property === undefined ? fallback : emuToPoints(property.value);
  };
  return {
    insetLeftPt: emuOrDefault(PROPERTY_DX_TEXT_LEFT, defaultLeftRight),
    insetTopPt: emuOrDefault(PROPERTY_DY_TEXT_TOP, defaultTopBottom),
    insetRightPt: emuOrDefault(PROPERTY_DX_TEXT_RIGHT, defaultLeftRight),
    insetBottomPt: emuOrDefault(PROPERTY_DY_TEXT_BOTTOM, defaultTopBottom),
  };
}

const NO_STYLE: StyleTextProps = { paragraphRuns: [], characterRuns: [] };

// The recovered nested content for an embedded OLE object: what readExternalOleEmbeds/resolveOleObjectStorage recover as raw [MS-CFB] compound-file bytes are second-order content this single-format package cannot itself decode -- it depends on no sibling format codec, per the monorepo README's own layering rule, so it has no doc-codec/xls-codec/ooxml.js reader available to turn those bytes into a real nested document. This port is the family's own established answer to that exact problem (ooxml.js's docx writer takes an analogous EmbeddedPresentationSerialiser port for the identical reason, one layer up in documents.js, which already depends on every format codec): a caller that DOES hold every codec -- documents.js -- supplies the decode, and this package stays decoupled either way. Returning undefined for anything (no port supplied, an unrecognised progId, a decode failure) degrades to no embedded block, matching the read-side tiered-degrade convention ooxml.js's own embedded-object recovery already states: one bad or unrecoverable embedded object never fails the host slide's read.
export type DecodeEmbeddedObjectPort = (
  storageBytes: Uint8Array<ArrayBuffer>,
  progId: string | undefined,
) =>
  | {
      readonly objectKind: ContentEmbeddedObjectKind;
      readonly document: ContentDocument;
    }
  | undefined;

export interface ReadPptOptions {
  readonly decodeEmbeddedObject?: DecodeEmbeddedObjectPort;
}

// What a slide's own reading starts from: the resolved document-wide state (streams, persist directory, blip store) plus this slide's own list entry and the document's font collection.
interface DocumentContext {
  readonly streamBytes: Uint8Array<ArrayBuffer>;
  readonly directory: ReadonlyMap<number, number>;
  readonly blips: readonly PptBlip[];
  readonly persist: SlidePersist;
  readonly fontNames: readonly string[];
  readonly externalOleEmbeds: ReadonlyMap<number, ExternalOleEmbed>;
  readonly decodeEmbeddedObject: DecodeEmbeddedObjectPort | undefined;
}

// A DocumentContext narrowed onto one slide by its resolved master -- the formatting cascade and colour scheme a run's unstated properties resolve against, which is per-slide because a slide's own scheme can differ from its master's.
interface DrawingContext extends DocumentContext {
  readonly masterInfo: MasterInfo;
}

// The flat form: metadata plus slides, matching the shape ooxml.js's readPptxContent and odf.js's readOdpContent return, rather than a full ContentDocument envelope. readPpt below is what wraps it.
export interface PptDocument {
  readonly metadata: LayoutMetadata;
  readonly slides: readonly ContentSlide[];
}

function requireStream(
  streams: readonly { path: string; bytes: Uint8Array<ArrayBuffer> }[],
  name: string,
): Uint8Array<ArrayBuffer> {
  const stream = streams.find((candidate) => candidate.path === name);
  if (stream === undefined) {
    throw new PptFormatError(
      `compound file has no "${name}" stream, which [MS-PPT] requires of every PowerPoint binary document`,
    );
  }
  return stream.bytes;
}

interface ShapeText {
  readonly textType: number;
  readonly records: readonly PptRecord[];
}

// A shape's text, whether it is stored on the shape itself or -- for a placeholder -- in the document's slide list, which the shape points into with an OutlineTextRefAtom. The two spellings are not alternatives a producer picks freely: a title or body placeholder's text is genuinely absent from the slide's own drawing, so a reader that only looked at the client textbox would report those shapes as empty. They also disagree about where TextHeaderAtom itself ends up: a client textbox's own children include it as a raw record, but readSlideListWithText (document/slide-list.ts) already consumes it while building each OutlineText, capturing its textType separately rather than leaving it in `records` -- so the two branches below resolve textType in genuinely different ways rather than both searching `records` for one.
function textRecordsFor(
  clientTextbox: PptRecord,
  persist: SlidePersist,
): ShapeText {
  const children = childRecords(clientTextbox);
  const outlineRef = findChild(children, RT_OutlineTextRefAtom);
  if (outlineRef === undefined) {
    const headerRecord = findChild(children, RT_TextHeaderAtom);
    if (headerRecord === undefined) {
      throw new PptFormatError(
        "a client textbox's own text records carry no TextHeaderAtom, which [MS-PPT] 2.9.1 requires to precede its TextCharsAtom/TextBytesAtom",
      );
    }
    return { textType: readTextHeaderAtom(headerRecord), records: children };
  }
  if (outlineRef.data.length < 4) {
    throw new PptFormatError(
      `OutlineTextRefAtom at offset ${outlineRef.offset} carries ${outlineRef.data.length} bytes, fewer than the 4 its index field needs`,
    );
  }
  const view = new DataView(
    outlineRef.data.buffer,
    outlineRef.data.byteOffset,
    outlineRef.data.byteLength,
  );
  const index = view.getInt32(0, true);
  const outlineText = persist.texts[index];
  if (outlineText === undefined) {
    throw new PptFormatError(
      `OutlineTextRefAtom references text ${index} of slide ${persist.slideId}, which has only ${persist.texts.length} texts in the slide list`,
    );
  }
  return { textType: outlineText.textType, records: outlineText.records };
}

function blocksFor(
  clientTextbox: PptRecord | undefined,
  context: DrawingContext,
): ContentBlock[] {
  if (clientTextbox === undefined) {
    return [];
  }
  const { textType, records } = textRecordsFor(clientTextbox, context.persist);
  const text = readTextBody(records);
  if (text === undefined) {
    return [];
  }
  const styleRecord = findChild(records, RT_StyleTextPropAtom);
  const style =
    styleRecord === undefined
      ? NO_STYLE
      : readStyleTextPropAtom(styleRecord, characterCountOf(text));
  return buildParagraphs(
    text,
    style,
    context.fontNames,
    context.masterInfo.styles,
    textType,
    context.masterInfo.colorScheme,
  );
}

// A picture shape's image block, sized to the shape's own frame -- the same frame-sized spelling ooxml.js's pptx reader gives a p:pic, so a picture reads identically from either format. An unresolvable pib (past the end of the store, an empty slot, a WMF/EMF/TIFF/DIB blip this package decodes none of) keeps the shape with empty content rather than dropping it, mirroring readPicShape's own "unresolvable image keeps the geometry" convention.
function imageBlocksFor(
  pibProperty: ShapeProperty | undefined,
  context: DrawingContext,
  widthPt: number,
  heightPt: number,
): ContentBlock[] {
  if (pibProperty === undefined) {
    return [];
  }
  const blip = blipForPib(context.blips, pibProperty.value);
  if (blip === undefined) {
    return [];
  }
  return [
    {
      kind: "image" as const,
      format: blip.format,
      base64: bytesToBase64(blip.bytes),
      widthPt,
      heightPt,
    },
  ];
}

// A shape's OLE-embedded object, when its OfficeArtClientData names one, the document's own external-object list resolves it, its persist entry's storage recovers, AND a decode port turns those bytes into a real nested document -- any one of those failing degrades to no additional block, the shape's own picture/text blocks (already collected by imageBlocksFor/blocksFor above) standing alone exactly as if this package had no OLE support at all. This mirrors ooxml.js's own OLE graphic-frame reading precedent: the fallback picture stays, and the embedded-object block sits beside it rather than replacing it, when a document was actually recovered.
function embeddedObjectBlocksFor(
  clientData: PptRecord | undefined,
  context: DrawingContext,
  frame: { xPt: number; yPt: number; widthPt: number; heightPt: number },
): ContentBlock[] {
  if (clientData === undefined || context.decodeEmbeddedObject === undefined) {
    return [];
  }
  const exObjId = readExObjIdRef(clientData);
  if (exObjId === undefined) {
    return [];
  }
  const embed = context.externalOleEmbeds.get(exObjId);
  if (embed === undefined) {
    return [];
  }
  const storageBytes = resolveOleObjectStorage(
    context.streamBytes,
    context.directory,
    embed.persistIdRef,
  );
  if (storageBytes === undefined) {
    return [];
  }
  const decoded = context.decodeEmbeddedObject(storageBytes, embed.progId);
  if (decoded === undefined) {
    return [];
  }
  return [
    {
      kind: "embeddedObject" as const,
      objectKind: decoded.objectKind,
      document: decoded.document,
      frame,
    },
  ];
}

// A table's grid, derived from its cells' own rectangles -- the one place the format states it, since no record names a row or a column and every cell is an ordinary anchored shape. Row boundaries are the distinct cell tops, column boundaries the distinct cell lefts, each in document-declared order; a cell lands at the intersection of its own top and left; a grid position no cell occupies reads as an empty cell, because the schema's table is dense and the format's is not. A cell carrying no anchor contributes nothing at all, the same "positioned, but unknown where" drop the slide's own walk applies to a shape with no anchor, and neither does a shape with a degenerate rectangle -- a real PowerPoint table's group carries a run of zero-width and zero-height shapes spelling its gridlines (confirmed by inspecting Microsoft Office PowerPoint's own output), which are not cells and would otherwise plant phantom rows and columns. master-unit arithmetic stays exact through to points (72/576 is exactly 1/8, exactly representable), so boundaries derived by subtraction never drift off a cell edge.
function tableBlockFor(table: PptTable, context: DrawingContext): ContentTable {
  const placed = table.cells.flatMap((cell) =>
    cell.anchor === undefined ||
    cell.anchor.right <= cell.anchor.left ||
    cell.anchor.bottom <= cell.anchor.top
      ? []
      : [{ cell, anchor: cell.anchor }],
  );
  const rowTops = [...new Set(placed.map((entry) => entry.anchor.top))].sort(
    (a, b) => a - b,
  );
  const columnLefts = [
    ...new Set(placed.map((entry) => entry.anchor.left)),
  ].sort((a, b) => a - b);
  const rightmost = Math.max(
    ...placed.map((entry) => entry.anchor.right),
    ...columnLefts,
  );
  const columnWidthsPt = columnLefts.map((left, index) => {
    // The next column's own left is this column's right edge; the last column (the only one .at() has no next left for) runs to the rightmost cell edge the table states.
    const right = columnLefts.at(index + 1) ?? rightmost;
    return masterUnitsToPoints(right - left);
  });
  const rows = rowTops.map((top) => {
    const inRow = placed
      .filter((entry) => entry.anchor.top === top)
      .sort((a, b) => a.anchor.left - b.anchor.left);
    const bottom = Math.max(...inRow.map((entry) => entry.anchor.bottom), top);
    const cells: ContentTableCell[] = columnLefts.map((left) => {
      const at = inRow.find((entry) => entry.anchor.left === left);
      return at === undefined
        ? { blocks: [] }
        : { blocks: blocksFor(at.cell.clientTextbox, context) };
    });
    const heightPt = masterUnitsToPoints(bottom - top);
    return heightPt > 0 ? { cells, heightPt } : { cells };
  });
  return { kind: "table", rows, columnWidthsPt };
}

// Every notes slide's text, keyed by the slideId of the presentation slide it belongs to. [MS-PPT] 3.5.3 makes this the association: "A notes slide is associated with its presentation slide by means of the slideIdRef field in the NotesContainer record", and it explicitly warns that the notes list's own order is not meaningful, so the mapping has to be built from each container's own atom rather than by pairing the two lists positionally. A NotesContainer naming the notes master states slideIdRef 0x00000000, which no presentation slide's own slideId can be, so such an entry simply matches nothing.
//
// A real producer does not always write that mandated 0x00000000, though: LibreOffice 26.2.5.2's own notes master states slideIdRef 0x80000001 instead, confirmed by inspecting its raw bytes. That is harmless here only because a presentation slide's own slideId (this package writes 256 + index, and no other producer this package has been checked against uses anything near it) never reaches that high -- [MS-PPT] 2.2.13 reserves 0x80000000 and above for MasterId, so a real slideId that large would already be spec-nonconformant. If a slideId this package's own write.ts mints (see FIRST_SLIDE_ID's own note) ever moved up into that range, or a third-party file's own genuine slideId did, this lookup would risk pairing a slide with the wrong notes -- or with the master's own sentinel entry -- rather than with none. Nothing here currently guards that bound, since it would take roughly two billion slides to reach it from this package's own writer, but a future notes-aware reader keying on slideIdRef anywhere else should carry the identical caveat.
function readNotesBySlideId(
  streamBytes: Uint8Array<ArrayBuffer>,
  directory: ReadonlyMap<number, number>,
  notesList: PptRecord | undefined,
): Map<number, string> {
  const notes = new Map<number, string>();
  if (notesList === undefined) {
    return notes;
  }
  for (const persist of readNotesListWithText(notesList)) {
    const notesContainer = resolvePersistObject(
      streamBytes,
      directory,
      persist.persistIdRef,
      `NotesPersistAtom for notes slide ${persist.notesId}`,
    );
    notes.set(
      readNotesContainerAtom(notesContainer).slideIdRef,
      readNotesText(notesContainer),
    );
  }
  return notes;
}

// A slide's own colour scheme, when it states one directly, else its master's. [MS-PPT] 2.5.1 mandates every SlideContainer carry its own SlideSchemeColorSchemeAtom, and a real producer that visually "follows the master's scheme" does so by duplicating the master's own RGB values into it rather than omitting the atom -- but this package's own writer (write.ts's writeSlideContainer) does not currently write one at all, so this reader tolerates its absence by falling back to the resolved master's colour scheme, which is also what an absent atom would mean in practice for a slide that genuinely follows its master.
function colorSchemeFor(
  slideChildren: readonly PptRecord[],
  master: MasterInfo,
): readonly RgbColor[] {
  const ownScheme = findSlideSchemeColorSchemeAtom(slideChildren);
  return ownScheme === undefined
    ? master.colorScheme
    : readSlideSchemeColorSchemeAtom(ownScheme);
}

// Every master persist object, keyed by its own identifier ([MS-PPT] 2.2.13 MasterId), resolved from the master list's own MasterPersistAtom entries -- the same RT_SlidePersistAtom shape the slide list itself uses ([MS-PPT] 2.4.14.1/2.4.14.2), read with the identical readSlideListWithText a slide's own list uses, its own `slideId` field simply naming a master rather than a slide here. A real .ppt genuinely carries more than one master when it mixes design templates within one deck, unlike this package's own writer, which only ever produces one -- SlideAtom.masterIdRef is a real per-slide choice, not a formality.
function readMastersById(
  streamBytes: Uint8Array<ArrayBuffer>,
  directory: ReadonlyMap<number, number>,
  masterList: PptRecord | undefined,
  documentDefault: MasterTextStyleAtom | undefined,
): Map<number, MasterInfo> {
  const mastersById = new Map<number, MasterInfo>();
  if (masterList === undefined) {
    return mastersById;
  }
  for (const persist of readSlideListWithText(masterList)) {
    const masterContainer = resolvePersistObject(
      streamBytes,
      directory,
      persist.persistIdRef,
      `MasterPersistAtom for master ${persist.slideId}`,
    );
    if (masterContainer.header.recType !== RT_MainMaster) {
      throw new PptFormatError(
        `persist object ${persist.persistIdRef} is record type 0x${masterContainer.header.recType.toString(16)}, not the RT_MainMaster (0x${RT_MainMaster.toString(16)}) its MasterPersistAtom promised`,
      );
    }
    const masterChildren = childRecords(masterContainer);
    const masterAtoms = masterChildren
      .filter((record) => record.header.recType === RT_TextMasterStyleAtom)
      .map(readTextMasterStyleAtom);
    const styles = buildMasterStyleTable(masterAtoms, documentDefault);
    const colorSchemeRecord = findSlideSchemeColorSchemeAtom(masterChildren);
    if (colorSchemeRecord === undefined) {
      throw new PptFormatError(
        `MainMasterContainer for master ${persist.slideId} has no SlideSchemeColorSchemeAtom, which [MS-PPT] 2.5.3 requires`,
      );
    }
    mastersById.set(persist.slideId, {
      styles,
      colorScheme: readSlideSchemeColorSchemeAtom(colorSchemeRecord),
    });
  }
  return mastersById;
}

function readSlide(
  base: DocumentContext,
  size: PageSize,
  notes: string,
  mastersById: ReadonlyMap<number, MasterInfo>,
): ContentSlide {
  const { streamBytes, directory, persist } = base;
  const slideContainer = resolvePersistObject(
    streamBytes,
    directory,
    persist.persistIdRef,
    `SlidePersistAtom for slide ${persist.slideId}`,
  );
  if (slideContainer.header.recType !== RT_Slide) {
    throw new PptFormatError(
      `persist object ${persist.persistIdRef} is record type 0x${slideContainer.header.recType.toString(16)}, not the RT_Slide (0x${RT_Slide.toString(16)}) its SlidePersistAtom promised`,
    );
  }
  const slideChildren = childRecords(slideContainer);
  const slideAtomRecord = findChild(slideChildren, RT_SlideAtom);
  if (slideAtomRecord === undefined) {
    throw new PptFormatError(
      `SlideContainer for slide ${persist.slideId} has no SlideAtom, which [MS-PPT] 2.5.1 requires as its first child`,
    );
  }
  const { masterIdRef } = readSlideAtom(slideAtomRecord);
  const master = mastersById.get(masterIdRef);
  if (master === undefined) {
    throw new PptFormatError(
      `slide ${persist.slideId}'s own SlideAtom names masterIdRef ${masterIdRef}, which the master list does not contain`,
    );
  }
  const context: DrawingContext = {
    ...base,
    masterInfo: {
      styles: master.styles,
      colorScheme: colorSchemeFor(slideChildren, master),
    },
  };

  const drawing = findChild(slideChildren, RT_Drawing);
  const shapes: ContentShape[] = [];
  for (const shape of drawing === undefined ? [] : readDrawingShapes(drawing)) {
    // A table arrives as one entry rather than as its cells: the group's own anchor is the shape's frame, the grid inside it is the table block, and a table's insets are the defaults (nothing about a table is a picture).
    if (!("clientTextbox" in shape)) {
      const tableLeft = masterUnitsToPoints(shape.anchor.left);
      const tableTop = masterUnitsToPoints(shape.anchor.top);
      shapes.push({
        frame: {
          xPt: tableLeft,
          yPt: tableTop,
          widthPt: Math.max(
            0,
            masterUnitsToPoints(shape.anchor.right) - tableLeft,
          ),
          heightPt: Math.max(
            0,
            masterUnitsToPoints(shape.anchor.bottom) - tableTop,
          ),
        },
        ...(shape.rotationDeg === undefined
          ? {}
          : { rotationDeg: shape.rotationDeg }),
        insetLeftPt: DEFAULT_INSET_LEFT_RIGHT_PT,
        insetTopPt: DEFAULT_INSET_TOP_BOTTOM_PT,
        insetRightPt: DEFAULT_INSET_LEFT_RIGHT_PT,
        insetBottomPt: DEFAULT_INSET_TOP_BOTTOM_PT,
        blocks: [tableBlockFor(shape, context)],
      });
      continue;
    }
    // A shape with no anchor has no rectangle on the slide, and ContentShape has no way to say "positioned, but unknown where". Dropping it loses less than inventing a position for it would: the alternative is a shape rendered at a place the file never states.
    if (shape.anchor === undefined) {
      continue;
    }
    const left = masterUnitsToPoints(shape.anchor.left);
    const top = masterUnitsToPoints(shape.anchor.top);
    const widthPt = Math.max(0, masterUnitsToPoints(shape.anchor.right) - left);
    const heightPt = Math.max(
      0,
      masterUnitsToPoints(shape.anchor.bottom) - top,
    );
    // A picture has no text body of its own -- its insets are genuinely zero rather than defaulted, since nothing ever positions text against them (the same convention ooxml.js's pptx reader states for a shape with no p:txBody).
    const isPicture = shape.properties.get(PROPERTY_PIB) !== undefined;
    shapes.push({
      frame: { xPt: left, yPt: top, widthPt, heightPt },
      ...(shape.rotationDeg === undefined
        ? {}
        : { rotationDeg: shape.rotationDeg }),
      ...insetsForShape(shape.properties, isPicture),
      blocks: [
        ...imageBlocksFor(
          shape.properties.get(PROPERTY_PIB),
          context,
          widthPt,
          heightPt,
        ),
        ...blocksFor(shape.clientTextbox, context),
        ...embeddedObjectBlocksFor(shape.clientData, context, {
          xPt: left,
          yPt: top,
          widthPt,
          heightPt,
        }),
      ],
    });
  }
  // Speaker notes live in their own NotesContainer persist objects, reached through the document's notes list rather than through the slide, and are resolved to this slide by readNotesBySlideId above. A slide with no notes slide of its own reads as "", which is what the schema requires of a slide with none.
  return { size, shapes, notes };
}

// Reads the two [MS-PPT] streams directly, for a caller that already holds them. The compound file below this is archive-codec's business, and separating the two keeps every record-level behaviour testable without a container around it. `picturesStream`, when supplied, is the optional "Pictures" stream ([MS-PPT] 2.1.3) a producer moves blips into instead of embedding them in the blip store; it is ignored for an encrypted document, whose pictures stream is itself RC4-encrypted by a per-picture scheme ([MS-PPT] 2.1.3's own decryption steps) this package does not implement -- such pictures read as no image rather than as garbage.
export function readPptStreams(
  currentUserStream: Uint8Array<ArrayBuffer>,
  powerPointDocumentStream: Uint8Array<ArrayBuffer>,
  password?: string,
  picturesStream?: Uint8Array<ArrayBuffer>,
  options?: ReadPptOptions,
): PptDocument {
  const currentUser = readCurrentUserAtom(currentUserStream);
  // The persist directory itself is always readable: UserEditAtom and PersistDirectoryAtom are never encrypted (see encryption.ts's own top comment), so building it does not need to wait on a password.
  const { directory, currentEdit } = buildPersistDirectory(
    powerPointDocumentStream,
    currentUser.offsetToCurrentEdit,
  );

  let streamBytes = powerPointDocumentStream;
  if (currentUser.encrypted) {
    if (password === undefined) {
      throw new PptEncryptedError(
        "the CurrentUserAtom's headerToken marks this document as RC4 CryptoAPI-encrypted ([MS-OFFCRYPTO] 2.3.5); call readPptStreams with a password to decrypt it",
      );
    }
    if (currentEdit.encryptSessionPersistIdRef === undefined) {
      throw new PptFormatError(
        "the CurrentUserAtom marks this document as encrypted, but its current UserEditAtom carries no encryptSessionPersistIdRef",
      );
    }
    streamBytes = decryptPptDocumentStream(
      powerPointDocumentStream,
      directory,
      currentEdit.encryptSessionPersistIdRef,
      password,
    );
  }

  const documentContainer = resolvePersistObject(
    streamBytes,
    directory,
    currentEdit.docPersistIdRef,
    "UserEditAtom.docPersistIdRef",
  );
  if (documentContainer.header.recType !== RT_Document) {
    throw new PptFormatError(
      `the document persist object is record type 0x${documentContainer.header.recType.toString(16)}, not RT_Document (0x${RT_Document.toString(16)})`,
    );
  }

  const children = childRecords(documentContainer);
  const documentAtomRecord = findChild(children, RT_DocumentAtom);
  if (documentAtomRecord === undefined) {
    throw new PptFormatError(
      "the DocumentContainer has no DocumentAtom, so the presentation's slide size is unknown",
    );
  }
  const documentAtom = readDocumentAtom(documentAtomRecord);
  const size: PageSize = {
    widthPt: masterUnitsToPoints(documentAtom.slideSize.x),
    heightPt: masterUnitsToPoints(documentAtom.slideSize.y),
  };

  const environment = findChild(children, RT_Environment);
  const fontNames = environment === undefined ? [] : readFontNames(environment);
  // [MS-PPT] 2.9.35: the DocumentTextInfoContainer's own TextMasterStyleAtom (a direct child of Environment, recInstance OTHER) is the fallback of last resort every TextTypeEnum member falls through to when its own master states nothing -- see document/master.ts's own top comment.
  const documentDefaultRecord =
    environment === undefined
      ? undefined
      : findChild(childRecords(environment), RT_TextMasterStyleAtom);
  const documentDefault =
    documentDefaultRecord === undefined
      ? undefined
      : readTextMasterStyleAtom(documentDefaultRecord);

  // The master, slide and notes lists all carry RT_SlideListWithText and differ only by recInstance, so matching on the record type alone would find whichever came first -- the master list.
  const listWithInstance = (instance: number): PptRecord | undefined =>
    children.find(
      (record) =>
        record.header.recType === RT_SlideListWithText &&
        record.header.recInstance === instance,
    );
  const mastersById = readMastersById(
    streamBytes,
    directory,
    listWithInstance(SLIDE_LIST_INSTANCE_MASTERS),
    documentDefault,
  );
  const slideList = listWithInstance(SLIDE_LIST_INSTANCE_SLIDES);
  const persists =
    slideList === undefined ? [] : readSlideListWithText(slideList);
  const notesBySlideId = readNotesBySlideId(
    streamBytes,
    directory,
    listWithInstance(SLIDE_LIST_INSTANCE_NOTES),
  );
  const blips = readBlipStore(
    documentContainer,
    currentUser.encrypted ? undefined : picturesStream,
  );
  const externalOleEmbeds = readExternalOleEmbeds(children);

  return {
    // Document properties live in the compound file's own "\x05SummaryInformation" stream ([MS-OSHARED]), not in any [MS-PPT] record -- genuinely outside what a caller holding only these two streams can supply. readPptContent, one level up, is where a container-level caller gets the real value: it looks the stream up itself and overrides this field when one is present.
    metadata: {},
    slides: persists.map((persist) =>
      readSlide(
        {
          streamBytes,
          directory,
          persist,
          fontNames,
          blips,
          externalOleEmbeds,
          decodeEmbeddedObject: options?.decodeEmbeddedObject,
        },
        size,
        notesBySlideId.get(persist.slideId) ?? "",
        mastersById,
      ),
    ),
  };
}

// Reads a .ppt file's bytes into the flat metadata + slides form. readPptStreams below is the pure record-level read (metadata always {}, since it has no container to look a SummaryInformation stream up in); this wraps it with the one container-level fact readPptStreams cannot know -- whether the compound file also carries a "\x05SummaryInformation" stream -- mapped onto LayoutMetadata through summaryInformationToLayoutMetadata (see src/metadata.ts) when present. `password` decrypts a presentation protected by [MS-OFFCRYPTO] 2.3.5 RC4 CryptoAPI -- see encryption.ts. It is ignored for an unencrypted presentation, and a missing or incorrect password against an encrypted one throws rather than returning a partial or garbled document.
export function readPptContent(
  bytes: Uint8Array<ArrayBuffer>,
  password?: string,
  options?: ReadPptOptions,
): PptDocument {
  const streams = readCompoundFile(bytes);
  const pictures = streams.find((stream) => stream.path === PICTURES_STREAM);
  const document = readPptStreams(
    requireStream(streams, CURRENT_USER_STREAM),
    requireStream(streams, POWERPOINT_DOCUMENT_STREAM),
    password,
    pictures === undefined ? undefined : pictures.bytes,
    options,
  );
  const metadataStream = streams.find(
    (stream) => stream.path === SUMMARY_INFORMATION_STREAM,
  );
  if (metadataStream === undefined) {
    return document;
  }
  return {
    ...document,
    metadata: summaryInformationToLayoutMetadata(
      readSummaryInformation(metadataStream.bytes),
    ),
  };
}

// Reads a .ppt file's bytes into the shared tree form, the same DocumentTree ooxml.js's readPptx and odf.js's readOdp produce for their own presentation formats.
export function readPpt(
  bytes: Uint8Array<ArrayBuffer>,
  password?: string,
  options?: ReadPptOptions,
): DocumentTree {
  const { metadata, slides } = readPptContent(bytes, password, options);
  const document: ContentDocument = {
    kind: "presentation",
    metadata,
    slides: [...slides],
  };
  return assembleTree(document);
}
