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
  });

  it("rejects a size field that is not the mandated 0x00000014", () => {
    expect(() => readCurrentUserAtom(currentUserAtom({ size: 0x10 }))).toThrow(
      PptFormatError,
    );
  });

  it("rejects a headerToken that is neither the plaintext nor the encrypted value", () => {
    expect(() =>
      readCurrentUserAtom(currentUserAtom({ headerToken: 0x12345678 })),
    ).toThrow(PptFormatError);
  });

  it("rejects a docFileVersion other than the mandated 0x03F4", () => {
    expect(() =>
      readCurrentUserAtom(currentUserAtom({ docFileVersion: 0x0400 })),
    ).toThrow(PptFormatError);
  });

  it("rejects a stream too short to hold the fixed portion", () => {
    expect(() =>
      readCurrentUserAtom(atom(RT_CurrentUserAtom, u32le(0x14))),
    ).toThrow(PptFormatError);
  });
});
