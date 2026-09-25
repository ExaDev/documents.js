import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "byte-codec";
import { zipPackage } from "../zip";
import { hasUtf8Bom, parsePackage } from "./read";

// parsePackage's own XML-vs-binary routing (looksLikeXml) is not exported, so every case here drives it indirectly through a real zip part's classification. The function's own contract note explains why a misclassification can only ever go one way: no standard ODF binary part starts with '<', so a false positive here would misparse a binary part as XML, while a false negative just stores an XML part losslessly as base64 instead — these tests pin both directions and every byte-level boundary the scan's own whitespace/'<' checks depend on. hasUtf8Bom itself is exported and tested directly below, since a wrongly-detected BOM and a correctly-rejected one can otherwise happen to produce the same XML/binary verdict downstream (a too-short array still ends the scan at the same byte either way), making the boundary untestable through parsePackage alone.

function packageWithOnePart(bytes: Uint8Array<ArrayBuffer>) {
  const zipBytes = zipPackage([["part", { bytes }]]);
  return parsePackage(zipBytes);
}

// Mirrors read.ts's own private byte constants, since looksLikeXml's classification is exercised only indirectly here (see the file-level comment above).
const UTF8_BOM_BYTE_1 = 0xef;
const UTF8_BOM_BYTE_2 = 0xbb;
const UTF8_BOM_BYTE_3 = 0xbf;
const ASCII_SPACE = 0x20;
const ASCII_TAB = 0x09;
const ASCII_LF = 0x0a;
const ASCII_CR = 0x0d;
const ASCII_LESS_THAN_MINUS_ONE = 0x3b; // ';', one below '<' (0x3c)
const ASCII_LESS_THAN_PLUS_ONE = 0x3d; // '=', one above '<' (0x3c)
const ARBITRARY_BYTE = 0x00;

describe("hasUtf8Bom", () => {
  it("recognises the exact three-byte BOM", () => {
    expect(
      hasUtf8Bom(
        new Uint8Array([UTF8_BOM_BYTE_1, UTF8_BOM_BYTE_2, UTF8_BOM_BYTE_3]),
      ),
    ).toBe(true);
  });

  it("recognises a BOM followed by more bytes", () => {
    expect(
      hasUtf8Bom(
        new Uint8Array([
          UTF8_BOM_BYTE_1,
          UTF8_BOM_BYTE_2,
          UTF8_BOM_BYTE_3,
          ARBITRARY_BYTE,
        ]),
      ),
    ).toBe(true);
  });

  it("rejects an empty array", () => {
    expect(hasUtf8Bom(new Uint8Array([]))).toBe(false);
  });

  it("rejects an array shorter than the BOM even when every present byte matches", () => {
    expect(hasUtf8Bom(new Uint8Array([UTF8_BOM_BYTE_1]))).toBe(false);
    expect(hasUtf8Bom(new Uint8Array([UTF8_BOM_BYTE_1, UTF8_BOM_BYTE_2]))).toBe(
      false,
    );
  });

  it("rejects a full-length array whose first byte doesn't match", () => {
    expect(
      hasUtf8Bom(
        new Uint8Array([ARBITRARY_BYTE, UTF8_BOM_BYTE_2, UTF8_BOM_BYTE_3]),
      ),
    ).toBe(false);
  });

  it("rejects a full-length array whose second byte doesn't match", () => {
    expect(
      hasUtf8Bom(
        new Uint8Array([UTF8_BOM_BYTE_1, ARBITRARY_BYTE, UTF8_BOM_BYTE_3]),
      ),
    ).toBe(false);
  });

  it("rejects a full-length array whose third byte doesn't match", () => {
    expect(
      hasUtf8Bom(
        new Uint8Array([UTF8_BOM_BYTE_1, UTF8_BOM_BYTE_2, ARBITRARY_BYTE]),
      ),
    ).toBe(false);
  });
});

describe("parsePackage: XML vs binary part classification", () => {
  it("classifies a part starting directly with '<' as xml", () => {
    const pkg = packageWithOnePart(new TextEncoder().encode("<a/>"));
    expect(pkg.parts.part?.kind).toBe("xml");
  });

  it("classifies an empty part as binary — the scan loop never runs at all", () => {
    const pkg = packageWithOnePart(new Uint8Array(0));
    expect(pkg.parts.part?.kind).toBe("binary");
  });

  it("classifies a part that is entirely whitespace as binary — the loop runs to completion without ever finding a non-whitespace byte", () => {
    const pkg = packageWithOnePart(
      new Uint8Array([ASCII_SPACE, ASCII_TAB, ASCII_LF, ASCII_CR]),
    );
    expect(pkg.parts.part?.kind).toBe("binary");
  });

  it("skips a leading UTF-8 BOM before checking for '<'", () => {
    const bomThenXml = new Uint8Array([
      UTF8_BOM_BYTE_1,
      UTF8_BOM_BYTE_2,
      UTF8_BOM_BYTE_3,
      ...new TextEncoder().encode("<a/>"),
    ]);
    const pkg = packageWithOnePart(bomThenXml);
    expect(pkg.parts.part?.kind).toBe("xml");
  });

  it("classifies a lone BOM with nothing after it as binary, not xml", () => {
    const pkg = packageWithOnePart(
      new Uint8Array([UTF8_BOM_BYTE_1, UTF8_BOM_BYTE_2, UTF8_BOM_BYTE_3]),
    );
    expect(pkg.parts.part?.kind).toBe("binary");
  });

  it("skips mixed leading whitespace (space, tab, LF, CR, in that order) before finding '<'", () => {
    const bytes = new TextEncoder().encode("  \t\n\r<a/>");
    const pkg = packageWithOnePart(bytes);
    expect(pkg.parts.part?.kind).toBe("xml");
  });

  it("treats a byte immediately adjacent to each whitespace value as non-whitespace, ending the scan on it", () => {
    // One below space, one below tab, one above LF, one above CR. None of these may be mistaken for the whitespace byte beside it.
    const belowSpace = ASCII_SPACE - 1;
    const belowTab = ASCII_TAB - 1;
    const aboveLf = ASCII_LF + 1;
    const aboveCr = ASCII_CR + 1;
    const hexRadix = 16;
    for (const nonWhitespace of [belowSpace, belowTab, aboveLf, aboveCr]) {
      const pkg = packageWithOnePart(new Uint8Array([nonWhitespace]));
      expect(
        pkg.parts.part?.kind,
        `byte 0x${nonWhitespace.toString(hexRadix)}`,
      ).toBe("binary");
    }
  });

  it("classifies real binary content (a PNG magic number) as binary, storing it losslessly as base64", () => {
    // The real 8-byte PNG signature (ISO/IEC 15948 5.2), derived from its own ASCII/control-character reading.
    const bytes = new Uint8Array(
      Array.from("\x89PNG\r\n\x1a\n", (c) => c.charCodeAt(0)),
    );
    const pkg = packageWithOnePart(bytes);
    const part = pkg.parts.part;
    expect(part?.kind).toBe("binary");
    if (part?.kind === "binary") {
      expect(part.base64).toBe(bytesToBase64(bytes));
    }
  });

  it("treats the byte one above '<' ('=') as not xml", () => {
    const pkg = packageWithOnePart(new Uint8Array([ASCII_LESS_THAN_PLUS_ONE]));
    expect(pkg.parts.part?.kind).toBe("binary");
  });

  it("treats the byte one below '<' (';') as not xml", () => {
    const pkg = packageWithOnePart(new Uint8Array([ASCII_LESS_THAN_MINUS_ONE]));
    expect(pkg.parts.part?.kind).toBe("binary");
  });

  it("classifies a real XML declaration (not just a bare element) as xml", () => {
    const pkg = packageWithOnePart(
      new TextEncoder().encode('<?xml version="1.0"?><a/>'),
    );
    expect(pkg.parts.part?.kind).toBe("xml");
  });
});

describe("parsePackage: routes multiple parts independently", () => {
  it("classifies each part in a multi-part package on its own merits, keyed by its own path", () => {
    const binaryContentBytes = Array.from({ length: 3 }, (_, i) => i + 1);
    const zipBytes = zipPackage([
      ["a.xml", { bytes: new TextEncoder().encode("<a/>") }],
      ["b.bin", { bytes: new Uint8Array(binaryContentBytes) }],
    ]);
    const pkg = parsePackage(zipBytes);
    expect(pkg.parts["a.xml"]?.kind).toBe("xml");
    expect(pkg.parts["b.bin"]?.kind).toBe("binary");
  });
});
