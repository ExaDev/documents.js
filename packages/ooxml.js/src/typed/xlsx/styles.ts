import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { attr, childrenWithTag, decodeEntities, rootElement } from '../util';
import { BUILTIN_NUMBER_FORMATS } from './number-format';

// Resolves xl/styles.xml down to the one thing typed/xlsx/content.ts needs from it: for each cell-format index (a <c>'s own s attribute), the number-format CODE STRING that cell's value is displayed through. Everything else a styleSheet carries -- fonts, fills, borders, alignment, protection -- is outside ContentSheetCell's own model and is not read.

const STYLES_PATH = 'xl/styles.xml';

// CT_Xf/@numFmtId's own schema default: an <xf> with no numFmtId attribute at all is General, not "unformatted".
const DEFAULT_NUM_FMT_ID = 0;

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
    const id = raw === undefined ? DEFAULT_NUM_FMT_ID : Number.parseInt(raw, 10);
    return Number.isInteger(id) ? codes.get(id) : undefined;
  });
}
