import { describe, expect, it } from "vitest";
import { assertNeverImageFormat, imageExtension } from "./image";

describe("imageExtension", () => {
  it("maps each ContentImageBlock format to its own real file extension", () => {
    expect(imageExtension("png")).toBe("png");
    expect(imageExtension("jpeg")).toBe("jpg");
    expect(imageExtension("svg")).toBe("svg");
    expect(imageExtension("gif")).toBe("gif");
  });
});

describe("assertNeverImageFormat", () => {
  it("throws naming the unhandled format, proving imageExtension's own exhaustiveness guard actually fires at runtime", () => {
    let caught: unknown;
    try {
      assertNeverImageFormat("bogus" as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'imageExtension: unhandled image format "bogus"',
    );
  });
});
