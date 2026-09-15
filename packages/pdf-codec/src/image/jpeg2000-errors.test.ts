import { describe, expect, it } from "vitest";
import {
  Jpeg2000ParseError,
  Jpeg2000UnsupportedError,
} from "./jpeg2000-errors";

describe("Jpeg2000ParseError", () => {
  it("carries its own class name, not the generic Error name", () => {
    const error = new Jpeg2000ParseError("bad codestream");
    expect(error.name).toBe("Jpeg2000ParseError");
    expect(error.message).toBe("bad codestream");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("Jpeg2000UnsupportedError", () => {
  it("carries its own class name, not the generic Error name", () => {
    const error = new Jpeg2000UnsupportedError("ROI shaping not decoded");
    expect(error.name).toBe("Jpeg2000UnsupportedError");
    expect(error.message).toBe("ROI shaping not decoded");
    expect(error).toBeInstanceOf(Error);
  });
});
