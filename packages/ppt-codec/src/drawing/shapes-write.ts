import type { ContentShape } from "document-schema.js";
import { buildTextBody } from "../content-write";
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
  OfficeArtFSP,
  OfficeArtFSPGR,
  OfficeArtSpContainer,
  OfficeArtSpgrContainer,
  RT_Drawing,
  RT_TextCharsAtom,
  RT_TextHeaderAtom,
} from "../record/types";
import { TEXT_TYPE_OTHER, characterCountOf } from "../text/atoms";
import { writeStyleTextPropAtom } from "../text/style-write";
import { pointsToMasterUnits } from "../units";

// The write-side mirror of drawing/shapes.ts: given a slide's ContentShape list, emits the [MS-ODRAW]/[MS-PPT] shape tree readDrawingShapes flattens back into PptShape[] -- one outermost patriarch group (the same fGroup|fPatriarch placeholder shape collectGroup/groupTransform special-case on read) followed by one plain OfficeArtSpContainer per content shape, each carrying a client anchor in slide coordinates and, when the shape has text, an OfficeArtClientTextbox. Deliberately narrower than the read side's own coverage: every shape this writer emits is a plain, ungrouped text box in slide coordinates (an OfficeArtClientAnchor, never OfficeArtChildAnchor/OfficeArtFSPGR group nesting) -- see the package README's write-scope section.

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

// The shape's own text, or undefined when it carries no paragraph block at all -- matching the reader's own optional clientTextbox rather than emitting an empty one nothing wrote.
function writeClientTextbox(
  shape: ContentShape,
  fontIndexOf: (family: string) => number,
): Uint8Array<ArrayBuffer> | undefined {
  const hasParagraph = shape.blocks.some((block) => block.kind === "paragraph");
  if (!hasParagraph) {
    return undefined;
  }
  const { text, style } = buildTextBody(shape.blocks, fontIndexOf);
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
  fontIndexOf: (family: string) => number,
): Uint8Array<ArrayBuffer> {
  const clientTextbox = writeClientTextbox(shape, fontIndexOf);
  const children = [
    writeFsp(spid, 0),
    writeClientAnchor(
      shape.frame.xPt,
      shape.frame.yPt,
      shape.frame.widthPt,
      shape.frame.heightPt,
    ),
  ];
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

// One slide's whole DrawingContainer: a single OfficeArtDgContainer holding one OfficeArtSpgrContainer (the patriarch group plus every content shape as its siblings) -- the same shape readDrawingShapes' top-level walk expects (one OfficeArtSpgrContainer collected via collectGroup, IDENTITY transform).
export function writeSlideDrawing(
  shapes: readonly ContentShape[],
  fontIndexOf: (family: string) => number,
): Uint8Array<ArrayBuffer> {
  const shapeContainers = shapes.map((shape, index) =>
    writeShape(FIRST_CONTENT_SPID + index, shape, fontIndexOf),
  );
  return writeContainer(RT_Drawing, [
    writeContainer(OfficeArtDgContainer, [
      writeContainer(OfficeArtSpgrContainer, [
        writePatriarch(),
        ...shapeContainers,
      ]),
    ]),
  ]);
}
