import type { XmlElement } from "ooxml.js";
import { attr, childrenWithTag, rootElement } from "ooxml.js";
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
    expect(master?.tag).toBe("p:notesMaster");
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

  it("inserts directly after p:sldMasterIdLst even when it is not the first element", () => {
    // A hand-authored presentation may order its own children differently; the insertion point is AFTER p:sldMasterIdLst itself, not simply at index 1 or at the front.
    const pkg = createEmptyPptxPackage();
    const presentation = rootElement(pkg.parts["ppt/presentation.xml"]);
    presentation?.children.reverse();
    ensureNotesMaster(pkg);
    const childTags = rootElement(pkg.parts["ppt/presentation.xml"])
      ?.children.filter((c): c is XmlElement => c.type === "element")
      .map((c) => c.tag);
    expect(childTags).toEqual([
      "p:notesSz",
      "p:sldSz",
      "p:sldIdLst",
      "p:sldMasterIdLst",
      "p:notesMasterIdLst",
    ]);
  });

  it("a second call re-runs nothing: the presentation gains no duplicate list and the notes master no duplicate relationship", () => {
    // Part-count alone cannot see a re-run (every part key is overwritten in place), so idempotency is pinned on the two structures a re-run would duplicate instead.
    const pkg = createEmptyPptxPackage();
    ensureNotesMaster(pkg);
    ensureNotesMaster(pkg);
    const presentation = rootElement(pkg.parts["ppt/presentation.xml"]);
    const notesMasterListCount =
      presentation === undefined
        ? 0
        : presentation.children.filter(
            (c): c is XmlElement =>
              c.type === "element" && c.tag === "p:notesMasterIdLst",
          ).length;
    expect(notesMasterListCount).toBe(1);
    const rels = rootElement(
      pkg.parts["ppt/notesMasters/_rels/notesMaster1.xml.rels"],
    );
    const relationshipCount =
      rels === undefined
        ? 0
        : rels.children.filter((c): c is XmlElement => c.type === "element")
            .length;
    expect(relationshipCount).toBe(1);
  });
});
