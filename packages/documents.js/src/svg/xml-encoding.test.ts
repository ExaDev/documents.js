import { describe, expect, it } from "vitest";
import {
  detectSvgEncoding,
  mapXmlEncodingLabel,
  readXmlEncodingDeclarationLabel,
} from "./xml-encoding";

function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

describe("mapXmlEncodingLabel", () => {
  it("maps the six canonical labels decodeText itself uses", () => {
    expect(mapXmlEncodingLabel("UTF-8")).toBe("utf-8");
    expect(mapXmlEncodingLabel("UTF-16LE")).toBe("utf-16le");
    expect(mapXmlEncodingLabel("UTF-16BE")).toBe("utf-16be");
    expect(mapXmlEncodingLabel("UTF-32LE")).toBe("utf-32le");
    expect(mapXmlEncodingLabel("UTF-32BE")).toBe("utf-32be");
    expect(mapXmlEncodingLabel("windows-1252")).toBe("windows-1252");
  });

  it("maps ISO-8859-1 and its common aliases onto windows-1252, per the WHATWG Encoding Standard's own compatibility mapping", () => {
    expect(mapXmlEncodingLabel("ISO-8859-1")).toBe("windows-1252");
    expect(mapXmlEncodingLabel("latin1")).toBe("windows-1252");
    expect(mapXmlEncodingLabel("us-ascii")).toBe("windows-1252");
    expect(mapXmlEncodingLabel("cp1252")).toBe("windows-1252");
  });

  it("matches case-insensitively", () => {
    expect(mapXmlEncodingLabel("iso-8859-1")).toBe("windows-1252");
    expect(mapXmlEncodingLabel("Iso-8859-1")).toBe("windows-1252");
    expect(mapXmlEncodingLabel("ISO-8859-1")).toBe("windows-1252");
  });

  it("returns undefined for a legacy CJK or Cyrillic code page, and for a name it does not recognise at all", () => {
    expect(mapXmlEncodingLabel("Shift_JIS")).toBe(undefined);
    expect(mapXmlEncodingLabel("GBK")).toBe(undefined);
    expect(mapXmlEncodingLabel("KOI8-R")).toBe(undefined);
    expect(mapXmlEncodingLabel("not-a-real-encoding")).toBe(undefined);
  });
});

describe("readXmlEncodingDeclarationLabel", () => {
  it("reads a double-quoted encoding value", () => {
    expect(
      readXmlEncodingDeclarationLabel(
        asciiBytes('<?xml version="1.0" encoding="ISO-8859-1"?><svg/>'),
      ),
    ).toBe("ISO-8859-1");
  });

  it("reads a single-quoted encoding value", () => {
    expect(
      readXmlEncodingDeclarationLabel(
        asciiBytes("<?xml version='1.0' encoding='UTF-16LE'?><svg/>"),
      ),
    ).toBe("UTF-16LE");
  });

  it("reads the encoding value regardless of whitespace around the =", () => {
    expect(
      readXmlEncodingDeclarationLabel(
        asciiBytes('<?xml version="1.0" encoding = "UTF-8"?><svg/>'),
      ),
    ).toBe("UTF-8");
  });

  it("returns undefined when there is no <?xml declaration at all", () => {
    expect(
      readXmlEncodingDeclarationLabel(
        asciiBytes('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      ),
    ).toBe(undefined);
  });

  it("returns undefined when the declaration is present but names no encoding", () => {
    expect(
      readXmlEncodingDeclarationLabel(
        asciiBytes('<?xml version="1.0"?><svg/>'),
      ),
    ).toBe(undefined);
  });

  it("returns undefined when the leading bytes do not start with <?xml, even if 'encoding=' appears later", () => {
    expect(
      readXmlEncodingDeclarationLabel(
        asciiBytes('<svg><!-- encoding="ISO-8859-1" --></svg>'),
      ),
    ).toBe(undefined);
  });

  it("never matches an encoding attribute that appears after the declaration's own close", () => {
    expect(
      readXmlEncodingDeclarationLabel(
        asciiBytes('<?xml version="1.0"?><svg encoding="ISO-8859-1"></svg>'),
      ),
    ).toBe(undefined);
  });
});

describe("detectSvgEncoding", () => {
  it("resolves from a byte order mark, without reading any declaration", () => {
    const bytes = Uint8Array.from([
      0xff,
      0xfe,
      ...asciiBytes('<?xml version="1.0" encoding="ISO-8859-1"?>'),
    ]);
    expect(detectSvgEncoding(bytes)).toEqual({
      kind: "resolved",
      encoding: "utf-16le",
    });
  });

  it("resolves from the declared encoding when there is no byte order mark", () => {
    expect(
      detectSvgEncoding(
        asciiBytes('<?xml version="1.0" encoding="ISO-8859-1"?><svg/>'),
      ),
    ).toEqual({ kind: "resolved", encoding: "windows-1252" });
  });

  it("reports unsupported when the declared encoding is outside decodeText's own bounded set", () => {
    expect(
      detectSvgEncoding(
        asciiBytes('<?xml version="1.0" encoding="Shift_JIS"?><svg/>'),
      ),
    ).toEqual({ kind: "unsupported", label: "Shift_JIS" });
  });

  it("returns undefined when there is neither a byte order mark nor a declaration", () => {
    expect(
      detectSvgEncoding(
        asciiBytes('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      ),
    ).toBe(undefined);
  });
});
