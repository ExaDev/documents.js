import { describe, expect, it } from "vitest";
import type { ContentDocument } from "document-schema.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
import type { Package } from "../../model/package";
import { el } from "../../xml/fragment";
import { readMimetype, writeMimetype } from "../../mimetype";
import {
  writeEmbeddedObjectPackage,
  writeDrawObjectElement,
  writeEmbeddedObject,
} from "./embedded-write";

const MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

function mediaTypeOf(pkg: Package): string | undefined {
  return readMimetype(pkg);
}

function wordprocessingDocument(): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [{ pageSize: PAGE_SIZE_A4, margins: MARGINS, blocks: [] }],
  };
}

describe("writeEmbeddedObjectPackage", () => {
  it("dispatches a wordprocessing document to writeOdtContent", () => {
    const pkg = writeEmbeddedObjectPackage({
      objectKind: "wordprocessing",
      document: wordprocessingDocument(),
    });
    expect(mediaTypeOf(pkg)).toBe("application/vnd.oasis.opendocument.text");
  });

  it("dispatches a presentation document to writeOdpContent", () => {
    const document: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [],
    };
    const pkg = writeEmbeddedObjectPackage({
      objectKind: "presentation",
      document,
    });
    expect(mediaTypeOf(pkg)).toBe(
      "application/vnd.oasis.opendocument.presentation",
    );
  });

  it("dispatches a spreadsheet document to writeOdsContent", () => {
    const document: ContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [],
    };
    const pkg = writeEmbeddedObjectPackage({
      objectKind: "spreadsheet",
      document,
    });
    expect(mediaTypeOf(pkg)).toBe(
      "application/vnd.oasis.opendocument.spreadsheet",
    );
  });

  it("dispatches a drawing document to writeOdgContent", () => {
    const document: ContentDocument = {
      kind: "drawing",
      metadata: {},
      pages: [],
    };
    const pkg = writeEmbeddedObjectPackage({
      objectKind: "drawing",
      document,
    });
    expect(mediaTypeOf(pkg)).toBe(
      "application/vnd.oasis.opendocument.graphics",
    );
  });

  it("dispatches a formula document to writeOdfFormulaContent", () => {
    const document: ContentDocument = {
      kind: "formula",
      metadata: {},
      formula: { mathml: [el("math", {}, [])] },
    };
    const pkg = writeEmbeddedObjectPackage({
      objectKind: "formula",
      document,
    });
    expect(mediaTypeOf(pkg)).toBe("application/vnd.oasis.opendocument.formula");
  });

  it("refuses a chart object, which has no write-side serialiser", () => {
    expect(() =>
      writeEmbeddedObjectPackage({
        objectKind: "chart",
        document: { kind: "spreadsheet", metadata: {}, sheets: [] },
      }),
    ).toThrow(/no write-side serialiser/);
  });
});

describe("writeDrawObjectElement", () => {
  it('carries xlink:type="simple" alongside the href', () => {
    const element = writeDrawObjectElement("Object 1");
    const attrByName = (name: string) =>
      element.attributes.find((a) => a.name === name)?.value;
    expect(attrByName("xlink:type")).toBe("simple");
    expect(attrByName("xlink:href")).toBe("./Object 1");
  });
});

describe("writeEmbeddedObject", () => {
  it("re-syncs the outer package's manifest so the new embedding directory is actually listed", () => {
    const pkg: Package = { parts: {} };
    writeMimetype(pkg, "application/vnd.oasis.opendocument.text");
    writeEmbeddedObject(
      { objectKind: "wordprocessing", document: wordprocessingDocument() },
      "Object 1",
      pkg,
    );
    const manifestPart = pkg.parts["META-INF/manifest.xml"];
    expect(manifestPart?.kind).toBe("xml");
    if (manifestPart?.kind !== "xml") {
      throw new Error("expected a manifest part");
    }
    const manifestXml = JSON.stringify(manifestPart.nodes);
    expect(manifestXml).toContain("Object 1/");
  });
});
