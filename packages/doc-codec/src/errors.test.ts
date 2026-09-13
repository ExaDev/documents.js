import { describe, expect, it } from "vitest";
import { assertDefined, DocFormatError, DocUnsupportedError } from "./errors";

describe("DocFormatError", () => {
  it("carries the message given to it and names itself DocFormatError", () => {
    const error = new DocFormatError("bad offset");
    expect(error.message).toBe("bad offset");
    expect(error.name).toBe("DocFormatError");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("DocUnsupportedError", () => {
  it("carries the message given to it and names itself DocUnsupportedError", () => {
    const error = new DocUnsupportedError("encrypted document");
    expect(error.message).toBe("encrypted document");
    expect(error.name).toBe("DocUnsupportedError");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("assertDefined", () => {
  it("throws a DocFormatError carrying the exact given message for an undefined value", () => {
    expect(() => {
      assertDefined(undefined, "should not be undefined");
    }).toThrow(DocFormatError);
    expect(() => {
      assertDefined(undefined, "should not be undefined");
    }).toThrow("should not be undefined");
  });

  it("does not throw for a defined value, including a falsy one", () => {
    expect(() => {
      assertDefined(0, "unreachable");
    }).not.toThrow();
    expect(() => {
      assertDefined("", "unreachable");
    }).not.toThrow();
    expect(() => {
      assertDefined(false, "unreachable");
    }).not.toThrow();
  });
});
