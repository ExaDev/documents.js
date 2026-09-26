import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzlibSync } from "fflate";
import { flattenTree, PAGE_SIZE_A4 } from "document-schema.js";
import { zipPackage } from "odf.js";
import { describe, expect, it } from "vitest";
import {
  FRACTION_FORMULA,
  MATRIX_FORMULA,
  odfFormulaBytes,
  SQRT_FORMULA,
  STRETCHY_FENCE_FORMULA,
  SUBSUP_FORMULA,
} from "../test-support/odf";
import { minimalOdpBytes } from "../test-support/odp";
import { minimalOdtBytes } from "../test-support/odt";
import type { DocumentTree } from "document-schema.js";
import { decodePackage } from "odf.js";
import { loadMathFont, readPdf } from "pdf-codec";
import { readOdpContent } from "../odf/odp/read";
import { readOdtContent } from "../odf/odt/read";
import { odfToPdf, odpToPdf, odtToPdf } from "./convert";
function findQpdf(): boolean {
  try {
    execFileSync("which", ["qpdf"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const QPDF_AVAILABLE = findQpdf();

// Cross-checks a PDF's own well-formedness with a real, independent, mature PDF tool — qpdf --check parses the object graph, xref table, and every stream's own /Length, catching a structural mistake this package's own reader might tolerate. Skipped (not failed) when qpdf isn't installed locally — matching this repo's own test:corpus precedent for an optional, environment-dependent check that never gates pnpm test/CI.
function qpdfCheck(bytes: Uint8Array<ArrayBuffer>): void {
  if (!QPDF_AVAILABLE) {
    return;
  }
  const path = join(
    tmpdir(),
    `documents-js-formula-test-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
  );
  writeFileSync(path, bytes);
  try {
    execFileSync("qpdf", ["--check", path], { stdio: "pipe" });
  } finally {
    unlinkSync(path);
  }
}

describe("odfToPdf: a simple fraction", () => {
  it("produces a well-formed, single-page PDF with the fraction rule between numerator and denominator", () => {
    const bytes = odfToPdf(odfFormulaBytes(FRACTION_FORMULA));
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");

    const layout = readPdf(bytes);
    expect(layout.pages).toHaveLength(1);
    qpdfCheck(bytes);
  });
});

describe("odfToPdf: a square root", () => {
  it("produces a well-formed PDF", () => {
    const bytes = odfToPdf(odfFormulaBytes(SQRT_FORMULA));
    const layout = readPdf(bytes);
    expect(layout.pages).toHaveLength(1);
    qpdfCheck(bytes);
  });
});

describe("odfToPdf: a superscript/subscript combination", () => {
  it("produces a well-formed PDF", () => {
    const bytes = odfToPdf(odfFormulaBytes(SUBSUP_FORMULA));
    const layout = readPdf(bytes);
    expect(layout.pages).toHaveLength(1);
    qpdfCheck(bytes);
  });
});

describe("odfToPdf: a small matrix (mtable)", () => {
  it("produces a well-formed PDF", () => {
    const bytes = odfToPdf(odfFormulaBytes(MATRIX_FORMULA));
    const layout = readPdf(bytes);
    expect(layout.pages).toHaveLength(1);
    qpdfCheck(bytes);
  });

  it("carries the StarMath annotation through, honoured by readOdfFormulaContent, even though it never affects the rendered output", () => {
    // starMath itself is not asserted on the PDF (there is no StarMath-rendering path — the real MathML is what's rendered), but this confirms the option is accepted and odfToPdf still succeeds with it present.
    const bytes = odfToPdf(
      odfFormulaBytes(FRACTION_FORMULA, { starMath: "{a} over {b}" }),
    );
    expect(readPdf(bytes).pages).toHaveLength(1);
  });
});

// Every Flate-compressed stream in `bytes`, inflated back to text — the only way to assert on the content-stream OPERATORS a conversion produced, since writePdf compresses them. Brute force by design (try each stream, keep the ones that inflate) rather than walking the object graph: this is a test wanting to read what was drawn, not a second PDF parser.
function inflatedStreams(bytes: Uint8Array<ArrayBuffer>): string[] {
  const raw = new TextDecoder("latin1").decode(bytes);
  const streams: string[] = [];
  const marker = /stream\r?\n/g;
  let match: RegExpExecArray | null = marker.exec(raw);
  while (match !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end >= 0) {
      try {
        streams.push(
          new TextDecoder("latin1").decode(
            unzlibSync(bytes.subarray(start, end)),
          ),
        );
      } catch {
        // Not a Flate stream (or not one whose bounds this crude scan got right) — the streams that matter here are, so skipping is correct rather than a swallowed failure.
      }
    }
    match = marker.exec(raw);
  }
  return streams;
}

// The page content stream specifically: the one selecting the embedded math font resource write.ts allocates for formulas. Identified by that resource selection rather than by any operator name, since the embedded CFF font program is itself a Flate stream whose compressed bytes can coincidentally contain any two-letter operator.
function formulaContentStream(bytes: Uint8Array<ArrayBuffer>): string {
  const content = inflatedStreams(bytes).find(
    (stream) => stream.includes("/MF ") && stream.includes(" Tf\n"),
  );
  expect(content).toBeDefined();
  return content!;
}

describe("odfToPdf: a stretchy fence around a tall construct", () => {
  it("draws each fence as a real multi-part assembly of the font's own glyphs, sized to the content", () => {
    const bytes = odfToPdf(odfFormulaBytes(STRETCHY_FENCE_FORMULA));
    expect(readPdf(bytes).pages).toHaveLength(1);
    qpdfCheck(bytes);

    const content = formulaContentStream(bytes);
    const font = loadMathFont().font;
    const cid = (codePoint: number) =>
      `<${font.glyphId(codePoint)!.toString(16).padStart(4, "0")}> Tj`;
    // The real LEFT PARENTHESIS pieces, by the Unicode code points that name them: a lower hook, at least one extension, an upper hook. Their glyph IDs reach the content stream as bare Identity-H CIDs, which is the whole point of drawing an assembly by glyph ID.
    expect(content).toContain(cid(0x239d)); // LEFT PARENTHESIS LOWER HOOK
    expect(content).toContain(cid(0x239b)); // LEFT PARENTHESIS UPPER HOOK
    expect(content.split(cid(0x239c)).length - 1).toBeGreaterThan(0); // LEFT PARENTHESIS EXTENSION, repeated
    expect(content).toContain(cid(0x23a0)); // RIGHT PARENTHESIS LOWER HOOK — the closing fence is assembled too
    // One /ActualText span per fence, so a reader still extracts "(" and ")" from glyphs that carry no ToUnicode mapping of their own.
    expect(content.split("/ActualText <feff0028> >> BDC").length - 1).toBe(1);
    expect(content.split("/ActualText <feff0029> >> BDC").length - 1).toBe(1);
    expect(content.split("EMC").length - 1).toBe(2);
  });

  it("leaves an ordinary short fence as ordinary text, drawn through the font's own cmap", () => {
    const short =
      "<math:mrow><math:mo>(</math:mo><math:mi>x</math:mi><math:mo>)</math:mo></math:mrow>";
    const content = formulaContentStream(odfToPdf(odfFormulaBytes(short)));
    expect(content).not.toContain("BDC"); // nothing was assembled
    const font = loadMathFont().font;
    // The base parenthesis glyph itself, shown as part of an ordinary multi-glyph text run rather than on its own.
    expect(content).toContain(
      font.glyphId(0x28)!.toString(16).padStart(4, "0"),
    );
  });
});

describe("odfToPdf: cancellation", () => {
  it("throws when the signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      odfToPdf(odfFormulaBytes(FRACTION_FORMULA), {
        signal: controller.signal,
      }),
    ).toThrow();
  });
});

// An odt (or odp) with a real embedded formula sub-object — a draw:frame > draw:object referencing "./Object 1", the standard ODF convention this package's own src/odf/formula/detect.ts targets (see that module's own comment) — built by hand exactly like every other src/test-support/*.ts fixture, not from a real LibreOffice-produced .odt/.odp.
const OFFICE_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"';
const TEXT_NS = 'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';
const DRAW_NS =
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"';
const XLINK_NS = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const SVG_NS =
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
const STYLE_NS =
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"';

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

// The embedded sub-object's own content.xml, addressed as "<name>/content.xml" inside the OUTER package — the same office:body > office:math > math:math structure odfFormulaBytes builds for a standalone .odf, just package-relative rather than a whole separate zip (see src/odf/formula/detect.ts's own subPackagePathFromHref for the "./Object 1" -> "Object 1" convention this exercises).
function embeddedFormulaObjectBytes(
  mathMlInner: string,
): Uint8Array<ArrayBuffer> {
  return enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${OFFICE_NS} xmlns:math="http://www.w3.org/1998/Math/MathML"><office:body><office:math><math:math xmlns:math="http://www.w3.org/1998/Math/MathML">${mathMlInner}</math:math></office:math></office:body></office:document-content>`,
  );
}

function odtBodyBytes(bodyInner: string): Uint8Array<ArrayBuffer> {
  return enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${OFFICE_NS} ${TEXT_NS} ${DRAW_NS} ${XLINK_NS} ${SVG_NS}><office:body><office:text>${bodyInner}</office:text></office:body></office:document-content>`,
  );
}

function odtZip(
  bodyInner: string,
  objects: readonly (readonly [string, string])[],
): Uint8Array<ArrayBuffer> {
  return zipPackage([
    [
      "mimetype",
      { bytes: enc("application/vnd.oasis.opendocument.text"), stored: true },
    ],
    ["content.xml", { bytes: odtBodyBytes(bodyInner) }],
    ...objects.map(
      ([name, mathMlInner]) =>
        [
          `${name}/content.xml`,
          { bytes: embeddedFormulaObjectBytes(mathMlInner) },
        ] as const,
    ),
  ]);
}

// A formula frame sitting as a DIRECT child of office:text — the absolutely-positioned (non-inline) shape, and the only one this package detected before.
function odtWithEmbeddedFormulaBytes(): Uint8Array<ArrayBuffer> {
  return odtZip(
    '<text:p>Before the formula</text:p><draw:frame svg:x="2cm" svg:y="2cm" svg:width="4cm" svg:height="1.5cm"><draw:object xlink:href="./Object 1"/></draw:frame>',
    [
      [
        "Object 1",
        "<math:mfrac><math:mi>a</math:mi><math:mi>b</math:mi></math:mfrac>",
      ],
    ],
  );
}

// A formula anchored INLINE inside a paragraph's own run content — the shape LibreOffice writes for a formula typed into a sentence: text:anchor-type="as-char", carrying svg:width/svg:height but deliberately NO svg:x, since its horizontal position comes from the text flow rather than from the frame (see src/odf/formula/detect.ts's own flowAnchoredFrameBox).
function odpZip(
  pageInner: string,
  objects: readonly (readonly [string, string])[],
): Uint8Array<ArrayBuffer> {
  const contentXml = enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${OFFICE_NS} ${TEXT_NS} ${DRAW_NS} ${XLINK_NS} ${SVG_NS} ${STYLE_NS}><office:automatic-styles><style:style style:name="PM1" style:family="drawing-page"/></office:automatic-styles><office:body><office:presentation><draw:page draw:style-name="PM1">${pageInner}</draw:page></office:presentation></office:body></office:document-content>`,
  );
  return zipPackage([
    [
      "mimetype",
      {
        bytes: enc("application/vnd.oasis.opendocument.presentation"),
        stored: true,
      },
    ],
    ["content.xml", { bytes: contentXml }],
    ...objects.map(
      ([name, mathMlInner]) =>
        [
          `${name}/content.xml`,
          { bytes: embeddedFormulaObjectBytes(mathMlInner) },
        ] as const,
    ),
  ]);
}

const FORMULA_FRAME =
  '<draw:frame svg:x="2cm" svg:y="2cm" svg:width="4cm" svg:height="1.5cm"><draw:object xlink:href="./Object 1"/></draw:frame>';
function odpWithEmbeddedFormulaBytes(): Uint8Array<ArrayBuffer> {
  return odpZip(FORMULA_FRAME, [
    ["Object 1", "<math:msqrt><math:mi>x</math:mi></math:msqrt>"],
  ]);
}

// A slide carrying BOTH a draw:g group and a formula frame — the exact shape that previously disabled formula detection for the whole slide, because a group's own frames are spliced into readOdpContent's flat shapes array at the group's own position, breaking any "Nth top-level frame = shapes[N]" correspondence.
describe("odtToPdf: an embedded formula inside a real odt document", () => {
  it("detects the embedded formula and renders it as real MathML, not merely its own placeholder text", () => {
    const bytes = odtToPdf(odtWithEmbeddedFormulaBytes());
    const layout = readPdf(bytes);
    expect(layout.pages.length).toBeGreaterThanOrEqual(1);
    qpdfCheck(bytes);
  });

  it("still produces a valid PDF for an ordinary odt with no embedded objects at all (the formula path never activates)", () => {
    const bytes = odtToPdf(minimalOdtBytes());
    expect(readPdf(bytes).pages.length).toBeGreaterThanOrEqual(1);
  });
});

describe("odpToPdf: an embedded formula inside a real odp slide", () => {
  it("detects the embedded formula and renders it as real MathML", () => {
    const bytes = odpToPdf(odpWithEmbeddedFormulaBytes());
    const layout = readPdf(bytes);
    expect(layout.pages).toHaveLength(1);
    qpdfCheck(bytes);
  });

  it("still produces a valid PDF for an ordinary odp with no embedded objects at all", () => {
    const bytes = odpToPdf(minimalOdpBytes());
    expect(readPdf(bytes).pages.length).toBeGreaterThanOrEqual(1);
  });
});

// --- The formula ContentDocument kind: a formula travels INSIDE the ContentDocument, with no side-channel map anywhere ---

describe("a formula as a real ContentDocument, not a side-channel map", () => {
  it("readOdtContent returns a bare ContentDocument whose formula block genuinely carries its own MathML", () => {
    const content = readOdtContent(
      decodePackage(odtWithEmbeddedFormulaBytes()),
    );
    if (content.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const block = content.sections[0]!.blocks.find(
      (b) => b.kind === "embeddedObject",
    );
    expect(block).toBeDefined();
    expect(block).toMatchObject({
      objectKind: "formula",
      document: { kind: "formula" },
    });
    if (block?.kind !== "embeddedObject" || block.document.kind !== "formula") {
      throw new Error("expected a formula-kind embedded document");
    }
    // The real MathML tree, not a plain-text stand-in: the fixture's own mfrac is right there in the ContentDocument.
    expect(block.document.formula.mathml).toHaveLength(1);
    expect(block.document.formula.mathml[0]).toMatchObject({
      type: "element",
      tag: "math:mfrac",
    });
  });

  it("readOdpContent does the same for a slide shape, replacing that shape's blocks with the formula block", () => {
    const content = readOdpContent(
      decodePackage(odpWithEmbeddedFormulaBytes()),
    );
    if (content.kind !== "presentation") {
      throw new Error("expected a presentation ContentDocument");
    }
    const [block] = content.slides[0]!.shapes[0]!.blocks;
    if (block?.kind !== "embeddedObject" || block.document.kind !== "formula") {
      throw new Error("expected a formula-kind embedded document");
    }
    expect(block.document.formula.mathml[0]).toMatchObject({
      type: "element",
      tag: "math:msqrt",
    });
  });

  it("odfToPdf now invokes onDocument with a real, non-undefined formula ContentDocument", () => {
    let captured: DocumentTree | undefined;
    const bytes = odfToPdf(
      odfFormulaBytes(FRACTION_FORMULA, { starMath: "{a} over {b}" }),
      {
        onDocument: (pkg) => {
          captured = pkg;
        },
      },
    );
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");

    expect(captured).toBeDefined();
    const capturedContent =
      captured === undefined ? undefined : flattenTree(captured);
    expect(capturedContent?.kind).toBe("formula");
    if (capturedContent?.kind !== "formula") {
      throw new Error("expected a formula ContentDocument");
    }
    expect(capturedContent.formula.starMath).toBe("{a} over {b}");
    expect(capturedContent.formula.mathml.length).toBeGreaterThan(0);
    // The pages half is a genuine single A4 page and no node carries any frame, by construction: the formula renders through writePdf's own separate formula positioning, never as page content, so there are no item placements to fuse onto content.
    expect(captured?.pages).toHaveLength(1);
    expect(captured?.pages?.[0]).toEqual(PAGE_SIZE_A4);
  });

  it("carries an odt formula through onDocument as part of the ContentDocument the conversion built", () => {
    let captured: DocumentTree | undefined;
    odtToPdf(odtWithEmbeddedFormulaBytes(), {
      onDocument: (pkg) => {
        captured = pkg;
      },
    });
    const capturedContent =
      captured === undefined ? undefined : flattenTree(captured);
    if (capturedContent?.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const block = capturedContent.sections[0]!.blocks.find(
      (b) => b.kind === "embeddedObject",
    );
    expect(
      block?.kind === "embeddedObject" && block.document.kind === "formula",
    ).toBe(true);
  });
});

// --- Where a formula frame actually IS: inline in a paragraph's run content, inside a group, inside a list item — and where its block lands as a result ---
