import type {
  ContentBlock,
  ContentImageBlock,
  ContentShape,
  ContentTable,
} from "document-schema.js";
import { buildTextBody } from "../content-write";
import { isBlipFormat } from "./blips";
import {
  type PptDiagnostic,
  type PptDiagnosticSink,
  PptDiagnosticCodes,
} from "../diagnostics";
import { PptUnsupportedContentError } from "../errors";
import {
  concatBytes,
  i32le,
  u32le,
  utf16le,
  writeAtom,
  writeContainer,
} from "../record/write";
import {
  OfficeArtChildAnchor,
  OfficeArtClientAnchor,
  OfficeArtClientTextbox,
  OfficeArtDgContainer,
  OfficeArtFOPT,
  OfficeArtFSP,
  OfficeArtFSPGR,
  OfficeArtSpContainer,
  OfficeArtSpgrContainer,
  OfficeArtTertiaryFOPT,
  RT_Drawing,
  RT_TextCharsAtom,
  RT_TextHeaderAtom,
} from "../record/types";
import {
  PROPERTY_DX_TEXT_LEFT,
  PROPERTY_DX_TEXT_RIGHT,
  PROPERTY_DY_TEXT_BOTTOM,
  PROPERTY_DY_TEXT_TOP,
  PROPERTY_PIB,
  PROPERTY_ROTATION,
  PROPERTY_TABLE_PROPERTIES,
  PROPERTY_TABLE_ROW_PROPERTIES,
  TABLE_FLAG_IS_TABLE,
  type WritableShapeProperty,
  degreesToFixedPoint,
  writeIMsoArray,
  writeShapePropertyTable,
} from "./properties";
import {
  DEFAULT_INSET_LEFT_RIGHT_PT,
  DEFAULT_INSET_TOP_BOTTOM_PT,
} from "../read";
import { TEXT_TYPE_OTHER } from "../text/atoms";
import { writeStyleTextPropAtom } from "../text/style-write";
import { pointsToEmu, pointsToMasterUnits } from "../units";

// A generic narrowing helper rather than a plain `as number` at each call site: this workspace's own strictTypeChecked lint tier auto-fixes a concrete `x as T` narrowing only nullability into `x!`, which `no-non-null-assertion` then bans outright -- a generic assertion (T unresolved at this call) doesn't match that autofix's own pattern, so it stays exactly the cast it is.
function definiteAt<T>(array: readonly T[], index: number): T {
  return array[index] as T;
}

// Whichever of a shape's own four insets differs from the default its own picture-ness implies (zero on every side for a picture, the standard 0.1in/0.05in pair otherwise -- read.ts's insetsForShape states the identical default pair for the identical reason). A shape stating exactly the applicable default writes no inset property at all, matching a real producer's own habit of only emitting what a shape actually overrides.
function insetProperties(
  shape: ContentShape,
  isPicture: boolean,
): WritableShapeProperty[] {
  const defaultLeftRight = isPicture ? 0 : DEFAULT_INSET_LEFT_RIGHT_PT;
  const defaultTopBottom = isPicture ? 0 : DEFAULT_INSET_TOP_BOTTOM_PT;
  const entries: WritableShapeProperty[] = [];
  if (shape.insetLeftPt !== defaultLeftRight) {
    entries.push({
      opid: PROPERTY_DX_TEXT_LEFT,
      op: pointsToEmu(shape.insetLeftPt),
    });
  }
  if (shape.insetTopPt !== defaultTopBottom) {
    entries.push({
      opid: PROPERTY_DY_TEXT_TOP,
      op: pointsToEmu(shape.insetTopPt),
    });
  }
  if (shape.insetRightPt !== defaultLeftRight) {
    entries.push({
      opid: PROPERTY_DX_TEXT_RIGHT,
      op: pointsToEmu(shape.insetRightPt),
    });
  }
  if (shape.insetBottomPt !== defaultTopBottom) {
    entries.push({
      opid: PROPERTY_DY_TEXT_BOTTOM,
      op: pointsToEmu(shape.insetBottomPt),
    });
  }
  return entries;
}

// The write-side mirror of drawing/shapes.ts: given a slide's ContentShape list, emits the [MS-ODRAW]/[MS-PPT] shape tree readDrawingShapes flattens back into PptShape[] -- one outermost patriarch group (the same fGroup|fPatriarch placeholder shape collectGroup/groupTransform special-case on read) followed by one plain OfficeArtSpContainer per content shape, each carrying a client anchor in slide coordinates, a property table when the shape states rotation or displays a picture, and, when the shape has text, an OfficeArtClientTextbox. Deliberately narrower than the read side's own coverage: every shape this writer emits is an ungrouped, unrotated-rectangle-in-slide-coordinates shape (an OfficeArtClientAnchor, never OfficeArtChildAnchor/OfficeArtFSPGR group nesting) -- see the package README's write-scope section.

// [MS-ODRAW] 2.2.40 OfficeArtFSP's flags word -- the same bits drawing/shapes.ts's FSP_GROUP/FSP_PATRIARCH name for reading.
const FSP_GROUP = 1 << 0;
const FSP_CHILD = 1 << 1;
// [MS-ODRAW] 2.2.40 bit 9: "this shape has an anchor to the parent" -- real producers set it on every anchored shape, the table group's own shape included.
const FSP_HAVE_ANCHOR = 1 << 9;
const FSP_PATRIARCH = 1 << 2;
// The patriarch's own shape id is always 1 ([MS-ODRAW] does not mandate this, but every real producer's outermost group shape is spid 1, and nothing in this reader's own drawing/shapes.ts inspects spid values at all -- see PptShape.spid's read-side comment); content shapes are numbered from 2, uniquely per slide, which is all readDrawingShapes/collectShape ever need of an spid.
const PATRIARCH_SPID = 1;
const FIRST_CONTENT_SPID = 2;

function writeFsp(spid: number, flags: number): Uint8Array<ArrayBuffer> {
  return writeAtom(OfficeArtFSP, concatBytes(u32le(spid), u32le(flags)), {
    recVer: 0x2,
  });
}

// [MS-PPT] 2.7.1 OfficeArtClientAnchor: written as the 16-byte RectStruct form (recLen 0x10, four signed 32-bit coordinates) rather than the 8-byte SmallRectStruct -- unlike a captured real file, this writer has no reason to prefer the smaller form, and the 32-bit range removes any risk of a large slide's master-unit coordinates overflowing a 16-bit one. Field order matches readClientAnchor's "top-left" spelling: top, left, right, bottom.
function writeClientAnchor(
  xPt: number,
  yPt: number,
  widthPt: number,
  heightPt: number,
): Uint8Array<ArrayBuffer> {
  const left = pointsToMasterUnits(xPt);
  const top = pointsToMasterUnits(yPt);
  const right = pointsToMasterUnits(xPt + widthPt);
  const bottom = pointsToMasterUnits(yPt + heightPt);
  return writeAtom(
    OfficeArtClientAnchor,
    concatBytes(i32le(top), i32le(left), i32le(right), i32le(bottom)),
  );
}

function writeTextCharsAtom(text: string): Uint8Array<ArrayBuffer> {
  return writeAtom(RT_TextCharsAtom, utf16le(text));
}

// The shape's own primary property table ([MS-ODRAW] 2.2.9), written only when the shape states something it carries: rotation as the fixed-point ([MS-OSHARED] 2.2.1.6) value drawing/properties.ts converts whole degrees into, a picture's one-based blip-store reference with the fBid bit that says the value is a store index rather than a plain integer, and whichever of the four text insets the shape states beyond the default its own picture-ness implies.
function writeShapeProperties(
  shape: ContentShape,
  pib: number | undefined,
): Uint8Array<ArrayBuffer> | undefined {
  const entries: WritableShapeProperty[] = [];
  if (shape.rotationDeg !== undefined) {
    entries.push({
      opid: PROPERTY_ROTATION,
      op: degreesToFixedPoint(shape.rotationDeg),
    });
  }
  if (pib !== undefined) {
    entries.push({ opid: PROPERTY_PIB, op: pib, fBid: true });
  }
  entries.push(...insetProperties(shape, pib !== undefined));
  return entries.length === 0
    ? undefined
    : writeShapePropertyTable(OfficeArtFOPT, entries);
}

// The shape's own text, or undefined when it carries no paragraph block at all -- matching the reader's own optional clientTextbox rather than emitting an empty one nothing wrote.
function writeClientTextbox(
  textBlocks: readonly ContentBlock[],
  fontIndexOf: (family: string) => number,
): Uint8Array<ArrayBuffer> | undefined {
  if (textBlocks.length === 0) {
    return undefined;
  }
  const { text, style } = buildTextBody(textBlocks, fontIndexOf);
  return writeContainer(OfficeArtClientTextbox, [
    writeAtom(RT_TextHeaderAtom, u32le(TEXT_TYPE_OTHER)),
    writeTextCharsAtom(text),
    writeStyleTextPropAtom(style),
  ]);
}

function writeShape(
  spid: number,
  shape: ContentShape,
  pib: number | undefined,
  textBlocks: readonly ContentBlock[],
  fontIndexOf: (family: string) => number,
  clientData: Uint8Array<ArrayBuffer> | undefined,
): Uint8Array<ArrayBuffer> {
  const properties = writeShapeProperties(shape, pib);
  const clientTextbox = writeClientTextbox(textBlocks, fontIndexOf);
  // [MS-ODRAW] 2.2.14's own child order: shapeProp (OfficeArtFSP) first, then the property tables, then the anchor, then clientData, then clientTextbox -- each table before the anchor it qualifies, exactly where every producer this package has been checked against puts it.
  const children = [writeFsp(spid, 0)];
  if (properties !== undefined) {
    children.push(properties);
  }
  children.push(
    writeClientAnchor(
      shape.frame.xPt,
      shape.frame.yPt,
      shape.frame.widthPt,
      shape.frame.heightPt,
    ),
  );
  if (clientData !== undefined) {
    children.push(clientData);
  }
  if (clientTextbox !== undefined) {
    children.push(clientTextbox);
  }
  return writeContainer(OfficeArtSpContainer, children);
}

// The outermost group every real drawing carries: an OfficeArtSpContainer holding only an OfficeArtFSPGR (a degenerate coordinate system, never read for the patriarch -- groupTransform returns the parent transform unchanged whenever FSP_PATRIARCH is set) and an FSP with fGroup|fPatriarch set. [MS-ODRAW] 2.2.16: "the first child of a group container is always the OfficeArtSpContainer holding that group's own shape information" -- collectGroup relies on this exact position.
function writePatriarch(): Uint8Array<ArrayBuffer> {
  return writeContainer(OfficeArtSpContainer, [
    writeAtom(OfficeArtFSPGR, new Uint8Array(16), { recVer: 0x1 }),
    writeFsp(PATRIARCH_SPID, FSP_GROUP | FSP_PATRIARCH),
  ]);
}

// A shape plus the host-side fact a drawing cannot derive for itself: the OfficeArtClientData record it carries (a main master's PlaceholderAtom). A picture's blip-store reference is not one of these -- planShapeBlocks resolves it from the shape's own image blocks through the context's blipIndexOf, so the pib a shape writes and the image block it came from can never disagree.
export interface DrawingShape {
  readonly shape: ContentShape;
  readonly clientData: Uint8Array<ArrayBuffer> | undefined;
}

// What one drawing's writing produced, beyond its bytes: the facts the document-wide OfficeArtFDGG states and this writer derives rather than guesses. shapeCount is every OfficeArtSpContainer the drawing carries, the patriarch included (2.2.47's cspSaved counts "the total number of shapes that have been saved in all of the drawings"); maxSpid is the highest shape identifier minted (2.2.47's spidMax is "the current maximum shape identifier that is used", not the next available).
export interface DrawingWritten {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly shapeCount: number;
  readonly maxSpid: number;
}

// Everything a drawing's writer needs from the document around it: the font resolver the text body shares, the blip-store resolver that assigns a picture its one-based pib (called only for an image whose format this writer can blip -- png or jpeg), the diagnostic sink every deliberate drop fires through, whether a whole-block drop should throw instead of merely reporting (see reportDrop below), and a human name for where this drawing sits, so a drop message says "slide 2" rather than an index the caller has to decode.
export interface DrawingWriteContext {
  readonly fontIndexOf: (family: string) => number;
  readonly blipIndexOf: (image: ContentImageBlock) => number;
  readonly sink: PptDiagnosticSink;
  readonly strict: boolean;
  readonly location: string;
}

// The one place a whole-block drop (a block that does not appear in the written output at all -- BLOCK_DROPPED, IMAGE_DROPPED) decides between WritePptOptions' two policies: reported through the sink alone (the default, matching every existing caller's own current behaviour), or reported AND thrown as a PptUnsupportedContentError, for a caller that would rather fail the whole conversion than ship a file quietly missing content it asked for. A lossy-but-still-written narrowing (TABLE_SPAN_DROPPED, a merged cell writing one column/row wide rather than vanishing) is never routed through this: it is a fidelity approximation, not an omission, and always stays sink-only regardless of the caller's policy.
function reportDrop(
  context: DrawingWriteContext,
  diagnostic: PptDiagnostic,
): void {
  context.sink(diagnostic);
  if (context.strict) {
    throw new PptUnsupportedContentError(diagnostic.message);
  }
}

// The image formats MSOBLIPTYPE gives this writer a blip record for are exactly isBlipFormat's two -- the same vocabulary drawing/blips.ts reads with, so a written picture always reads back as the same image.

// One shape's blocks, partitioned the way the writer genuinely treats them, so the drop diagnostics and the write itself can never disagree: paragraph blocks become the text body, the first png/jpeg image becomes the shape's single blip reference, the first table block turns the whole shape into a table group, an embeddedObject block is silently skipped when `hasOleClientData` says write.ts's own OLE plan already turned it into a real ExObjRefAtom (naming it here too would be a false "dropped" diagnostic for content that was genuinely written), and everything else -- an image whose format has no MSOBLIPTYPE token here, a second image beyond the one pib a shape carries, a second table, an embeddedObject block no OLE plan claimed (no serialiser port, or one that declined this document), and every block kind with no [MS-PPT] spelling this writer produces -- is dropped, with a diagnostic naming it. When a table is present the shape is a table group and carries no text body or blip of its own, so any paragraph or image collected before the table is dropped too, each named through the same sink. Keeping the partition in one place is what makes the diagnostic honest: there is no second filter elsewhere that could silently spare or spare-drop a block this function classified differently.
function planShapeBlocks(
  blocks: readonly ContentBlock[],
  context: DrawingWriteContext,
  hasOleClientData: boolean,
): {
  readonly pib: number | undefined;
  readonly textBlocks: readonly ContentBlock[];
  readonly table: ContentTable | undefined;
} {
  const textBlocks: ContentBlock[] = [];
  let pib: number | undefined;
  let table: ContentTable | undefined;
  const drop = (block: ContentBlock, reason: string): void => {
    reportDrop(context, {
      code: PptDiagnosticCodes.BLOCK_DROPPED,
      severity: "warning",
      message: `${context.location}: ${reason}`,
    });
  };
  for (const block of blocks) {
    if (block.kind === "embeddedObject" && hasOleClientData) {
      continue;
    }
    if (block.kind === "paragraph") {
      textBlocks.push(block);
      continue;
    }
    if (block.kind === "image") {
      if (!isBlipFormat(block.format)) {
        reportDrop(context, {
          code: PptDiagnosticCodes.IMAGE_DROPPED,
          severity: "warning",
          message: `${context.location}: an image block in format '${block.format}' is dropped; MSOBLIPTYPE gives this writer a blip record for PNG and JPEG only`,
        });
        continue;
      }
      if (pib !== undefined) {
        reportDrop(context, {
          code: PptDiagnosticCodes.IMAGE_DROPPED,
          severity: "warning",
          message: `${context.location}: a second image block is dropped; a shape carries exactly one blip-store reference, and an earlier image already consumed it`,
        });
        continue;
      }
      pib = context.blipIndexOf(block);
      continue;
    }
    if (block.kind === "table") {
      if (table !== undefined) {
        drop(
          block,
          "a second 'table' block is dropped; a shape becomes one table group, and an earlier table already did",
        );
        continue;
      }
      table = block;
      continue;
    }
    drop(
      block,
      `a '${block.kind}' block is dropped; this writer produces no [MS-PPT] spelling for it`,
    );
  }
  if (table !== undefined) {
    for (const block of textBlocks) {
      drop(
        block,
        "a 'paragraph' block is dropped; a shape carrying a table becomes a table group, which holds its text in cells rather than a text body of its own",
      );
    }
    if (pib !== undefined) {
      reportDrop(context, {
        code: PptDiagnosticCodes.IMAGE_DROPPED,
        severity: "warning",
        message: `${context.location}: an image block is dropped; a shape carrying a table becomes a table group, which has no blip reference of its own`,
      });
    }
    return { pib: undefined, textBlocks: [], table };
  }
  return { pib, textBlocks, table };
}

// A table's row heights in master units, for the tableRowProperties IMsoArray: every row stating a heightPt states its own minimum height, and the rows stating none share what remains of the table's own height equally -- the neutral division that adds no information the input did not give, where inventing per-row values would.
function tableRowHeights(
  table: ContentTable,
  frameHeightMasterUnits: number,
): number[] {
  const stated = table.rows.map((row) =>
    row.heightPt === undefined ? undefined : pointsToMasterUnits(row.heightPt),
  );
  const unstatedCount = stated.filter((height) => height === undefined).length;
  // No separate unstatedCount === 0 branch: `shared` below divides by zero when there is nothing left unstated (an Infinity/NaN value), but that value is never read in that case, since `?? shared` only ever substitutes for an element that actually is undefined, and none are when unstatedCount is 0.
  const remaining =
    frameHeightMasterUnits -
    stated.reduce<number>((sum, height) => sum + (height ?? 0), 0);
  const shared = Math.max(1, Math.round(remaining / unstatedCount));
  return stated.map((height) => height ?? shared);
}

// A table group, in the spelling a real PowerPoint-authored file carries (confirmed by inspecting Microsoft Office PowerPoint's own output, Apache POI's table_test.ppt fixture): the group shape opens with the FSPGR child coordinate system ([MS-ODRAW] 2.2.14 puts shapeGroup first), carries fGroup, states tableProperties fIsTable plus tableRowProperties as a complex IMsoArray of row minimum heights in the tertiary property table, and anchors the whole table with a client anchor whose rectangle is the FSPGR's own -- an identity mapping, so the cells' child anchors read as slide coordinates directly; then one plain text-box shape per cell, each carrying fChild and an OfficeArtChildAnchor at its grid position. Cell geometry is derived from the table's own frame, the column widths, and the row heights -- the same derivation read.ts's tableBlockFor reverses, so the grid this writer lays out is exactly the grid that reads back.
function writeTableGroup(
  spid: number,
  shape: ContentShape,
  table: ContentTable,
  context: DrawingWriteContext,
): { readonly bytes: Uint8Array<ArrayBuffer>; readonly shapeCount: number } {
  const { frame } = shape;
  const rowHeights = tableRowHeights(
    table,
    pointsToMasterUnits(frame.heightPt),
  );
  // The grid's column widths in master units: the declared widths, extended past the declared count by repeating the last one so a ragged row's extra cells continue the grid rightward rather than collapsing onto earlier columns (which would silently overwrite them on read, since the reader places a cell by its left edge). A table declaring no widths at all divides its own frame equally.
  const declaredWidths = table.columnWidthsPt.map(pointsToMasterUnits);
  // Seeded at 1 so even a table with no rows and no declared widths derives a one-column grid rather than an empty one.
  const cellCount = Math.max(
    1,
    ...table.rows.map((row) => row.cells.length),
    declaredWidths.length,
  );
  const lastDeclared = declaredWidths.at(-1);
  const equalShare = Math.max(
    1,
    Math.round(pointsToMasterUnits(frame.widthPt) / cellCount),
  );
  const columnWidthsMasterUnits = Array.from(
    { length: cellCount },
    (_, index) => declaredWidths[index] ?? lastDeclared ?? equalShare,
  );
  const columnBoundaries: number[] = [];
  let columnEdge = pointsToMasterUnits(frame.xPt);
  for (const width of columnWidthsMasterUnits) {
    columnBoundaries.push(columnEdge);
    columnEdge += width;
  }
  columnBoundaries.push(columnEdge);
  const rowBoundaries: number[] = [];
  let rowEdge = pointsToMasterUnits(frame.yPt);
  for (const height of rowHeights) {
    rowBoundaries.push(rowEdge);
    rowEdge += height;
  }
  rowBoundaries.push(rowEdge);
  const rowHeightsPayload = writeIMsoArray(rowHeights, 4);
  // The FSPGR states the table's own slide-coordinate rectangle, and the client anchor states the same rectangle -- the identity mapping real PowerPoint writes, so the cells' child anchors are their slide positions.
  const tableLeft = pointsToMasterUnits(frame.xPt);
  const tableTop = pointsToMasterUnits(frame.yPt);
  const tableRight = pointsToMasterUnits(frame.xPt + frame.widthPt);
  const tableBottom = pointsToMasterUnits(frame.yPt + frame.heightPt);
  const groupShape = writeContainer(OfficeArtSpContainer, [
    writeAtom(
      OfficeArtFSPGR,
      concatBytes(
        i32le(tableLeft),
        i32le(tableTop),
        i32le(tableRight),
        i32le(tableBottom),
      ),
      { recVer: 0x1 },
    ),
    writeFsp(spid, FSP_GROUP | FSP_HAVE_ANCHOR),
    ...(shape.rotationDeg === undefined
      ? []
      : [
          writeShapePropertyTable(OfficeArtFOPT, [
            {
              opid: PROPERTY_ROTATION,
              op: degreesToFixedPoint(shape.rotationDeg),
            },
          ]),
        ]),
    writeShapePropertyTable(OfficeArtTertiaryFOPT, [
      { opid: PROPERTY_TABLE_PROPERTIES, op: TABLE_FLAG_IS_TABLE },
      {
        opid: PROPERTY_TABLE_ROW_PROPERTIES,
        op: rowHeightsPayload.length,
        // fBid is set alongside fComplex because the real producer sets both together here (Microsoft Office PowerPoint's own table writes do exactly this, confirmed by inspecting its raw bytes) and LibreOffice's import only finds the row-height payload on a property marked fBid -- without it the group imports as plain grouped shapes rather than a table.
        fBid: true,
        complex: rowHeightsPayload,
      },
    ]),
    writeClientAnchor(frame.xPt, frame.yPt, frame.widthPt, frame.heightPt),
  ]);
  let cellSpid = spid + 1;
  const cellShapes = table.rows.flatMap((row, rowIndex) =>
    row.cells.map((cell, columnIndex) => {
      // columnIndex is always < cellCount (cellCount is derived as the max of every row's own cell count) and rowIndex always < table.rows.length (rowHeights carries exactly one entry per row), so columnBoundaries/rowBoundaries -- each one element longer than the count they bound -- always have both `[index]` and `[index + 1]` defined for a real cell. TypeScript's indexed-access typing cannot see that derivation across the two arrays, so this asserts it once, by construction, rather than guarding against an out-of-range case no real table can produce.
      const cellLeft = definiteAt(columnBoundaries, columnIndex);
      const cellRight = definiteAt(columnBoundaries, columnIndex + 1);
      const cellTop = definiteAt(rowBoundaries, rowIndex);
      const cellBottom = definiteAt(rowBoundaries, rowIndex + 1);
      if (cell.colSpan !== undefined && cell.colSpan > 1) {
        context.sink({
          code: PptDiagnosticCodes.TABLE_SPAN_DROPPED,
          severity: "warning",
          message: `${context.location}: a table cell's colSpan ${String(cell.colSpan)} is dropped; a PowerPoint 97-2003 table is a strict grid of shapes with no merge records, so the cell is written one column wide`,
        });
      }
      if (cell.rowSpan !== undefined && cell.rowSpan > 1) {
        context.sink({
          code: PptDiagnosticCodes.TABLE_SPAN_DROPPED,
          severity: "warning",
          message: `${context.location}: a table cell's rowSpan ${String(cell.rowSpan)} is dropped; a PowerPoint 97-2003 table is a strict grid of shapes with no merge records, so the cell is written one row tall`,
        });
      }
      for (const block of cell.blocks) {
        if (block.kind !== "paragraph") {
          reportDrop(context, {
            code: PptDiagnosticCodes.BLOCK_DROPPED,
            severity: "warning",
            message: `${context.location}: a '${block.kind}' block inside a table cell is dropped; a table cell in this format is a plain text-box shape with no property table or object reference of its own`,
          });
        }
      }
      // writeClientTextbox's own buildTextBody already filters to paragraph blocks internally (the same call every non-table shape makes with its own unfiltered block list), so filtering here first would only be a second, redundant copy of that exact check.
      const textbox = writeClientTextbox(cell.blocks, context.fontIndexOf);
      const children = [
        // fChild ([MS-ODRAW] 2.2.40): the cell belongs to the table's group, and its anchor is a child anchor in the group's own coordinate space.
        writeFsp(cellSpid, FSP_CHILD),
        writeAtom(
          OfficeArtChildAnchor,
          // OfficeArtChildAnchor 2.2.39: xLeft, yTop, xRight, yBottom -- the left-top order, unlike a client anchor's top-left one.
          concatBytes(
            i32le(cellLeft),
            i32le(cellTop),
            i32le(cellRight),
            i32le(cellBottom),
          ),
        ),
      ];
      cellSpid += 1;
      if (textbox !== undefined) {
        children.push(textbox);
      }
      return writeContainer(OfficeArtSpContainer, children);
    }),
  );
  return {
    bytes: writeContainer(OfficeArtSpgrContainer, [groupShape, ...cellShapes]),
    // The group shape itself plus one shape per cell.
    shapeCount: 1 + table.rows.reduce((sum, row) => sum + row.cells.length, 0),
  };
}

function writeDrawing(
  shapes: readonly DrawingShape[],
  context: DrawingWriteContext,
): DrawingWritten {
  // Spids are minted contiguously across every shape this drawing writes -- a plain shape takes one, a table group takes one for its group shape and one per cell -- so the identifier space and the shape count stay derived from the same walk.
  let nextSpid = FIRST_CONTENT_SPID;
  let shapeCount = 1; // the patriarch
  const shapeContainers: Uint8Array<ArrayBuffer>[] = [];
  for (const entry of shapes) {
    const plan = planShapeBlocks(
      entry.shape.blocks,
      context,
      entry.clientData !== undefined,
    );
    if (plan.table !== undefined) {
      const group = writeTableGroup(nextSpid, entry.shape, plan.table, context);
      nextSpid += group.shapeCount;
      shapeCount += group.shapeCount;
      shapeContainers.push(group.bytes);
      continue;
    }
    shapeContainers.push(
      writeShape(
        nextSpid,
        entry.shape,
        plan.pib,
        plan.textBlocks,
        context.fontIndexOf,
        entry.clientData,
      ),
    );
    nextSpid += 1;
    shapeCount += 1;
  }
  return {
    bytes: writeContainer(RT_Drawing, [
      writeContainer(OfficeArtDgContainer, [
        writeContainer(OfficeArtSpgrContainer, [
          writePatriarch(),
          ...shapeContainers,
        ]),
      ]),
    ]),
    shapeCount,
    maxSpid: Math.max(PATRIARCH_SPID, nextSpid - 1),
  };
}

// One slide's whole DrawingContainer: a single OfficeArtDgContainer holding one OfficeArtSpgrContainer (the patriarch group plus every content shape as its siblings) -- the same shape readDrawingShapes' top-level walk expects (one OfficeArtSpgrContainer collected via collectGroup, IDENTITY transform).
export function writeSlideDrawing(
  shapes: readonly DrawingShape[],
  context: DrawingWriteContext,
): DrawingWritten {
  return writeDrawing(shapes, context);
}
