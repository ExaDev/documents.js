import { describe, expect, it } from "vitest";
import { EpubInvalidOpfError, type EpubDiagnosticSink } from "../diagnostics";
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

  it("splits a manifest item's multi-valued properties on any whitespace run", () => {
    const { manifest } = parseOpf(
      `<package xmlns="http://www.idpf.org/2007/opf">
        <manifest>
          <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav  scripted"/>
        </manifest>
        <spine/>
      </package>`,
    );
    expect(manifest[0]?.properties).toEqual(["nav", "scripted"]);
  });

  it("skips a manifest item missing a required attribute, keeping the well-formed ones", () => {
    const { manifest } = parseOpf(
      `<package xmlns="http://www.idpf.org/2007/opf">
        <manifest>
          <item id="incomplete" href="x.xhtml"/>
          <item id="ok" href="ok.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine/>
      </package>`,
    );
    expect(manifest).toEqual([
      {
        id: "ok",
        href: "ok.xhtml",
        mediaType: "application/xhtml+xml",
        properties: [],
      },
    ]);
  });

  it("skips a spine itemref with no idref, keeping the well-formed ones", () => {
    const { spine } = parseOpf(
      `<package xmlns="http://www.idpf.org/2007/opf">
        <manifest/>
        <spine>
          <itemref/>
          <itemref idref="chapter1"/>
        </spine>
      </package>`,
    );
    expect(spine).toEqual([{ idref: "chapter1", linear: true }]);
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
    expect(() => parseOpf("<not-a-package/>")).toThrow(
      "the OPF document has no <package> root element",
    );
  });

  it("throws EpubInvalidOpfError with no <manifest>", () => {
    const xml =
      '<package xmlns="http://www.idpf.org/2007/opf"><spine/></package>';
    expect(() => parseOpf(xml)).toThrow(EpubInvalidOpfError);
    expect(() => parseOpf(xml)).toThrow(
      "the OPF document has no <manifest> element",
    );
  });

  it("throws EpubInvalidOpfError with no <spine>", () => {
    const xml =
      '<package xmlns="http://www.idpf.org/2007/opf"><manifest/></package>';
    expect(() => parseOpf(xml)).toThrow(EpubInvalidOpfError);
    expect(() => parseOpf(xml)).toThrow(
      "the OPF document has no <spine> element",
    );
  });

  it("tolerates a missing <metadata> element", () => {
    const { metadata } = parseOpf(
      '<package xmlns="http://www.idpf.org/2007/opf"><manifest/><spine/></package>',
    );
    expect(metadata).toEqual({});
  });

  it("reports dc:publisher/dc:contributor/dc:rights as unmapped metadata fields", () => {
    const codes: string[] = [];
    const sink: EpubDiagnosticSink = (diagnostic) =>
      codes.push(diagnostic.code);
    parseOpf(
      `<package xmlns="http://www.idpf.org/2007/opf">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:publisher>A Publisher</dc:publisher>
          <dc:rights>All rights reserved</dc:rights>
        </metadata>
        <manifest/>
        <spine/>
      </package>`,
      sink,
    );
    expect(
      codes.filter((c) => c === "epub/metadata-field-unmapped"),
    ).toHaveLength(2);
  });
});
