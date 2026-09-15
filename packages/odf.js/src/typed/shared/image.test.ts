import { describe, expect, it } from "vitest";
import { imageExtension } from "./image";

describe("imageExtension", () => {
  it("maps each ContentImageBlock format to its own real file extension", () => {
    expect(imageExtension("png")).toBe("png");
    expect(imageExtension("jpeg")).toBe("jpg");
    expect(imageExtension("svg")).toBe("svg");
    expect(imageExtension("gif")).toBe("gif");
  });
});
