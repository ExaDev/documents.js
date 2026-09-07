import { readInt16LE, readUint16LE, slice } from "../bytes";
import { DocFormatError } from "../errors";
import { readGrpprl, type Prl } from "../prop/sprm";

// The style sheet, [MS-DOC] 2.9.271 -- a size-prefixed header followed by one entry per style, indexed by istd. This reader takes each style's identity from it (its name, its kind, and the style it inherits from) and, for a paragraph or character style, its own property set too: STD.grLPUpxSw, whose shape varies by style kind (parseGrLPUpxSw below) and whose values resolveStyleFormatting walks up the istdBase inheritance chain to fold, most-specific style winning, beneath a paragraph's or run's own direct exceptions (ExaDev/documents.js#1005). A table or numbering style's own formatting set (StkTableGRLPUPX/StkListGRLPUPX) is a genuine layer of the format this package has not built, and that consequence is stated plainly in the README rather than approximated here.
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
  /** The style's own paragraph formatting -- StkParaGRLPUPX's lpUpxPapx.PAPX.grpprlPapx -- present only for a paragraph style (STK.paragraph). Undefined for every other stk: table and numbering styles carry their own formatting shapes this package does not read (see the README's own scope note). */
  readonly grpprlPapx: readonly Prl[] | undefined;
  /** The style's own character formatting -- a paragraph style's StkParaGRLPUPX.lpUpxChpx.CHPX.grpprlChpx (the run-level defaults a heading's own text falls back to) or a character style's StkCharGRLPUPX.lpUpxChpx.CHPX.grpprlChpx -- present for STK.paragraph and STK.character, undefined otherwise. */
  readonly grpprlChpx: readonly Prl[] | undefined;
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
  const stk = word1 & 0x000f;

  const name = readXstz(
    std,
    cbStdBaseInFile,
    `name of the style at istd ${istd}`,
  );
  const grLPUpxSwOffset =
    cbStdBaseInFile + xstzByteLength(std, cbStdBaseInFile);
  const { grpprlPapx, grpprlChpx } = parseGrLPUpxSw(
    std,
    grLPUpxSwOffset,
    stk,
    istd,
  );

  return {
    istd,
    sti: word0 & 0x0fff,
    stk,
    istdBase: istdBase === ISTD_BASE_NONE ? undefined : istdBase,
    name,
    grpprlPapx,
    grpprlChpx,
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

// The Xstz's own total byte length -- the 2-byte character count, the characters themselves (2 bytes each), and the 2-byte null terminator that follows them -- so a caller can find whatever comes after it (STD's own grLPUpxSw) without re-deriving the same arithmetic readXstz already did to produce the string.
function xstzByteLength(bytes: Uint8Array, offset: number): number {
  const cch = readUint16LE(bytes, offset);
  return 2 + cch * 2 + 2;
}

// One LPUpxPapx/LPUpxChpx entry, [MS-DOC] 2.9.140/2.9.138: a 2-byte cbUpx giving the UPX's own length (excluding padding), followed by that many bytes, followed by one zero byte of padding if cbUpx is odd -- "This structure is padded to an even length, but the length in cbUpx MUST NOT include this padding."
function readLpUpx(
  std: Uint8Array,
  offset: number,
  what: string,
): { readonly upx: Uint8Array; readonly next: number } {
  const cbUpx = readUint16LE(std, offset);
  const upx = slice(std, offset + 2, cbUpx, what);
  return { upx, next: offset + 2 + cbUpx + (cbUpx % 2) };
}

// GrLPUpxSw, [MS-DOC] 2.9.113: a style's own formatting sets, shaped by its stk. Only StkParaGRLPUPX (stk 1: lpUpxPapx then lpUpxChpx, [MS-DOC] 2.9.267) and StkCharGRLPUPX (stk 2: lpUpxChpx alone, 2.9.263) are read here -- table and numbering styles (stk 3/4) carry TAPX and a differently-shaped formatting set this package does not read, matching every other table-style gap this package's own README already states. A revision-marked style (StdfPost2000.fHasOriginalStyle) carries one further trailing structure (StkParaLPUpxGrLPUpxRM/StkCharLPUpxGrLPUpxRM) after the members read here; it is never reached, since neither member read here needs to walk past what it already has.
function parseGrLPUpxSw(
  std: Uint8Array,
  offset: number,
  stk: number,
  istd: number,
): {
  grpprlPapx: readonly Prl[] | undefined;
  grpprlChpx: readonly Prl[] | undefined;
} {
  if (stk === STK.paragraph) {
    // UpxPapx, [MS-DOC] 2.9.338: a 2-byte istd (which "MUST be equal to the current style", so it is skipped rather than re-read) followed by grpprlPapx.
    const papx = readLpUpx(
      std,
      offset,
      `UpxPapx for the paragraph style at istd ${istd}`,
    );
    const chpx = readLpUpx(
      std,
      papx.next,
      `UpxChpx for the paragraph style at istd ${istd}`,
    );
    const grpprlPapxBytes = slice(
      papx.upx,
      2,
      papx.upx.length - 2,
      `grpprlPapx for the paragraph style at istd ${istd}`,
    );
    return {
      grpprlPapx: readGrpprl(grpprlPapxBytes),
      grpprlChpx: readGrpprl(chpx.upx),
    };
  }
  if (stk === STK.character) {
    const chpx = readLpUpx(
      std,
      offset,
      `UpxChpx for the character style at istd ${istd}`,
    );
    return { grpprlPapx: undefined, grpprlChpx: readGrpprl(chpx.upx) };
  }
  return { grpprlPapx: undefined, grpprlChpx: undefined };
}

export interface ResolvedStyleFormatting {
  readonly paragraphPrls: readonly Prl[];
  readonly characterPrls: readonly Prl[];
}

// Walks StdfBase.istdBase from the given istd up to its root, then folds each style's own grpprlPapx/grpprlChpx from ROOT to LEAF -- the opposite direction from how [MS-DOC] 2.4.6.5 itself constructs the combined array ("append [this style's own array] to the beginning of the array from the base style", i.e. leaf-first). That construction only states the array's shape; 2.6's own "Applying Properties" rule -- "the last Prl applied determines the value of that property" -- is what actually assigns precedence, and folding a leaf-first array in that order would let a base style's own property overwrite what the more specific derived style set on top of it. Resolving root-to-leaf and applying each level's own grpprl last, as this function does, gives the derived style precedence instead -- the ordinary "more specific wins" behaviour every style-inheritance model shares, and the only reading consistent with a style overriding a property its own base already set.
export function resolveStyleFormatting(
  styleSheet: StyleSheet,
  istd: number,
): ResolvedStyleFormatting {
  const chain: Style[] = [];
  const seen = new Set<number>();
  let current = styleSheet.styles[istd];
  while (current !== undefined) {
    if (seen.has(current.istd)) {
      throw new DocFormatError(
        `style inheritance chain starting at istd ${istd} loops back to istd ${current.istd}, which [MS-DOC] 2.9.260's own istdBase rule forbids`,
      );
    }
    seen.add(current.istd);
    chain.push(current);
    current =
      current.istdBase === undefined
        ? undefined
        : styleSheet.styles[current.istdBase];
  }

  const paragraphPrls: Prl[] = [];
  const characterPrls: Prl[] = [];
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const style = chain[index];
    if (style === undefined) continue;
    if (style.grpprlPapx !== undefined) paragraphPrls.push(...style.grpprlPapx);
    if (style.grpprlChpx !== undefined) characterPrls.push(...style.grpprlChpx);
  }
  return { paragraphPrls, characterPrls };
}

// The heading level a paragraph style index implies, per sprmPIstd's own statement: "An istd value in the range of 1 to 9, inclusive, also specifies the outline level of the paragraph ... where the new outline level is equal to the value of the istd minus 1." Outline level is zero-based and the shared schema's headingLevel is one-based, so the two cancel and the istd is the heading level directly.
//
// This is deliberately derived from the istd rather than from the style's name: a document's own "Heading 1" may be renamed, localised, or absent from the style sheet entirely, but the istd-to-outline-level rule is stated normatively by the format and holds regardless.
export function headingLevelFromIstd(istd: number): number | undefined {
  return istd >= 1 && istd <= 9 ? istd : undefined;
}

// A minimal, genuinely spec-conformant STSH carrying zero styles ([MS-DOC] 2.9.271's own "cstd" MAY be 0; no MUST-clause requires a document to define even one). write.ts always writes one, never omits fcStshf/lcbStshf entirely, because FibRgFcLcb97's own lcbStshf field "MUST be a nonzero value" -- a document with no style sheet at all is not a construct [MS-DOC] permits, even though this package's own reader tolerates lcbStshf 0 (see read.ts). Every field is the same fixed Stshif header parseStsh's own STSHIF_SIZE check requires, populated with the values Word's own default document carries when nothing overrides them; there are no styles for it to also fold and, in turn, nothing for a paragraph's own sprmPIstd to resolve a name or heading level through -- see the README's own scope note on paragraph styles.
export function buildEmptyStsh(): Uint8Array {
  const stshi: number[] = [];
  const push16 = (value: number): void => {
    stshi.push(value & 0xff, (value >> 8) & 0xff);
  };
  push16(0); // cstd: no styles.
  push16(STDF_SIZE_WITHOUT_POST_2000); // cbSTDBaseInFile.
  push16(0x0001); // fStdStylenamesWritten, which [MS-DOC] requires to be 1.
  push16(0); // stiMaxWhenSaved.
  push16(0x000f); // istdMaxFixedWhenSaved, which [MS-DOC] requires to be 0x000F.
  push16(0); // nVerBuiltInNamesWhenSaved.
  push16(0); // ftcAsci.
  push16(0); // ftcFE.
  push16(0); // ftcOther.
  push16(0); // ftcBi.
  push16(4); // StshiLsd.cbLSD, which [MS-DOC] requires to be 4.
  return new Uint8Array([
    stshi.length & 0xff,
    (stshi.length >> 8) & 0xff,
    ...stshi,
  ]);
}
