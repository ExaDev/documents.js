import type {
  ContentBlock,
  ContentImageBlock,
  ContentShape,
} from "document-schema.js";
import { buildTextBody } from "../content-write";
import { isBlipFormat } from "./blips";
import { type PptDiagnosticSink, PptDiagnosticCodes } from "../diagnostics";
import {
  concatBytes,
  i32le,
  u32le,
  utf16le,
  writeAtom,
  writeContainer,
} from "../record/write";
import {
  OfficeArtClientAnchor,
  OfficeArtClientTextbox,
  OfficeArtDgContainer,
  OfficeArtFOPT,
  OfficeArtFSP,
  OfficeArtFSPGR,
  OfficeArtSpContainer,
  OfficeArtSpgrContainer,
  RT_Drawing,
  RT_TextCharsAtom,
  RT_TextHeaderAtom,
} from "../record/types";
import {
  PROPERTY_PIB,
  PROPERTY_ROTATION,
  type WritableShapeProperty,
  degreesToFixedPoint,
  writeShapePropertyTable,
} from "./properties";
import { TEXT_TYPE_OTHER, characterCountOf } from "../text/atoms";
import { writeStyleTextPropAtom } from "../text/style-write";
import { pointsToMasterUnits } from "../units";

// The write-side mirror of drawing/shapes.ts: given a slide's ContentShape list, emits the [MS-ODRAW]/[MS-PPT] shape tree readDrawingShapes flattens back into PptShape[] -- one outermost patriarch group (the same fGroup|fPatriarch placeholder shape collectGroup/groupTransform special-case on read) followed by one plain OfficeArtSpContainer per content shape, each carrying a client anchor in slide coordinates, a property table when the shape states rotation or displays a picture, and, when the shape has text, an OfficeArtClientTextbox. Deliberately narrower than the read side's own coverage: every shape this writer emits is an ungrouped, unrotated-rectangle-in-slide-coordinates shape (an OfficeArtClientAnchor, never OfficeArtChildAnchor/OfficeArtFSPGR group nesting) -- see the package README's write-scope section.

// [MS-ODRAW] 2.2.40 OfficeArtFSP's flags word -- the same two bits drawing/shapes.ts's FSP_GROUP/FSP_PATRIARCH name for reading.
const FSP_GROUP = 1 << 0;
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

// The shape's own primary property table ([MS-ODRAW] 2.2.9), written only when the shape states something it carries: rotation as the fixed-point ([MS-OSHARED] 2.2.1.6) value drawing/properties.ts converts whole degrees into, and a picture's one-based blip-store reference with the fBid bit that says the value is a store index rather than a plain integer.
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
  // characterCountOf/the run counts buildTextBody produced must agree, or the atom this writes could never be read back by readStyleTextPropAtom's own characterCount-driven termination -- asserted here rather than trusted, since it is the one invariant the whole run-count design in content-write.ts depends on.
  const totalParagraphCount = style.paragraphRuns.reduce(
    (sum, run) => sum + run.count,
    0,
  );
  if (totalParagraphCount !== characterCountOf(text)) {
    throw new Error(
      `internal error: built ${totalParagraphCount} characters of paragraph runs for a ${characterCountOf(text)}-character text body`,
    );
  }
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

// Everything a drawing's writer needs from the document around it: the font resolver the text body shares, the blip-store resolver that assigns a picture its one-based pib (called only for an image whose format this writer can blip -- png or jpeg), the diagnostic sink every deliberate drop fires through, and a human name for where this drawing sits, so a drop message says "slide 2" rather than an index the caller has to decode.
export interface DrawingWriteContext {
  readonly fontIndexOf: (family: string) => number;
  readonly blipIndexOf: (image: ContentImageBlock) => number;
  readonly sink: PptDiagnosticSink;
  readonly location: string;
}

// The image formats MSOBLIPTYPE gives this writer a blip record for are exactly isBlipFormat's two -- the same vocabulary drawing/blips.ts reads with, so a written picture always reads back as the same image.

// One shape's blocks, partitioned the way the writer genuinely treats them, so the drop diagnostics and the write itself can never disagree: paragraph blocks become the text body, the first png/jpeg image becomes the shape's single blip reference, and everything else -- an image whose format has no MSOBLIPTYPE token here, a second image beyond the one pib a shape carries, and every block kind with no [MS-PPT] spelling this writer produces -- is dropped, with a diagnostic naming it. Keeping the partition in one place is what makes the diagnostic honest: there is no second filter elsewhere that could silently spare or spare-drop a block this function classified differently.
function planShapeBlocks(
  blocks: readonly ContentBlock[],
  context: DrawingWriteContext,
): {
  readonly pib: number | undefined;
  readonly textBlocks: readonly ContentBlock[];
} {
  const textBlocks: ContentBlock[] = [];
  let pib: number | undefined;
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      textBlocks.push(block);
      continue;
    }
    if (block.kind === "image") {
      if (!isBlipFormat(block.format)) {
        context.sink({
          code: PptDiagnosticCodes.IMAGE_DROPPED,
          severity: "warning",
          message: `${context.location}: an image block in format '${block.format}' is dropped; MSOBLIPTYPE gives this writer a blip record for PNG and JPEG only`,
        });
        continue;
      }
      if (pib !== undefined) {
        context.sink({
          code: PptDiagnosticCodes.IMAGE_DROPPED,
          severity: "warning",
          message: `${context.location}: a second image block is dropped; a shape carries exactly one blip-store reference, and an earlier image already consumed it`,
        });
        continue;
      }
      pib = context.blipIndexOf(block);
      continue;
    }
    context.sink({
      code: PptDiagnosticCodes.BLOCK_DROPPED,
      severity: "warning",
      message: `${context.location}: a '${block.kind}' block is dropped; this writer produces no [MS-PPT] spelling for it`,
    });
  }
  return { pib, textBlocks };
}

function writeDrawing(
  shapes: readonly DrawingShape[],
  context: DrawingWriteContext,
): DrawingWritten {
  const shapeContainers = shapes.map((entry, index) => {
    const plan = planShapeBlocks(entry.shape.blocks, context);
    return writeShape(
      FIRST_CONTENT_SPID + index,
      entry.shape,
      plan.pib,
      plan.textBlocks,
      context.fontIndexOf,
      entry.clientData,
    );
  });
  return {
    bytes: writeContainer(RT_Drawing, [
      writeContainer(OfficeArtDgContainer, [
        writeContainer(OfficeArtSpgrContainer, [
          writePatriarch(),
          ...shapeContainers,
        ]),
      ]),
    ]),
    // Every shape container, the patriarch included.
    shapeCount: shapes.length + 1,
    // Spids run PATRIARCH_SPID then FIRST_CONTENT_SPID upward, so the last content shape minted the highest identifier.
    maxSpid:
      shapes.length === 0
        ? PATRIARCH_SPID
        : FIRST_CONTENT_SPID + shapes.length - 1,
  };
}

// One slide's whole DrawingContainer: a single OfficeArtDgContainer holding one OfficeArtSpgrContainer (the patriarch group plus every content shape as its siblings) -- the same shape readDrawingShapes' top-level walk expects (one OfficeArtSpgrContainer collected via collectGroup, IDENTITY transform).
export function writeSlideDrawing(
  shapes: readonly DrawingShape[],
  context: DrawingWriteContext,
): DrawingWritten {
  return writeDrawing(shapes, context);
}
