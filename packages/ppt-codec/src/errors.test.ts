import { describe, expect, it } from "vitest";
import {
  PptEncryptedError,
  PptFormatError,
  PptUnsupportedContentError,
} from "./errors";

// Each error class states its own `name`, which is what lets a caller tell the three apart by more than the message string alone (e.g. logging or matching on `error.name` rather than `instanceof` across a serialisation boundary that loses the prototype chain).

describe("PptFormatError", () => {
  it("names itself PptFormatError and keeps the message it was given", () => {
    const error = new PptFormatError("malformed record");
    expect(error.name).toBe("PptFormatError");
    expect(error.message).toBe("malformed record");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("PptEncryptedError", () => {
  it("names itself PptEncryptedError and keeps the message it was given", () => {
    const error = new PptEncryptedError("needs a password");
    expect(error.name).toBe("PptEncryptedError");
    expect(error.message).toBe("needs a password");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("PptUnsupportedContentError", () => {
  it("names itself PptUnsupportedContentError and keeps the message it was given", () => {
    const error = new PptUnsupportedContentError("outside writer scope");
    expect(error.name).toBe("PptUnsupportedContentError");
    expect(error.message).toBe("outside writer scope");
    expect(error).toBeInstanceOf(Error);
  });
});
