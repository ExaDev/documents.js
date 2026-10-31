import { EMPTY_DICT, FixtureBuilder, enc } from "./pdf";

// One-page PDFs showing glyphs from a font whose embedded program the caller supplies, with no /ToUnicode CMap, so the only route from what the page shows to text runs through the font dictionary's encoding and the program itself. Built by literal object layout through test-support/pdf.ts's FixtureBuilder, importing nothing from this package's own writer, for the reason that file's header states.

const HEX_RADIX = 16;
const CODE_HEX_DIGITS = 2;

const CATALOG = "<< /Type /Catalog /Pages 2 0 R >>";
const PAGES = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
const PAGE =
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>";

function showHex(codes: readonly number[], digits: number): string {
  return codes
    .map((code) => code.toString(HEX_RADIX).padStart(digits, "0"))
    .join("");
}

// A page showing one-byte codes from a simple TrueType font whose /Encoding is a dictionary carrying only `differences`, the /Differences array's contents as PDF source (`65 /g5`, say). Without `program` the font descriptor names no /FontFile2.
export function simpleFontDifferencesPdf(options: {
  readonly differences: string;
  readonly codes: readonly number[];
  readonly program?: Uint8Array<ArrayBuffer>;
}): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  b.object(1, CATALOG);
  b.object(2, PAGES);
  b.object(3, PAGE);
  b.object(
    4,
    `<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+Subset /FirstChar 0 /LastChar 255 /Encoding << /Differences [${options.differences}] >> /FontDescriptor 6 0 R >>`,
  );
  b.stream(
    5,
    EMPTY_DICT,
    enc(
      `BT /F1 12 Tf 10 50 Td <${showHex(options.codes, CODE_HEX_DIGITS)}> Tj ET`,
    ),
  );
  const fontFile = options.program === undefined ? "" : "/FontFile2 7 0 R";
  b.object(
    6,
    `<< /Type /FontDescriptor /FontName /ABCDEF+Subset /Flags 32 ${fontFile} >>`,
  );
  if (options.program === undefined) {
    b.classicXrefAndTrailer(6, "/Root 1 0 R");
    return b.bytes();
  }
  b.stream(7, EMPTY_DICT, options.program);
  b.classicXrefAndTrailer(7, "/Root 1 0 R");
  return b.bytes();
}
