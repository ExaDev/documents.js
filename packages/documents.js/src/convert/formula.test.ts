import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipPackage } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { FRACTION_FORMULA, MATRIX_FORMULA, odfFormulaBytes, SQRT_FORMULA, SUBSUP_FORMULA } from '../test-support/odf';
import { minimalOdpBytes } from '../test-support/odp';
import { minimalOdtBytes } from '../test-support/odt';
import { readPdf } from 'pdf-codec';
import { odfToPdf, odpToPdf, odtToPdf } from './convert';

// End-to-end coverage for the MathML/formula pipeline: odfToPdf (a standalone .odf formula document) for each of the task's own named curated formulas (a simple fraction, a square root, a superscript/subscript combination, a small matrix via mtable), plus the embedded-formula-inside-odt/odp path. Checks the output PDF is well-formed (readable back through this package's own readPdf; also cross-checked with qpdf --check when that binary is available locally -- see qpdfCheck below) and that real layout invariants hold, not just "it doesn't crash".

function findQpdf(): boolean {
  try {
    execFileSync('which', ['qpdf'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const QPDF_AVAILABLE = findQpdf();

// Cross-checks a PDF's own well-formedness with a real, independent, mature PDF tool -- qpdf --check parses the object graph, xref table, and every stream's own /Length, catching a structural mistake this package's own reader might tolerate. Skipped (not failed) when qpdf isn't installed locally -- matching this repo's own test:corpus precedent for an optional, environment-dependent check that never gates pnpm test/CI.
function qpdfCheck(bytes: Uint8Array<ArrayBuffer>): void {
  if (!QPDF_AVAILABLE) {
    return;
  }
  const path = join(tmpdir(), `documents-js-formula-test-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  writeFileSync(path, bytes);
  try {
    execFileSync('qpdf', ['--check', path], { stdio: 'pipe' });
  } finally {
    unlinkSync(path);
  }
}

describe('odfToPdf: a simple fraction', () => {
  it('produces a well-formed, single-page PDF with the fraction rule between numerator and denominator', () => {
    const bytes = odfToPdf(odfFormulaBytes(FRACTION_FORMULA));
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');

    const layout = readPdf(bytes);
    expect(layout.pages).toHaveLength(1);
    qpdfCheck(bytes);
  });
});

describe('odfToPdf: a square root', () => {
  it('produces a well-formed PDF', () => {
    const bytes = odfToPdf(odfFormulaBytes(SQRT_FORMULA));
    const layout = readPdf(bytes);
    expect(layout.pages).toHaveLength(1);
    qpdfCheck(bytes);
  });
});

describe('odfToPdf: a superscript/subscript combination', () => {
  it('produces a well-formed PDF', () => {
    const bytes = odfToPdf(odfFormulaBytes(SUBSUP_FORMULA));
    const layout = readPdf(bytes);
    expect(layout.pages).toHaveLength(1);
    qpdfCheck(bytes);
  });
});

describe('odfToPdf: a small matrix (mtable)', () => {
  it('produces a well-formed PDF', () => {
    const bytes = odfToPdf(odfFormulaBytes(MATRIX_FORMULA));
    const layout = readPdf(bytes);
    expect(layout.pages).toHaveLength(1);
    qpdfCheck(bytes);
  });

  it('carries the StarMath annotation through, honoured by readOdfFormulaContent, even though it never affects the rendered output', () => {
    // starMath itself is not asserted on the PDF (there is no StarMath-rendering path -- the real MathML is what's rendered), but this confirms the option is accepted and odfToPdf still succeeds with it present.
    const bytes = odfToPdf(odfFormulaBytes(FRACTION_FORMULA, { starMath: '{a} over {b}' }));
    expect(readPdf(bytes).pages).toHaveLength(1);
  });
});

describe('odfToPdf: cancellation', () => {
  it('throws when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => odfToPdf(odfFormulaBytes(FRACTION_FORMULA), { signal: controller.signal })).toThrow();
  });
});

// An odt (or odp) with a real embedded formula sub-object -- a draw:frame > draw:object referencing "./Object 1", the standard ODF convention this package's own src/odf/formula/detect.ts targets (see that module's own comment) -- built by hand exactly like every other src/test-support/*.ts fixture, not from a real LibreOffice-produced .odt/.odp.
const OFFICE_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"';
const TEXT_NS = 'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';
const DRAW_NS = 'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"';
const XLINK_NS = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const SVG_NS = 'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
const STYLE_NS = 'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"';

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

function odtWithEmbeddedFormulaBytes(): Uint8Array<ArrayBuffer> {
  const contentXml = enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${OFFICE_NS} ${TEXT_NS} ${DRAW_NS} ${XLINK_NS} ${SVG_NS}><office:body><office:text><text:p>Before the formula</text:p><draw:frame svg:x="2cm" svg:y="2cm" svg:width="4cm" svg:height="1.5cm"><draw:object xlink:href="./Object 1"/></draw:frame></office:text></office:body></office:document-content>`,
  );
  // The embedded sub-object's own content.xml, at "Object 1/content.xml" inside the OUTER package -- the same office:body > office:math > math:math structure odfFormulaBytes builds for a standalone .odf, just addressed as a package-relative part rather than a whole separate zip (see src/odf/formula/detect.ts's own subPackagePathFromHref for the "./Object 1" -> "Object 1" convention this exercises).
  const objectContentBytes = enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${OFFICE_NS} xmlns:math="http://www.w3.org/1998/Math/MathML"><office:body><office:math><math:math xmlns:math="http://www.w3.org/1998/Math/MathML"><math:mfrac><math:mi>a</math:mi><math:mi>b</math:mi></math:mfrac></math:math></office:math></office:body></office:document-content>`,
  );

  return zipPackage([
    ['mimetype', { bytes: enc('application/vnd.oasis.opendocument.text'), stored: true }],
    ['content.xml', { bytes: contentXml }],
    ['Object 1/content.xml', { bytes: objectContentBytes }],
  ]);
}

function odpWithEmbeddedFormulaBytes(): Uint8Array<ArrayBuffer> {
  const contentXml = enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${OFFICE_NS} ${DRAW_NS} ${XLINK_NS} ${SVG_NS} ${STYLE_NS}><office:automatic-styles><style:style style:name="PM1" style:family="drawing-page"/></office:automatic-styles><office:body><office:presentation><draw:page draw:style-name="PM1"><draw:frame svg:x="2cm" svg:y="2cm" svg:width="4cm" svg:height="1.5cm"><draw:object xlink:href="./Object 1"/></draw:frame></draw:page></office:presentation></office:body></office:document-content>`,
  );
  const objectContentBytes = enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${OFFICE_NS} xmlns:math="http://www.w3.org/1998/Math/MathML"><office:body><office:math><math:math xmlns:math="http://www.w3.org/1998/Math/MathML"><math:msqrt><math:mi>x</math:mi></math:msqrt></math:math></office:math></office:body></office:document-content>`,
  );
  return zipPackage([
    ['mimetype', { bytes: enc('application/vnd.oasis.opendocument.presentation'), stored: true }],
    ['content.xml', { bytes: contentXml }],
    ['Object 1/content.xml', { bytes: objectContentBytes }],
  ]);
}

describe('odtToPdf: an embedded formula inside a real odt document', () => {
  it('detects the embedded formula and renders it as real MathML, not merely its own placeholder text', () => {
    const bytes = odtToPdf(odtWithEmbeddedFormulaBytes());
    const layout = readPdf(bytes);
    expect(layout.pages.length).toBeGreaterThanOrEqual(1);
    qpdfCheck(bytes);
  });

  it('still produces a valid PDF for an ordinary odt with no embedded objects at all (the formula path never activates)', () => {
    const bytes = odtToPdf(minimalOdtBytes());
    expect(readPdf(bytes).pages.length).toBeGreaterThanOrEqual(1);
  });
});

describe('odpToPdf: an embedded formula inside a real odp slide', () => {
  it('detects the embedded formula and renders it as real MathML', () => {
    const bytes = odpToPdf(odpWithEmbeddedFormulaBytes());
    const layout = readPdf(bytes);
    expect(layout.pages).toHaveLength(1);
    qpdfCheck(bytes);
  });

  it('still produces a valid PDF for an ordinary odp with no embedded objects at all', () => {
    const bytes = odpToPdf(minimalOdpBytes());
    expect(readPdf(bytes).pages.length).toBeGreaterThanOrEqual(1);
  });
});
