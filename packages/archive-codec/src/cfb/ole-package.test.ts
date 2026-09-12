import { describe, expect, it } from "vitest";
import {
  OlePackageFormatError,
  OlePackageWriteError,
  readOlePackage,
  writeOlePackage,
} from "./ole-package";

// Coverage for the OLE Package stream unwrapping (src/cfb/ole-package.ts): the [MS-OLEDS]-family packaging a Word/PowerPoint compound-file embed wraps the real file in before storing it as the 'Package' stream. Fixtures are built inline (the layout is a short run of length-prefixed fields) rather than through the compound-file writer, so the byte construction here is an independent spelling of the format the module must parse.

const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

// The Package stream layout: a uint16 header word, the label and source path as null-terminated strings, 8 opaque bytes, the temp path as a null-terminated string, then the file's byte count and the file bytes themselves.
function packageStream(
  label: string,
  sourcePath: string,
  tempPath: string,
  fileBytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const zstring = (s: string): Uint8Array<ArrayBuffer> => enc(`${s}\0`);
  const parts = [
    new Uint8Array([0x02, 0x00]),
    zstring(label),
    zstring(sourcePath),
    new Uint8Array(8),
    zstring(tempPath),
    new Uint8Array(4),
    fileBytes,
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  new DataView(out.buffer).setUint32(
    out.length - fileBytes.length - 4,
    fileBytes.length,
    true,
  );
  return out;
}

describe("readOlePackage", () => {
  it("unwraps the packaged file bytes and the descriptive strings around them", () => {
    const fileBytes = enc("the real embedded file");
    const pkg = readOlePackage(
      packageStream(
        "Book1.xlsx",
        "C:\\data\\Book1.xlsx",
        "C:\\users\\joe\\AppData\\Local\\Temp\\Book1.xlsx",
        fileBytes,
      ),
    );
    expect(pkg.label).toBe("Book1.xlsx");
    expect(pkg.sourcePath).toBe("C:\\data\\Book1.xlsx");
    expect(pkg.tempPath).toBe(
      "C:\\users\\joe\\AppData\\Local\\Temp\\Book1.xlsx",
    );
    expect(pkg.fileBytes).toEqual(fileBytes);
  });

  it("ignores trailing bytes after the file data (the optional wide-string tail)", () => {
    // Real producers append wide-character repeats of the paths after the file bytes; the packaged file's extent is fixed by its declared size, so the tail is none of this reader's business.
    const wrapped = packageStream("a", "b", "c", enc("payload"));
    const withTail = new Uint8Array(wrapped.length + 6);
    withTail.set(wrapped);
    withTail.set(enc("tail!"), wrapped.length);
    expect(readOlePackage(withTail).fileBytes).toEqual(enc("payload"));
  });

  it("unwraps an empty packaged file", () => {
    const pkg = readOlePackage(
      packageStream("empty", "", "", new Uint8Array(0)),
    );
    expect(pkg.fileBytes).toEqual(new Uint8Array(0));
  });

  it("throws OlePackageFormatError when a string never terminates", () => {
    const unterminated = enc("\x02\x00Book1.xlsx");
    let caught: unknown;
    try {
      readOlePackage(unterminated);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OlePackageFormatError);
    expect((caught as Error).name).toBe("OlePackageFormatError");
    expect((caught as Error).message).toBe(
      "Package stream ends inside its label string with no terminator",
    );
  });

  it("names the field that never terminates, when it is the source path rather than the label", () => {
    const unterminated = enc("\x02\x00a\0Book1.xlsx");
    expect(() => readOlePackage(unterminated)).toThrow(
      "Package stream ends inside its source path string with no terminator",
    );
  });

  it("names the field that never terminates, when it is the temp path rather than the label or source path", () => {
    const unterminated = new Uint8Array([
      ...enc("\x02\x00a\0b\0"),
      ...new Uint8Array(8), // the 8 opaque bytes between sourcePath and tempPath
      ...enc("Book1.xlsx"),
    ]);
    expect(() => readOlePackage(unterminated)).toThrow(
      "Package stream ends inside its temp path string with no terminator",
    );
  });

  it("throws OlePackageFormatError when fewer than 4 bytes remain for the packaged file's own size field", () => {
    // The three strings and the 8 opaque bytes are all present and well-formed; only the trailing size field itself is truncated.
    const bytes = new Uint8Array([
      ...enc("\x02\x00a\0b\0"),
      ...new Uint8Array(8), // the 8 opaque bytes
      ...enc("c\0"),
      0x00,
      0x00,
    ]); // 2 bytes where the 4-byte size field belongs
    expect(() => readOlePackage(bytes)).toThrow(
      "Package stream ends before its packaged file size field",
    );
  });

  it("throws OlePackageFormatError when the declared file size exceeds the remaining bytes", () => {
    const wrapped = packageStream("a", "b", "c", enc("payload"));
    const view = new DataView(wrapped.buffer);
    view.setUint32(wrapped.length - "payload".length - 4, 0x00ffffff, true);
    expect(() => readOlePackage(wrapped)).toThrow(
      "Package stream declares 16777215 packaged-file bytes but holds only 7",
    );
  });

  it("throws OlePackageFormatError for input too short to hold even the fixed fields", () => {
    expect(() => readOlePackage(new Uint8Array(3))).toThrow(
      OlePackageFormatError,
    );
  });
});

describe("writeOlePackage", () => {
  it("writes the header word as 0x0002 in little-endian order", () => {
    const built = writeOlePackage({
      label: "",
      sourcePath: "",
      tempPath: "",
      fileBytes: new Uint8Array(0),
    });
    expect([...built.subarray(0, 2)]).toEqual([0x02, 0x00]);
  });

  it("round-trips through readOlePackage", () => {
    const fileBytes = enc("the real embedded file");
    const built = writeOlePackage({
      label: "Book1.xlsx",
      sourcePath: "C:\\data\\Book1.xlsx",
      tempPath: "C:\\users\\joe\\AppData\\Local\\Temp\\Book1.xlsx",
      fileBytes,
    });
    const parsed = readOlePackage(built);
    expect(parsed.label).toBe("Book1.xlsx");
    expect(parsed.sourcePath).toBe("C:\\data\\Book1.xlsx");
    expect(parsed.tempPath).toBe(
      "C:\\users\\joe\\AppData\\Local\\Temp\\Book1.xlsx",
    );
    expect(parsed.fileBytes).toEqual(fileBytes);
  });

  it("round-trips empty label/paths and an empty packaged file", () => {
    const built = writeOlePackage({
      label: "",
      sourcePath: "",
      tempPath: "",
      fileBytes: new Uint8Array(0),
    });
    const parsed = readOlePackage(built);
    expect(parsed.label).toBe("");
    expect(parsed.sourcePath).toBe("");
    expect(parsed.tempPath).toBe("");
    expect(parsed.fileBytes).toEqual(new Uint8Array(0));
  });

  it("accepts U+007F (DEL), the highest code point this field's ASCII check allows", () => {
    expect(() =>
      writeOlePackage({
        label: "a\u007fb",
        sourcePath: "",
        tempPath: "",
        fileBytes: new Uint8Array(0),
      }),
    ).not.toThrow();
  });

  it("throws OlePackageWriteError when label contains a non-ASCII character", () => {
    expect(() =>
      writeOlePackage({
        label: "café.docx",
        sourcePath: "",
        tempPath: "",
        fileBytes: new Uint8Array(0),
      }),
    ).toThrow(
      "Package stream's label contains a character (U+00e9) outside ASCII; encoding it to an arbitrary windows-1252 byte would need a full codepage table this package does not carry",
    );
  });

  it("throws OlePackageWriteError when sourcePath or tempPath contains a non-ASCII character", () => {
    expect(() =>
      writeOlePackage({
        label: "a",
        sourcePath: "C:\\café\\a.docx",
        tempPath: "",
        fileBytes: new Uint8Array(0),
      }),
    ).toThrow("Package stream's source path contains a character");
    expect(() =>
      writeOlePackage({
        label: "a",
        sourcePath: "",
        tempPath: "C:\\café\\a.docx",
        fileBytes: new Uint8Array(0),
      }),
    ).toThrow("Package stream's temp path contains a character");
  });

  // A NUL byte is itself ASCII (U+0000, well under 0x7f), so the non-ASCII check above cannot catch it -- but this field's own encoding is null-terminated, so an embedded NUL would silently truncate the field and mis-frame every field written after it, exactly the round-trip guarantee this function's own doc comment states.
  it("throws OlePackageWriteError when label contains an embedded NUL byte", () => {
    let caught: unknown;
    try {
      writeOlePackage({
        label: "a\u0000b",
        sourcePath: "",
        tempPath: "",
        fileBytes: new Uint8Array(0),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OlePackageWriteError);
    expect((caught as Error).name).toBe("OlePackageWriteError");
    expect((caught as Error).message).toBe(
      "Package stream's label contains an embedded NUL byte, which this field's own null-terminated encoding cannot carry: it would silently truncate the field and mis-frame every field written after it",
    );
  });

  it("throws OlePackageWriteError when sourcePath or tempPath contains an embedded NUL byte", () => {
    expect(() =>
      writeOlePackage({
        label: "a",
        sourcePath: "C:\\a\u0000b.docx",
        tempPath: "",
        fileBytes: new Uint8Array(0),
      }),
    ).toThrow("Package stream's source path contains an embedded NUL byte");
    expect(() =>
      writeOlePackage({
        label: "a",
        sourcePath: "",
        tempPath: "C:\\a\u0000b.docx",
        fileBytes: new Uint8Array(0),
      }),
    ).toThrow("Package stream's temp path contains an embedded NUL byte");
  });
});
