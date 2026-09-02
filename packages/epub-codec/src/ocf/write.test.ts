import { describe, expect, it } from "vitest";
import { resolveOpfPath } from "./container";
import { writeContainerXml } from "./write";

describe("writeContainerXml", () => {
  it("round-trips through resolveOpfPath", () => {
    const xml = writeContainerXml("OEBPS/content.opf");
    expect(resolveOpfPath(xml)).toBe("OEBPS/content.opf");
  });
});
