import type { XmlElement } from "ooxml.js";
import {
  attr,
  childrenWithTag,
  decodePackage,
  encodePackage,
  resolveRelationships,
  rootElement,
} from "ooxml.js";
import { describe, expect, it } from "vitest";
import { createEmptyPptxPackage, ensureNotesMaster } from "./scaffold";
function elementChild(node: XmlElement | undefined, tag: string): XmlElement {
  const found = node === undefined ? undefined : childrenWithTag(node, tag)[0];
  if (found === undefined) {
    throw new Error(`expected a <${tag}> child`);
  }
  return found;
}

// A part root's attributes as one map, failing the test when the root itself is absent for the same reason.
function attributeMap(node: XmlElement | undefined): Record<string, string> {
  if (node === undefined) {
    throw new Error("expected an element");
  }
  return Object.fromEntries(
    node.attributes.map((a) => [a.name, a.value] as const),
  );
}

describe("createEmptyPptxPackage", () => {
  it("has every part a minimal, real-world-openable pptx needs, with no slides yet", () => {
    const pkg = createEmptyPptxPackage();
    expect(Object.keys(pkg.parts).sort()).toEqual(
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "ppt/presentation.xml",
        "ppt/_rels/presentation.xml.rels",
        "ppt/slideMasters/slideMaster1.xml",
        "ppt/slideMasters/_rels/slideMaster1.xml.rels",
        "ppt/slideLayouts/slideLayout1.xml",
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
        "ppt/theme/theme1.xml",
      ].sort(),
    );
  });

  it("round-trips through encodePackage/decodePackage unchanged", () => {
    const pkg = createEmptyPptxPackage();
    expect(decodePackage(encodePackage(pkg))).toEqual(pkg);
  });

  it("declares the default 16:9 widescreen slide size", () => {
    const pkg = createEmptyPptxPackage();
    const root = rootElement(pkg.parts["ppt/presentation.xml"]);
    const sldSz = root?.children.find(
      (c) => c.type === "element" && c.tag === "p:sldSz",
    );
    expect(
      sldSz?.type === "element" ? sldSz.attributes : undefined,
    ).toContainEqual({ name: "cx", value: "12192000" });
  });

  // Every one of these was a real defect, each confirmed only by opening the generated file in actual Keynote (not this package's own reader, which never required any of them): the slide/master/layout root elements need every namespace prefix they use declared on themselves, since each OOXML part is an independent XML document; a schema-validating reader rejects a p:spTree missing its mandatory p:nvGrpSpPr/p:grpSpPr pair; and a presentation with no slideMaster/slideLayout/theme chain, or a slide with no relationship to a layout, is rejected outright even though this package's own reader tolerates all three.

  it("declares xmlns:p, xmlns:a, and xmlns:r on the presentation, slideMaster, and slideLayout root elements", () => {
    const pkg = createEmptyPptxPackage();
    for (const partPath of [
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideLayouts/slideLayout1.xml",
    ]) {
      const root = rootElement(pkg.parts[partPath]);
      expect(root, partPath).toBeDefined();
      const names = root?.attributes.map((a) => a.name) ?? [];
      expect(names, partPath).toEqual(
        expect.arrayContaining(["xmlns:p", "xmlns:a", "xmlns:r"]),
      );
    }
  });

  it("p:presentation declares p:sldMasterIdLst before p:sldIdLst, per CT_Presentation element order", () => {
    const pkg = createEmptyPptxPackage();
    const root = rootElement(pkg.parts["ppt/presentation.xml"]);
    const tags = root?.children
      .filter((c) => c.type === "element")
      .map((c) => c.tag);
    const masterIndex = tags?.indexOf("p:sldMasterIdLst") ?? -1;
    const slideIndex = tags?.indexOf("p:sldIdLst") ?? -1;
    expect(masterIndex).toBeGreaterThanOrEqual(0);
    expect(slideIndex).toBeGreaterThan(masterIndex);
  });

  it("the slide master has an explicit white p:bg before p:spTree, so a real viewer never falls back to its own default background", () => {
    const pkg = createEmptyPptxPackage();
    const master = rootElement(pkg.parts["ppt/slideMasters/slideMaster1.xml"]);
    const cSld =
      master === undefined ? undefined : childrenWithTag(master, "p:cSld")[0];
    expect(cSld).toBeDefined();
    const childTags = cSld?.children
      .filter((c) => c.type === "element")
      .map((c) => c.tag);
    expect(childTags?.indexOf("p:bg")).toBe(0);
    expect(childTags?.indexOf("p:spTree")).toBe(1);
    const srgbClr =
      cSld === undefined ? undefined : childrenWithTag(cSld, "p:bg")[0];
    const fill =
      srgbClr === undefined
        ? undefined
        : childrenWithTag(
            childrenWithTag(
              childrenWithTag(srgbClr, "p:bgPr")[0]!,
              "a:solidFill",
            )[0]!,
            "a:srgbClr",
          )[0];
    expect(fill === undefined ? undefined : attr(fill, "val")).toBe("FFFFFF");
  });

  it("every p:spTree (slide master and slide layout) starts with p:nvGrpSpPr then p:grpSpPr", () => {
    const pkg = createEmptyPptxPackage();
    for (const partPath of [
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideLayouts/slideLayout1.xml",
    ]) {
      const root = rootElement(pkg.parts[partPath]);
      const cSld =
        root === undefined ? undefined : childrenWithTag(root, "p:cSld")[0];
      const spTree =
        cSld === undefined ? undefined : childrenWithTag(cSld, "p:spTree")[0];
      const childTags = spTree?.children
        .filter((c) => c.type === "element")
        .map((c) => c.tag);
      expect(childTags, partPath).toEqual(["p:nvGrpSpPr", "p:grpSpPr"]);
    }
  });

  it("the slide master relates to the slide layout and the theme; the slide layout relates back to the slide master", () => {
    const pkg = createEmptyPptxPackage();
    const masterRels = [
      ...resolveRelationships(
        pkg,
        "ppt/slideMasters/slideMaster1.xml",
      ).values(),
    ];
    expect(
      masterRels.some((r) => r.target === "ppt/slideLayouts/slideLayout1.xml"),
    ).toBe(true);
    expect(masterRels.some((r) => r.target === "ppt/theme/theme1.xml")).toBe(
      true,
    );
    const layoutRels = [
      ...resolveRelationships(
        pkg,
        "ppt/slideLayouts/slideLayout1.xml",
      ).values(),
    ];
    expect(
      layoutRels.some((r) => r.target === "ppt/slideMasters/slideMaster1.xml"),
    ).toBe(true);
  });

  it("p:presentation relates to the slide master via p:sldMasterIdLst/@r:id", () => {
    const pkg = createEmptyPptxPackage();
    const root = rootElement(pkg.parts["ppt/presentation.xml"]);
    const sldMasterIdLst =
      root === undefined
        ? undefined
        : childrenWithTag(root, "p:sldMasterIdLst")[0];
    const sldMasterId =
      sldMasterIdLst === undefined
        ? undefined
        : childrenWithTag(sldMasterIdLst, "p:sldMasterId")[0];
    const rId =
      sldMasterId === undefined ? undefined : attr(sldMasterId, "r:id");
    expect(rId).toBeDefined();
    const presentationRels = resolveRelationships(pkg, "ppt/presentation.xml");
    expect(
      rId === undefined ? undefined : presentationRels.get(rId)?.target,
    ).toBe("ppt/slideMasters/slideMaster1.xml");
  });

  // p:notesSz is required alongside p:sldSz per CT_Presentation, even before any slide ever uses speaker notes — confirmed present in every real PowerPoint/Keynote-authored presentation.xml.
  it("declares a US-Letter-portrait p:notesSz", () => {
    const pkg = createEmptyPptxPackage();
    const root = rootElement(pkg.parts["ppt/presentation.xml"]);
    const notesSz =
      root === undefined ? undefined : childrenWithTag(root, "p:notesSz")[0];
    expect(notesSz === undefined ? undefined : attr(notesSz, "cx")).toBe(
      "6858000",
    );
    expect(notesSz === undefined ? undefined : attr(notesSz, "cy")).toBe(
      "9144000",
    );
  });
});

describe("ensureNotesMaster", () => {
  it("creates ppt/notesMasters/notesMaster1.xml, wires it into p:notesMasterIdLst (right after p:sldMasterIdLst), and is idempotent", () => {
    const pkg = createEmptyPptxPackage();
    const firstCallPath = ensureNotesMaster(pkg);
    expect(firstCallPath).toBe("ppt/notesMasters/notesMaster1.xml");
    expect(pkg.parts["ppt/notesMasters/notesMaster1.xml"]).toBeDefined();

    const root = rootElement(pkg.parts["ppt/presentation.xml"]);
    const tags = root?.children
      .filter((c) => c.type === "element")
      .map((c) => c.tag);
    expect(tags?.indexOf("p:sldMasterIdLst")).toBe(0);
    expect(tags?.indexOf("p:notesMasterIdLst")).toBe(1);

    const partCountAfterFirstCall = Object.keys(pkg.parts).length;
    const secondCallPath = ensureNotesMaster(pkg);
    expect(secondCallPath).toBe(firstCallPath);
    expect(Object.keys(pkg.parts)).toHaveLength(partCountAfterFirstCall);
  });

  // Confirmed by diffing against a real Keynote-exported reference pptx with speaker notes: this element is required by CT_NotesMaster (a real reader rejects a notesSlide relating to a notesMaster that has no p:clrMap), mirroring the identity map already used on the slide master.
  it("the notes master has an identity p:clrMap", () => {
    const pkg = createEmptyPptxPackage();
    ensureNotesMaster(pkg);
    const master = rootElement(pkg.parts["ppt/notesMasters/notesMaster1.xml"]);
    const clrMap =
      master === undefined ? undefined : childrenWithTag(master, "p:clrMap")[0];
    expect(clrMap === undefined ? undefined : attr(clrMap, "bg1")).toBe("lt1");
  });

  it("the notes master relates to the theme", () => {
    const pkg = createEmptyPptxPackage();
    ensureNotesMaster(pkg);
    const masterRels = [
      ...resolveRelationships(
        pkg,
        "ppt/notesMasters/notesMaster1.xml",
      ).values(),
    ];
    expect(masterRels.some((r) => r.target === "ppt/theme/theme1.xml")).toBe(
      true,
    );
  });
});

// Every part this scaffold writes with an explicit XML declaration (the .rels parts addRelationship creates carry none, by that helper's own design, so the declaration test below names the scaffold-built parts rather than iterating pkg.parts).
const SCAFFOLD_XML_PART_PATHS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "ppt/presentation.xml",
  "ppt/slideMasters/slideMaster1.xml",
  "ppt/slideLayouts/slideLayout1.xml",
  "ppt/theme/theme1.xml",
] as const;

describe("createEmptyPptxPackage: package-level parts", () => {
  it("every scaffold-built XML part starts with the standard version/encoding/standalone declaration", () => {
    const pkg = createEmptyPptxPackage();
    for (const partPath of SCAFFOLD_XML_PART_PATHS) {
      const part = pkg.parts[partPath];
      expect(part?.kind, partPath).toBe("xml");
      if (part?.kind !== "xml") {
        continue;
      }
      expect(part.nodes[0], partPath).toEqual({
        type: "declaration",
        attributes: [
          { name: "version", value: "1.0" },
          { name: "encoding", value: "UTF-8" },
          { name: "standalone", value: "yes" },
        ],
      });
    }
  });

  it("the notes master part carries the same declaration, created lazily", () => {
    const pkg = createEmptyPptxPackage();
    ensureNotesMaster(pkg);
    const part = pkg.parts["ppt/notesMasters/notesMaster1.xml"];
    expect(part?.kind).toBe("xml");
    if (part?.kind === "xml") {
      expect(part.nodes[0]).toEqual({
        type: "declaration",
        attributes: [
          { name: "version", value: "1.0" },
          { name: "encoding", value: "UTF-8" },
          { name: "standalone", value: "yes" },
        ],
      });
    }
  });

  it("[Content_Types].xml declares exactly the two Defaults and every Override, in write order", () => {
    const pkg = createEmptyPptxPackage();
    ensureNotesMaster(pkg);
    const types = rootElement(pkg.parts["[Content_Types].xml"]);
    expect(types?.tag).toBe("Types");
    expect(types?.attributes).toEqual([
      {
        name: "xmlns",
        value: "http://schemas.openxmlformats.org/package/2006/content-types",
      },
    ]);
    const entries =
      types === undefined
        ? []
        : types.children.filter((c): c is XmlElement => c.type === "element");
    expect(entries.map((e) => [e.tag, attributeMap(e)])).toEqual([
      [
        "Default",
        {
          Extension: "rels",
          ContentType:
            "application/vnd.openxmlformats-package.relationships+xml",
        },
      ],
      ["Default", { Extension: "xml", ContentType: "application/xml" }],
      [
        "Override",
        {
          PartName: "/ppt/presentation.xml",
          ContentType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
        },
      ],
      [
        "Override",
        {
          PartName: "/ppt/slideLayouts/slideLayout1.xml",
          ContentType:
            "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml",
        },
      ],
      [
        "Override",
        {
          PartName: "/ppt/slideMasters/slideMaster1.xml",
          ContentType:
            "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml",
        },
      ],
      [
        "Override",
        {
          PartName: "/ppt/theme/theme1.xml",
          ContentType:
            "application/vnd.openxmlformats-officedocument.theme+xml",
        },
      ],
      [
        "Override",
        {
          PartName: "/ppt/notesMasters/notesMaster1.xml",
          ContentType:
            "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml",
        },
      ],
    ]);
  });

  it("the package-root relationship is exactly rId1, officeDocument, targeting ppt/presentation.xml", () => {
    const pkg = createEmptyPptxPackage();
    const rels = rootElement(pkg.parts["_rels/.rels"]);
    expect(rels?.tag).toBe("Relationships");
    expect(rels?.attributes).toEqual([
      {
        name: "xmlns",
        value: "http://schemas.openxmlformats.org/package/2006/relationships",
      },
    ]);
    const relationships =
      rels === undefined
        ? []
        : rels.children.filter((c): c is XmlElement => c.type === "element");
    expect(relationships.map(attributeMap)).toEqual([
      {
        Id: "rId1",
        Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
        Target: "ppt/presentation.xml",
      },
    ]);
  });

  it("options.metadata adds a docProps/core.xml part, and no options adds none", () => {
    expect(createEmptyPptxPackage().parts["docProps/core.xml"]).toBeUndefined();
    const withTitle = createEmptyPptxPackage({
      metadata: { title: "Quarterly review" },
    });
    const core = rootElement(withTitle.parts["docProps/core.xml"]);
    expect(core?.tag).toBe("cp:coreProperties");
    expect(elementChild(core, "dc:title").children).toEqual([
      { type: "text", value: "Quarterly review" },
    ]);
  });
});

describe("createEmptyPptxPackage: ppt/presentation.xml", () => {
  it("carries sldMasterIdLst through notesSz in CT_Presentation's own order, with the spec-minimum master id and both sldSz dimensions", () => {
    const pkg = createEmptyPptxPackage();
    const presentation = rootElement(pkg.parts["ppt/presentation.xml"]);
    expect(presentation?.tag).toBe("p:presentation");
    expect(presentation?.attributes).toEqual([
      {
        name: "xmlns:p",
        value: "http://schemas.openxmlformats.org/presentationml/2006/main",
      },
      {
        name: "xmlns:r",
        value:
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      },
    ]);
    const childTags =
      presentation === undefined
        ? []
        : presentation.children
            .filter((c): c is XmlElement => c.type === "element")
            .map((c) => c.tag);
    expect(childTags).toEqual([
      "p:sldMasterIdLst",
      "p:sldIdLst",
      "p:sldSz",
      "p:notesSz",
    ]);
    // ECMA-376 Part 1, 13.3.9: master and layout ids draw from the reserved range starting at 2147483648, distinct from ordinary slide ids.
    const sldMasterId = elementChild(
      elementChild(presentation, "p:sldMasterIdLst"),
      "p:sldMasterId",
    );
    expect(attr(sldMasterId, "id")).toBe("2147483648");
    expect(elementChild(presentation, "p:sldIdLst").children).toEqual([]);
    const sldSz = elementChild(presentation, "p:sldSz");
    expect(attr(sldSz, "cx")).toBe("12192000");
    expect(attr(sldSz, "cy")).toBe("6858000");
  });
});

describe("createEmptyPptxPackage: slide master part", () => {
  const MASTER_PATH = "ppt/slideMasters/slideMaster1.xml";

  it("declares all three namespace prefixes with their full URIs, and nothing else, on the root", () => {
    const pkg = createEmptyPptxPackage();
    const master = rootElement(pkg.parts[MASTER_PATH]);
    expect(master?.tag).toBe("p:sldMaster");
    expect(master?.attributes).toEqual([
      {
        name: "xmlns:p",
        value: "http://schemas.openxmlformats.org/presentationml/2006/main",
      },
      {
        name: "xmlns:a",
        value: "http://schemas.openxmlformats.org/drawingml/2006/main",
      },
      {
        name: "xmlns:r",
        value:
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      },
    ]);
  });

  it("carries cSld, clrMap, sldLayoutIdLst in CT_SlideMaster's own order", () => {
    const pkg = createEmptyPptxPackage();
    const master = rootElement(pkg.parts[MASTER_PATH]);
    const childTags =
      master === undefined
        ? []
        : master.children
            .filter((c): c is XmlElement => c.type === "element")
            .map((c) => c.tag);
    expect(childTags).toEqual(["p:cSld", "p:clrMap", "p:sldLayoutIdLst"]);
  });

  it("the white background is a solidFill of FFFFFF followed by an empty effectLst, per CT_BackgroundProperties order", () => {
    const pkg = createEmptyPptxPackage();
    const master = rootElement(pkg.parts[MASTER_PATH]);
    const bgPr = elementChild(
      elementChild(elementChild(master, "p:cSld"), "p:bg"),
      "p:bgPr",
    );
    const fillTags = bgPr.children
      .filter((c): c is XmlElement => c.type === "element")
      .map((c) => c.tag);
    expect(fillTags).toEqual(["a:solidFill", "a:effectLst"]);
    expect(
      attr(elementChild(elementChild(bgPr, "a:solidFill"), "a:srgbClr"), "val"),
    ).toBe("FFFFFF");
  });

  it("the empty group shape tree identifies itself as shape id 1 with an empty name", () => {
    const pkg = createEmptyPptxPackage();
    const master = rootElement(pkg.parts[MASTER_PATH]);
    const spTree = elementChild(elementChild(master, "p:cSld"), "p:spTree");
    expect(spTree.tag).toBe("p:spTree");
    const nvGrpSpPr = elementChild(spTree, "p:nvGrpSpPr");
    expect(
      nvGrpSpPr.children
        .filter((c): c is XmlElement => c.type === "element")
        .map((c) => c.tag),
    ).toEqual(["p:cNvPr", "p:cNvGrpSpPr", "p:nvPr"]);
    const cNvPr = elementChild(nvGrpSpPr, "p:cNvPr");
    expect(attr(cNvPr, "id")).toBe("1");
    expect(attr(cNvPr, "name")).toBe("");
  });

  it("the colour map is exactly the identity mapping onto the theme's own twelve slots", () => {
    const pkg = createEmptyPptxPackage();
    const master = rootElement(pkg.parts[MASTER_PATH]);
    expect(attributeMap(elementChild(master, "p:clrMap"))).toEqual({
      bg1: "lt1",
      tx1: "dk1",
      bg2: "lt2",
      tx2: "dk2",
      accent1: "accent1",
      accent2: "accent2",
      accent3: "accent3",
      accent4: "accent4",
      accent5: "accent5",
      accent6: "accent6",
      hlink: "hlink",
      folHlink: "folHlink",
    });
  });

  it("sldLayoutIdLst points at the one blank layout with a spec-minimum id and a live relationship", () => {
    const pkg = createEmptyPptxPackage();
    const master = rootElement(pkg.parts[MASTER_PATH]);
    const sldLayoutId = elementChild(
      elementChild(master, "p:sldLayoutIdLst"),
      "p:sldLayoutId",
    );
    expect(attr(sldLayoutId, "id")).toBe("2147483648");
    const rId = attr(sldLayoutId, "r:id");
    expect(rId).toBeDefined();
    if (rId !== undefined) {
      expect(resolveRelationships(pkg, MASTER_PATH).get(rId)?.target).toBe(
        "ppt/slideLayouts/slideLayout1.xml",
      );
    }
  });

  it("the master's own relationships are exactly the layout and the theme, with their full type URIs and relative targets", () => {
    const pkg = createEmptyPptxPackage();
    const rels = rootElement(
      pkg.parts["ppt/slideMasters/_rels/slideMaster1.xml.rels"],
    );
    const relationships =
      rels === undefined
        ? []
        : rels.children.filter((c): c is XmlElement => c.type === "element");
    expect(relationships.map(attributeMap)).toEqual([
      {
        Id: "rId1",
        Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
        Target: "../slideLayouts/slideLayout1.xml",
      },
      {
        Id: "rId2",
        Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
        Target: "../theme/theme1.xml",
      },
    ]);
  });
});
