import { describe, it, expect } from "vitest";
import { parseXml } from "../xml/parse";
import type { Package } from "../model/package";
import {
  OOO1_NAMESPACES,
  OOO1_MEDIA_TYPES,
  isOoo1Package,
  odfMediaTypeForOoo1MediaType,
  ooo1MediaTypeForExtension,
} from "./ns";
import { ODF_NAMESPACES } from "../ns";

// The OOo 1.0 URIs asserted here are not paraphrases of the prefix names: every one was read out of a genuine OpenOffice.org 1.x document's own root-element xmlns declarations (the .sxw/.sxc/.sxi/.sxd samples this work was validated against) and cross-checked against LibreOffice's own OOo-namespace token table, xmloff/source/core/xmltoken.cxx's XML_N_*_OOO entries.
describe("OOO1_NAMESPACES", () => {
  it("pins the openoffice.org family at the 2000/2001 URIs, never the OASIS ones", () => {
    expect(OOO1_NAMESPACES.office).toBe("http://openoffice.org/2000/office");
    expect(OOO1_NAMESPACES.text).toBe("http://openoffice.org/2000/text");
    expect(OOO1_NAMESPACES.style).toBe("http://openoffice.org/2000/style");
    expect(OOO1_NAMESPACES.table).toBe("http://openoffice.org/2000/table");
    // The same "do not pattern-match the prefix onto the URI" trap ODF has: draw: is ".../drawing", number: is ".../datastyle".
    expect(OOO1_NAMESPACES.draw).toBe("http://openoffice.org/2000/drawing");
    expect(OOO1_NAMESPACES.number).toBe("http://openoffice.org/2000/datastyle");
    // config: and manifest: are the two that moved to the 2001 path; presentation: did NOT, despite OpenOffice.org's own retained DTD (xmloff/dtd/nmspace.mod) declaring it as 2001/presentation -- a real .sxi's own meta.xml declares 2000/presentation, and 2001/presentation appears nowhere in LibreOffice's namespace table.
    expect(OOO1_NAMESPACES.presentation).toBe(
      "http://openoffice.org/2000/presentation",
    );
    expect(OOO1_NAMESPACES.config).toBe("http://openoffice.org/2001/config");
    expect(OOO1_NAMESPACES.manifest).toBe(
      "http://openoffice.org/2001/manifest",
    );
  });

  it("binds fo:/svg: to the real W3C namespaces, where ODF mints its own -compatible URIs", () => {
    expect(OOO1_NAMESPACES.fo).toBe("http://www.w3.org/1999/XSL/Format");
    expect(OOO1_NAMESPACES.svg).toBe("http://www.w3.org/2000/svg");
    expect(OOO1_NAMESPACES.fo).not.toBe(ODF_NAMESPACES.fo);
    expect(OOO1_NAMESPACES.svg).not.toBe(ODF_NAMESPACES.svg);
  });

  it("reuses the W3C/Dublin Core namespaces ODF also reuses unchanged", () => {
    expect(OOO1_NAMESPACES.xlink).toBe(ODF_NAMESPACES.xlink);
    expect(OOO1_NAMESPACES.dc).toBe(ODF_NAMESPACES.dc);
    expect(OOO1_NAMESPACES.math).toBe(ODF_NAMESPACES.math);
  });

  it("shares no URI with the OASIS table for any prefix ODF renamespaced", () => {
    for (const prefix of [
      "office",
      "style",
      "text",
      "table",
      "draw",
      "meta",
      "number",
      "chart",
      "dr3d",
      "form",
      "script",
      "presentation",
      "config",
      "manifest",
      "fo",
      "svg",
    ] as const) {
      expect(OOO1_NAMESPACES[prefix]).not.toBe(ODF_NAMESPACES[prefix]);
    }
  });
});

describe("OOO1_MEDIA_TYPES", () => {
  it("maps every OpenOffice.org 1.x extension to its application/vnd.sun.xml.* type", () => {
    expect(OOO1_MEDIA_TYPES.sxw).toBe("application/vnd.sun.xml.writer");
    expect(OOO1_MEDIA_TYPES.stw).toBe(
      "application/vnd.sun.xml.writer.template",
    );
    expect(OOO1_MEDIA_TYPES.sxg).toBe("application/vnd.sun.xml.writer.global");
    expect(OOO1_MEDIA_TYPES.sxc).toBe("application/vnd.sun.xml.calc");
    expect(OOO1_MEDIA_TYPES.stc).toBe("application/vnd.sun.xml.calc.template");
    expect(OOO1_MEDIA_TYPES.sxi).toBe("application/vnd.sun.xml.impress");
    expect(OOO1_MEDIA_TYPES.sti).toBe(
      "application/vnd.sun.xml.impress.template",
    );
    expect(OOO1_MEDIA_TYPES.sxd).toBe("application/vnd.sun.xml.draw");
    expect(OOO1_MEDIA_TYPES.std).toBe("application/vnd.sun.xml.draw.template");
    expect(OOO1_MEDIA_TYPES.sxm).toBe("application/vnd.sun.xml.math");
  });

  it("resolves an extension case-insensitively, and nothing for an ODF extension", () => {
    expect(ooo1MediaTypeForExtension("SXW")).toBe(
      "application/vnd.sun.xml.writer",
    );
    expect(ooo1MediaTypeForExtension("odt")).toBeUndefined();
  });

  it("maps each OOo media type onto its OASIS successor", () => {
    expect(odfMediaTypeForOoo1MediaType("application/vnd.sun.xml.writer")).toBe(
      "application/vnd.oasis.opendocument.text",
    );
    expect(
      odfMediaTypeForOoo1MediaType("application/vnd.sun.xml.calc.template"),
    ).toBe("application/vnd.oasis.opendocument.spreadsheet-template");
    expect(
      odfMediaTypeForOoo1MediaType("application/vnd.sun.xml.impress"),
    ).toBe("application/vnd.oasis.opendocument.presentation");
    expect(odfMediaTypeForOoo1MediaType("application/vnd.sun.xml.draw")).toBe(
      "application/vnd.oasis.opendocument.graphics",
    );
    expect(
      odfMediaTypeForOoo1MediaType("application/vnd.sun.xml.writer.global"),
    ).toBe("application/vnd.oasis.opendocument.text-master");
    expect(
      odfMediaTypeForOoo1MediaType("application/vnd.oasis.opendocument.text"),
    ).toBeUndefined();
  });
});

function packageOf(parts: Record<string, string>): Package {
  return {
    parts: Object.fromEntries(
      Object.entries(parts).map(([path, xml]) => [
        path,
        { kind: "xml" as const, nodes: parseXml(xml) },
      ]),
    ),
  };
}

describe("isOoo1Package", () => {
  it("recognises a package whose content.xml declares the OOo office namespace", () => {
    const pkg = packageOf({
      "content.xml": `<office:document-content xmlns:office="http://openoffice.org/2000/office" xmlns:text="http://openoffice.org/2000/text" office:version="1.0" office:class="text"><office:body><text:p>hi</text:p></office:body></office:document-content>`,
    });
    expect(isOoo1Package(pkg)).toBe(true);
  });

  it("recognises one detectable only from its manifest, with no content.xml at all", () => {
    const pkg = packageOf({
      "META-INF/manifest.xml": `<manifest:manifest xmlns:manifest="http://openoffice.org/2001/manifest"><manifest:file-entry manifest:media-type="application/vnd.sun.xml.writer" manifest:full-path="/"/></manifest:manifest>`,
    });
    expect(isOoo1Package(pkg)).toBe(true);
  });

  it("rejects a real ODF package", () => {
    const pkg = packageOf({
      "content.xml": `<office:document-content xmlns:office="${ODF_NAMESPACES.office}" xmlns:text="${ODF_NAMESPACES.text}" office:version="1.3"><office:body><office:text><text:p>hi</text:p></office:text></office:body></office:document-content>`,
    });
    expect(isOoo1Package(pkg)).toBe(false);
  });

  it("rejects a package with no XML parts at all", () => {
    expect(isOoo1Package({ parts: {} })).toBe(false);
    expect(
      isOoo1Package({
        parts: { "Pictures/a.png": { kind: "binary", base64: "" } },
      }),
    ).toBe(false);
  });
});
