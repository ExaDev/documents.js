import { describe, expect, it } from "vitest";
import { docxToPdf } from "../convert/convert";
import { minimalDocxBytes } from "../test-support/docx";
import { setDocumentMetadata } from "./write";

// The classification table: every format with no metadata container refuses the call from EITHER side (as source and as target alike), each naming its own reason; pdf paired with anything but pdf rebuilds into the target format rather than patching the PDF in place.

const NOTHING = new Uint8Array(new ArrayBuffer(0));

describe("setDocumentMetadata: unsupported formats refuse from either side", () => {
  const refusals: readonly [string, string][] = [
    ["odf", "standalone formula document"],
    ["csv", "RFC 4180 text has no metadata container"],
    ["svg", "root <title> element alone"],
    ["doc", "doc-codec's reader always returns empty metadata"],
    ["xls", "xls-codec's reader always returns empty metadata"],
    ["ppt", "document properties live in the compound file"],
    ["epub", "Dublin Core"],
  ];

  it.each(refusals)("%s as source", (format, fragment) => {
    expect(() =>
      setDocumentMetadata(format as never, "pdf", NOTHING, { title: "x" }),
    ).toThrow(fragment);
    expect(() =>
      setDocumentMetadata(format as never, "pdf", NOTHING, { title: "x" }),
    ).toThrow("not a supported setDocumentMetadata source or target");
  });

  it.each(refusals)("%s as target", (format, fragment) => {
    expect(() =>
      setDocumentMetadata("pdf", format as never, NOTHING, { title: "x" }),
    ).toThrow(fragment);
    expect(() =>
      setDocumentMetadata("pdf", format as never, NOTHING, { title: "x" }),
    ).toThrow("not a supported setDocumentMetadata source or target");
  });
});

describe("setDocumentMetadata: format mismatches", () => {
  it("a pdf source with a non-pdf target refuses rather than patching in place", () => {
    const pdfBytes = docxToPdf(minimalDocxBytes());
    expect(() =>
      setDocumentMetadata("pdf", "odt", pdfBytes, { title: "x" }),
    ).toThrow("must be the same format");
  });
});
