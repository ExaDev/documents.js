import { describe, expect, it } from "vitest";
import type { SourceResidue } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { el } from "../../xml/fragment";
import {
  addOdfPackageResidue,
  collectOdfNonContentPartResidue,
  isEmbeddedObjectPart,
  odfDivisionDescriptor,
  odfIndexControlDescriptor,
  writeOdfPackageResidue,
} from "./constructs";
import {} from "./constructs-markers";
import {} from "./constructs-definitions";

// Every fixture here is a programmatic package/element built with el/txt, matching the sibling odt/constructs.test.ts's own fixture-gate convention.

function part(nodes: readonly XmlNode[]): Package {
  return { parts: { "settings.xml": { kind: "xml", nodes: [...nodes] } } };
}

describe("isEmbeddedObjectPart", () => {
  it("quarantines an Object-N directory's own part path", () => {
    expect(isEmbeddedObjectPart("Object 1/content.xml")).toBe(true);
    expect(isEmbeddedObjectPart("Object 12/content.xml")).toBe(true);
  });
  it("does not match a path whose first segment merely ends with the Object-N shape", () => {
    expect(isEmbeddedObjectPart("XObject 1/content.xml")).toBe(false);
  });
  it("does not match a path whose first segment has trailing content after the digits", () => {
    expect(isEmbeddedObjectPart("Object 1x/content.xml")).toBe(false);
  });
  it("does not match a path with no digits at all", () => {
    expect(isEmbeddedObjectPart("Object/content.xml")).toBe(false);
  });
});

describe("addOdfPackageResidue", () => {
  it("concatenates onto an already-existing key rather than overwriting it", () => {
    const out: Record<string, SourceResidue> = {
      k: { format: "odt", xml: "<a></a>" },
    };
    addOdfPackageResidue(out, "k", "odt", el("b", {}));
    expect(out.k?.xml).toBe("<a></a><b></b>");
  });
});

describe("collectOdfNonContentPartResidue", () => {
  it("quarantines nothing for a non-content part whose nodes carry no element at all", () => {
    const pkg = part([{ type: "declaration", attributes: [] }]);
    const out: Record<string, SourceResidue> = {};
    collectOdfNonContentPartResidue(pkg, "odt", out);
    expect(out).toEqual({});
  });
  it("quarantines a non-content part carrying a real element", () => {
    const pkg = part([el("config:config-item-set", {}, [])]);
    const out: Record<string, SourceResidue> = {};
    collectOdfNonContentPartResidue(pkg, "odt", out);
    expect(out["settings.xml"]?.xml).toContain("config:config-item-set");
  });
});

describe("writeOdfPackageResidue", () => {
  const baseline: SourceResidue = { format: "odt", xml: "<foo/>" };

  it("does nothing when source is undefined", () => {
    const pkg: Package = { parts: {} };
    writeOdfPackageResidue(pkg, "odt", undefined);
    expect(pkg.parts).toEqual({});
  });

  it("skips an entry whose residue format does not match the writer's own format", () => {
    const pkg: Package = { parts: {} };
    writeOdfPackageResidue(pkg, "odt", {
      "settings.xml": { format: "ods", xml: "<foo/>" },
    });
    expect(pkg.parts).toEqual({});
  });

  it("skips an entry whose key does not end .xml", () => {
    const pkg: Package = { parts: {} };
    writeOdfPackageResidue(pkg, "odt", { "settings.bin": baseline });
    expect(pkg.parts).toEqual({});
  });

  it("skips an entry keyed at one of this writer's own consumed part paths", () => {
    const pkg: Package = { parts: {} };
    writeOdfPackageResidue(pkg, "odt", { "content.xml": baseline });
    expect(pkg.parts).toEqual({});
  });

  it("skips an entry keyed inside an embedded object's own Object-N directory", () => {
    const pkg: Package = { parts: {} };
    writeOdfPackageResidue(pkg, "odt", { "Object 1/content.xml": baseline });
    expect(pkg.parts).toEqual({});
  });

  it("restores an eligible entry as a real xml part with the exact declaration attributes", () => {
    const pkg: Package = { parts: {} };
    writeOdfPackageResidue(pkg, "odt", { "settings.xml": baseline });
    const restored = pkg.parts["settings.xml"];
    if (restored?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    const [declaration] = restored.nodes;
    if (declaration?.type !== "declaration") {
      throw new Error("expected a leading declaration node");
    }
    expect(declaration.attributes).toEqual([
      { name: "version", value: "1.0" },
      { name: "encoding", value: "UTF-8" },
    ]);
  });

  it("filters non-element nodes out of the parsed residue body, keeping only the real element", () => {
    const pkg: Package = { parts: {} };
    writeOdfPackageResidue(pkg, "odt", {
      "settings.xml": { format: "odt", xml: "<!--c--><foo/>" },
    });
    const restored = pkg.parts["settings.xml"];
    if (restored?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    const [, body] = restored.nodes;
    expect(body).toEqual({
      type: "element",
      tag: "foo",
      attributes: [],
      children: [],
    });
  });
});

function sectionPackage(styles: readonly XmlElement[]): Package {
  return {
    parts: {
      "content.xml": {
        kind: "xml",
        nodes: [
          el("office:document-content", {}, [
            el("office:automatic-styles", {}, styles),
          ]),
        ],
      },
    },
  };
}

describe("odfDivisionDescriptor", () => {
  it("carries no name property when text:name is absent", () => {
    const descriptor = odfDivisionDescriptor(
      el("text:section", {}),
      sectionPackage([]),
    );
    expect(descriptor).not.toHaveProperty("name");
  });

  it('reads text:protected="false" as an explicit false, not an absent flag', () => {
    const descriptor = odfDivisionDescriptor(
      el("text:section", { "text:protected": "false" }),
      sectionPackage([]),
    );
    expect(descriptor.protected).toBe(false);
  });

  it("carries no protected property when text:protected is absent", () => {
    const descriptor = odfDivisionDescriptor(
      el("text:section", {}),
      sectionPackage([]),
    );
    expect(descriptor).not.toHaveProperty("protected");
  });

  it("carries no columnCount property when the section carries no resolvable column count", () => {
    const descriptor = odfDivisionDescriptor(
      el("text:section", {}),
      sectionPackage([]),
    );
    expect(descriptor).not.toHaveProperty("columnCount");
  });

  it("resolves a section's own column count only from the exact style matching both family and name", () => {
    const expectedColumnCount = 3;
    const styles = [
      // right name, wrong family — must not match
      el(
        "style:style",
        { "style:family": "paragraph", "style:name": "Sect1" },
        [
          el("style:section-properties", {}, [
            el("style:columns", { "fo:column-count": "9" }),
          ]),
        ],
      ),
      // right family, wrong name — must not match
      el("style:style", { "style:family": "section", "style:name": "Other" }, [
        el("style:section-properties", {}, [
          el("style:columns", { "fo:column-count": "9" }),
        ]),
      ]),
      // right family and name — the real match
      el("style:style", { "style:family": "section", "style:name": "Sect1" }, [
        el("style:section-properties", {}, [
          el("style:columns", { "fo:column-count": `${expectedColumnCount}` }),
        ]),
      ]),
    ];
    const descriptor = odfDivisionDescriptor(
      el("text:section", { "text:style-name": "Sect1" }),
      sectionPackage(styles),
    );
    expect(descriptor.columnCount).toBe(expectedColumnCount);
  });

  it("treats a zero column count as no fact", () => {
    const styles = [
      el("style:style", { "style:family": "section", "style:name": "Sect1" }, [
        el("style:section-properties", {}, [
          el("style:columns", { "fo:column-count": "0" }),
        ]),
      ]),
    ];
    const descriptor = odfDivisionDescriptor(
      el("text:section", { "text:style-name": "Sect1" }),
      sectionPackage(styles),
    );
    expect(descriptor).not.toHaveProperty("columnCount");
  });

  it("treats a negative column count as no fact", () => {
    const styles = [
      el("style:style", { "style:family": "section", "style:name": "Sect1" }, [
        el("style:section-properties", {}, [
          el("style:columns", { "fo:column-count": "-5" }),
        ]),
      ]),
    ];
    const descriptor = odfDivisionDescriptor(
      el("text:section", { "text:style-name": "Sect1" }),
      sectionPackage(styles),
    );
    expect(descriptor).not.toHaveProperty("columnCount");
  });

  it("carries no linked.sectionName when the section-source has no text:section-name", () => {
    const descriptor = odfDivisionDescriptor(
      el("text:section", {}, [
        el("text:section-source", { "xlink:href": "chapter.odt" }),
      ]),
      sectionPackage([]),
    );
    expect(descriptor.linked).not.toHaveProperty("sectionName");
  });
});

describe("odfIndexControlDescriptor", () => {
  it("carries no tag property when the wrapper has no text:name", () => {
    const descriptor = odfIndexControlDescriptor(
      el("text:table-of-content", {}),
    );
    expect(descriptor).not.toHaveProperty("tag");
  });
});
