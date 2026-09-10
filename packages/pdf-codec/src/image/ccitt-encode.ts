import {
  BLACK_TERMINATING_AND_MAKEUP,
  EXTENDED_MAKEUP,
  WHITE_TERMINATING_AND_MAKEUP,
} from "./ccitt";

// A hand-written CCITT Group 4 (ITU-T T.6, Modified Modified READ) fax ENCODER -- the inverse of ccitt.ts's decoder, consuming exactly the packed 1-bit-per-pixel bitmap that decoder produces (MSB first, each row padded to a whole byte, 0 = black and 1 = white under PDF's /BlackIs1-false convention). Like its sibling, this module has zero PDF knowledge: the caller (write.ts's image path) supplies plain geometry and gets plain bytes, and writes the /CCITTFaxDecode dictionary and /DecodeParms itself.
//
// The run-length code tables are NOT restated here: they are imported from ccitt.ts's own literal transcription (T.4 Tables 2/3/4), so encoder and decoder are built from one transcription and cannot drift apart. Only the two-dimensional mode codes are restated, because ccitt.ts types them for DECODING (a bit-string-keyed lookup of {kind, delta}) while encoding needs the reverse direction.
//
// The algorithm is T.6 clause 2.2's coding model exactly: for each line, against the previous line's changing elements, choose pass / vertical / horizontal mode per the standard's decision procedure. No EOLs are emitted (pure T.6), and the final byte is zero-padded -- both properties the decoder accepts by construction (it stops at the requested row count and ignores trailing pad bits).

// The per-colour terminating+makeup tables plus the shared extended makeups, inverted from [bits, run] to run -> bits. A run of length < 64 has exactly one terminating code; a longer run is one or more make-up codes (each a multiple of 64, up to 2560) followed by one terminating code for the remainder.
function buildRunCodes(
  table: readonly (readonly [string, number])[],
): ReadonlyMap<number, string> {
  const map = new Map<number, string>();
  for (const [bits, run] of table) {
    map.set(run, bits);
  }
  for (const [bits, run] of EXTENDED_MAKEUP) {
    if (!map.has(run)) {
      map.set(run, bits);
    }
  }
  return map;
}

const WHITE_RUN_CODES = buildRunCodes(WHITE_TERMINATING_AND_MAKEUP);
const BLACK_RUN_CODES = buildRunCodes(BLACK_TERMINATING_AND_MAKEUP);

// T.4 4.2.1.3.1's two-dimensional mode codes (reused unchanged by T.6): pass, horizontal, and vertical at each signed offset -3..3. Vertical is by far the common case -- "1" alone codes a1 exactly under b1 -- which is why G4 compresses line-art-like bilevel content far past what Flate achieves on the same pixels.
const PASS_MODE = "0001";
const HORIZONTAL_MODE = "001";
const VERTICAL_MODES: ReadonlyMap<number, string> = new Map([
  [0, "1"],
  [1, "011"],
  [-1, "010"],
  [2, "000011"],
  [-2, "000010"],
  [3, "0000011"],
  [-3, "0000010"],
]);

// The largest run length any make-up code names (T.4 Table 4 tops out at 2560); a longer run is coded as several make-ups then the terminating remainder.
const LARGEST_MAKEUP_RUN = 2560;
const MAKEUP_GRANULARITY = 64;

class BitWriter {
  private bytes: number[] = [];
  private current = 0;
  private used = 0;

  get byteLength(): number {
    return this.bytes.length;
  }

  writeBits(bits: string): void {
    for (const char of bits) {
      this.current = (this.current << 1) | (char === "1" ? 1 : 0);
      this.used++;
      if (this.used === 8) {
        this.bytes.push(this.current);
        this.current = 0;
        this.used = 0;
      }
    }
  }

  finish(): Uint8Array<ArrayBuffer> {
    if (this.used > 0) {
      // Zero-padding the final partial byte is what every real G4 producer does, and T.6 permits it: the decoder stops at the requested row count regardless.
      this.bytes.push(this.current << (8 - this.used));
    }
    return new Uint8Array(this.bytes);
  }
}

function writeRun(writer: BitWriter, run: number, white: boolean): void {
  const codes = white ? WHITE_RUN_CODES : BLACK_RUN_CODES;
  let remaining = run;
  while (remaining >= MAKEUP_GRANULARITY) {
    const makeup = Math.min(
      remaining - (remaining % MAKEUP_GRANULARITY),
      LARGEST_MAKEUP_RUN,
    );
    writer.writeBits(codes.get(makeup)!);
    remaining -= makeup;
  }
  writer.writeBits(codes.get(remaining)!);
}

// One row's changing elements: the positions where the pixel colour differs from the one before it, with an imaginary WHITE pixel before position 0 (T.6 2.2.1's own convention). Index parity in this array therefore encodes colour: element i is a transition INTO black when i is even, into white when odd -- the property the b1 lookup relies on.
function changingElements(
  bitmap: Uint8Array,
  rowByteOffset: number,
  columns: number,
): number[] {
  const changes: number[] = [];
  let previous = 1; // the imaginary white pixel before the row
  for (let x = 0; x < columns; x++) {
    const byte = bitmap[rowByteOffset + (x >> 3)] ?? 0;
    const pixel = (byte >> (7 - (x & 7))) & 1;
    if (pixel !== previous) {
      changes.push(x);
      previous = pixel;
    }
  }
  return changes;
}

export interface EncodeCcittFaxOptions {
  readonly columns: number;
  readonly rows: number;
  // The encode-abort budget: the moment the emitted stream grows past this many bytes the encoder stops and answers undefined, because the caller is comparing against a rival encoding of that size and G4 can no longer win. Without it, an adversarial bilevel image (a checkerboard -- G4's worst case, where every run is 1 pixel and codes horizontally) makes the encoder emit a losing multi-megabyte candidate in full before the caller discards it.
  readonly maxBytes?: number;
}

// Encodes a packed 1-bpp bitmap (the decoder's own output layout) as a pure two-dimensional T.6 stream. The caller hands the geometry explicitly rather than deriving it from the bitmap because a PDF image's /Columns and /Rows are the authority the decoder will be given on the way back.
export function encodeCcittFax(
  bitmap: Uint8Array,
  options: EncodeCcittFaxOptions,
): Uint8Array<ArrayBuffer> | undefined {
  const { columns, rows, maxBytes } = options;
  if (columns <= 0 || rows <= 0) {
    return new Uint8Array(0);
  }
  const rowBytes = (columns + 7) >> 3;
  const writer = new BitWriter();
  // The reference line above the first row is T.6's imaginary all-white line: it has no changing element this side of the right edge, which the sentinel reads below spell as "columns".
  let reference: number[] = [];
  for (let y = 0; y < rows; y++) {
    const offset = y * rowBytes;
    const current = changingElements(bitmap, offset, columns);
    // Index of the next unconsumed changing element on each line; reading past the end answers "columns" (T.6 2.2.2's sentinel).
    let ci = 0;
    let ri = 0;
    const cur = (i: number): number => current[i] ?? columns;
    const ref = (i: number): number => reference[i] ?? columns;
    // a0 starts one position before the line with colour white (T.6 2.2.1's own initial condition).
    let a0 = -1;
    let white = true;
    while (a0 < columns) {
      if (maxBytes !== undefined && writer.byteLength > maxBytes) {
        return undefined;
      }
      const a1 = cur(ci);
      const a2 = cur(ci + 1);
      // Advance the reference index past everything at or left of a0 (a0 only moves right, so this is monotone).
      while (ri < reference.length && ref(ri) <= a0) {
        ri++;
      }
      // b1: the first reference element strictly right of a0 whose transition direction matches a1's -- INTO black while the a0-run is white, INTO white while it is black. Parity encodes direction; skip one element when the parity is wrong.
      let b1Index = ri;
      if (b1Index % 2 !== (white ? 0 : 1)) {
        b1Index++;
      }
      const b1 = ref(b1Index);
      const b2 = ref(b1Index + 1);
      if (b2 < a1) {
        // Pass mode: the reference run that starts at b1 ends before the current line's next change, so the current line's colour continues past it unchanged.
        writer.writeBits(PASS_MODE);
        a0 = b2;
      } else {
        const delta = a1 - b1;
        const vertical = VERTICAL_MODES.get(delta);
        if (vertical !== undefined) {
          // Vertical mode: a1 sits within 3 pixels of b1 and is coded by the offset alone.
          writer.writeBits(vertical);
          a0 = a1;
          ci++;
        } else {
          // Horizontal mode: the two runs a0..a1 and a1..a2 are coded explicitly, the first in the a0-run's own colour. The run starts at the first PIXEL, not at a0's imaginary initial position: a row that starts black has a zero-length leading white run, not a one-pixel one (T.6 2.2.1's imaginary a0 sits before the first pixel exactly so the run from it to a change at 0 is empty).
          writer.writeBits(HORIZONTAL_MODE);
          writeRun(writer, a1 - Math.max(a0, 0), white);
          writeRun(writer, a2 - a1, !white);
          a0 = a2;
          ci += 2;
        }
      }
      // The colour at the new a0 comes from the bitmap itself: index parity cannot state it once sentinel positions (a0 = columns, or an a2 past the last real change) enter, and recomputing from the pixels is the one rule that is right for all three modes.
      if (a0 < columns) {
        const byte = bitmap[offset + (a0 >> 3)] ?? 0;
        white = ((byte >> (7 - (a0 & 7))) & 1) === 1;
      }
    }
    reference = current;
  }
  return writer.finish();
}
