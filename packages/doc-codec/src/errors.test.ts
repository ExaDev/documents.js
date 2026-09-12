import { describe, expect, it } from "vitest";
import { DocFormatError, DocUnsupportedError } from "./errors";

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
