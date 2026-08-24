import { describe, expect, it } from "vitest";
import { assertPartsUnchangedExcept } from "./fidelity";
import { minimalDocxPackage } from "./docx";

describe("assertPartsUnchangedExcept", () => {
  it("does not throw when nothing changed", () => {
    const before = minimalDocxPackage();
    const after = minimalDocxPackage();
    expect(() => {
      assertPartsUnchangedExcept(before, after, []);
    }).not.toThrow();
  });

  it("does not throw when only a listed touched part changed", () => {
    const before = minimalDocxPackage();
    const after = minimalDocxPackage();
    const part = after.parts["word/document.xml"];
    if (part?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    part.nodes = [];
    expect(() => {
      assertPartsUnchangedExcept(before, after, ["word/document.xml"]);
    }).not.toThrow();
  });

  it("throws when an untouched part changed", () => {
    const before = minimalDocxPackage();
    const after = minimalDocxPackage();
    const part = after.parts["word/styles.xml"];
    if (part?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    part.nodes = [];
    expect(() => {
      assertPartsUnchangedExcept(before, after, ["word/document.xml"]);
    }).toThrow(/styles\.xml/);
  });

  it("throws when a part is added that did not exist before", () => {
    const before = minimalDocxPackage();
    const after = minimalDocxPackage();
    after.parts["word/media/image1.png"] = { kind: "binary", base64: "AA==" };
    expect(() => {
      assertPartsUnchangedExcept(before, after, []);
    }).toThrow(/word\/media\/image1\.png/);
  });

  it("throws when a part is removed", () => {
    const before = minimalDocxPackage();
    const after = minimalDocxPackage();
    delete after.parts["word/styles.xml"];
    expect(() => {
      assertPartsUnchangedExcept(before, after, []);
    }).toThrow(/styles\.xml/);
  });
});
