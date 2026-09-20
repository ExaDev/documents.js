import type {
  ContentDocument,
  ContentSection,
  DocumentTree,
} from "document-schema.js";
import * as documentSchema from "document-schema.js";
import { describe, expect, it, vi } from "vitest";
import {
  EpubUnbalancedConstructMarkersError,
  EpubUnsupportedDocumentKindError,
} from "./diagnostics";
import { readEpub } from "./read";
import { bytesToBase64 } from "byte-codec";
import { unzipPackage } from "./zip";
import { writeEpub, writeEpubContent } from "./write";

const PAGE = { widthPt: 595.28, heightPt: 841.89 };
const MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

function section(blocks: ContentSection["blocks"]): ContentSection {
  return { pageSize: PAGE, margins: MARGINS, blocks };
}

function doc(sections: ContentSection[]): ContentDocument {
  return { kind: "wordprocessing", metadata: {}, sections };
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function writtenOpf(document: ContentDocument): string {
  const entries = unzipPackage(writeEpubContent(document));
  const opf = entries["OEBPS/content.opf"];
  expect(opf).toBeDefined();
  return decode(opf ?? new Uint8Array());
}

describe("buildHead: the required <title> element", () => {
  it("writes a real <title> tag, not an empty one", () => {
    const entries = unzipPackage(
      writeEpubContent(
        doc([section([{ kind: "paragraph", runs: [{ text: "Body." }] }])]),
      ),
    );
    const sectionXml = entries["OEBPS/section1.xhtml"];
    expect(sectionXml).toBeDefined();
    expect(decode(sectionXml ?? new Uint8Array())).toContain("<title>");
  });

  it("carries the real title text inside the <title> element, not an empty one", () => {
    const entries = unzipPackage(
      writeEpubContent(
        doc([
          {
            ...section([{ kind: "paragraph", runs: [{ text: "Body." }] }]),
          },
        ]),
      ),
    );
    const sectionXml = decode(
      entries["OEBPS/section1.xhtml"] ?? new Uint8Array(),
    );
    const titleMatch = /<title>([^<]*)<\/title>/u.exec(sectionXml);
    expect(titleMatch?.[1]).toBeTruthy();
  });
});

describe("imageExtension/imageMediaType: every ContentImageBlock format maps to its own real extension and media type", () => {
  it.each([
    ["png", "png", "image/png"],
    ["jpeg", "jpg", "image/jpeg"],
    ["svg", "svg", "image/svg+xml"],
    ["gif", "gif", "image/gif"],
  ] as const)(
    "format %s -> extension .%s, media-type %s",
    (format, ext, mediaType) => {
      const document = doc([
        section([
          {
            kind: "image",
            format,
            base64: bytesToBase64(new Uint8Array([1, 2, 3])),
            widthPt: 10,
            heightPt: 10,
          },
        ]),
      ]);
      const entries = unzipPackage(writeEpubContent(document));
      expect(Object.keys(entries)).toContain(`OEBPS/images/img1.${ext}`);
      const opf = writtenOpf(document);
      expect(opf).toContain(`href="images/img1.${ext}"`);
      expect(opf).toContain(`media-type="${mediaType}"`);
    },
  );
});

describe("writeEpubContent: registered-image numbering starts at 1, not 0 or -1", () => {
  it("names the first registered image img1, not img0 or img-1", () => {
    const document = doc([
      section([
        {
          kind: "image",
          format: "png",
          base64: bytesToBase64(new Uint8Array([1, 2, 3])),
          widthPt: 10,
          heightPt: 10,
        },
      ]),
    ]);
    const entries = unzipPackage(writeEpubContent(document));
    expect(Object.keys(entries)).toContain("OEBPS/images/img1.png");
    expect(writtenOpf(document)).toContain('id="img1"');
  });

  it("numbers a second registered image img2, continuing from the first", () => {
    const document = doc([
      section([
        {
          kind: "image",
          format: "png",
          base64: bytesToBase64(new Uint8Array([1, 2, 3])),
          widthPt: 10,
          heightPt: 10,
        },
        {
          kind: "image",
          format: "png",
          base64: bytesToBase64(new Uint8Array([4, 5, 6])),
          widthPt: 10,
          heightPt: 10,
        },
      ]),
    ]);
    const entries = unzipPackage(writeEpubContent(document));
    expect(Object.keys(entries)).toContain("OEBPS/images/img1.png");
    expect(Object.keys(entries)).toContain("OEBPS/images/img2.png");
  });
});

describe("writeEpubContent: the OPF manifest's nav item", () => {
  it('carries id="nav", href="nav.xhtml", the XHTML media-type, and properties="nav"', () => {
    const opf = writtenOpf(
      doc([section([{ kind: "paragraph", runs: [{ text: "x" }] }])]),
    );
    expect(opf).toContain('id="nav"');
    expect(opf).toContain('href="nav.xhtml"');
    expect(opf).toMatch(/id="nav"[^>]*media-type="application\/xhtml\+xml"/u);
    expect(opf).toMatch(/id="nav"[^>]*properties="nav"/u);
  });
});

describe("writeEpubContent: the OPF manifest's section items", () => {
  it("carries the XHTML media-type and no properties attribute at all", () => {
    const opf = writtenOpf(
      doc([section([{ kind: "paragraph", runs: [{ text: "x" }] }])]),
    );
    expect(opf).toMatch(/id="s1"[^>]*media-type="application\/xhtml\+xml"/u);
    const itemMatch = /<item[^>]*id="s1"[^>]*><\/item>/u.exec(opf);
    expect(itemMatch?.[0]).toBeDefined();
    expect(itemMatch?.[0]).not.toContain("properties=");
  });
});

describe("writeEpubContent: the OPF manifest's image items", () => {
  it("carries no properties attribute at all", () => {
    const document = doc([
      section([
        {
          kind: "image",
          format: "png",
          base64: bytesToBase64(new Uint8Array([1, 2, 3])),
          widthPt: 10,
          heightPt: 10,
        },
      ]),
    ]);
    const opf = writtenOpf(document);
    const itemMatch = /<item[^>]*id="img1"[^>]*><\/item>/u.exec(opf);
    expect(itemMatch?.[0]).toBeDefined();
    expect(itemMatch?.[0]).not.toContain("properties=");
  });
});

describe("writeEpubContent: the generated dc:identifier", () => {
  it("is a real, non-empty urn:uuid value, not an empty string", () => {
    const opf = writtenOpf(
      doc([section([{ kind: "paragraph", runs: [{ text: "x" }] }])]),
    );
    const identifierMatch =
      /<dc:identifier id="pub-id">([^<]*)<\/dc:identifier>/u.exec(opf);
    expect(identifierMatch?.[1]).toMatch(/^urn:uuid:[0-9a-f-]{36}$/u);
  });
});

describe("writeEpubContent: an unbalanced construct marker", () => {
  it("wraps decomposeSection's own ConstructMarkerImbalanceError as EpubUnbalancedConstructMarkersError", () => {
    const document = doc([
      section([
        { kind: "constructStart", descriptor: { kind: "division" } },
        { kind: "paragraph", runs: [{ text: "never closed" }] },
        // No matching constructEnd.
      ]),
    ]);
    expect(() => writeEpubContent(document)).toThrow(
      EpubUnbalancedConstructMarkersError,
    );
  });
});

describe("writeEpub: a non-wordprocessing DocumentTree", () => {
  it("throws EpubUnsupportedDocumentKindError naming the tree's own kind", () => {
    const tree: DocumentTree = {
      kind: "spreadsheet",
      metadata: {},
      children: [],
    };
    try {
      writeEpub(tree);
      expect.unreachable("writeEpub should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EpubUnsupportedDocumentKindError);
      expect(
        error instanceof EpubUnsupportedDocumentKindError
          ? error.kind
          : undefined,
      ).toBe("spreadsheet");
    }
  });

  it("checks the tree's own kind before ever calling flattenTree, not after", () => {
    const flattenTreeSpy = vi.spyOn(documentSchema, "flattenTree");
    const tree: DocumentTree = {
      kind: "spreadsheet",
      metadata: {},
      children: [],
    };
    expect(() => writeEpub(tree)).toThrow(EpubUnsupportedDocumentKindError);
    expect(flattenTreeSpy).not.toHaveBeenCalled();
    flattenTreeSpy.mockRestore();
  });
});

describe("writeEpub: a wordprocessing DocumentTree", () => {
  it("does not throw EpubUnsupportedDocumentKindError -- the kind check only ever rejects a non-wordprocessing tree", () => {
    const tree = documentSchema.assembleTree(
      doc([section([{ kind: "paragraph", runs: [{ text: "Hello." }] }])]),
    );
    expect(() => writeEpub(tree)).not.toThrow(EpubUnsupportedDocumentKindError);
  });
});

describe("writeEpubContent: the written nav document's own toc hrefs match the spine order", () => {
  it("reads back a multi-section EPUB with no NAV_SPINE_ORDER_MISMATCH residue", () => {
    const document = doc([
      section([{ kind: "paragraph", runs: [{ text: "Chapter one." }] }]),
      section([{ kind: "paragraph", runs: [{ text: "Chapter two." }] }]),
      section([{ kind: "paragraph", runs: [{ text: "Chapter three." }] }]),
    ]);
    const tree = readEpub(writeEpubContent(document));
    expect(tree.source?.nav).toBeUndefined();
  });
});
