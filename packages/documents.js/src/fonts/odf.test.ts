import { describe, expect, it } from "vitest";
import { decodePackage, ODF_MEDIA_TYPES, zipPackage } from "odf.js";
import { parseName } from "pdf-codec/font-tables";
import { parseSfnt } from "pdf-codec/sfnt";
import { minimalOdtPackage } from "../test-support/odt";
import {
  caladeaBoldBytes,
  caladeaItalicBytes,
  caladeaRegularBytes,
  embeddedFontOdtPackage,
} from "../test-support/fonts";
import { extractOdfEmbeddedFonts, OdfEmbeddedFontError } from "./odf";

const ODF_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0"';

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

function postScriptNameOf(bytes: Uint8Array<ArrayBuffer>): string | undefined {
  const font = parseSfnt(bytes);
  return font === undefined ? undefined : parseName(font)?.postScriptName;
}

// A single-part odt carrying one office:font-face-decls block in content.xml, so a test can vary just the declaration markup.
function odtWithFontFaceDecls(
  decls: string,
  fontParts: Record<string, Uint8Array<ArrayBuffer>>,
) {
  return decodePackage(
    zipPackage([
      ["mimetype", { bytes: enc(ODF_MEDIA_TYPES.odt), stored: true }],
      [
        "content.xml",
        {
          bytes: enc(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${ODF_NS}><office:font-face-decls>${decls}</office:font-face-decls><office:body><office:text/></office:body></office:document-content>`,
          ),
        },
      ],
      ...Object.entries(fontParts).map(
        ([path, bytes]) => [path, { bytes }] as const,
      ),
    ]),
  );
}

describe("extractOdfEmbeddedFonts", () => {
  it("recovers every embedded face with its family and the exact font bytes", () => {
    const fonts = extractOdfEmbeddedFonts(embeddedFontOdtPackage());
    expect(
      fonts.map(({ family, bold, italic }) => ({ family, bold, italic })),
    ).toEqual([
      { family: "Caladea", bold: false, italic: false },
      { family: "Caladea", bold: true, italic: false },
    ]);
    expect(fonts[0]?.bytes).toEqual(caladeaRegularBytes());
    expect(fonts[1]?.bytes).toEqual(caladeaBoldBytes());
    expect(fonts.map((font) => postScriptNameOf(font.bytes))).toEqual([
      "Caladea-Regular",
      "Caladea-Bold",
    ]);
  });

  // The fixture repeats the identical office:font-face-decls block in content.xml AND styles.xml, exactly as a real LibreOffice-saved document does -- two declarations of one embedded face must not become two faces.
  it("de-duplicates a face declared in both content.xml and styles.xml", () => {
    expect(extractOdfEmbeddedFonts(embeddedFontOdtPackage())).toHaveLength(2);
  });

  // The bold face in the fixture carries NO loext:font-weight at all, so its bold flag can only have come from the font's own OS/2 fsSelection bits.
  it("falls back to the font file own OS/2 fsSelection bits when loext attributes are absent", () => {
    const fonts = extractOdfEmbeddedFonts(embeddedFontOdtPackage());
    expect(fonts[1]?.bold).toBe(true);
    expect(fonts[1]?.italic).toBe(false);
  });

  it("reads italic from the font file own OS/2 fsSelection bits", () => {
    const fonts = extractOdfEmbeddedFonts(
      odtWithFontFaceDecls(
        '<style:font-face style:name="Caladea" svg:font-family="Caladea"><svg:font-face-src><svg:font-face-uri xlink:href="Fonts/x.ttf"><svg:font-face-format svg:string="truetype"/></svg:font-face-uri></svg:font-face-src></style:font-face>',
        { "Fonts/x.ttf": caladeaItalicBytes() },
      ),
    );
    expect(fonts.map(({ bold, italic }) => ({ bold, italic }))).toEqual([
      { bold: false, italic: true },
    ]);
  });

  // A declared loext attribute is the producer's own claim about the file and wins over the file's self-description, so a producer that deliberately registers a bold face under a regular slot is honoured.
  it.each([
    ["bold", "normal", true, false],
    ["700", "italic", true, true],
    ["600", "oblique", true, true],
    ["normal", "normal", false, false],
    ["400", "normal", false, false],
  ])(
    "resolves loext:font-weight=%s loext:font-style=%s to bold=%s italic=%s",
    (weight, style, bold, italic) => {
      const fonts = extractOdfEmbeddedFonts(
        odtWithFontFaceDecls(
          `<style:font-face style:name="Caladea" svg:font-family="Caladea"><svg:font-face-src><svg:font-face-uri xlink:href="Fonts/x.ttf" loext:font-weight="${weight}" loext:font-style="${style}"/></svg:font-face-src></style:font-face>`,
          { "Fonts/x.ttf": caladeaRegularBytes() },
        ),
      );
      expect(
        fonts.map((font) => ({ bold: font.bold, italic: font.italic })),
      ).toEqual([{ bold, italic }]);
    },
  );

  // LibreOffice quotes any CSS font-family value containing a space, and may list generic fallbacks after it -- neither belongs in the family name a font registry matches on.
  it.each([
    ["&apos;Liberation Serif&apos;", "Liberation Serif"],
    ["&quot;Noto Sans&quot;, sans-serif", "Noto Sans"],
    ["Caladea", "Caladea"],
  ])("normalises svg:font-family %s to %s", (declared, expected) => {
    const fonts = extractOdfEmbeddedFonts(
      odtWithFontFaceDecls(
        `<style:font-face style:name="F1" svg:font-family="${declared}"><svg:font-face-src><svg:font-face-uri xlink:href="Fonts/x.ttf"/></svg:font-face-src></style:font-face>`,
        { "Fonts/x.ttf": caladeaRegularBytes() },
      ),
    );
    expect(fonts[0]?.family).toBe(expected);
  });

  it("falls back to style:name when the face declares no svg:font-family", () => {
    const fonts = extractOdfEmbeddedFonts(
      odtWithFontFaceDecls(
        '<style:font-face style:name="Caladea"><svg:font-face-src><svg:font-face-uri xlink:href="Fonts/x.ttf"/></svg:font-face-src></style:font-face>',
        {
          "Fonts/x.ttf": caladeaRegularBytes(),
        },
      ),
    );
    expect(fonts[0]?.family).toBe("Caladea");
  });

  // A style:font-face with no svg:font-face-src is the overwhelmingly common case: it names a font the document REFERS to, without embedding it.
  it("ignores a font face that declares no embedded source", () => {
    expect(
      extractOdfEmbeddedFonts(
        odtWithFontFaceDecls(
          '<style:font-face style:name="Caladea" svg:font-family="Caladea"/>',
          {},
        ),
      ),
    ).toEqual([]);
  });

  it("returns nothing for an odt with no office:font-face-decls at all", () => {
    expect(extractOdfEmbeddedFonts(minimalOdtPackage())).toEqual([]);
  });

  it("throws when a svg:font-face-uri references a part the package does not contain", () => {
    expect(() =>
      extractOdfEmbeddedFonts(
        odtWithFontFaceDecls(
          '<style:font-face style:name="Caladea" svg:font-family="Caladea"><svg:font-face-src><svg:font-face-uri xlink:href="Fonts/missing.ttf"/></svg:font-face-src></style:font-face>',
          {},
        ),
      ),
    ).toThrow(OdfEmbeddedFontError);
  });

  it("throws when a svg:font-face-uri carries no xlink:href", () => {
    expect(() =>
      extractOdfEmbeddedFonts(
        odtWithFontFaceDecls(
          '<style:font-face style:name="Caladea" svg:font-family="Caladea"><svg:font-face-src><svg:font-face-uri/></svg:font-face-src></style:font-face>',
          {},
        ),
      ),
    ).toThrow(OdfEmbeddedFontError);
  });

  // ODF embeds fonts unmodified, so a part that is not already a recognisable font is a broken package rather than something to sniff a font key for -- there is no key anywhere in an ODF package to try.
  it("throws when an embedded part is not a recognisable font", () => {
    expect(() =>
      extractOdfEmbeddedFonts(
        odtWithFontFaceDecls(
          '<style:font-face style:name="Caladea" svg:font-family="Caladea"><svg:font-face-src><svg:font-face-uri xlink:href="Fonts/x.ttf"/></svg:font-face-src></style:font-face>',
          {
            "Fonts/x.ttf": new Uint8Array(64),
          },
        ),
      ),
    ).toThrow(OdfEmbeddedFontError);
  });
});
