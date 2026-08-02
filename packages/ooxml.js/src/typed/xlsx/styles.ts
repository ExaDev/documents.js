import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import type { CellNumberFormat } from './number-format';
import { attr, childrenWithTag, decodeEntities, rootElement } from '../util';
import { BUILTIN_NUMBER_FORMATS } from './number-format';

// Resolves xl/styles.xml down to the one thing typed/xlsx/content.ts needs from it: for each cell-format index (a <c>'s own s attribute), the number-format CODE STRING that cell's value is displayed through. Everything else a styleSheet carries -- fonts, fills, borders, alignment, protection -- is outside ContentSheetCell's own model and is not read. Its write-side counterpart, CellFormatTable below, is the same relationship in reverse: the cell formats typed/xlsx/build.ts interns while it walks cells, ready to serialize as one <numFmts>/<cellXfs> pair.

const STYLES_PATH = 'xl/styles.xml';

// numFmtId 0, 'General' -- CT_Xf/@numFmtId's own schema default, so an <xf> with no numFmtId attribute at all is General, not "unformatted". Shared by both directions: what the reader falls back to for an undeclared id, and what the writer's own default cell format carries.
export const GENERAL_NUM_FMT_ID = 0;

// numFmtId -> format code, built in exactly two feeds: ECMA-376's own built-in table first, then the file's own <numFmts> overlaid UNCONDITIONALLY. The overlay is unconditional rather than fill-the-gaps because a producer-declared code always wins over an implied one -- confirmed necessary against real LibreOffice output, whose kitchen-sink export declares id 164 as "General" and then points its plain numeric cells at it; a fill-the-gaps overlay would still be correct there, but nothing in the format stops a producer redeclaring an id inside the built-in range, and the spec's own table is the FALLBACK for ids a file leaves undeclared, not an authority over ids it declares.
function readNumberFormatCodesById(styleSheet: XmlElement): Map<number, string> {
  const codes = new Map<number, string>(BUILTIN_NUMBER_FORMATS);
  const numFmtsEl = childrenWithTag(styleSheet, 'numFmts')[0];
  if (numFmtsEl === undefined) {
    return codes;
  }
  for (const numFmt of childrenWithTag(numFmtsEl, 'numFmt')) {
    const idRaw = attr(numFmt, 'numFmtId');
    const formatCode = attr(numFmt, 'formatCode');
    if (idRaw === undefined || formatCode === undefined) {
      continue;
    }
    const id = Number.parseInt(idRaw, 10);
    if (Number.isInteger(id)) {
      // decodeEntities is load-bearing here, not defensive: this package's lossless layer keeps attribute values exactly as written, and a real format code routinely contains quoted literals -- LibreOffice's own boolean format arrives as `&quot;TRUE&quot;;&quot;TRUE&quot;;&quot;FALSE&quot;`, which would tokenize as bare code characters rather than as quoted text if fed through raw.
      codes.set(id, decodeEntities(formatCode));
    }
  }
  return codes;
}

// One entry per <cellXfs><xf>, in document order, so the array index IS the value of a cell's own s attribute. An entry is undefined when that xf points at a numFmtId with no code anywhere -- an id in the 23-36 range ECMA-376's own built-in table leaves reserved, or a dangling reference to a numFmt the file never declared -- which the caller treats as carrying no formatting information rather than as General.
//
// numFmtId is read directly off the cellXf, not chased through xfId into <cellStyleXfs>. That inheritance path exists in the schema (an xf may take its number format from the named cell style it is based on when applyNumberFormat is off) but real producers write the resolved numFmtId onto the cellXf itself -- every one of the seven cellXfs entries in this package's own kitchen-sink fixture does, including the five carrying a genuine date/time/percentage/currency format -- so implementing the chase would be building for a case no available file exercises.
export function readCellFormatCodes(pkg: Package): readonly (string | undefined)[] {
  const styleSheet = rootElement(pkg.parts[STYLES_PATH]);
  if (styleSheet === undefined) {
    return [];
  }
  const cellXfsEl = childrenWithTag(styleSheet, 'cellXfs')[0];
  if (cellXfsEl === undefined) {
    return [];
  }
  const codes = readNumberFormatCodesById(styleSheet);
  return childrenWithTag(cellXfsEl, 'xf').map((xf) => {
    const raw = attr(xf, 'numFmtId');
    const id = raw === undefined ? GENERAL_NUM_FMT_ID : Number.parseInt(raw, 10);
    return Number.isInteger(id) ? codes.get(id) : undefined;
  });
}

// --- the write side: interning the cell formats a written workbook needs -------------------------------------------

// Where a file's own custom format ids start. ECMA-376 implies ids 0-49 (BUILTIN_NUMBER_FORMATS above) and reserves everything up to 163 for locale-specific built-ins a producer must not redefine; 164 is the first id a file may declare for itself, and is where every real producer starts -- this directory's own kitchen-sink.xlsx fixture declares its six formats as 164-169.
const FIRST_CUSTOM_NUM_FMT_ID = 164;

// The cell-format index every cell with nothing but General formatting carries, and the one entry this table always starts with, so a workbook that needs no formats at all still writes exactly the single-<xf> cellXfs it did before this table existed.
export const DEFAULT_CELL_FORMAT_INDEX = 0;

// A custom format as it must be declared in <numFmts>: the id this table assigned it, and the code itself (raw, NOT XML-encoded -- the caller encodes when it writes the formatCode attribute, matching how every other string this package writes is handled).
export interface DeclaredNumberFormat {
  id: number;
  code: string;
}

// A built-in id and a custom code can never collide as keys, since one signature space is numeric ids and the other is format-code text.
function signatureOf(format: CellNumberFormat): string {
  return format.kind === 'builtin' ? `builtin:${format.id}` : `custom:${format.code}`;
}

// The write-side counterpart to readCellFormatCodes above, and a direct mirror of shared-strings.ts's own SharedStringTable: typed/xlsx/build.ts fills it on demand while it walks cells, and it hands back a stable index each time -- the value of that cell's own `s` attribute, an index into <cellXfs>. What is deduplicated is the cell FORMAT: two cells wanting the same number format share one xf entry, and two cells wanting the same custom CODE share one <numFmt> declaration too, exactly as a real producer's own output does.
//
// A number format is the only thing distinguishing one xf from another in what this writer produces (fonts, fills, and borders are all single-entry defaults -- see buildStylesPart), so the format IS the whole interning key.
export class CellFormatTable {
  private readonly indexBySignature = new Map<string, number>([[signatureOf({ kind: 'builtin', id: GENERAL_NUM_FMT_ID }), DEFAULT_CELL_FORMAT_INDEX]]);
  private readonly numFmtIdByIndex: number[] = [GENERAL_NUM_FMT_ID];
  private readonly declared: DeclaredNumberFormat[] = [];

  // Returns the (possibly newly assigned) cellXfs index that displays a value through `format`.
  intern(format: CellNumberFormat): number {
    const signature = signatureOf(format);
    const existing = this.indexBySignature.get(signature);
    if (existing !== undefined) {
      return existing;
    }
    const numFmtId = format.kind === 'builtin' ? format.id : this.declare(format.code);
    const index = this.numFmtIdByIndex.length;
    this.numFmtIdByIndex.push(numFmtId);
    this.indexBySignature.set(signature, index);
    return index;
  }

  // Every custom format code this table assigned an id to, in id order -- one <numFmt> element each, and empty whenever nothing beyond the built-ins was ever interned.
  declarations(): readonly DeclaredNumberFormat[] {
    return this.declared;
  }

  // One numFmtId per cellXfs entry, in index order: the array index IS the value a cell's own `s` attribute carries.
  cellFormats(): readonly number[] {
    return this.numFmtIdByIndex;
  }

  private declare(code: string): number {
    const id = FIRST_CUSTOM_NUM_FMT_ID + this.declared.length;
    this.declared.push({ id, code });
    return id;
  }
}
