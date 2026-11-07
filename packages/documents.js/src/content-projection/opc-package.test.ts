import { describe, expect, it } from "vitest";
import {
  docx,
  paragraph,
  xmlPart,
  zipParts,
  type PackagePart,
} from "../test-support/content-projection";
import { comparePartDigests } from "./compare-parts";
import {
  canonicalizeOpcPackage,
  decodeXmlBytes,
  listOpcParts,
  readContentTypes,
  readOpcPart,
  sha256Hex,
} from "./opc-package";

const BUDGET = 2 ** 30;
const canonicalize = async (bytes: Uint8Array, memoryBudgetBytes = BUDGET) =>
  canonicalizeOpcPackage(bytes, { memoryBudgetBytes });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const body = `${paragraph("alpha beta")}${paragraph("gamma")}`;

describe("zip directory access", () => {
  it("lists parts with their uncompressed sizes in name order, without directory entries", () => {
    const bytes = zipParts([
      { name: "b.txt", content: "12345" },
      { name: "a/", content: "" },
      { name: "a/c.txt", content: "12" },
    ]);
    expect(listOpcParts(bytes).map((p) => [p.name, p.size])).toEqual([
      ["a/c.txt", 2],
      ["b.txt", 5],
    ]);
  });

  it("reads one part and refuses a missing one", () => {
    const bytes = zipParts([{ name: "a.txt", content: "hello" }]);
    expect(new TextDecoder().decode(readOpcPart(bytes, "a.txt"))).toBe("hello");
    expect(() => readOpcPart(bytes, "missing.txt")).toThrow(/missing\.txt/);
  });
});

function utf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]);
  const view = new DataView(out.buffer);
  for (let index = 0; index < text.length; index += 1) {
    view.setUint16(2 + index * 2, text.charCodeAt(index), littleEndian);
  }
  return out;
}

describe("decodeXmlBytes", () => {
  it("decodes UTF-8 with or without a byte order mark and UTF-16 by its mark", () => {
    const text = "<a>é</a>";
    const encoded = new TextEncoder().encode(text);
    expect(decodeXmlBytes(encoded)).toBe(text);
    expect(decodeXmlBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...encoded]))).toBe(
      text,
    );
    expect(decodeXmlBytes(utf16(text, true))).toBe(text);
    expect(decodeXmlBytes(utf16(text, false))).toBe(text);
  });

  it("refuses invalid UTF-8 instead of substituting replacement characters", () => {
    expect(() => decodeXmlBytes(new Uint8Array([0x3c, 0xc3, 0x28]))).toThrow();
  });
});

describe("sha256Hex", () => {
  it("matches the published SHA-256 test vector for abc", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("digests a view into a larger buffer by its own bytes only", async () => {
    const big = new TextEncoder().encode("xxabcyy");
    expect(await sha256Hex(big.subarray(2, 5))).toBe(
      await sha256Hex(new TextEncoder().encode("abc")),
    );
  });
});

describe("readContentTypes", () => {
  it("resolves an override before a default, and defaults by case-insensitive extension", () => {
    const bytes = docx({ body, media: { "i.PNG": PNG } });
    const types = readContentTypes(bytes);
    expect(types.typeOf("word/document.xml")).toContain("document.main+xml");
    expect(types.typeOf("word/media/i.PNG")).toBe("image/png");
    expect(types.typeOf("unknown")).toBeUndefined();
  });

  it("declares no types for a package whose content types are missing or malformed", () => {
    expect(
      readContentTypes(zipParts([{ name: "a.xml", content: "<a/>" }])).typeOf(
        "a.xml",
      ),
    ).toBeUndefined();
    expect(
      readContentTypes(
        zipParts([{ name: "[Content_Types].xml", content: "<Types" }]),
      ).typeOf("a.xml"),
    ).toBeUndefined();
  });
});

describe("canonicalizeOpcPackage container normalisation", () => {
  it("ignores entry order, timestamps and compression", async () => {
    const plain = await canonicalize(docx({ body }));
    const repacked = await canonicalize(
      docx({
        body,
        zip: {
          reverse: true,
          store: true,
          mtime: new Date(Date.UTC(2020, 5, 6)),
        },
      }),
    );
    expect([...repacked.parts]).toEqual([...plain.parts]);
  });

  it("ignores lexical difference inside XML parts, here a prefix rename", async () => {
    const original = docx({ body });
    const renamed = zipParts(
      listOpcParts(original).map((entry): PackagePart => ({
        name: entry.name,
        content:
          entry.name === "word/document.xml"
            ? new TextDecoder()
                .decode(readOpcPart(original, entry.name))
                .replaceAll("<w:", "<x:")
                .replaceAll("</w:", "</x:")
                .replaceAll("xmlns:w=", "xmlns:x=")
            : readOpcPart(original, entry.name),
      })),
      { reverse: true },
    );
    const a = await canonicalize(original);
    const b = await canonicalize(renamed);
    expect(a.parts.get("word/document.xml")?.kind).toBe("xml");
    expect(b.parts.get("word/document.xml")).toEqual(
      a.parts.get("word/document.xml"),
    );
  });

  it("digests a binary part by its bytes", async () => {
    const form = await canonicalize(docx({ body, media: { "i.png": PNG } }));
    expect(form.parts.get("word/media/i.png")).toEqual({
      kind: "binary",
      size: PNG.length,
      digest: await sha256Hex(PNG),
    });
  });
});

describe("canonicalizeOpcPackage parts that cannot be canonicalised", () => {
  it("records a malformed XML part as unparsed, with the error's class and a digest of its bytes, and still reads the rest", async () => {
    const bytes = docx({
      body,
      extraParts: [{ name: "word/broken.xml", content: "<a><b></a>" }],
    });
    const form = await canonicalize(bytes);
    const broken = form.parts.get("word/broken.xml");
    expect(broken).toMatchObject({ kind: "unparsed", reason: "XmlScanError" });
    expect(form.parts.get("word/document.xml")?.kind).toBe("xml");
  });

  it("records a document type declaration as a refusal rather than dropping it", async () => {
    const bytes = docx({
      body,
      extraParts: [
        {
          name: "word/settings.xml",
          content: '<!DOCTYPE s [<!ENTITY e "x">]><s>&e;</s>',
        },
      ],
    });
    expect(
      (await canonicalize(bytes)).parts.get("word/settings.xml"),
    ).toMatchObject({
      kind: "unparsed",
      reason: "XmlDoctypeError",
    });
  });

  it("never records an error message, since a message can quote the document", async () => {
    const bytes = docx({
      body,
      extraParts: [{ name: "word/x.xml", content: "<a>SECRET&nbsp;</a>" }],
    });
    expect(
      JSON.stringify([...(await canonicalize(bytes)).parts]),
    ).not.toContain("SECRET");
  });

  it("records a part the memory budget does not cover as skipped, with nothing known of its content", async () => {
    const bytes = docx({ body });
    const form = await canonicalize(bytes, 1);
    expect(
      [...form.parts.values()].every((part) => part.kind === "skipped"),
    ).toBe(true);
  });

  it("refuses a non-positive memory budget", async () => {
    await expect(canonicalize(docx({ body }), 0)).rejects.toThrow(RangeError);
  });
});

describe("comparePartDigests", () => {
  const core = (creator: string) => ({ creator });

  it("separates identical, identifier-only, metadata, differing, missing and added parts", async () => {
    const original = await canonicalize(
      docx({
        body,
        creator: "Ada",
        media: { "i.png": PNG },
        extraParts: [
          xmlPart("word/settings.xml", '<s xmlns="urn:s" rsid="1"><x/></s>'),
          xmlPart("word/styles.xml", '<s xmlns="urn:s"><a/></s>'),
          xmlPart("word/gone.xml", "<g/>"),
        ],
      }),
    );
    const rewrite = await canonicalize(
      docx({
        body,
        creator: core("Grace").creator,
        media: { "i.png": PNG },
        extraParts: [
          xmlPart("word/settings.xml", '<s xmlns="urn:s" rsid="2"><x/></s>'),
          xmlPart("word/styles.xml", '<s xmlns="urn:s"><b/></s>'),
          xmlPart("word/new.xml", "<n/>"),
        ],
      }),
    );
    const report = comparePartDigests(original, rewrite);
    expect(report.identical).toContain("word/document.xml");
    expect(report.identical).toContain("word/media/i.png");
    expect(report.identifierOnly).toEqual(["word/settings.xml"]);
    expect(report.metadata).toEqual(["docProps/core.xml"]);
    expect(report.differing).toEqual(["word/styles.xml"]);
    expect(report.missing).toEqual(["word/gone.xml"]);
    expect(report.added).toEqual(["word/new.xml"]);
    expect(report.undetermined).toEqual([]);
  });

  it("reports a part either side skipped as undetermined", async () => {
    const original = await canonicalize(docx({ body }));
    const skipped = await canonicalize(docx({ body }), 1);
    expect(comparePartDigests(original, skipped).undetermined).toContain(
      "word/document.xml",
    );
  });

  it("compares an unparsed part by its raw bytes", async () => {
    const make = async (text: string) =>
      canonicalize(
        docx({ body, extraParts: [{ name: "word/b.xml", content: text }] }),
      );
    expect(
      comparePartDigests(await make("<a>"), await make("<a>")).identical,
    ).toContain("word/b.xml");
    expect(
      comparePartDigests(await make("<a>"), await make("<b>")).differing,
    ).toContain("word/b.xml");
  });
});
