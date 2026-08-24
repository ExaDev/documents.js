import { describe, expect, it } from "vitest";
import { decodePackage, zipPackage } from "ooxml.js";
import { parseName } from "pdf-codec/font-tables";
import { parseSfnt } from "pdf-codec/sfnt";
import { minimalDocxPackage } from "../test-support/docx";
import { minimalPptxPackage } from "../test-support/pptx";
import {
  caladeaBoldBytes,
  caladeaItalicBytes,
  caladeaRegularBytes,
  embeddedFontDocxPackage,
  embeddedFontPptxPackage,
} from "../test-support/fonts";
import { extractOoxmlEmbeddedFonts, OoxmlEmbeddedFontError } from "./ooxml";

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

function postScriptNameOf(bytes: Uint8Array<ArrayBuffer>): string | undefined {
  const font = parseSfnt(bytes);
  return font === undefined ? undefined : parseName(font)?.postScriptName;
}

describe("extractOoxmlEmbeddedFonts (docx)", () => {
  it("recovers every embedded face with its family and bold/italic flags", () => {
    const fonts = extractOoxmlEmbeddedFonts(embeddedFontDocxPackage(), "docx");
    expect(
      fonts.map(({ family, bold, italic }) => ({ family, bold, italic })),
    ).toEqual([
      { family: "Caladea", bold: false, italic: false },
      { family: "Caladea", bold: true, italic: false },
    ]);
  });

  // The load-bearing claim: the extracted bytes are the ORIGINAL font, not the obfuscated part. The fixture obfuscated with literal key bytes quoted from ECMA-376 Part 4 2.8.1 (regular face) and never called deriveFontKey, so a wrong key derivation cannot produce these bytes -- it would fail the sfnt check inside deobfuscateEmbeddedFont before reaching here.
  it("deobfuscates each face back to its exact original font bytes", () => {
    const fonts = extractOoxmlEmbeddedFonts(embeddedFontDocxPackage(), "docx");
    expect(fonts[0]?.bytes).toEqual(caladeaRegularBytes());
    expect(fonts[1]?.bytes).toEqual(caladeaBoldBytes());
  });

  it("produces bytes that open with a real sfnt signature and parse as the expected faces", () => {
    const fonts = extractOoxmlEmbeddedFonts(embeddedFontDocxPackage(), "docx");
    for (const font of fonts) {
      expect([...font.bytes.subarray(0, 4)]).toEqual([0x00, 0x01, 0x00, 0x00]);
    }
    expect(fonts.map((font) => postScriptNameOf(font.bytes))).toEqual([
      "Caladea-Regular",
      "Caladea-Bold",
    ]);
  });

  it("returns nothing for a docx with no fontTable relationship at all", () => {
    expect(extractOoxmlEmbeddedFonts(minimalDocxPackage(), "docx")).toEqual([]);
  });

  it("throws when an embed element names a relationship id its .rels part does not declare", () => {
    const pkg = embeddedFontDocxPackage();
    const rels = pkg.parts["word/_rels/fontTable.xml.rels"];
    if (rels?.kind !== "xml") {
      throw new Error("fixture is missing its font table rels part");
    }
    rels.nodes = [];
    expect(() => extractOoxmlEmbeddedFonts(pkg, "docx")).toThrow(
      OoxmlEmbeddedFontError,
    );
  });

  it("throws when a relationship targets a part the package does not contain", () => {
    const pkg = embeddedFontDocxPackage();
    delete pkg.parts["word/fonts/font1.odttf"];
    expect(() => extractOoxmlEmbeddedFonts(pkg, "docx")).toThrow(
      OoxmlEmbeddedFontError,
    );
  });

  it("throws for a package with no officeDocument relationship", () => {
    const pkg = embeddedFontDocxPackage();
    delete pkg.parts["_rels/.rels"];
    expect(() => extractOoxmlEmbeddedFonts(pkg, "docx")).toThrow(
      OoxmlEmbeddedFontError,
    );
  });

  // Resolution goes through the package's own relationship graph rather than the conventional word/fontTable.xml path, so a producer that names the part something else still resolves.
  it("follows the relationship graph rather than assuming word/fontTable.xml", () => {
    const pkg = decodePackage(
      zipPackage({
        "[Content_Types].xml": enc(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        ),
        "_rels/.rels": enc(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/word/document.xml"/></Relationships>',
        ),
        "word/document.xml": enc(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
        ),
        "word/_rels/document.xml.rels": enc(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="typography/fonts.xml"/></Relationships>',
        ),
        "word/typography/fonts.xml": enc(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:font w:name="Caladea"><w:embedItalic r:id="rId4"/></w:font></w:fonts>',
        ),
        "word/typography/_rels/fonts.xml.rels": enc(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="../media/face.ttf"/></Relationships>',
        ),
        "word/media/face.ttf": caladeaItalicBytes(),
      }),
    );
    expect(extractOoxmlEmbeddedFonts(pkg, "docx")).toEqual([
      {
        family: "Caladea",
        bold: false,
        italic: true,
        bytes: caladeaItalicBytes(),
      },
    ]);
  });
});

describe("extractOoxmlEmbeddedFonts (pptx)", () => {
  // pptx's .fntdata parts are stored unobfuscated and its p:regular/p:italic elements carry no font key at all, so this face can only be recovered by the sniff-first half of deobfuscateEmbeddedFont.
  it("recovers unobfuscated faces declared in p:embeddedFontLst", () => {
    const fonts = extractOoxmlEmbeddedFonts(embeddedFontPptxPackage(), "pptx");
    expect(
      fonts.map(({ family, bold, italic }) => ({ family, bold, italic })),
    ).toEqual([
      { family: "Caladea", bold: false, italic: false },
      { family: "Caladea", bold: false, italic: true },
    ]);
    expect(fonts[0]?.bytes).toEqual(caladeaRegularBytes());
    expect(fonts[1]?.bytes).toEqual(caladeaItalicBytes());
    expect(fonts.map((font) => postScriptNameOf(font.bytes))).toEqual([
      "Caladea-Regular",
      "Caladea-Italic",
    ]);
  });

  it("returns nothing for a pptx with no p:embeddedFontLst", () => {
    expect(extractOoxmlEmbeddedFonts(minimalPptxPackage(), "pptx")).toEqual([]);
  });

  it("throws when a p:embeddedFont declares no p:font typeface", () => {
    const pkg = decodePackage(
      zipPackage({
        "_rels/.rels": enc(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
        ),
        "ppt/presentation.xml": enc(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:embeddedFontLst><p:embeddedFont><p:font/><p:regular r:id="rId2"/></p:embeddedFont></p:embeddedFontLst></p:presentation>',
        ),
      }),
    );
    expect(() => extractOoxmlEmbeddedFonts(pkg, "pptx")).toThrow(
      OoxmlEmbeddedFontError,
    );
  });

  it("throws when an embed element carries no r:id", () => {
    const pkg = decodePackage(
      zipPackage({
        "_rels/.rels": enc(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
        ),
        "ppt/presentation.xml": enc(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:embeddedFontLst><p:embeddedFont><p:font typeface="Caladea"/><p:regular/></p:embeddedFont></p:embeddedFontLst></p:presentation>',
        ),
      }),
    );
    expect(() => extractOoxmlEmbeddedFonts(pkg, "pptx")).toThrow(
      OoxmlEmbeddedFontError,
    );
  });
});
