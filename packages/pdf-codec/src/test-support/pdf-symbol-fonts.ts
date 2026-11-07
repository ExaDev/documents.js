import { EMPTY_DICT, FixtureBuilder, enc } from "./pdf";

// One-page PDFs showing codes from a font named the way a symbol font is named, with or without a /ToUnicode CMap and an embedded program, for reading the characters a symbol font's glyphs are (symbol-font-private-use.ts). Built by literal object layout through test-support/pdf.ts's FixtureBuilder, importing nothing from this package's own writer, for the reason that file's header states.

const HEX_RADIX = 16;
const CODE_HEX_DIGITS = 2;
const CID_HEX_DIGITS = 4;
const UTF16_HEX_DIGITS = 4;

const CATALOG = "<< /Type /Catalog /Pages 2 0 R >>";
const PAGES = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
const PAGE =
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>";
// Catalog, pages, page, font and content stream take objects 1 to 5; whatever else a fixture needs is numbered on from here, so the cross-reference table covers every number without a gap.
const FIRST_OPTIONAL_OBJ = 6;

function hex(value: number, digits: number): string {
  return value.toString(HEX_RADIX).toUpperCase().padStart(digits, "0");
}

// A /ToUnicode CMap (ISO 32000-1 9.10.3) sending each code, `codeDigits` hexadecimal digits wide, to the single UTF-16 code unit given: every value a symbol font's producer writes is one Basic Multilingual Plane code point.
function toUnicodeCMap(
  mappings: ReadonlyMap<number, number>,
  codeDigits: number,
): string {
  const codespace = `<${hex(0, codeDigits)}> <${"F".repeat(codeDigits)}>`;
  const lines = [...mappings].map(
    ([code, codePoint]) =>
      `<${hex(code, codeDigits)}> <${hex(codePoint, UTF16_HEX_DIGITS)}>`,
  );
  return `begincmap\n1 begincodespacerange\n${codespace}\nendcodespacerange\n${String(lines.length)} beginbfchar\n${lines.join("\n")}\nendbfchar\nendcmap`;
}

interface OptionalObjects {
  readonly toUnicode?: string;
  readonly program?: Uint8Array<ArrayBuffer>;
}

// The objects after the content stream, numbered in order: the /ToUnicode stream, then the font descriptor and its /FontFile2. Returns the entries the font dictionary (`toUnicode`) and the font descriptor's owner (`fontDescriptor`) name them by, each empty when the fixture has no such object.
function writeOptionalObjects(
  b: FixtureBuilder,
  fontName: string,
  objects: OptionalObjects,
): {
  readonly toUnicode: string;
  readonly fontDescriptor: string;
  readonly last: number;
} {
  let next = FIRST_OPTIONAL_OBJ;
  let toUnicode = "";
  if (objects.toUnicode !== undefined) {
    b.stream(next, EMPTY_DICT, enc(objects.toUnicode));
    toUnicode = `/ToUnicode ${String(next)} 0 R`;
    next++;
  }
  let fontDescriptor = "";
  if (objects.program !== undefined) {
    const descriptor = next;
    const fontFile = next + 1;
    b.object(
      descriptor,
      `<< /Type /FontDescriptor /FontName /${fontName} /Flags 4 /FontFile2 ${String(fontFile)} 0 R >>`,
    );
    b.stream(fontFile, EMPTY_DICT, objects.program);
    fontDescriptor = `/FontDescriptor ${String(descriptor)} 0 R`;
    next = fontFile + 1;
  }
  return { toUnicode, fontDescriptor, last: next - 1 };
}

// A page showing one-byte codes from a simple font: `subtype` is the font's /Subtype (Type1 by default), `baseFont` its /BaseFont, `codes` the bytes shown, `toUnicode` the code to code point pairs of a /ToUnicode CMap (none when absent), `encoding` the /Encoding value as PDF source (none when absent), and `program` a TrueType program the font descriptor carries as /FontFile2 (no descriptor when absent).
export function simpleSymbolFontPdf(options: {
  readonly subtype?: "Type1" | "TrueType";
  readonly baseFont: string;
  readonly codes: readonly number[];
  readonly toUnicode?: ReadonlyMap<number, number>;
  readonly encoding?: string;
  readonly program?: Uint8Array<ArrayBuffer>;
}): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  b.object(1, CATALOG);
  b.object(2, PAGES);
  b.object(3, PAGE);
  b.stream(
    5,
    EMPTY_DICT,
    enc(
      `BT /F1 12 Tf 10 50 Td <${options.codes.map((code) => hex(code, CODE_HEX_DIGITS)).join("")}> Tj ET`,
    ),
  );
  const optional = writeOptionalObjects(b, options.baseFont, {
    toUnicode:
      options.toUnicode === undefined
        ? undefined
        : toUnicodeCMap(options.toUnicode, CODE_HEX_DIGITS),
    program: options.program,
  });
  const encoding =
    options.encoding === undefined ? "" : `/Encoding ${options.encoding}`;
  b.object(
    4,
    `<< /Type /Font /Subtype /${options.subtype ?? "Type1"} /BaseFont /${options.baseFont} ${encoding} ${optional.toUnicode} ${optional.fontDescriptor} >>`,
  );
  b.classicXrefAndTrailer(Math.max(optional.last, 5), "/Root 1 0 R");
  return b.bytes();
}

// A page showing two-byte codes from a Type0 font with /Identity-H and a CIDFontType2 descendant, the shape Word embeds a symbol font in: `baseFont` is the /BaseFont of both the font and its descendant, `cids` the codes shown, `toUnicode` the code to code point pairs of its /ToUnicode CMap, and `program` a TrueType program the descendant's font descriptor carries as /FontFile2 (no descriptor when absent).
export function compositeSymbolFontPdf(options: {
  readonly baseFont: string;
  readonly cids: readonly number[];
  readonly toUnicode: ReadonlyMap<number, number>;
  readonly program?: Uint8Array<ArrayBuffer>;
}): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  b.object(1, CATALOG);
  b.object(2, PAGES);
  b.object(3, PAGE);
  b.stream(
    5,
    EMPTY_DICT,
    enc(
      `BT /F1 12 Tf 10 50 Td <${options.cids.map((cid) => hex(cid, CID_HEX_DIGITS)).join("")}> Tj ET`,
    ),
  );
  const optional = writeOptionalObjects(b, options.baseFont, {
    toUnicode: toUnicodeCMap(options.toUnicode, CID_HEX_DIGITS),
    program: options.program,
  });
  const descendant = optional.last + 1;
  b.object(
    descendant,
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${options.baseFont} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ${optional.fontDescriptor} >>`,
  );
  b.object(
    4,
    `<< /Type /Font /Subtype /Type0 /BaseFont /${options.baseFont} /Encoding /Identity-H /DescendantFonts [${String(descendant)} 0 R] ${optional.toUnicode} >>`,
  );
  b.classicXrefAndTrailer(descendant, "/Root 1 0 R");
  return b.bytes();
}
