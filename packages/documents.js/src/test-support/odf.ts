import type { Package } from "odf.js";
import { decodePackage, ODF_MEDIA_TYPES, zipPackage } from "odf.js";

// Never imported by src/index.ts and never reaches dist/. Hand-authored ODF formula (.odf) XML zipped via odf.js's own zipPackage/decodePackage, mirroring src/test-support/odt.ts's own established convention exactly (same mimetype-part-first-and-stored requirement, same "not from a real LibreOffice binary" scope) -- see that file's own top-of-file comment for the full reasoning. Every fixture wraps its own MathML content in the real office:body > office:math > math:math structure a genuine LibreOffice-authored .odf uses, with every math element under a "math:" namespace prefix (not the bare, unprefixed form) -- deliberately, since that IS what real LibreOffice output uses (confirmed by src/mathml/nodes.ts's own localName-stripping design, built specifically to handle this), so these fixtures exercise the realistic path, not merely the more lenient one.

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

const MIMETYPE = enc(ODF_MEDIA_TYPES.odf);
const MATH_NS = 'xmlns:math="http://www.w3.org/1998/Math/MathML"';
const OFFICE_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"';

// Wraps `mathMlInner` (the raw math:math element's own children, already-serialised XML -- e.g. "<math:mrow>...</math:mrow>") in a full, structurally-real odf package. A caller building a curated fixture writes the MathML by hand rather than via src/mathml's own types, matching every other src/test-support/*.ts fixture's own "hand-authored XML in, real reader out" shape -- src/mathml has no XML-serialising code of its own to reuse here anyway (it only ever consumes an already-parsed tree).
export function odfFormulaBytes(
  mathMlInner: string,
  options: { readonly starMath?: string } = {},
): Uint8Array<ArrayBuffer> {
  const annotation =
    options.starMath === undefined
      ? ""
      : `<math:annotation encoding="StarMath 5.0">${options.starMath}</math:annotation>`;
  const contentXml = enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${OFFICE_NS} ${MATH_NS}><office:body><office:math><math:math ${MATH_NS}><math:semantics>${mathMlInner}${annotation}</math:semantics></math:math></office:math></office:body></office:document-content>`,
  );
  return zipPackage([
    ["mimetype", { bytes: MIMETYPE, stored: true }],
    ["content.xml", { bytes: contentXml }],
  ]);
}

export function odfFormulaPackage(
  mathMlInner: string,
  options?: { readonly starMath?: string },
): Package {
  return decodePackage(odfFormulaBytes(mathMlInner, options));
}

// A small, curated set of real formulas covering every construct the task's own test requirement names: a simple fraction, a square root, a superscript/subscript combination, and a small matrix via mtable.

export const FRACTION_FORMULA =
  "<math:mfrac><math:mi>a</math:mi><math:mi>b</math:mi></math:mfrac>";
export const SQRT_FORMULA = "<math:msqrt><math:mi>x</math:mi></math:msqrt>";
export const SUBSUP_FORMULA =
  "<math:mrow><math:mi>x</math:mi><math:msubsup><math:mi>y</math:mi><math:mn>1</math:mn><math:mn>2</math:mn></math:msubsup></math:mrow>";
// A parenthesised stack of nested fractions: the only construct these fixtures can build that is genuinely taller than the largest pre-built parenthesis STIX Two Math draws by hand (3821 design units), so the fences must be assembled from the font's own repeatable parts to cover it -- see src/mathml/layout.ts's own stretchRowOperators.
export const STRETCHY_FENCE_FORMULA = `<math:mrow><math:mo>(</math:mo>${["", "", "", "", ""].reduce((inner) => `<math:mfrac>${inner}<math:mn>2</math:mn></math:mfrac>`, "<math:mn>1</math:mn>")}<math:mo>)</math:mo></math:mrow>`;

export const MATRIX_FORMULA =
  "<math:mtable><math:mtr><math:mtd><math:mn>1</math:mn></math:mtd><math:mtd><math:mn>2</math:mn></math:mtd></math:mtr><math:mtr><math:mtd><math:mn>3</math:mn></math:mtd><math:mtd><math:mn>4</math:mn></math:mtd></math:mtr></math:mtable>";
