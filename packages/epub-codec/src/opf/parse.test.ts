import { describe, expect, it } from "vitest";
import { EpubInvalidOpfError } from "../diagnostics";
import { parseOpf } from "./parse";

const OPF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>A Test Book</dc:title>
    <dc:creator>Ada Lovelace</dc:creator>
    <dc:creator>Charles Babbage</dc:creator>
    <dc:subject>Fiction</dc:subject>
    <dc:subject>Adventure</dc:subject>
    <dc:language>en</dc:language>
    <dc:date>2026-01-01</dc:date>
    <dc:identifier id="pub-id">urn:uuid:example</dc:identifier>
    <meta property="dcterms:modified">2026-02-02T10:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="images/cover.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter1"/>
    <itemref idref="chapter2"/>
    <itemref idref="notes" linear="no"/>
  </spine>
</package>`;

describe("parseOpf", () => {
  it("reads Dublin Core metadata into LayoutMetadata", () => {
    const { metadata } = parseOpf(OPF_XML);
    expect(metadata.title).toBe("A Test Book");
    expect(metadata.author).toBe("Ada Lovelace; Charles Babbage");
    expect(metadata.keywords).toEqual(["Fiction", "Adventure"]);
    expect(metadata.language).toBe("en");
    expect(metadata.createdIso).toBe("2026-01-01");
    expect(metadata.modifiedIso).toBe("2026-02-02T10:00:00Z");
  });

  it("reads every manifest item with its properties", () => {
    const { manifest } = parseOpf(OPF_XML);
    expect(manifest).toContainEqual({
      id: "nav",
      href: "nav.xhtml",
      mediaType: "application/xhtml+xml",
      properties: ["nav"],
    });
    expect(manifest).toContainEqual({
      id: "cover",
      href: "images/cover.jpg",
      mediaType: "image/jpeg",
      properties: [],
    });
  });

  it("reads the spine in document order, with linear=no honoured", () => {
    const { spine, ncxId } = parseOpf(OPF_XML);
    expect(spine).toEqual([
      { idref: "chapter1", linear: true },
      { idref: "chapter2", linear: true },
      { idref: "notes", linear: false },
    ]);
    expect(ncxId).toBe("ncx");
  });

  it("throws EpubInvalidOpfError with no <package> root", () => {
    expect(() => parseOpf("<not-a-package/>")).toThrow(EpubInvalidOpfError);
  });

  it("throws EpubInvalidOpfError with no <manifest>", () => {
    expect(() =>
      parseOpf(
        '<package xmlns="http://www.idpf.org/2007/opf"><spine/></package>',
      ),
    ).toThrow(EpubInvalidOpfError);
  });

  it("throws EpubInvalidOpfError with no <spine>", () => {
    expect(() =>
      parseOpf(
        '<package xmlns="http://www.idpf.org/2007/opf"><manifest/></package>',
      ),
    ).toThrow(EpubInvalidOpfError);
  });

  it("tolerates a missing <metadata> element", () => {
    const { metadata } = parseOpf(
      '<package xmlns="http://www.idpf.org/2007/opf"><manifest/><spine/></package>',
    );
    expect(metadata).toEqual({});
  });
});
