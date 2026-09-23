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

// The first child of a part's element with the given tag, failing the test (with the tag in the message) when absent — every assertion below walks down from a real element, so a missing rung is a scaffold defect, not an undefined-chase.
function elementChild(node: XmlElement | undefined, tag: string): XmlElement {
  const found = childrenWithTag(node, tag)[0];
  if (found === undefined) {
    throw new Error(`expected a <${tag}> child`);
  }
  return found;
}

function attributeMap(node: XmlElement): Record<string, string> {
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

describe("createEmptyPptxPackage: slide layout part", () => {
  it("is the blank layout, preserved, deferring to the master's colour map", () => {
    const pkg = createEmptyPptxPackage();
    const layout = rootElement(pkg.parts["ppt/slideLayouts/slideLayout1.xml"]);
    expect(layout?.tag).toBe("p:sldLayout");
    expect(attributeMap(layout)).toEqual({
      "xmlns:p": "http://schemas.openxmlformats.org/presentationml/2006/main",
      "xmlns:a": "http://schemas.openxmlformats.org/drawingml/2006/main",
      "xmlns:r":
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      // ECMA-376's own designation for a layout with no placeholders, kept in the part because a reader keying on layout type finds no placeholder-bearing ancestor otherwise.
      type: "blank",
      preserve: "1",
    });
    const cSld = elementChild(layout, "p:cSld");
    expect(attr(cSld, "name")).toBe("Blank");
    const clrMapOvr = elementChild(layout, "p:clrMapOvr");
    expect(
      clrMapOvr.children.filter((c): c is XmlElement => c.type === "element"),
    ).toEqual([
      {
        type: "element",
        tag: "a:masterClrMapping",
        attributes: [],
        children: [],
      },
    ]);
    // The layout's own relationship back to the master, with its full type URI and relative target.
    const rels = rootElement(
      pkg.parts["ppt/slideLayouts/_rels/slideLayout1.xml.rels"],
    );
    const relationships =
      rels === undefined
        ? []
        : rels.children.filter((c): c is XmlElement => c.type === "element");
    expect(relationships.map(attributeMap)).toEqual([
      {
        Id: "rId1",
        Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
        Target: "../slideMasters/slideMaster1.xml",
      },
    ]);
  });
});

describe("createEmptyPptxPackage: theme part", () => {
  // PowerPoint's own default "Office" theme, verbatim: these are the real values every PowerPoint-authored presentation carries, not choices of this package — a consumer keying on any of them (scheme colour names, the Calibri pair, the three-entry style lists) finds exactly what real files hold.
  it("is the Office theme: named colour scheme with the twelve standard slots, Calibri Light/Calibri font pair, and the three-entry format scheme", () => {
    const pkg = createEmptyPptxPackage();
    const theme = rootElement(pkg.parts["ppt/theme/theme1.xml"]);
    expect(theme?.tag).toBe("a:theme");
    expect(attributeMap(theme)).toEqual({
      "xmlns:a": "http://schemas.openxmlformats.org/drawingml/2006/main",
      name: "Office Theme",
    });
    const themeElements = elementChild(theme, "a:themeElements");
    expect(
      themeElements.children.filter(
        (c): c is XmlElement => c.type === "element",
      ),
    ).toHaveLength(3);

    const clrScheme = elementChild(themeElements, "a:clrScheme");
    expect(attr(clrScheme, "name")).toBe("Office");
    const expectedColours: readonly {
      readonly slot: string;
      readonly element: string;
      readonly attributes: Record<string, string>;
    }[] = [
      {
        slot: "a:dk1",
        element: "a:sysClr",
        attributes: { val: "windowText", lastClr: "000000" },
      },
      {
        slot: "a:lt1",
        element: "a:sysClr",
        attributes: { val: "window", lastClr: "FFFFFF" },
      },
      { slot: "a:dk2", element: "a:srgbClr", attributes: { val: "1F497D" } },
      { slot: "a:lt2", element: "a:srgbClr", attributes: { val: "EEECE1" } },
      {
        slot: "a:accent1",
        element: "a:srgbClr",
        attributes: { val: "4F81BD" },
      },
      {
        slot: "a:accent2",
        element: "a:srgbClr",
        attributes: { val: "C0504D" },
      },
      {
        slot: "a:accent3",
        element: "a:srgbClr",
        attributes: { val: "9BBB59" },
      },
      {
        slot: "a:accent4",
        element: "a:srgbClr",
        attributes: { val: "8064A2" },
      },
      {
        slot: "a:accent5",
        element: "a:srgbClr",
        attributes: { val: "4BACC6" },
      },
      {
        slot: "a:accent6",
        element: "a:srgbClr",
        attributes: { val: "F79646" },
      },
      { slot: "a:hlink", element: "a:srgbClr", attributes: { val: "0000FF" } },
      {
        slot: "a:folHlink",
        element: "a:srgbClr",
        attributes: { val: "800080" },
      },
    ];
    const slots = clrScheme.children.filter(
      (c): c is XmlElement => c.type === "element",
    );
    expect(slots.map((s) => s.tag)).toEqual(expectedColours.map((c) => c.slot));
    for (const expected of expectedColours) {
      const entry = elementChild(clrScheme, expected.slot);
      expect(
        entry.children.filter((c): c is XmlElement => c.type === "element"),
        expected.slot,
      ).toEqual([
        {
          type: "element",
          tag: expected.element,
          attributes: Object.entries(expected.attributes).map(
            ([name, value]) => ({ name, value }),
          ),
          children: [],
        },
      ]);
    }

    const fontScheme = elementChild(themeElements, "a:fontScheme");
    expect(attr(fontScheme, "name")).toBe("Office");
    for (const [tag, typeface] of [
      ["a:majorFont", "Calibri Light"],
      ["a:minorFont", "Calibri"],
    ] as const) {
      const font = elementChild(fontScheme, tag);
      expect(
        font.children.filter((c): c is XmlElement => c.type === "element"),
        tag,
      ).toEqual([
        {
          type: "element",
          tag: "a:latin",
          attributes: [{ name: "typeface", value: typeface }],
          children: [],
        },
        {
          type: "element",
          tag: "a:ea",
          attributes: [{ name: "typeface", value: "" }],
          children: [],
        },
        {
          type: "element",
          tag: "a:cs",
          attributes: [{ name: "typeface", value: "" }],
          children: [],
        },
      ]);
    }

    const fmtScheme = elementChild(themeElements, "a:fmtScheme");
    expect(attr(fmtScheme, "name")).toBe("Office");
    // fillStyleLst and bgFillStyleLst: exactly three solidFill/schemeClr phClr entries each.
    for (const listTag of ["a:fillStyleLst", "a:bgFillStyleLst"]) {
      const fills = elementChild(fmtScheme, listTag).children.filter(
        (c): c is XmlElement => c.type === "element",
      );
      expect(fills, listTag).toHaveLength(3);
      for (const fill of fills) {
        expect(fill.tag, listTag).toBe("a:solidFill");
        const schemeClr = elementChild(fill, "a:schemeClr");
        expect(attr(schemeClr, "val"), listTag).toBe("phClr");
      }
    }
    // lnStyleLst: exactly three a:ln entries, each wrapping one solidFill/schemeClr phClr.
    const lines = elementChild(fmtScheme, "a:lnStyleLst").children.filter(
      (c): c is XmlElement => c.type === "element",
    );
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.tag).toBe("a:ln");
      expect(
        attr(
          elementChild(elementChild(line, "a:solidFill"), "a:schemeClr"),
          "val",
        ),
      ).toBe("phClr");
    }
    // effectStyleLst: exactly three effectStyle entries, each holding an empty effectLst.
    const effects = elementChild(fmtScheme, "a:effectStyleLst").children.filter(
      (c): c is XmlElement => c.type === "element",
    );
    expect(effects).toHaveLength(3);
    for (const effectStyle of effects) {
      expect(effectStyle.tag).toBe("a:effectStyle");
      expect(elementChild(effectStyle, "a:effectLst").children).toEqual([]);
    }
  });
});

describe("ensureNotesMaster: relationships and failure paths", () => {
  it("the notes master's own relationship is exactly the theme, with its full type URI and relative target", () => {
    const pkg = createEmptyPptxPackage();
    ensureNotesMaster(pkg);
    const rels = rootElement(
      pkg.parts["ppt/notesMasters/_rels/notesMaster1.xml.rels"],
    );
    const relationships =
      rels === undefined
        ? []
        : rels.children.filter((c): c is XmlElement => c.type === "element");
    expect(relationships.map(attributeMap)).toEqual([
      {
        Id: "rId1",
        Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
        Target: "../theme/theme1.xml",
      },
    ]);
  });

  it("the presentation's relationship to the notes master carries the notesMaster type, and p:notesMasterId points through it", () => {
    const pkg = createEmptyPptxPackage();
    ensureNotesMaster(pkg);
    const rels = rootElement(pkg.parts["ppt/_rels/presentation.xml.rels"]);
    const relationships =
      rels === undefined
        ? []
        : rels.children.filter((c): c is XmlElement => c.type === "element");
    // The notes master relationship is the second one the presentation gains (after its own slideMaster), so the pair of allocated ids pins the allocation order too.
    expect(relationships.map(attributeMap)).toEqual([
      {
        Id: "rId1",
        Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
        Target: "slideMasters/slideMaster1.xml",
      },
      {
        Id: "rId2",
        Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster",
        Target: "notesMasters/notesMaster1.xml",
      },
    ]);
    const presentation = rootElement(pkg.parts["ppt/presentation.xml"]);
    const notesMasterId = elementChild(
      elementChild(presentation, "p:notesMasterIdLst"),
      "p:notesMasterId",
    );
    expect(attr(notesMasterId, "r:id")).toBe("rId2");
  });

  it("the notes master root declares exactly the p and a namespaces", () => {
    const pkg = createEmptyPptxPackage();
    ensureNotesMaster(pkg);
    const master = rootElement(pkg.parts["ppt/notesMasters/notesMaster1.xml"]);
    expect(attributeMap(master)).toEqual({
      "xmlns:p": "http://schemas.openxmlformats.org/presentationml/2006/main",
      "xmlns:a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    });
    const cSld = elementChild(master, "p:cSld");
    expect(
      cSld.children
        .filter((c): c is XmlElement => c.type === "element")
        .map((c) => c.tag),
    ).toEqual(["p:bg", "p:spTree"]);
    const bgPr = elementChild(elementChild(cSld, "p:bg"), "p:bgPr");
    expect(
      attr(elementChild(elementChild(bgPr, "a:solidFill"), "a:srgbClr"), "val"),
    ).toBe("FFFFFF");
    const spTree = elementChild(cSld, "p:spTree");
    expect(
      spTree.children
        .filter((c): c is XmlElement => c.type === "element")
        .map((c) => c.tag),
    ).toEqual(["p:nvGrpSpPr", "p:grpSpPr"]);
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

  it("throws when ppt/presentation.xml is absent or not an XML part", () => {
    const missing = createEmptyPptxPackage();
    delete missing.parts["ppt/presentation.xml"];
    expect(() => ensureNotesMaster(missing)).toThrow(
      "ensureNotesMaster: package has no ppt/presentation.xml element",
    );
    const nonXml = createEmptyPptxPackage();
    nonXml.parts["ppt/presentation.xml"] = { kind: "binary", base64: "" };
    expect(() => ensureNotesMaster(nonXml)).toThrow(
      "ensureNotesMaster: package has no ppt/presentation.xml element",
    );
  });

  it("inserts p:notesMasterIdLst at the very front when the presentation has no p:sldMasterIdLst", () => {
    // The spine is ordinarily already built; a caller mutating their own package down to a bare p:presentation still gets the required element, at the only position left.
    const pkg = createEmptyPptxPackage();
    const presentation = rootElement(pkg.parts["ppt/presentation.xml"]);
    if (presentation !== undefined) {
      presentation.children = [];
    }
    ensureNotesMaster(pkg);
    const childTags = rootElement(pkg.parts["ppt/presentation.xml"])
      ?.children.filter((c): c is XmlElement => c.type === "element")
      .map((c) => c.tag);
    expect(childTags).toEqual(["p:notesMasterIdLst"]);
  });
});
