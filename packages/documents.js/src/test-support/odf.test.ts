import { ODF_MEDIA_TYPES, unzipPackage } from "odf.js";
import { describe, expect, it } from "vitest";
import { odfFormulaBytes } from "./odf";

describe("odfFormulaBytes", () => {
  it("writes the mimetype part first, stored uncompressed, with the real ODF formula media type", () => {
    const bytes = odfFormulaBytes("<math:mi>x</math:mi>");
    // ZIP local file header: signature(4) version(2) flags(2) then the compression method at offset 8-9 — 0 means stored (no DEFLATE), the requirement ODF's own mimetype part has.
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(Array.from(bytes.subarray(8, 10))).toEqual([0, 0]);
    // Filename length at offset 26-27, the filename itself starting at offset 30.
    const nameLength = bytes[26]! | (bytes[27]! << 8);
    const name = new TextDecoder().decode(bytes.subarray(30, 30 + nameLength));
    expect(name).toBe("mimetype");

    const parts = unzipPackage(bytes);
    expect(new TextDecoder().decode(parts.mimetype)).toBe(ODF_MEDIA_TYPES.odf);
  });

  it("puts exactly the given MathML inner content into math:semantics, with no annotation and no stray text, when no StarMath fallback is given", () => {
    const bytes = odfFormulaBytes("<math:mi>x</math:mi>");
    const contentXml = new TextDecoder().decode(
      unzipPackage(bytes)["content.xml"],
    );
    expect(contentXml).toContain(
      "<math:semantics><math:mi>x</math:mi></math:semantics>",
    );
  });

  it("includes a StarMath annotation element when a fallback is given", () => {
    const bytes = odfFormulaBytes("<math:mi>x</math:mi>", {
      starMath: "x",
    });
    const contentXml = new TextDecoder().decode(
      unzipPackage(bytes)["content.xml"],
    );
    expect(contentXml).toContain(
      '<math:annotation encoding="StarMath 5.0">x</math:annotation>',
    );
  });
});
