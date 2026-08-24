import { decodePackage as decodeOdfPackage } from "odf.js";
import { decodePackage as decodeOoxmlPackage } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { docxToPdf, odsToXlsx } from "./convert/convert";
import {
  decodeDocumentPackage,
  decodeOdbPackage,
  encodeDocumentPackage,
  UnsupportedPackageFormatError,
} from "./package-codec";
import { encodeMarkdownText } from "./markdown/text";
import { readOdbTables } from "./odb/read";
import { richMarkdownText } from "./test-support/markdown";
import { FRACTION_FORMULA, odfFormulaBytes } from "./test-support/odf";
import {
  embeddedHsqldbOdbBytes,
  embeddedHsqldbOdbPackage,
} from "./test-support/odb";
import { minimalDocxBytes } from "./test-support/docx";
import { minimalOdgBytes } from "./test-support/odg";
import { minimalOdpBytes } from "./test-support/odp";
import { minimalOdsBytes } from "./test-support/ods";
import { minimalOdtBytes } from "./test-support/odt";
import { minimalPptxBytes } from "./test-support/pptx";

describe("decodeDocumentPackage: OOXML formats (docx/pptx/xlsx)", () => {
  it("docx: matches ooxml.js decodePackage", () => {
    const bytes = minimalDocxBytes();
    expect(decodeDocumentPackage("docx", bytes)).toEqual(
      decodeOoxmlPackage(bytes),
    );
  });

  it("pptx: matches ooxml.js decodePackage", () => {
    const bytes = minimalPptxBytes();
    expect(decodeDocumentPackage("pptx", bytes)).toEqual(
      decodeOoxmlPackage(bytes),
    );
  });

  it("xlsx: decodes a real xlsx package through ooxml.js decodePackage -- xlsx is an ordinary OPC container with no xlsx-specific handling needed", () => {
    const bytes = odsToXlsx(minimalOdsBytes());
    const pkg = decodeDocumentPackage("xlsx", bytes);
    expect(pkg).toEqual(decodeOoxmlPackage(bytes));
    expect(Object.keys(pkg.parts).length).toBeGreaterThan(0);
  });
});

describe("decodeDocumentPackage: ODF formats (odt/odp/ods/odg/odf)", () => {
  it("odt: matches odf.js decodePackage", () => {
    const bytes = minimalOdtBytes();
    expect(decodeDocumentPackage("odt", bytes)).toEqual(
      decodeOdfPackage(bytes),
    );
  });

  it("odp: matches odf.js decodePackage", () => {
    const bytes = minimalOdpBytes();
    expect(decodeDocumentPackage("odp", bytes)).toEqual(
      decodeOdfPackage(bytes),
    );
  });

  it("ods: matches odf.js decodePackage", () => {
    const bytes = minimalOdsBytes();
    expect(decodeDocumentPackage("ods", bytes)).toEqual(
      decodeOdfPackage(bytes),
    );
  });

  it("odg: matches odf.js decodePackage", () => {
    const bytes = minimalOdgBytes();
    expect(decodeDocumentPackage("odg", bytes)).toEqual(
      decodeOdfPackage(bytes),
    );
  });

  it("odf: matches odf.js decodePackage", () => {
    const bytes = odfFormulaBytes(FRACTION_FORMULA);
    expect(decodeDocumentPackage("odf", bytes)).toEqual(
      decodeOdfPackage(bytes),
    );
  });
});

describe("decodeOdbPackage", () => {
  it("matches odf.js decodePackage on a real .odb package", () => {
    const bytes = embeddedHsqldbOdbBytes();
    expect(decodeOdbPackage(bytes)).toEqual(embeddedHsqldbOdbPackage());
  });

  it("produces a Package that readOdbTables can actually consume", () => {
    const pkg = decodeOdbPackage(embeddedHsqldbOdbBytes());
    const tables = readOdbTables(pkg);
    expect(tables.map((table) => table.tableName).sort()).toEqual([
      "CUSTOMERS",
      "ORDERS",
    ]);
    const customers = tables.find((table) => table.tableName === "CUSTOMERS");
    expect(customers?.rows).toHaveLength(3);
  });
});

describe("decodeDocumentPackage / encodeDocumentPackage: unsupported formats", () => {
  it("markdown: throws UnsupportedPackageFormatError -- markdown is plain text, not a zip container", () => {
    const bytes = encodeMarkdownText(richMarkdownText());
    expect(() => decodeDocumentPackage("markdown", bytes)).toThrow(
      UnsupportedPackageFormatError,
    );
    expect(() => decodeDocumentPackage("markdown", bytes)).toThrow(
      /no raw package concept/,
    );
    try {
      decodeDocumentPackage("markdown", bytes);
      expect.unreachable();
    } catch (error) {
      if (!(error instanceof UnsupportedPackageFormatError)) {
        throw error;
      }
      expect(error.format).toBe("markdown");
    }
  });

  it("pdf: throws UnsupportedPackageFormatError -- pdf is not an OPC/ODF zip package", () => {
    const bytes = docxToPdf(minimalDocxBytes());
    expect(() => decodeDocumentPackage("pdf", bytes)).toThrow(
      UnsupportedPackageFormatError,
    );
    expect(() => decodeDocumentPackage("pdf", bytes)).toThrow(
      /no raw package concept/,
    );
  });

  it("encodeDocumentPackage: markdown throws UnsupportedPackageFormatError too", () => {
    const pkg = decodeOoxmlPackage(minimalDocxBytes());
    expect(() => encodeDocumentPackage("markdown", pkg)).toThrow(
      UnsupportedPackageFormatError,
    );
  });

  it("encodeDocumentPackage: pdf throws UnsupportedPackageFormatError too", () => {
    const pkg = decodeOoxmlPackage(minimalDocxBytes());
    expect(() => encodeDocumentPackage("pdf", pkg)).toThrow(
      UnsupportedPackageFormatError,
    );
  });
});

describe("encodeDocumentPackage: round trip", () => {
  it("docx: decode -> encode -> decode preserves every part", () => {
    const bytes = minimalDocxBytes();
    const pkg = decodeDocumentPackage("docx", bytes);
    const reEncoded = encodeDocumentPackage("docx", pkg);
    expect(decodeDocumentPackage("docx", reEncoded)).toEqual(pkg);
  });

  it("odt: decode -> encode -> decode preserves every part", () => {
    const bytes = minimalOdtBytes();
    const pkg = decodeDocumentPackage("odt", bytes);
    const reEncoded = encodeDocumentPackage("odt", pkg);
    expect(decodeDocumentPackage("odt", reEncoded)).toEqual(pkg);
  });

  it("xlsx: decode -> encode -> decode preserves every part", () => {
    const bytes = odsToXlsx(minimalOdsBytes());
    const pkg = decodeDocumentPackage("xlsx", bytes);
    const reEncoded = encodeDocumentPackage("xlsx", pkg);
    expect(decodeDocumentPackage("xlsx", reEncoded)).toEqual(pkg);
  });
});
