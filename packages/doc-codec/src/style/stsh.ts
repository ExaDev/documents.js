import { readInt16LE, readUint16LE, slice } from "../bytes";
import { DocFormatError } from "../errors";

// The style sheet, [MS-DOC] 2.9.271 -- a size-prefixed header followed by one entry per style, indexed by istd. This reader takes each style's identity from it (its name, its kind, and the style it inherits from) and deliberately not its property sets: those live in the STD's grLPUpxSw, whose shape varies by style kind and whose values would then have to be resolved up an inheritance chain before a paragraph's own exceptions were layered on. That is a genuine layer of the format this package has not built, and the consequence is stated plainly in the README rather than approximated here.
//
// Two sizing rules make the entry array walkable and are easy to skip past. cbStshi gives the header's total size, and it is the only safe way forward: the header ends with an explicitly ignorable STSHIB whose length is not otherwise derivable, so a reader that adds up the fields it knows lands short. And every LPStd begins on an even byte, with the padding excluded from cbStd -- "LPStd structures are stored on even-byte boundaries, but this length MUST NOT include this padding" -- so an odd-length entry is followed by one byte belonging to no entry.

/** Stshif is a fixed 18 bytes: cstd, cbSTDBaseInFile, a bit field, stiMaxWhenSaved, istdMaxFixedWhenSaved, nVerBuiltInNamesWhenSaved, and the three default font indexes. */
const STSHIF_SIZE = 18;
/** Stshif.cbSTDBaseInFile "MUST be 0x000A when the Stdf structure does not contain an StdfPost2000 structure and MUST be 0x0012 when [it] does". */
const STDF_SIZE_WITHOUT_POST_2000 = 0x000a;
const STDF_SIZE_WITH_POST_2000 = 0x0012;
/** StdfBase.sti's "0x0FFE for user-defined styles"; anything else is an application-defined style whose sti identifies it. */
export const STI_USER_DEFINED = 0x0ffe;

/** StdfBase.stk, [MS-DOC] 2.9.269 -- which of ECMA-376's ST_StyleType values this style is. */
export const STK = {
  paragraph: 1,
  character: 2,
  table: 3,
  numbering: 4,
} as const;

export interface Style {
  /** The style's index in STSH.rglpstd, which is what sprmPIstd and sprmCIstd name. */
  readonly istd: number;
  /** The invariant application-defined style identifier, or STI_USER_DEFINED for a style the document itself defines. */
  readonly sti: number;
  readonly stk: number;
  /** The istd this style inherits from, or undefined when StdfBase.istdBase is 0x0FFF ("this style does not inherit from any other style"). */
  readonly istdBase: number | undefined;
  /** The style's primary name, from the STD's own Xstz. */
  readonly name: string;
}

export interface StyleSheet {
  /** Indexed by istd; a hole is a slot [MS-DOC] permits to be empty ("A style definition can be empty, in which case cbStd MUST be 0"). */
  readonly styles: readonly (Style | undefined)[];
}

/** StdfBase.istdBase's "0x0FFF if this style does not inherit from any other style". */
const ISTD_BASE_NONE = 0x0fff;

export function parseStsh(stsh: Uint8Array): StyleSheet {
  const cbStshi = readUint16LE(stsh, 0);
  const stshi = slice(stsh, 2, cbStshi, "STSH.lpstshi.stshi");
  if (stshi.length < STSHIF_SIZE) {
    throw new DocFormatError(
      `STSHI is ${stshi.length} bytes, shorter than the fixed ${STSHIF_SIZE}-byte Stshif it must begin with`,
    );
  }
  const cstd = readUint16LE(stshi, 0);
  const cbStdBaseInFile = readUint16LE(stshi, 2);
  if (
    cbStdBaseInFile !== STDF_SIZE_WITHOUT_POST_2000 &&
    cbStdBaseInFile !== STDF_SIZE_WITH_POST_2000
  ) {
    throw new DocFormatError(
      `Stshif.cbSTDBaseInFile is 0x${cbStdBaseInFile.toString(16)}, neither of the two sizes [MS-DOC] permits for an Stdf (0x000A without an StdfPost2000, 0x0012 with one)`,
    );
  }

  const styles: (Style | undefined)[] = [];
  let cursor = 2 + cbStshi;
  for (let istd = 0; istd < cstd; istd += 1) {
    const cbStd = readInt16LE(stsh, cursor);
    if (cbStd < 0) {
      throw new DocFormatError(
        `LPStd for istd ${istd} declares cbStd ${cbStd}; [MS-DOC] requires it not to be less than 0`,
      );
    }
    const std = slice(stsh, cursor + 2, cbStd, `STD for istd ${istd}`);
    styles.push(cbStd === 0 ? undefined : parseStd(std, istd, cbStdBaseInFile));
    // The entry's own bytes, then the padding byte an odd length needs to put the next entry on an even boundary.
    cursor += 2 + cbStd + (cbStd % 2);
  }
  return { styles };
}

function parseStd(
  std: Uint8Array,
  istd: number,
  cbStdBaseInFile: number,
): Style {
  // StdfBase, the first 10 bytes of every Stdf, packed least-significant-field-first within each little-endian 16-bit word: sti occupies the low 12 bits of the first, stk the low 4 of the second with istdBase in the remaining 12, and cupx/istdNext the same split in the third.
  const word0 = readUint16LE(std, 0);
  const word1 = readUint16LE(std, 2);
  const istdBase = (word1 >> 4) & 0x0fff;

  return {
    istd,
    sti: word0 & 0x0fff,
    stk: word1 & 0x000f,
    istdBase: istdBase === ISTD_BASE_NONE ? undefined : istdBase,
    name: readXstz(std, cbStdBaseInFile, `name of the style at istd ${istd}`),
  };
}

// Xstz, [MS-DOC] 2.9.351: an Xst -- a 2-byte character count followed by that many 16-bit code units -- then a 2-byte null terminator. The count is of CHARACTERS, not bytes, so the string occupies twice as many bytes as it declares.
function readXstz(bytes: Uint8Array, offset: number, what: string): string {
  const cch = readUint16LE(bytes, offset);
  const chars = slice(bytes, offset + 2, cch * 2, what);
  let out = "";
  for (let index = 0; index < cch; index += 1) {
    out += String.fromCharCode(readUint16LE(chars, index * 2));
  }
  return out;
}

// The heading level a paragraph style index implies, per sprmPIstd's own statement: "An istd value in the range of 1 to 9, inclusive, also specifies the outline level of the paragraph ... where the new outline level is equal to the value of the istd minus 1." Outline level is zero-based and the shared schema's headingLevel is one-based, so the two cancel and the istd is the heading level directly.
//
// This is deliberately derived from the istd rather than from the style's name: a document's own "Heading 1" may be renamed, localised, or absent from the style sheet entirely, but the istd-to-outline-level rule is stated normatively by the format and holds regardless.
export function headingLevelFromIstd(istd: number): number | undefined {
  return istd >= 1 && istd <= 9 ? istd : undefined;
}
