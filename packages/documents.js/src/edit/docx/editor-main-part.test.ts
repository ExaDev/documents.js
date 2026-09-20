import { decodePackage, resolveRelationships } from "ooxml.js";
import { describe, expect, it } from "vitest";
import {
  minimalDocxBytes,
  renamedMainPartDocxBytes,
} from "../../test-support/docx";
import { openDocx } from "./editor";

// openDocx on a package whose body is not at word/document.xml. The readers already resolve the main part from the root officeDocument relationship (ExaDev/documents.js#1314); until this change the editors did not, so opening the very file that issue was about threw while readDocxContent on the same bytes read it (ExaDev/documents.js#1339). The fixture carries the identical document minimalDocxBytes does, so these assertions are the conventional fixture's own behaviour, not a weaker substitute for it.

describe("openDocx: main part named by the officeDocument relationship", () => {
  it("opens a package whose body is at word/document2.xml", () => {
    const editor = openDocx(renamedMainPartDocxBytes());
    expect(editor.paragraphs()[0]?.text).toContain("Hello, world!");
    expect(editor.tables()).toHaveLength(1);
  });

  it("reads the same content from the renamed body as from the conventional one", () => {
    const renamed = openDocx(renamedMainPartDocxBytes());
    const conventional = openDocx(minimalDocxBytes());
    expect(renamed.paragraphs().map((p) => p.text)).toEqual(
      conventional.paragraphs().map((p) => p.text),
    );
  });

  it("writes an appended paragraph back into the renamed body part, leaving the conventional path absent", () => {
    const editor = openDocx(renamedMainPartDocxBytes());
    editor.body.appendParagraph({ text: "Appended" });
    const written = decodePackage(editor.toBytes());
    expect(Object.hasOwn(written.parts, "word/document2.xml")).toBe(true);
    expect(Object.hasOwn(written.parts, "word/document.xml")).toBe(false);
    // Reopening the written bytes is what proves the edit landed in the part the package's own relationship names, rather than merely that some part gained a paragraph.
    expect(
      openDocx(editor.toBytes())
        .paragraphs()
        .map((p) => p.text),
    ).toContain("Appended");
  });

  it("keeps the renamed body's own relationships intact across a write-back", () => {
    const editor = openDocx(renamedMainPartDocxBytes());
    editor.body.appendParagraph({ text: "Appended" });
    const written = decodePackage(editor.toBytes());
    expect(Object.hasOwn(written.parts, "word/_rels/document2.xml.rels")).toBe(
      true,
    );
    expect(Object.hasOwn(written.parts, "word/styles2.xml")).toBe(true);
  });

  it("adds an image part beside the renamed body rather than under word/media by convention", () => {
    const editor = openDocx(renamedMainPartDocxBytes());
    const paragraph = editor.body.appendParagraph();
    paragraph.insertImageAfter({
      bytes: TINY_PNG,
      format: "png",
      widthPt: 10,
      heightPt: 10,
    });
    const written = decodePackage(editor.toBytes());
    // word/media because the body sits in word/, not because the path is hardcoded -- the directory is derived from wherever the resolved body part lives.
    expect(Object.hasOwn(written.parts, "word/media/image1.png")).toBe(true);
    // The relationship is registered against the renamed body part, so it resolves back to the media part from there.
    const rels = resolveRelationships(written, "word/document2.xml");
    expect(
      [...rels.values()].some((rel) => rel.target === "word/media/image1.png"),
    ).toBe(true);
  });
});

// A real 1x1 PNG: the image path sniffs actual bytes rather than trusting the declared format.
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x04,
  0x00, 0x00, 0x00, 0xb5, 0x1c, 0x0c, 0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0xfa, 0xcf, 0x00, 0x00, 0x02, 0x07, 0x01, 0x02,
  0x9a, 0x1c, 0x31, 0x71, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);
