import type { Package as OdfPackage } from "odf.js";
import { describe, expect, it } from "vitest";
import { buildDocxPackage } from "../edit/docx/content";
import { createDocx } from "../edit/docx/editor";
import { createEmptyDocxPackage } from "../edit/docx/scaffold";
import { buildOdtPackage } from "../edit/odt/content";
import { createOdg } from "../edit/odg/editor";
import { createOdp } from "../edit/odp/editor";
import { createOds } from "../edit/ods/editor";
import { createOdt } from "../edit/odt/editor";
import { createPptx } from "../edit/pptx/editor";
import { readDocxContent } from "../ooxml/docx/read";
import { readPptxContent } from "../ooxml/pptx/read";
import { readOdgContent } from "../odf/odg/read";
import { readOdpContent } from "../odf/odp/read";
import { readOdsContent } from "../odf/ods/read";
import { readOdtContent } from "../odf/odt/read";
import { fixedClock } from "../ports/clock";
import { el, txt } from "../xml/fragment";

// End-to-end proof that createDocx/createPptx/createOdt/createOdp/createOds/createOdg (the "make a document from nothing" entry points across both the OOXML and ODF ecosystems) each stamp real, deterministic creation/modification timestamps through an injected ClockPort, and that a real, pre-existing document's own timestamp is never clobbered by rebuilding it. src/model/metadata.test.ts already covers resolveMetadataTimestamps' own precedence rule in isolation; this file proves that rule is actually wired into every real entry point named in the README's Fonts-adjacent "documents.js" feature set, not merely implemented and left unreferenced (documents.js's own ClockPort existed with zero live call sites before this task).

const FIXED_NOW = new Date("2026-03-10T09:30:00.000Z");
const FIXED_NOW_ISO = FIXED_NOW.toISOString();

describe("create*() stamps real, deterministic timestamps via an injected clock (OOXML ecosystem)", () => {
  it("createDocx({ clock }) writes the fixed instant to both createdIso and modifiedIso", () => {
    const editor = createDocx({ clock: fixedClock(FIXED_NOW) });
    const doc = readDocxContent(editor.toPackage());
    expect(doc.metadata.createdIso).toBe(FIXED_NOW_ISO);
    expect(doc.metadata.modifiedIso).toBe(FIXED_NOW_ISO);
  });

  it("createPptx({ clock }) writes the fixed instant to both createdIso and modifiedIso", () => {
    const editor = createPptx({ clock: fixedClock(FIXED_NOW) });
    const doc = readPptxContent(editor.toPackage());
    expect(doc.metadata.createdIso).toBe(FIXED_NOW_ISO);
    expect(doc.metadata.modifiedIso).toBe(FIXED_NOW_ISO);
  });
});

describe("create*() stamps real, deterministic timestamps via an injected clock (ODF ecosystem)", () => {
  it("createOdt({ clock }) writes the fixed instant to both createdIso and modifiedIso", () => {
    const editor = createOdt({ clock: fixedClock(FIXED_NOW) });
    const doc = readOdtContent(editor.toPackage());
    expect(doc.metadata.createdIso).toBe(FIXED_NOW_ISO);
    expect(doc.metadata.modifiedIso).toBe(FIXED_NOW_ISO);
  });

  it("createOdp({ clock }) writes the fixed instant to both createdIso and modifiedIso", () => {
    const editor = createOdp({ clock: fixedClock(FIXED_NOW) });
    const doc = readOdpContent(editor.toPackage());
    expect(doc.metadata.createdIso).toBe(FIXED_NOW_ISO);
    expect(doc.metadata.modifiedIso).toBe(FIXED_NOW_ISO);
  });

  it("createOds({ clock }) writes the fixed instant to both createdIso and modifiedIso", () => {
    const editor = createOds({ clock: fixedClock(FIXED_NOW) });
    const doc = readOdsContent(editor.toPackage());
    expect(doc.metadata.createdIso).toBe(FIXED_NOW_ISO);
    expect(doc.metadata.modifiedIso).toBe(FIXED_NOW_ISO);
  });

  it("createOdg({ clock }) writes the fixed instant to both createdIso and modifiedIso", () => {
    const editor = createOdg({ clock: fixedClock(FIXED_NOW) });
    const doc = readOdgContent(editor.toPackage());
    expect(doc.metadata.createdIso).toBe(FIXED_NOW_ISO);
    expect(doc.metadata.modifiedIso).toBe(FIXED_NOW_ISO);
  });
});

describe("buildDocxPackage precedence: an already-timestamped ContentDocument is never touched by the clock", () => {
  it("never consults the supplied clock when content.metadata already carries both createdIso and modifiedIso", () => {
    const original = readDocxContent(createEmptyDocxPackage());
    if (original.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const withMetadata = {
      ...original,
      metadata: {
        createdIso: "2020-05-01T00:00:00.000Z",
        modifiedIso: "2021-05-01T00:00:00.000Z",
      },
    };

    const throwingClock = {
      now: (): Date => {
        throw new Error(
          "clock should not be consulted when both timestamps are already present",
        );
      },
    };

    const rebuiltPackage = buildDocxPackage(withMetadata, {
      clock: throwingClock,
    });
    const rebuilt = readDocxContent(rebuiltPackage);
    expect(rebuilt.metadata.createdIso).toBe("2020-05-01T00:00:00.000Z");
    expect(rebuilt.metadata.modifiedIso).toBe("2021-05-01T00:00:00.000Z");
  });
});

// A real docProps/core.xml part, hand-built directly from XmlElement/XmlNode literals -- not via addCoreProperties or createDocx -- so this fixture simulates a genuinely pre-existing document authored by something other than this package, carrying an old, known createdIso this package never wrote.
function docxPackageWithHandBuiltCoreProperties(
  createdIso: string,
  modifiedIso: string,
): ReturnType<typeof createEmptyDocxPackage> {
  const pkg = createEmptyDocxPackage();
  const root = el(
    "cp:coreProperties",
    {
      "xmlns:cp":
        "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
      "xmlns:dc": "http://purl.org/dc/elements/1.1/",
      "xmlns:dcterms": "http://purl.org/dc/terms/",
      "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    },
    [
      el("dc:title", {}, [txt("An old document")]),
      el("dcterms:created", { "xsi:type": "dcterms:W3CDTF" }, [
        txt(createdIso),
      ]),
      el("dcterms:modified", { "xsi:type": "dcterms:W3CDTF" }, [
        txt(modifiedIso),
      ]),
    ],
  );
  pkg.parts["docProps/core.xml"] = {
    kind: "xml",
    nodes: [
      {
        type: "declaration",
        attributes: [
          { name: "version", value: "1.0" },
          { name: "encoding", value: "UTF-8" },
          { name: "standalone", value: "yes" },
        ],
      },
      root,
    ],
  };
  return pkg;
}

describe("buildDocxPackage never clobbers a real pre-existing document's own creation date", () => {
  it("preserves a hand-authored old createdIso/modifiedIso even when rebuilt with a later fixedClock", () => {
    const OLD_CREATED_ISO = "2015-06-01T08:00:00.000Z";
    const OLD_MODIFIED_ISO = "2016-07-02T10:00:00.000Z";
    const handBuiltPkg = docxPackageWithHandBuiltCoreProperties(
      OLD_CREATED_ISO,
      OLD_MODIFIED_ISO,
    );

    const original = readDocxContent(handBuiltPkg);
    if (original.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    expect(original.metadata.createdIso).toBe(OLD_CREATED_ISO);
    expect(original.metadata.modifiedIso).toBe(OLD_MODIFIED_ISO);

    // A much later clock -- if resolveMetadataTimestamps' precedence were wired in wrong, this would stamp "now" over the real, old creation date.
    const laterClock = fixedClock(new Date("2026-12-25T00:00:00.000Z"));
    const rebuiltPackage = buildDocxPackage(original, { clock: laterClock });
    const rebuilt = readDocxContent(rebuiltPackage);

    expect(rebuilt.metadata.createdIso).toBe(OLD_CREATED_ISO);
    expect(rebuilt.metadata.modifiedIso).toBe(OLD_MODIFIED_ISO);
  });
});

// The ODF-side counterpart to the docx test above -- a hand-built odt Package (content.xml + a hand-authored meta.xml, neither written by this package's own writer) carrying a known old meta:creation-date/dc:date, proving buildOdtPackage's identical precedence wiring on the ODF ecosystem too. readFirstMasterPageGeometry (odf.js) tolerates a missing styles.xml by falling back to A4 defaults, so this fixture omits it entirely -- content.xml and meta.xml are all readOdtContent needs.
function odtPackageWithHandBuiltMeta(
  createdIso: string,
  modifiedIso: string,
): OdfPackage {
  const contentRoot = el(
    "office:document-content",
    {
      "xmlns:office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
      "xmlns:text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
      "office:version": "1.3",
    },
    [el("office:automatic-styles"), el("office:body", {}, [el("office:text")])],
  );
  const metaRoot = el(
    "office:document-meta",
    {
      "xmlns:office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
      "xmlns:meta": "urn:oasis:names:tc:opendocument:xmlns:meta:1.0",
      "xmlns:dc": "http://purl.org/dc/elements/1.1/",
      "office:version": "1.3",
    },
    [
      el("office:meta", {}, [
        el("dc:title", {}, [txt("An old document")]),
        el("meta:creation-date", {}, [txt(createdIso)]),
        el("dc:date", {}, [txt(modifiedIso)]),
      ]),
    ],
  );
  const declaration = {
    type: "declaration" as const,
    attributes: [
      { name: "version", value: "1.0" },
      { name: "encoding", value: "UTF-8" },
      { name: "standalone", value: "yes" },
    ],
  };
  return {
    parts: {
      "content.xml": { kind: "xml", nodes: [declaration, contentRoot] },
      "meta.xml": { kind: "xml", nodes: [declaration, metaRoot] },
    },
  };
}

describe("buildOdtPackage never clobbers a real pre-existing document's own creation date", () => {
  it("preserves a hand-authored old createdIso/modifiedIso even when rebuilt with a later fixedClock", () => {
    const OLD_CREATED_ISO = "2012-03-04T05:06:00.000Z";
    const OLD_MODIFIED_ISO = "2013-04-05T06:07:00.000Z";
    const handBuiltPkg = odtPackageWithHandBuiltMeta(
      OLD_CREATED_ISO,
      OLD_MODIFIED_ISO,
    );

    const original = readOdtContent(handBuiltPkg);
    if (original.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    expect(original.metadata.createdIso).toBe(OLD_CREATED_ISO);
    expect(original.metadata.modifiedIso).toBe(OLD_MODIFIED_ISO);

    const laterClock = fixedClock(new Date("2026-12-25T00:00:00.000Z"));
    const rebuiltPackage = buildOdtPackage(original, { clock: laterClock });
    const rebuilt = readOdtContent(rebuiltPackage);

    expect(rebuilt.metadata.createdIso).toBe(OLD_CREATED_ISO);
    expect(rebuilt.metadata.modifiedIso).toBe(OLD_MODIFIED_ISO);
  });
});
