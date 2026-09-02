import { describe, expect, it } from "vitest";
import { EpubInvalidContainerError } from "../diagnostics";
import { resolveOpfPath } from "./container";

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

describe("resolveOpfPath", () => {
  it("resolves the OPF rootfile's full-path", () => {
    expect(resolveOpfPath(CONTAINER_XML)).toBe("OEBPS/content.opf");
  });

  it("picks the OPF-media-type rootfile among several declared roles", () => {
    const xml = `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles>
        <rootfile full-path="other/rendition.xml" media-type="application/x-other-rendition"/>
        <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
      </rootfiles>
    </container>`;
    expect(resolveOpfPath(xml)).toBe("EPUB/package.opf");
  });

  it("throws EpubInvalidContainerError when there is no <container> root", () => {
    expect(() => resolveOpfPath("<not-a-container/>")).toThrow(
      EpubInvalidContainerError,
    );
  });

  it("throws EpubInvalidContainerError when there is no <rootfiles> element", () => {
    expect(() =>
      resolveOpfPath(
        '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"/>',
      ),
    ).toThrow(EpubInvalidContainerError);
  });

  it("throws EpubInvalidContainerError when no rootfile carries a full-path", () => {
    const xml = `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile media-type="application/oebps-package+xml"/></rootfiles>
    </container>`;
    expect(() => resolveOpfPath(xml)).toThrow(EpubInvalidContainerError);
  });
});
