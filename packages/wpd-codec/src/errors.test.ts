import { describe, expect, it } from "vitest";
import {
  WpdEncryptedDocumentError,
  WpdFormatError,
  WpdNotAWordPerfectFileError,
  WpdUnsupportedVersionError,
  WpdWrongPasswordError,
} from "./errors";

// Each subclass sets its own `.name`, and downstream reading code (and consumers catching by name) relies on it -- the integration tests exercising these errors never assert on `.name` itself, only on `instanceof`, so it needs its own direct coverage here.
describe("WpdFormatError subclasses", () => {
  it("names WpdFormatError itself", () => {
    expect(new WpdFormatError("x").name).toBe("WpdFormatError");
  });

  it("names WpdNotAWordPerfectFileError", () => {
    expect(new WpdNotAWordPerfectFileError("x").name).toBe(
      "WpdNotAWordPerfectFileError",
    );
  });

  it("names WpdEncryptedDocumentError", () => {
    expect(new WpdEncryptedDocumentError("x").name).toBe(
      "WpdEncryptedDocumentError",
    );
  });

  it("names WpdUnsupportedVersionError", () => {
    expect(new WpdUnsupportedVersionError("x").name).toBe(
      "WpdUnsupportedVersionError",
    );
  });

  it("names WpdWrongPasswordError and states both checksums in its message", () => {
    const error = new WpdWrongPasswordError(0x1234, 0xabcd);
    expect(error.name).toBe("WpdWrongPasswordError");
    expect(error.headerEncryptionWord).toBe(0x1234);
    expect(error.passwordChecksum).toBe(0xabcd);
    expect(error.message).toBe(
      "The header's encryption word (0x1234) does not match this password's checksum (0xabcd): either the password is wrong, or the file uses the enhanced encryption mode (WordPerfect 9 and later), which this reader does not support.",
    );
  });
});
