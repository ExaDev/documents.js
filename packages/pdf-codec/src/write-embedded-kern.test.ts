import { createHash } from "node:crypto";
import { base64ToBytes, bytesToBase64, encodePng } from "byte-codec";
import { describe, expect, it } from "vitest";
import type { LayoutFont } from "document-schema.js";
import type { LayoutDocument, LayoutImageAsset } from "./layout";
import { LAYOUT_FORMAT_VERSION } from "./layout";
import type { EmbeddedFace } from "./embedded-font";
import { encodeForShowEmbedded, loadEmbeddedFace } from "./embedded-font";
import { createFontRegistry } from "./font-registry";
import { createFontMeasurer } from "./measure";
import { readPdf } from "./read";
import { parseSfnt } from "./sfnt";
import { STIX_TWO_MATH_FONT_BASE64 } from "./assets/stix-two-math-font";
import { carlitoRegularBytes } from "./test-support/fonts";
import { writePdf } from "./write";

// The end-to-end proof that a FontRegistry actually reaches the written PDF: a document whose text is authored in Calibri, converted with a registry whose vendored-substitute step resolves that family to the real Carlito face this package embeds, must come out carrying a genuine /Type0 + /CIDFontType2 + /FontFile2 font program rather than a standard-14 Helvetica dictionary — and must be measured against Carlito's own advances rather than Helvetica's plus the Calibri width fudge.
//
// The other half of this file is the guarantee that costs nothing to state and everything to lose: a document converted with NO registry at all must still produce byte-identical output to the build before any of this existed. That is asserted against golden SHA-256 digests captured from commit 162b24c, the last commit before embedded-font resolution was wired into writePdf (regenerate by checking that commit out and hashing writePdf's output for backwardCompatibilityDocument() below).

const BLACK = { r: 0, g: 0, b: 0 };
const RED = { r: 1, g: 0, b: 0 };
const HELVETICA = {
  family: "Helvetica",
  weight: "normal",
  style: "normal",
} as const;
const CALIBRI = {
  family: "Calibri",
  weight: "normal",
  style: "normal",
} as const;
const CALIBRI_BOLD = {
  family: "Calibri",
  weight: "bold",
  style: "normal",
} as const;
const CALIBRI_LIGHT = {
  family: "Calibri Light",
  weight: "normal",
  style: "normal",
} as const;
const CAMBRIA = {
  family: "Cambria",
  weight: "normal",
  style: "normal",
} as const;
const CAMBRIA_BOLD = {
  family: "Cambria",
  weight: "bold",
  style: "normal",
} as const;

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function carlitoRegularFace(): EmbeddedFace {
  const sfnt = parseSfnt(carlitoRegularBytes());
  if (sfnt === undefined) {
    throw new Error(
      "vendored Carlito Regular failed to parse as an sfnt container",
    );
  }
  const face = loadEmbeddedFace(sfnt);
  if (face === undefined) {
    throw new Error(
      "vendored Carlito Regular failed to load as an embeddable face",
    );
  }
  return face;
}

function textDoc(text: string, font: Readonly<LayoutFont>): LayoutDocument {
  return {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: {},
    pages: [
      {
        widthPt: 612,
        heightPt: 792,
        items: [
          {
            kind: "text",
            text,
            xPt: 72,
            yPt: 700,
            font,
            sizePt: 12,
            color: BLACK,
          },
        ],
      },
    ],
    images: {},
  };
}

// Locates the /FontFile2 stream's own payload in an uncompressed PDF: /Length1 states the UNCOMPRESSED font-program length, so with compress: false the bytes immediately after that object's `stream\n` are the embedded sfnt itself, verbatim.
describe("writePdf: pair kerning, from the font table through to a written page", () => {
  // Four adjacent pairs both families genuinely kern (AV, VA, AT, TA), a glyph repeated three times, and one final pair (AR) each font covers but adjusts by nothing.
  const KERNED_TEXT = "AVATAR";

  it("measures a kerned string narrower than its own bare advance sum, by the font's real adjustments", () => {
    const face = carlitoRegularFace();
    const measuredPt = createFontMeasurer(
      createFontRegistry(),
    ).widthOfTextAtSize(KERNED_TEXT, CALIBRI, 12);
    // Carlito Regular's own 'hmtx' advances, read out of the real .ttf with a bare DataView: A 1185, V 1162, T 998, R 1112 design units on a 2048-unit em. Their bare sum is what this package measured for this string before kerning was applied.
    const naivePt =
      (((1185 + 1162 + 1185 + 998 + 1185 + 1112) * 1000) / 2048 / 1000) * 12;
    expect(naivePt).toBeCloseTo(40.001953125, 10);
    // AV -89, VA -96, AT -160, TA -160 design units: -505 in total, or -2.958984375pt at size 12.
    expect(measuredPt).toBeCloseTo(37.04296875, 10);
    expect(measuredPt).toBeCloseTo(
      naivePt - ((505 * 1000) / 2048 / 1000) * 12,
      10,
    );
    expect(measuredPt).toBeLessThan(naivePt);
    // The measurement is the shared encode step's own answer, not a second computation that happens to agree.
    expect(measuredPt).toBeCloseTo(
      (encodeForShowEmbedded(KERNED_TEXT, face).width1000 / 1000) * 12,
      10,
    );
  });

  it("writes the adjustments into the page as a real TJ array, read straight back out of the PDF bytes", () => {
    // Cambria resolves to the vendored Caladea, whose 1000-unit em makes every TJ number the font's own declared design-unit adjustment exactly: AV 117, VA 119, AT 79, TA 79, each negated from the advance delta because a TJ number is subtracted from the current horizontal coordinate (ISO 32000-1 9.4.3).
    const text = decode(
      writePdf(textDoc(KERNED_TEXT, CAMBRIA), {
        compress: false,
        fonts: createFontRegistry(),
      }),
    );
    expect(text).toContain(
      "[<0005> 117 <001a> 119 <0005> 79 <0018> 79 <00050016>] TJ",
    );
    // The array's own strings concatenate back to exactly the CIDs an unkerned Tj would have shown — splitting the run repositions glyphs, it never changes which ones are drawn — and no unsplit Tj for this run survives alongside it.
    expect(text).not.toContain("<0005001a0005001800050016> Tj");
  });

  it("still writes a plain Tj for a run the same face kerns nothing in", () => {
    // 'Hi' is a pair Caladea says nothing about, in a face carrying thousands of pairs it does. The common case keeps its single unsplit string.
    const text = decode(
      writePdf(textDoc("Hi", CAMBRIA), {
        compress: false,
        fonts: createFontRegistry(),
      }),
    );
    expect(text).toContain("<000c0027> Tj");
    expect(text).not.toContain("TJ");
  });

  it("reads back through readPdf at the kerned positions, which is what settles the TJ sign empirically", () => {
    const item = readPdf(
      writePdf(textDoc(KERNED_TEXT, CAMBRIA), {
        compress: false,
        fonts: createFontRegistry(),
      }),
    ).pages[0]?.items[0];
    if (item?.kind !== "text") {
      throw new Error("the written page did not read back as one text item");
    }
    // Caladea's own advances for A/V/T/R (599/598/557/613, on a 1000-unit em) sum to 3565 units; its four adjustments total -394. A TJ number written with the opposite sign would recover 3565 + 394 here — WIDER than the unkerned run rather than narrower — so this is the assertion that decides the direction against this package's own reader rather than by argument from the specification alone.
    expect(item.widthPt).toBeCloseTo(((3565 - 394) / 1000) * 12, 4);
    expect(item.widthPt).toBeLessThan((3565 / 1000) * 12);
    expect(item.widthPt).not.toBeCloseTo(((3565 + 394) / 1000) * 12, 1);
    // Splitting the run across several strings must not cost the text itself: the reader concatenates them and recovers the whole string through the same ToUnicode CMap.
    expect(item.text).toBe(KERNED_TEXT);
  });
});

describe("writePdf: backward compatibility with no registry supplied", () => {
  function pngAsset(): LayoutImageAsset {
    const data = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
    return {
      format: "png",
      base64: bytesToBase64(
        encodePng({ width: 2, height: 2, channels: 3, data }),
      ),
      widthPx: 2,
      heightPx: 2,
    };
  }

  // Deliberately exercises every object kind writePdf allocates — three distinct standard-14 faces (two of them, Calibri and Cambria, families that WOULD have resolved to an embedded vendored substitute had a registry been supplied), an underlined run, each vector item kind, an image with its own XObject, a link annotation, hidden speaker notes, and Info metadata — so a change to any allocation order, resource-dict key, or content-stream operator shows up as a digest mismatch rather than passing unnoticed.
  function backwardCompatibilityDocument(): LayoutDocument {
    return {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {
        title: "Backward compatibility",
        author: "pdf-codec",
        createdIso: "2024-01-02T03:04:05.000Z",
      },
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          notes: "speaker notes",
          items: [
            {
              kind: "text",
              text: "Hello World",
              xPt: 72,
              yPt: 700,
              font: HELVETICA,
              sizePt: 12,
              color: BLACK,
            },
            {
              kind: "text",
              text: "Calibri body text",
              xPt: 72,
              yPt: 680,
              font: CALIBRI,
              sizePt: 11,
              color: BLACK,
              underline: true,
            },
            {
              kind: "text",
              text: "Cambria heading",
              xPt: 72,
              yPt: 650,
              font: CAMBRIA_BOLD,
              sizePt: 14,
              color: RED,
            },
            {
              kind: "rect",
              xPt: 72,
              yPt: 600,
              widthPt: 100,
              heightPt: 20,
              fill: RED,
            },
            {
              kind: "line",
              x1Pt: 72,
              y1Pt: 590,
              x2Pt: 172,
              y2Pt: 590,
              color: BLACK,
              widthPt: 1,
            },
            {
              kind: "ellipse",
              xPt: 72,
              yPt: 540,
              widthPt: 40,
              heightPt: 30,
              fill: BLACK,
              stroke: { color: RED, widthPt: 2 },
            },
            {
              kind: "path",
              subpaths: [
                {
                  startXPt: 200,
                  startYPt: 500,
                  closed: true,
                  segments: [
                    { kind: "line", xPt: 260, yPt: 500 },
                    {
                      kind: "cubic",
                      c1xPt: 280,
                      c1yPt: 500,
                      c2xPt: 280,
                      c2yPt: 440,
                      xPt: 240,
                      yPt: 440,
                    },
                  ],
                },
              ],
              fill: RED,
            },
            {
              kind: "image",
              imageId: "logo",
              xPt: 400,
              yPt: 600,
              widthPt: 50,
              heightPt: 50,
            },
            {
              kind: "link",
              uri: "https://example.com",
              xPt: 72,
              yPt: 400,
              widthPt: 120,
              heightPt: 14,
            },
          ],
        },
      ],
      images: { logo: pngAsset() },
    };
  }

  // Captured at commit 162b24c (the last commit before embedded-font resolution was wired into measurement and PDF text writing) by hashing writePdf(backwardCompatibilityDocument()) for both compression settings. A mismatch here means output drifted for a caller that supplied no font configuration at all — the one thing this whole change is not allowed to do.
  const GOLDEN_UNCOMPRESSED_SHA256 =
    "69fcab0328798b0992e45515fb8bf63eeaa346daf67dec215653bd512fec0b2a";
  const GOLDEN_COMPRESSED_SHA256 =
    "b73454d18df3e52db6680e7d5a1ddedc97befad0d5b9f7661667173c8365e0f7";

  it("produces byte-identical uncompressed output to the pre-embedded-font build", () => {
    expect(
      sha256(writePdf(backwardCompatibilityDocument(), { compress: false })),
    ).toBe(GOLDEN_UNCOMPRESSED_SHA256);
  });

  it("produces byte-identical compressed output to the pre-embedded-font build", () => {
    expect(sha256(writePdf(backwardCompatibilityDocument()))).toBe(
      GOLDEN_COMPRESSED_SHA256,
    );
  });

  it("embeds no font program at all, and still resolves Calibri and Cambria to standard-14 faces", () => {
    const text = decode(
      writePdf(backwardCompatibilityDocument(), { compress: false }),
    );
    expect(text).not.toContain("/FontFile2");
    expect(text).not.toContain("/Subtype /Type0");
    expect(text).not.toContain("/E1 ");
    expect(text).toContain("/BaseFont /Helvetica");
    expect(text).toContain("/BaseFont /Times-Bold");
    // Calibri still measures and draws through the standard-14 width correction, exactly as before.
    expect(text).toContain("92 Tz");
  });
});

describe("writePdf: GSUB ligature shaping through the vendored faces", () => {
  it("draws a ligature glyph where the face's own GSUB declares one, not its component glyphs", () => {
    const face = carlitoRegularFace();
    // 'office' shapes to four glyphs (o, ffi-ligature, c, e) through the face's own 'liga' feature, so the shown codes carry four 2-byte CIDs, not six.
    expect(encodeForShowEmbedded("office", face).codes.length).toBe(8);
  });

  it("round-trips ligature text through the written PDF's own ToUnicode mapping", () => {
    // 'office fluff' exercises all three ligature lengths this face carries: ffi inside 'office', and fl plus ff inside 'fluff'.
    const bytes = writePdf(textDoc("office fluff", CALIBRI), {
      compress: false,
      fonts: createFontRegistry(),
    });
    const text = decode(bytes);
    // The ffi ligature glyph (76) maps to its whole three-character run — the bfchar destination a copy/paste recovers — proving the ToUnicode CMap carries multi-character sequences and the subset retained the ligature glyph no single code point's cmap entry reaches.
    expect(text).toContain("<004c> <006600660069>");
    // And the read side puts those sequences back together as the original text.
    const reread = readPdf(bytes);
    const item = reread.pages[0]?.items[0];
    expect(item?.kind).toBe("text");
    expect(item?.kind === "text" ? item.text : "").toBe("office fluff");
  });
});

describe("the vendored-substitute step's Calibri Light report", () => {
  it("reports the family substitution a caller can act on, weight mismatch included in the family change", () => {
    const reports: {
      readonly requestedFamily: string;
      readonly reason: string;
      readonly resolvedFamily: string;
    }[] = [];
    const registry = createFontRegistry({
      onSubstitution: (report) => {
        reports.push(report);
      },
    });
    const resolved = registry.resolve(CALIBRI_LIGHT);
    // No genuine Light face exists to vendor (Carlito ships one weight per style axis), so the honest outcome is the documented approximation — ordinary-weight Carlito — REPORTED rather than silent. This pins that the report fires, so it cannot quietly regress into a silent substitution.
    expect(resolved.kind).toBe("embedded");
    expect(reports).toContainEqual({
      requestedFamily: "Calibri Light",
      requestedBold: false,
      requestedItalic: false,
      reason: "vendored-substitute",
      resolvedFamily: "carlito",
    });
  });
});

describe("writePdf: embedded face allocation, ordering and subsetting inputs", () => {
  function textItems(
    entries: readonly {
      readonly text: string;
      readonly font: LayoutFont;
      readonly yPt: number;
    }[],
  ) {
    return entries.map(({ text, font, yPt }) => ({
      kind: "text" as const,
      text,
      xPt: 72,
      yPt,
      font,
      sizePt: 12,
      color: BLACK,
    }));
  }

  it("assigns resource names by PostScript-name sort order, so the second item's face names E1", () => {
    // Encounter order is Regular then Bold; sorted order is Bold then Regular, so the bold face
    // must be E1 and the regular E2 — pinned by which resource each run's Tf actually names.
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          items: textItems([
            { text: "regular", font: CALIBRI, yPt: 700 },
            { text: "bold", font: CALIBRI_BOLD, yPt: 680 },
          ]),
        },
      ],
      images: {},
    };
    const text = decode(
      writePdf(doc, { compress: false, fonts: createFontRegistry() }),
    );
    expect(text).toContain("/Size 16 ");
    expect(text).toContain("/E2 12 Tf");
    expect(text).toContain("/E1 12 Tf");
  });

  it("orders four faces' object groups by PostScript name, however they are encountered", () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          items: textItems([
            { text: "a", font: CAMBRIA_BOLD, yPt: 700 },
            { text: "b", font: CALIBRI_BOLD, yPt: 680 },
            { text: "c", font: CAMBRIA, yPt: 660 },
            { text: "d", font: CALIBRI, yPt: 640 },
          ]),
        },
      ],
      images: {},
    };
    const text = decode(
      writePdf(doc, { compress: false, fonts: createFontRegistry() }),
    );
    // Caladea-Bold < Caladea-Regular < Carlito-Bold < Carlito-Regular (the "Cal" families sort
    // before the "Car" ones): the four groups' /BaseFont tags appear in the file in exactly that
    // order, which only the sort can produce, and each run's Tf names its own face's slot in it.
    const boldCaladea = text.indexOf("Caladea-Bold");
    const regularCaladea = text.indexOf("Caladea-Regular");
    const boldCarlito = text.indexOf("Carlito-Bold");
    const regularCarlito = text.indexOf("Carlito-Regular");
    expect(boldCaladea).toBeGreaterThanOrEqual(0);
    expect(boldCaladea).toBeLessThan(regularCaladea);
    expect(regularCaladea).toBeLessThan(boldCarlito);
    expect(boldCarlito).toBeLessThan(regularCarlito);
    // Encounter order was Caladea-Bold, Carlito-Bold, Caladea-Regular, Carlito-Regular.
    expect(text).toContain("/E1 12 Tf");
    expect(text).toContain("/E3 12 Tf");
    expect(text).toContain("/E2 12 Tf");
    expect(text).toContain("/E4 12 Tf");
  });

  it("subsets to exactly the shaped and code-point-derived glyph set of the document's own text", () => {
    // 'office fluff' shapes ligatures (ffi, fl, ff) while its raw code points still cover every
    // letter: the subset's size and its CRC32 subset tag are both functions of exactly that glyph
    // list, so a seeded or reordered input list moves either one.
    const bytes = writePdf(textDoc("office fluff", CALIBRI), {
      compress: false,
      fonts: createFontRegistry(),
    });
    const text = decode(bytes);
    expect(text).toContain("/BaseFont /YLSGNX+Carlito-Regular");
    expect(text).toContain("/Length1 28632");
    expect(text).toContain("/Size 11 ");
  });

  it("subsets a digits-only document without pulling in any letter glyph", () => {
    const bytes = writePdf(textDoc("0123", CALIBRI), {
      compress: false,
      fonts: createFontRegistry(),
    });
    const text = decode(bytes);
    // The ToUnicode CMap covers exactly the digits' code points; a stray seed string would add
    // letter mappings (S is 0053) that nothing in the document drew.
    expect(text).toContain("<0030>");
    expect(text).not.toContain("<0053>");
    expect(text).not.toContain("<0057>");
  });

  it("refuses to embed a face whose outlines cannot be subsetted, naming the face", () => {
    // STIX Two Math is CFF-flavoured: sfnt-subset rebuilds 'glyf' and refuses anything without it.
    const fonts = createFontRegistry({
      fonts: [
        {
          family: "MathSource",
          bold: false,
          italic: false,
          bytes: base64ToBytes(STIX_TWO_MATH_FONT_BASE64),
        },
      ],
    });
    const doc = textDoc("x", {
      family: "MathSource",
      weight: "normal",
      style: "normal",
    });
    expect(() => writePdf(doc, { fonts })).toThrow(
      /font "STIXTwoMath" resolved to an embeddable face, but its glyph outlines could not be subsetted/,
    );
  });
});

describe("writePdf: faces sharing one PostScript name", () => {
  it("keeps first-encountered order between three faces whose programs all spell the same name", () => {
    // Three byte-distinct copies of one font resolve to three distinct faces whose PostScript
    // names are identical (embedded-font's face cache is keyed by the bytes object, so copies
    // parse separately). The sort comparator returns 0 for every pair and sort's stability is
    // what keeps the encounter order — pinned here by which resource name each size's run picks.
    const fonts = createFontRegistry({
      fonts: [
        {
          family: "FamilyA",
          bold: false,
          italic: false,
          bytes: carlitoRegularBytes(),
        },
        {
          family: "FamilyB",
          bold: false,
          italic: false,
          bytes: new Uint8Array(carlitoRegularBytes()),
        },
        {
          family: "FamilyC",
          bold: false,
          italic: false,
          bytes: new Uint8Array(carlitoRegularBytes()),
        },
      ],
    });
    const run = (family: string, yPt: number, sizePt: number) => ({
      kind: "text" as const,
      text: "x",
      xPt: 72,
      yPt,
      font: { family, weight: "normal" as const, style: "normal" as const },
      sizePt,
      color: BLACK,
    });
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          items: [
            run("FamilyA", 700, 12),
            run("FamilyB", 680, 13),
            run("FamilyC", 660, 14),
          ],
        },
      ],
      images: {},
    };
    const text = decode(writePdf(doc, { compress: false, fonts }));
    expect(text).toContain("/E1 12 Tf");
    expect(text).toContain("/E2 13 Tf");
    expect(text).toContain("/E3 14 Tf");
  });
});
