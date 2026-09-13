import { describe, expect, it } from "vitest";
import { PptFormatError } from "../errors";
import { RT_CurrentUserAtom } from "../record/types";
import {
  asciiBytes,
  concatBytes,
  u8,
  u16le,
  u32le,
  utf16le,
  writeAtom as atom,
} from "../record/write";
import {
  CURRENT_USER_HEADER_TOKEN_ENCRYPTED,
  CURRENT_USER_HEADER_TOKEN_PLAIN,
  decodeUtf16Le,
  readCurrentUserAtom,
} from "./current-user";

// Built from [MS-PPT] 2.3.2's own field table: rh, then a 20-byte (0x14) fixed portion of size/headerToken/offsetToCurrentEdit/lenUserName/docFileVersion/majorVersion/minorVersion/unused, then the variable ansiUserName, then relVersion, then the optional unicodeUserName of 2 * lenUserName bytes. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/940d5700-e4d7-4fc0-ab48-fed5dbc48bc1
function currentUserAtom(options: {
  headerToken?: number;
  offsetToCurrentEdit?: number;
  ansiUserName?: string;
  unicodeUserName?: string;
  size?: number;
  docFileVersion?: number;
}): Uint8Array<ArrayBuffer> {
  const {
    headerToken = CURRENT_USER_HEADER_TOKEN_PLAIN,
    offsetToCurrentEdit = 0x00001234,
    ansiUserName = "Ada",
    unicodeUserName,
    size = 0x00000014,
    docFileVersion = 0x03f4,
  } = options;
  const ansi = asciiBytes(ansiUserName);
  return atom(
    RT_CurrentUserAtom,
    concatBytes(
      u32le(size),
      u32le(headerToken),
      u32le(offsetToCurrentEdit),
      u16le(ansi.length),
      u16le(docFileVersion),
      u8(0x03),
      u8(0x00),
      u16le(0),
      ansi,
      u32le(0x00000008),
      unicodeUserName === undefined
        ? new Uint8Array(0)
        : utf16le(unicodeUserName),
    ),
  );
}

describe("decodeUtf16Le", () => {
  it("decodes an even-length run of little-endian code units", () => {
    expect(decodeUtf16Le(utf16le("Adaé"))).toBe("Adaé");
  });

  it("ignores a trailing odd byte rather than reading past the buffer", () => {
    const bytes = utf16le("Ada");
    const withTrailingByte = new Uint8Array(bytes.length + 1);
    withTrailingByte.set(bytes);
    withTrailingByte[bytes.length] = 0xff;
    expect(decodeUtf16Le(withTrailingByte)).toBe("Ada");
  });

  it("decodes an empty buffer to an empty string", () => {
    expect(decodeUtf16Le(new Uint8Array(0))).toBe("");
  });
});

describe("readCurrentUserAtom", () => {
  it("reads the offset of the most recent user edit", () => {
    expect(
      readCurrentUserAtom(currentUserAtom({ offsetToCurrentEdit: 0x0000abcd }))
        .offsetToCurrentEdit,
    ).toBe(0x0000abcd);
  });

  it("reports a plaintext document for headerToken 0xE391C05F", () => {
    expect(readCurrentUserAtom(currentUserAtom({})).encrypted).toBe(false);
  });

  it("reports an encrypted document for headerToken 0xF3D1C4DF", () => {
    expect(
      readCurrentUserAtom(
        currentUserAtom({ headerToken: CURRENT_USER_HEADER_TOKEN_ENCRYPTED }),
      ).encrypted,
    ).toBe(true);
  });

  it("reads the ANSI user name, whose length lenUserName gives in bytes", () => {
    expect(
      readCurrentUserAtom(currentUserAtom({ ansiUserName: "Grace" })).userName,
    ).toBe("Grace");
  });

  it("prefers the Unicode user name, which the spec says supersedes the ANSI one", () => {
    expect(
      readCurrentUserAtom(
        currentUserAtom({ ansiUserName: "Ada?", unicodeUserName: "Adaé" }),
      ).userName,
    ).toBe("Adaé");
  });

  it("reads a record with no unicodeUserName at all, which the spec permits", () => {
    expect(
      readCurrentUserAtom(currentUserAtom({ ansiUserName: "Ada" })).userName,
    ).toBe("Ada");
  });

  it("rejects a record whose recType is not RT_CurrentUserAtom", () => {
    expect(() => readCurrentUserAtom(atom(0x03e8, new Uint8Array(20)))).toThrow(
      PptFormatError,
    );
    expect(() => readCurrentUserAtom(atom(0x03e8, new Uint8Array(20)))).toThrow(
      `Current User stream begins with record type 0x3e8, not RT_CurrentUserAtom (0x${RT_CurrentUserAtom.toString(16)})`,
    );
  });

  it("rejects a size field that is not the mandated 0x00000014", () => {
    expect(() => readCurrentUserAtom(currentUserAtom({ size: 0x10 }))).toThrow(
      PptFormatError,
    );
    expect(() => readCurrentUserAtom(currentUserAtom({ size: 0x10 }))).toThrow(
      "CurrentUserAtom size field is 0x10, not the mandated 0x14",
    );
  });

  it("rejects a headerToken that is neither the plaintext nor the encrypted value", () => {
    expect(() =>
      readCurrentUserAtom(currentUserAtom({ headerToken: 0x12345678 })),
    ).toThrow(PptFormatError);
    expect(() =>
      readCurrentUserAtom(currentUserAtom({ headerToken: 0x12345678 })),
    ).toThrow(
      "CurrentUserAtom headerToken is 0x12345678, neither the plaintext 0xe391c05f nor the encrypted 0xf3d1c4df",
    );
  });

  it("rejects a docFileVersion other than the mandated 0x03F4", () => {
    expect(() =>
      readCurrentUserAtom(currentUserAtom({ docFileVersion: 0x0400 })),
    ).toThrow(PptFormatError);
    expect(() =>
      readCurrentUserAtom(currentUserAtom({ docFileVersion: 0x0400 })),
    ).toThrow(
      "CurrentUserAtom docFileVersion is 0x400, not the mandated 0x3f4",
    );
  });

  it("rejects a stream too short to hold the fixed portion", () => {
    expect(() =>
      readCurrentUserAtom(atom(RT_CurrentUserAtom, u32le(0x14))),
    ).toThrow(PptFormatError);
    expect(() =>
      readCurrentUserAtom(atom(RT_CurrentUserAtom, u32le(0x14))),
    ).toThrow(
      "CurrentUserAtom carries 4 bytes of data, fewer than the 20-byte fixed portion the record requires",
    );
  });

  it("accepts a record carrying exactly the 20-byte fixed portion and nothing more", () => {
    // lenUserName 0, no ansiUserName/relVersion/unicodeUserName bytes at all -- ansiEnd and unicodeStart both then sit exactly at (or past) the buffer's own end, which must not be treated as an overrun.
    const bytes = atom(
      RT_CurrentUserAtom,
      concatBytes(
        u32le(0x00000014),
        u32le(CURRENT_USER_HEADER_TOKEN_PLAIN),
        u32le(0),
        u16le(0), // lenUserName
        u16le(0x03f4),
        u8(0x03),
        u8(0x00),
        u16le(0),
      ),
    );
    expect(readCurrentUserAtom(bytes).userName).toBe("");
  });

  it("rejects an ansiUserName that runs past the record's own bytes", () => {
    const bytes = atom(
      RT_CurrentUserAtom,
      concatBytes(
        u32le(0x00000014),
        u32le(CURRENT_USER_HEADER_TOKEN_PLAIN),
        u32le(0),
        u16le(10), // lenUserName claims 10 bytes, but none follow
        u16le(0x03f4),
        u8(0x03),
        u8(0x00),
        u16le(0),
      ),
    );
    expect(() => readCurrentUserAtom(bytes)).toThrow(PptFormatError);
    expect(() => readCurrentUserAtom(bytes)).toThrow(
      "CurrentUserAtom declares a 10-byte ansiUserName that runs past the record's 20 bytes",
    );
  });
});
