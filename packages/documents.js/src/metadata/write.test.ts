import { decodePackage as decodeOdfPackage } from "odf.js";
import {
  decodePackage as decodeOoxmlPackage,
  encodePackage,
  readXlsxContent,
} from "ooxml.js";
import { readPdf } from "pdf-codec";
import { describe, expect, it } from "vitest";
import { docxToPdf, odsToXlsx } from "../convert/convert";
import { readOdpContent } from "../odf/odp/read";
import { readDocxExtras } from "../ooxml/docx/extras";
import { readDocxContent } from "../ooxml/docx/read";
import { docxWithExtrasPackage, minimalDocxBytes } from "../test-support/docx";
import { minimalOdpBytes } from "../test-support/odp";
import { richOdsBytes } from "../test-support/ods";
import { patchDocxMetadata, setDocumentMetadata } from "./write";

describe("setDocumentMetadata: rebuild path (pptx/odt/odp/ods/odg/markdown)", () => {
  it("patches only the overridden field, leaving the source document own existing title untouched", () => {
    const bytes = setDocumentMetadata("odp", "odp", minimalOdpBytes(), {
      author: "New Author",
    });
    const metadata = readOdpContent(decodeOdfPackage(bytes)).metadata;
    expect(metadata.title).toBe("My Presentation"); // minimalOdpBytes's own real dc:title, never touched.
    expect(metadata.author).toBe("New Author");
  });

  it("overrides the title when asked to", () => {
    const bytes = setDocumentMetadata("odp", "odp", minimalOdpBytes(), {
      title: "Renamed Deck",
    });
    expect(readOdpContent(decodeOdfPackage(bytes)).metadata.title).toBe(
      "Renamed Deck",
    );
  });

  it("sets keywords as a real string array", () => {
    const bytes = setDocumentMetadata("odp", "odp", minimalOdpBytes(), {
      keywords: ["quarterly", "sales"],
    });
    expect(readOdpContent(decodeOdfPackage(bytes)).metadata.keywords).toEqual([
      "quarterly",
      "sales",
    ]);
  });

  it("a markdown rebuild preserves a relative-path image when an images resolver is supplied (rather than degrading it to alt text)", () => {
    const onePixelPng = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      ),
      (char) => char.codePointAt(0)!,
    );
    const markdown = new TextEncoder().encode(
      "![a local image](./local.png)\n",
    );
    const resolver = (destination: string) =>
      destination === "./local.png" ? { bytes: onePixelPng } : undefined;

    const rebuilt = new TextDecoder().decode(
      setDocumentMetadata(
        "markdown",
        "markdown",
        markdown,
        { title: "Patched" },
        { images: resolver },
      ),
    );
    // The resolved image is inlined back as a data: URI (buildMarkdownText re-serialises a ContentImageBlock), not lost to alt text -- the resolver reached the markdown content codec's read through SetDocumentMetadataOptions.images.
    expect(rebuilt).toContain("data:image/png");
  });
});

// ExaDev/documents.js#966: patchDocxMetadata patches docProps/core.xml directly on the decoded Package, so everything docx-extras covers (comments, footnotes, header/footer parts, numbering) survives byte-faithful -- unlike the rebuild-from-ContentDocument path every REBUILD_FORMATS member above takes, which genuinely drops all of it (see extras.ts's own gotcha). setDocumentMetadata's own docx/docx branch calls this function directly (see the "setDocumentMetadata: docx-patch path" describe block below), so every caller gets this for free.
describe("patchDocxMetadata", () => {
  it("patches title/author in place, leaving docx-extras data (comments, footnotes, headers/footers, numbering) completely untouched", () => {
    const sourceBytes = encodePackage(docxWithExtrasPackage());
    const before = readDocxExtras(decodeOoxmlPackage(sourceBytes));
    expect(before.comments.length).toBeGreaterThan(0);
    expect(before.footnotes.length).toBeGreaterThan(0);
    expect(before.headerFooterParts.length).toBeGreaterThan(0);
    expect(Object.keys(before.numbering).length).toBeGreaterThan(0);

    const patched = patchDocxMetadata(sourceBytes, {
      title: "Patched Title",
      author: "New Author",
    });

    const after = readDocxExtras(decodeOoxmlPackage(patched));
    expect(after).toStrictEqual(before);

    // The metadata edit itself still landed.
    const metadata = readDocxContent(decodeOoxmlPackage(patched)).metadata;
    expect(metadata.title).toBe("Patched Title");
    expect(metadata.author).toBe("New Author");
  });

  it("creates docProps/core.xml from scratch when the source carries none at all, and leaves it absent when no field is overridden", () => {
    const sourceBytes = encodePackage(docxWithExtrasPackage());
    expect(
      decodeOoxmlPackage(sourceBytes).parts["docProps/core.xml"],
    ).toBeUndefined();

    const untouched = patchDocxMetadata(sourceBytes, {});
    expect(
      decodeOoxmlPackage(untouched).parts["docProps/core.xml"],
    ).toBeUndefined();

    const patched = patchDocxMetadata(sourceBytes, { title: "Brand New" });
    const part = decodeOoxmlPackage(patched).parts["docProps/core.xml"];
    expect(part?.kind).toBe("xml");
  });

  // ExaDev/documents.js#1007 round 2: overrides.keywords !== undefined is true for `keywords: []`, but addCoreProperties itself never emits a cp:keywords element for an empty array -- so a naive "any field present" check created a real (but empty) docProps/core.xml, plus its Content_Types override and package-root relationship, out of a document that had neither, contradicting the "no requested change stays byte-for-byte free of a part it never had" contract this same describe block's own previous test pins.
  it("stays byte-for-byte free of docProps/core.xml when the only override is an empty keywords array", () => {
    const sourceBytes = encodePackage(docxWithExtrasPackage());
    expect(
      decodeOoxmlPackage(sourceBytes).parts["docProps/core.xml"],
    ).toBeUndefined();

    const patched = patchDocxMetadata(sourceBytes, { keywords: [] });

    expect(
      decodeOoxmlPackage(patched).parts["docProps/core.xml"],
    ).toBeUndefined();
  });

  it("leaves fields the caller never mentions exactly as the source document already had them", () => {
    const sourceBytes = minimalDocxBytes();
    const withTitle = patchDocxMetadata(sourceBytes, { title: "First Pass" });
    const withAuthorToo = patchDocxMetadata(withTitle, {
      author: "Second Pass Author",
    });

    const core = decodeOoxmlPackage(withAuthorToo);
    expect(readDocxExtras(core)).toStrictEqual(
      readDocxExtras(decodeOoxmlPackage(sourceBytes)),
    );

    // The actual behaviour this test's own name claims: title survives the second pass untouched (it was never mentioned in that pass's overrides), and author took the value the second pass actually set.
    const metadata = readDocxContent(core).metadata;
    expect(metadata.title).toBe("First Pass");
    expect(metadata.author).toBe("Second Pass Author");
  });
});

// ExaDev/documents.js#966 round 2: classifyWritePath routes a docx/docx pair to patchDocxMetadata internally (the "docx-patch" WritePath kind), rather than the generic ContentDocument rebuild every other REBUILD_FORMATS member takes -- so calling setDocumentMetadata directly, with no caller-side special-casing, is exactly as lossless for docx as calling patchDocxMetadata by hand (proven above).
describe("setDocumentMetadata: docx-patch path", () => {
  it("preserves docx-extras data (comments, footnotes, headers/footers, numbering) when source and target are both docx", () => {
    const sourceBytes = encodePackage(docxWithExtrasPackage());
    const before = readDocxExtras(decodeOoxmlPackage(sourceBytes));
    expect(before.comments.length).toBeGreaterThan(0);
    expect(before.footnotes.length).toBeGreaterThan(0);
    expect(before.headerFooterParts.length).toBeGreaterThan(0);
    expect(Object.keys(before.numbering).length).toBeGreaterThan(0);

    const patched = setDocumentMetadata("docx", "docx", sourceBytes, {
      title: "Patched Title",
      author: "New Author",
    });

    const after = readDocxExtras(decodeOoxmlPackage(patched));
    expect(after).toStrictEqual(before);

    const metadata = readDocxContent(decodeOoxmlPackage(patched)).metadata;
    expect(metadata.title).toBe("Patched Title");
    expect(metadata.author).toBe("New Author");
  });

  it("rejects docx paired with a different target format, naming that the formats must match", () => {
    expect(() =>
      setDocumentMetadata("docx", "pptx", minimalDocxBytes(), {}),
    ).toThrow(/must be the same format\./);
  });

  it("rejects a different source format paired with a docx target, naming that the formats must match", () => {
    // classifyWritePath rejects on the format pair alone, before ever reading the bytes -- so an empty Uint8Array is fine here, matching the sibling "rejects two different rebuild formats" test's own pattern.
    expect(() =>
      setDocumentMetadata("pptx", "docx", new Uint8Array(), {}),
    ).toThrow(/must be the same format\./);
  });
});

describe("setDocumentMetadata: pdf direct-patch path", () => {
  it("patches metadata on the parsed PDF directly, leaving the page content untouched", () => {
    const pdfBytes = docxToPdf(minimalDocxBytes());
    const before = readPdf(pdfBytes);

    const patched = setDocumentMetadata("pdf", "pdf", pdfBytes, {
      title: "A Patched PDF",
      subject: "metadata test",
    });
    const after = readPdf(patched);

    expect(after.metadata.title).toBe("A Patched PDF");
    expect(after.metadata.subject).toBe("metadata test");
    expect(after.pages.length).toBe(before.pages.length);
  });
});

// xlsx rebuilds through DOCUMENT_FORMAT_CODECS.xlsx.content (ooxml.js's readXlsxContent/buildXlsxPackageFromContent, src/codecs/registry.ts) exactly like every other rebuild format above -- real xlsx bytes (via the odsToXlsx bridge over richOdsBytes, the same real-fixture pattern src/convert/bridges.test.ts already uses) prove the round trip genuinely works, not merely that the type system accepts 'xlsx' as a RebuildFormat.
describe("setDocumentMetadata: rebuild path (xlsx)", () => {
  it("patches only the overridden field, leaving the source spreadsheet content untouched", () => {
    const xlsxBytes = odsToXlsx(richOdsBytes());
    const before = readXlsxContent(decodeOoxmlPackage(xlsxBytes));
    expect(before.metadata.title).toBe("Rich Spreadsheet"); // richOdsBytes's own real dc:title, carried through odsToXlsx.

    const patched = setDocumentMetadata("xlsx", "xlsx", xlsxBytes, {
      author: "New Author",
    });
    const after = readXlsxContent(decodeOoxmlPackage(patched));
    expect(after.metadata.title).toBe("Rich Spreadsheet");
    expect(after.metadata.author).toBe("New Author");
    if (after.kind !== "spreadsheet" || before.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(after.sheets[0]?.cells.length).toBe(before.sheets[0]?.cells.length);
  });

  it("overrides the title when asked to", () => {
    const xlsxBytes = odsToXlsx(richOdsBytes());
    const patched = setDocumentMetadata("xlsx", "xlsx", xlsxBytes, {
      title: "Renamed Workbook",
    });
    expect(readXlsxContent(decodeOoxmlPackage(patched)).metadata.title).toBe(
      "Renamed Workbook",
    );
  });
});

describe("setDocumentMetadata: rejected formats", () => {
  it("rejects odf as a source or target, naming that it has no write path back out", () => {
    expect(() =>
      setDocumentMetadata("odf", "odf", new Uint8Array(), {}),
    ).toThrow(/no write path back out/);
  });

  it("rejects csv as a source or target, naming that RFC 4180 text has no metadata container", () => {
    expect(() =>
      setDocumentMetadata(
        "csv",
        "csv",
        new TextEncoder().encode("A,B\n1,2\n"),
        {},
      ),
    ).toThrow(/no metadata container/);
  });

  it("rejects a source that is neither pdf nor a rebuild format, even when target is a rebuild format", () => {
    expect(() =>
      setDocumentMetadata("pdf", "docx", new Uint8Array(), {}),
    ).toThrow(/must be the same format \(or both 'pdf'\)/);
  });

  it("rejects two different rebuild formats -- setDocumentMetadata does not convert format", () => {
    expect(() =>
      setDocumentMetadata("docx", "pptx", minimalDocxBytes(), {}),
    ).toThrow(/must be the same format\./);
  });
});
