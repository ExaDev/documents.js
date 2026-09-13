import { describe, expect, it } from "vitest";
import { BiffWriteError } from "./write-errors";

describe("BiffWriteError", () => {
  it("carries the message it was constructed with", () => {
    const error = new BiffWriteError("a sheet image is outside the grid");
    expect(error.message).toBe("a sheet image is outside the grid");
  });

  it("names itself BiffWriteError rather than the generic Error name", () => {
    const error = new BiffWriteError("anything");
    expect(error.name).toBe("BiffWriteError");
  });

  it("is a real Error instance", () => {
    expect(new BiffWriteError("x")).toBeInstanceOf(Error);
  });
});
