import { inflateSync } from "fflate";
import { base64ToBytes } from "byte-codec";
import { CORE_FONT_GLYPH_ORDERS_DEFLATED_BASE64 } from "./glyph-data/core-font-glyph-orders";

// The glyph order of the core faces producers most often embed (the Arial, Times New Roman and Courier New families), for a program that keeps a face's own glyph numbering but carries nothing that says what any glyph draws: no 'cmap', no glyph names. A composite font's CIDs then address glyphs whose characters only the face's published order states, and readers such as Acrobat carry the same knowledge for the same reason.
//
// Knowing the order by the face's name alone would be a guess the first time a subsetter renumbered the glyphs, a producer embedded another face under that name, or a release of the face moved one glyph. So each glyph is accepted only where the program's own advance width for it equals the face's (in the same units per em), which every one of those cases breaks: a renumbered or foreign program puts other widths at those glyph ids, and a glyph a release redrew to a different width stops matching. Compared across two releases of each of these faces, a few glyph ids per face changed advance width and every other glyph kept both its id and its width, so the check refuses those few and costs nothing else.
//
// The data is generated from installed copies of the faces by scripts/generate-core-font-glyph-orders.mjs, whose header describes the binary layout read below.

interface CoreFace {
  readonly unitsPerEm: number;
  // Per glyph id, the text the glyph draws, or undefined where the face states none.
  readonly texts: readonly (string | undefined)[];
  readonly advances: Uint16Array;
}

// Field sizes of the binary layout, in bytes.
const FACE_COUNT_SIZE = 2;
const NAME_LENGTH_SIZE = 1;
const FACE_HEADER_SIZE = 4; // unitsPerEm uint16, glyph count uint16
const CODE_POINT_COUNT_SIZE = 1;
const CODE_POINT_SIZE = 3; // uint24
const ADVANCE_SIZE = 2;
const BITS_PER_BYTE = 8;

let faces: ReadonlyMap<string, CoreFace> | undefined;

function readFaces(): ReadonlyMap<string, CoreFace> {
  if (faces !== undefined) {
    return faces;
  }
  const bytes = inflateSync(
    base64ToBytes(CORE_FONT_GLYPH_ORDERS_DEFLATED_BASE64),
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read = new Map<string, CoreFace>();
  let at = FACE_COUNT_SIZE;
  for (let face = 0; face < view.getUint16(0); face++) {
    const nameLength = view.getUint8(at);
    at += NAME_LENGTH_SIZE;
    const name = String.fromCharCode(...bytes.subarray(at, at + nameLength));
    at += nameLength;
    const unitsPerEm = view.getUint16(at);
    const glyphCount = view.getUint16(at + 2);
    at += FACE_HEADER_SIZE;
    const texts: (string | undefined)[] = [];
    const advances = new Uint16Array(glyphCount);
    for (let glyphId = 0; glyphId < glyphCount; glyphId++) {
      const codePointCount = view.getUint8(at);
      at += CODE_POINT_COUNT_SIZE;
      const codePoints: number[] = [];
      for (let i = 0; i < codePointCount; i++) {
        codePoints.push(
          (view.getUint8(at) << (2 * BITS_PER_BYTE)) | view.getUint16(at + 1),
        );
        at += CODE_POINT_SIZE;
      }
      texts.push(
        codePoints.length === 0
          ? undefined
          : String.fromCodePoint(...codePoints),
      );
      advances[glyphId] = view.getUint16(at);
      at += ADVANCE_SIZE;
    }
    read.set(name, { unitsPerEm, texts, advances });
  }
  faces = read;
  return read;
}

/**
 * The glyph order of a core face, checked glyph by glyph against the program that claims to be it.
 * @param postScriptName - the face's PostScript name without any subset tag, as the program's own 'name' table states it or, for a program with none, as the font dictionary's /BaseFont does
 * @param unitsPerEm - the program's own design grid; a program on another grid is not the face, whatever its name
 * @returns a lookup from a glyph id and the program's own advance width for that glyph to the character the face draws there, answering undefined wherever the width disagrees with the face's or the face draws no character; or undefined when the name is not a core face or the grid is not the face's
 */
export function coreFaceGlyphOrder(
  postScriptName: string,
  unitsPerEm: number,
): ((glyphId: number, advanceWidth: number) => string | undefined) | undefined {
  const face = readFaces().get(postScriptName);
  if (face?.unitsPerEm !== unitsPerEm) {
    return undefined;
  }
  return (glyphId, advanceWidth) =>
    face.advances[glyphId] === advanceWidth ? face.texts[glyphId] : undefined;
}
