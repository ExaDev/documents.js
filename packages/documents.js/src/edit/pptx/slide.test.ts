import type { Part, XmlElement } from "ooxml.js";
import { attr, resolveRelationships, rootElement, textContent } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { el } from "../../xml/fragment";
import { createPptx, openPptx } from "./editor";
import { PptxSlide } from "./slide";
import { DML_NS, PML_NS } from "./scaffold";

function childOf(
  node: XmlElement | undefined,
  tag: string,
): XmlElement | undefined {
  return node?.children.find(
    (c): c is XmlElement => c.type === "element" && c.tag === tag,
  );
}

function findDeep(
  node: XmlElement | undefined,
  tag: string,
): XmlElement | undefined {
  for (const child of node?.children ?? []) {
    if (child.type === "element") {
      if (child.tag === tag) {
        return child;
      }
      const nested = findDeep(child, tag);
      if (nested !== undefined) {
        return nested;
      }
    }
  }
  return undefined;
}

function attrOf(
  element: XmlElement | undefined,
  name: string,
): string | undefined {
  return element === undefined ? undefined : attr(element, name);
}

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

function findSpTreeChildren(
  part: Part | undefined,
  slidePartPath: string,
): XmlElement["children"] {
  const slideRoot = rootElement(part);
  const cSld = slideRoot?.children.find(
    (c): c is XmlElement => c.type === "element" && c.tag === "p:cSld",
  );
  const spTree = cSld?.children.find(
    (c): c is XmlElement => c.type === "element" && c.tag === "p:spTree",
  );
  if (spTree === undefined) {
    throw new Error(`expected a p:cSld/p:spTree element in ${slidePartPath}`);
  }
  return spTree.children;
}

describe("PptxSlide.shapes / tables", () => {
  it("shapes() excludes a table graphic frame — only the text box and picture come back", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
      text: "Title",
    });
    slide.addImage({
      frame: { xPt: 0, yPt: 60, widthPt: 50, heightPt: 50 },
      format: "png",
      bytes: PNG_BYTES,
    });
    slide.addTable({
      frame: { xPt: 0, yPt: 120, widthPt: 200, heightPt: 80 },
      table: { rows: 2, columns: 2 },
    });

    expect(slide.shapes()).toHaveLength(2);
  });

  it("tables() returns exactly the one added table, a fully working PptxTable", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
      text: "Title",
    });
    slide.addTable({
      frame: { xPt: 0, yPt: 60, widthPt: 200, heightPt: 80 },
      table: { rows: 2, columns: 2 },
    });

    const tables = slide.tables();
    expect(tables).toHaveLength(1);
    expect(tables[0]?.rows()).toHaveLength(2);
    expect(tables[0]?.rows()[0]?.cells()).toHaveLength(2);

    tables[0]?.cell(1, 1).setParagraphs([{ runs: [{ text: "B2" }] }]);

    // Round-trips through re-decoding the package, not merely through the live JS reference.
    const reopened = openPptx(editor.toBytes());
    const reopenedTable = reopened.slides()[0]?.tables()[0];
    expect(reopenedTable?.rows()).toHaveLength(2);
    const b2 = reopenedTable?.cell(1, 1);
    expect(b2).toBeDefined();
  });

  it("tables() reflects true document position, not addTable call order — swapping the two graphic frames in the raw XML tree reorders tables()", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    // Distinguishable by column count, so which table is which can be told apart after reordering.
    slide.addTable({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 40 },
      table: { rows: 1, columns: 3 },
    });
    slide.addTextBox({
      frame: { xPt: 0, yPt: 50, widthPt: 100, heightPt: 40 },
      text: "Interleaved",
    });
    slide.addTable({
      frame: { xPt: 0, yPt: 100, widthPt: 100, heightPt: 40 },
      table: { rows: 1, columns: 1 },
    });

    expect(slide.shapes()).toHaveLength(1);
    expect(slide.shapes()[0]?.text).toBe("Interleaved");
    expect(slide.tables().map((t) => t.rows()[0]?.cells().length)).toEqual([
      3, 1,
    ]);

    const slidePartPath = Object.keys(editor.toPackage().parts).find((p) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(p),
    );
    if (slidePartPath === undefined) {
      throw new Error("expected a ppt/slides/slideN.xml part");
    }
    const spTreeChildren = findSpTreeChildren(
      editor.toPackage().parts[slidePartPath],
      slidePartPath,
    );
    const graphicFrameIndices: number[] = [];
    spTreeChildren.forEach((c, i) => {
      if (c.type === "element" && c.tag === "p:graphicFrame") {
        graphicFrameIndices.push(i);
      }
    });
    const [firstIndex, secondIndex] = graphicFrameIndices;
    if (firstIndex === undefined || secondIndex === undefined) {
      throw new Error("expected exactly two p:graphicFrame children");
    }
    const firstFrame = spTreeChildren[firstIndex];
    const secondFrame = spTreeChildren[secondIndex];
    if (firstFrame === undefined || secondFrame === undefined) {
      throw new Error(
        "expected both p:graphicFrame indices to resolve to a real element",
      );
    }
    spTreeChildren[firstIndex] = secondFrame;
    spTreeChildren[secondIndex] = firstFrame;

    // Same live `slide` reference, no re-reading through the editor: tables() must walk the mutated tree afresh each call.
    expect(slide.tables().map((t) => t.rows()[0]?.cells().length)).toEqual([
      1, 3,
    ]);
  });

  it("a table survives a full toBytes() -> decodePackage round trip and is still found by tables()", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addTable({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 40 },
      table: { rows: 1, columns: 1 },
    });

    const bytes = editor.toBytes();
    const reopened = openPptx(bytes);
    const reopenedSlide = reopened.slides()[0];
    expect(reopenedSlide?.tables()).toHaveLength(1);
    expect(reopenedSlide?.shapes()).toHaveLength(0);
  });
});

describe("PptxSlide.addVector", () => {
  it("appends a vector primitive as its own shape, in paint order after an earlier addTextBox", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 20 },
      text: "Behind",
    });
    const vectorShape = slide.addVector({
      kind: "rect",
      frame: { xPt: 10, yPt: 10, widthPt: 30, heightPt: 30 },
    });

    const shapes = slide.shapes();
    expect(shapes).toHaveLength(2);
    expect(shapes[1]).toEqual(vectorShape);
    expect(vectorShape.frame).toEqual({
      xPt: 10,
      yPt: 10,
      widthPt: 30,
      heightPt: 30,
    });
  });
});

describe("PptxSlide.registerHyperlink", () => {
  it("adds an External hyperlink relationship on the slide's own part and returns its r:id", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    const rId = slide.registerHyperlink("https://example.com/");

    const slidePartPath = Object.keys(editor.toPackage().parts).find((p) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(p),
    );
    if (slidePartPath === undefined) {
      throw new Error("expected a ppt/slides/slideN.xml part");
    }
    const rels = resolveRelationships(editor.toPackage(), slidePartPath);
    const rel = rels.get(rId);
    expect(rel).toEqual({
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
      target: "https://example.com/",
      targetMode: "External",
    });
  });
});

describe("PptxSlide.remove", () => {
  it("removes the slide from the presentation and throws on further use", () => {
    const editor = createPptx();
    const first = editor.addSlide();
    first.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "Keep",
    });
    const second = editor.addSlide();

    second.remove();

    expect(editor.slides()).toHaveLength(1);
    expect(editor.slides()[0]?.shapes()[0]?.text).toBe("Keep");
    expect(() => second.shapes()).toThrow(/removed/);
  });
});
describe("PptxSlide.notes", () => {
  it("reads the empty string for a slide with no notes relationship", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    expect(slide.notes).toBe("");
  });

  it("setting notes mints the part, its content-type override, the slide relationship, and the notesMaster chain", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.notes = "Speaker notes";

    const pkg = editor.toPackage();
    expect(pkg.parts["ppt/notesSlides/notesSlide1.xml"]).toBeDefined();

    const contentTypesRoot = rootElement(pkg.parts["[Content_Types].xml"]);
    const hasNotesOverride = contentTypesRoot?.children.some(
      (c) =>
        c.type === "element" &&
        c.tag === "Override" &&
        attr(c, "PartName") === "/ppt/notesSlides/notesSlide1.xml",
    );
    expect(hasNotesOverride).toBe(true);

    const slidePartPath = Object.keys(pkg.parts).find((p) =>
      /^ppt\/slides\/slide1\.xml$/.test(p),
    );
    const rels = resolveRelationships(
      pkg,
      slidePartPath ?? "ppt/slides/slide1.xml",
    );
    const notesRel = [...rels.values()].find(
      (r) =>
        r.type ===
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide",
    );
    expect(notesRel).toBeDefined();

    const notesRels = resolveRelationships(
      pkg,
      "ppt/notesSlides/notesSlide1.xml",
    );
    expect(
      [...notesRels.values()].some(
        (r) =>
          r.type ===
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster",
      ),
    ).toBe(true);

    expect(slide.notes).toBe("Speaker notes");
  });

  it("re-setting notes overwrites the one part rather than minting another", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.notes = "First";
    slide.notes = "Second";
    const pkg = editor.toPackage();
    const notesParts = Object.keys(pkg.parts).filter((p) =>
      /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p),
    );
    expect(notesParts).toEqual(["ppt/notesSlides/notesSlide1.xml"]);
    expect(slide.notes).toBe("Second");
  });

  it("a second slide's notes take the next part index", () => {
    const editor = createPptx();
    const first = editor.addSlide();
    const second = editor.addSlide();
    first.notes = "One";
    second.notes = "Two";
    const pkg = editor.toPackage();
    expect(
      Object.keys(pkg.parts)
        .filter((p) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p))
        .sort(),
    ).toEqual([
      "ppt/notesSlides/notesSlide1.xml",
      "ppt/notesSlides/notesSlide2.xml",
    ]);
    expect(second.notes).toBe("Two");
    expect(first.notes).toBe("One");
  });

  it("notes survive a full toBytes round trip", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.notes = "Keep me";
    const reopened = openPptx(editor.toBytes());
    expect(reopened.slides()[0]?.notes).toBe("Keep me");
  });
});

describe("PptxSlide.addTextBox ids", () => {
  it("allocates document-unique ids in call order across shape kinds", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    const first = slide.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "a",
    });
    const second = slide.addTextBox({
      frame: { xPt: 0, yPt: 20, widthPt: 10, heightPt: 10 },
      text: "b",
    });
    const pic = slide.addImage({
      frame: { xPt: 0, yPt: 40, widthPt: 10, heightPt: 10 },
      format: "png",
      bytes: PNG_BYTES,
    });
    // The empty slide's own spTree group already holds cNvPr id 1, so the
    // first added shape allocates 2.
    expect(first.name).toBe("TextBox 2");
    expect(second.name).toBe("TextBox 3");
    expect(pic.name).toBe("Picture 4");
    // An id already present in the tree is never reused: the next addition
    // continues above it.
    const later = slide.addVector({
      kind: "rect",
      frame: { xPt: 0, yPt: 60, widthPt: 5, heightPt: 5 },
    });
    expect(later.frame).toEqual({ xPt: 0, yPt: 60, widthPt: 5, heightPt: 5 });
  });

  it("a hand-placed high id pushes the next allocation above it, and non-numeric ids are ignored", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    const slidePartPath = Object.keys(editor.toPackage().parts).find((p) =>
      /^ppt\/slides\/slide1\.xml$/.test(p),
    );
    const slideRoot = rootElement(
      editor.toPackage().parts[slidePartPath ?? ""],
    );
    const cSld = slideRoot?.children.find(
      (c): c is XmlElement => c.type === "element" && c.tag === "p:cSld",
    );
    const spTree = cSld?.children.find(
      (c): c is XmlElement => c.type === "element" && c.tag === "p:spTree",
    );
    spTree?.children.push(
      el("p:sp", {}, [
        el("p:nvSpPr", {}, [
          el("p:cNvPr", { id: "7", name: "Seed" }),
          el("p:cNvSpPr"),
          el("p:nvPr"),
        ]),
        el("p:spPr"),
        el("p:txBody", {}, [el("a:bodyPr"), el("a:lstStyle"), el("a:p")]),
      ]),
      el("p:sp", {}, [
        el("p:nvSpPr", {}, [
          el("p:cNvPr", { id: "not-a-number", name: "Junk" }),
          el("p:cNvSpPr"),
          el("p:nvPr"),
        ]),
        el("p:spPr"),
        el("p:txBody", {}, [el("a:bodyPr"), el("a:lstStyle"), el("a:p")]),
      ]),
    );
    const added = slide.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "after",
    });
    expect(added.name).toBe("TextBox 8");
  });
});

describe("PptxSlide.addTable rotation", () => {
  it("writes the table graphic frame's rotation in 60,000ths of a degree", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addTable({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 40 },
      table: { rows: 1, columns: 1 },
      rotationDeg: 30,
    });
    const slidePartPath = Object.keys(editor.toPackage().parts).find((p) =>
      /^ppt\/slides\/slide1\.xml$/.test(p),
    );
    const slideRoot = rootElement(
      editor.toPackage().parts[slidePartPath ?? ""],
    );
    const cSld = slideRoot?.children.find(
      (c): c is XmlElement => c.type === "element" && c.tag === "p:cSld",
    );
    const spTree = cSld?.children.find(
      (c): c is XmlElement => c.type === "element" && c.tag === "p:spTree",
    );
    const graphicFrame = spTree?.children.find(
      (c): c is XmlElement =>
        c.type === "element" && c.tag === "p:graphicFrame",
    );
    const xfrm = graphicFrame?.children.find(
      (c): c is XmlElement => c.type === "element" && c.tag === "p:xfrm",
    );
    expect(xfrm?.attributes.find((a) => a.name === "rot")?.value).toBe(
      "1800000",
    );
  });
});

describe("PptxSlide.tables with a non-table graphic frame", () => {
  it("skips a graphic frame whose graphicData is not the table uri", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addTable({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 40 },
      table: { rows: 1, columns: 1 },
    });
    const slidePartPath = Object.keys(editor.toPackage().parts).find((p) =>
      /^ppt\/slides\/slide1\.xml$/.test(p),
    );
    const slideRoot = rootElement(
      editor.toPackage().parts[slidePartPath ?? ""],
    );
    const cSld = slideRoot?.children.find(
      (c): c is XmlElement => c.type === "element" && c.tag === "p:cSld",
    );
    const spTree = cSld?.children.find(
      (c): c is XmlElement => c.type === "element" && c.tag === "p:spTree",
    );
    spTree?.children.push(
      el("p:graphicFrame", {}, [
        el("p:nvGraphicFramePr", {}, [
          el("p:cNvPr", { id: "99", name: "Chart" }),
          el("p:cNvGraphicFramePr"),
          el("p:nvPr"),
        ]),
        el("p:xfrm", {}, [
          el("a:off", { x: "0", y: "0" }),
          el("a:ext", { cx: "100", cy: "100" }),
        ]),
        el("a:graphic", {}, [
          el("a:graphicData", {
            uri: "http://schemas.openxmlformats.org/drawingml/2006/chart",
          }),
        ]),
      ]),
    );
    expect(slide.tables()).toHaveLength(1);
  });
});

describe("PptxSlide.notes part structure", () => {
  it("builds the minimal CT_NotesSlide skeleton with the body placeholder's exact geometry", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.notes = "Body text";

    const notesRoot = rootElement(
      editor.toPackage().parts["ppt/notesSlides/notesSlide1.xml"],
    );
    expect(notesRoot?.tag).toBe("p:notes");
    expect(notesRoot?.attributes).toContainEqual({
      name: "xmlns:p",
      value: PML_NS,
    });
    expect(notesRoot?.attributes).toContainEqual({
      name: "xmlns:a",
      value: DML_NS,
    });
    const tags = (node: XmlElement | undefined): (string | undefined)[] =>
      node?.children.map((c) => (c.type === "element" ? c.tag : undefined)) ??
      [];
    expect(tags(notesRoot)).toEqual(["p:cSld", "p:clrMapOvr"]);
    expect(tags(childOf(notesRoot, "p:clrMapOvr"))).toEqual([
      "a:masterClrMapping",
    ]);

    const cSld = childOf(notesRoot, "p:cSld");
    const spTree = childOf(cSld, "p:spTree");
    const shapes = tags(spTree).filter((t) => t === "p:sp");
    expect(shapes).toEqual(["p:sp"]);

    const body = childOf(spTree, "p:sp");
    expect(tags(body)).toEqual(["p:nvSpPr", "p:spPr", "p:txBody"]);
    const cNvPr = childOf(childOf(body, "p:nvSpPr"), "p:cNvPr");
    expect(attrOf(cNvPr, "id")).toBe("2");
    expect(attrOf(cNvPr, "name")).toBe("Notes Placeholder");
    expect(tags(childOf(childOf(body, "p:nvSpPr"), "p:cNvSpPr"))).toEqual([
      "a:spLocks",
    ]);
    expect(
      attrOf(
        childOf(childOf(childOf(body, "p:nvSpPr"), "p:cNvSpPr"), "a:spLocks"),
        "noGrp",
      ),
    ).toBe("1");
    // Scoped under the body shape: the spTree's own group also carries an
    // (empty) p:nvPr, which a document-wide search would find first.
    // Scoped under the body shape and searched as p:ph (the placeholder is
    // presentationml, not drawingml): the spTree's own group also carries an
    // empty p:nvPr a document-wide search would find first.
    const ph = childOf(childOf(childOf(body, "p:nvSpPr"), "p:nvPr"), "p:ph");
    expect(attrOf(ph, "type")).toBe("body");
    expect(attrOf(ph, "idx")).toBe("1");

    const xfrm = childOf(childOf(body, "p:spPr"), "a:xfrm");
    expect(attrOf(childOf(xfrm, "a:off"), "x")).toBe("685800");
    expect(attrOf(childOf(xfrm, "a:off"), "y")).toBe("4400550");
    expect(attrOf(childOf(xfrm, "a:ext"), "cx")).toBe("5486400");
    expect(attrOf(childOf(xfrm, "a:ext"), "cy")).toBe("4200525");

    const txBody = childOf(body, "p:txBody");
    expect(tags(txBody)).toEqual(["a:bodyPr", "a:lstStyle", "a:p"]);
    const notesParagraph = childOf(txBody, "a:p");
    if (notesParagraph === undefined) {
      throw new Error("expected an a:p paragraph in the notes body");
    }
    expect(textContent(notesParagraph)).toBe("Body text");
  });

  it("escapes XML-special notes text", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.notes = "a & <b>";
    expect(slide.notes).toBe("a & <b>");
  });
});

describe("nextIdIn deep walks and attribute order", () => {
  it("finds a cNvPr nested at arbitrary depth and with id after another attribute", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    const slidePartPath = Object.keys(editor.toPackage().parts).find((p) =>
      /^ppt\/slides\/slide1\.xml$/.test(p),
    );
    const slideRoot = rootElement(
      editor.toPackage().parts[slidePartPath ?? ""],
    );
    const cSld = slideRoot?.children.find(
      (c): c is XmlElement => c.type === "element" && c.tag === "p:cSld",
    );
    const spTree = cSld?.children.find(
      (c): c is XmlElement => c.type === "element" && c.tag === "p:spTree",
    );
    spTree?.children.push(
      el("p:wrapper", {}, [
        el("p:nested", {}, [
          el("p:nvSpPr", {}, [
            el("p:cNvPr", { name: "Deep", id: "9" }),
            el("p:cNvSpPr"),
            el("p:nvPr"),
          ]),
        ]),
      ]),
    );
    const added = slide.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "after",
    });
    expect(added.name).toBe("TextBox 10");
  });
});

describe("PptxSlide.remove precision", () => {
  it("removes exactly the matching sldId among several, leaving the others' content intact", () => {
    const editor = createPptx();
    const first = editor.addSlide();
    first.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "First",
    });
    const middle = editor.addSlide();
    middle.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "Middle",
    });
    const last = editor.addSlide();
    last.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "Last",
    });

    middle.remove();

    // The p:sldId entry itself is gone from sldIdLst, not merely the part:
    // slides() counts parts, so only the presentation part's own child list
    // observes the entry removal.
    const presentationRoot = rootElement(
      editor.toPackage().parts["ppt/presentation.xml"],
    );
    const sldIdLst = childOf(presentationRoot, "p:sldIdLst");
    const sldIds =
      sldIdLst?.children.filter(
        (c): c is XmlElement => c.type === "element" && c.tag === "p:sldId",
      ) ?? [];
    expect(sldIds).toHaveLength(2);
    expect(editor.slides()).toHaveLength(2);
    expect(editor.slides()[0]?.shapes()[0]?.text).toBe("First");
    expect(editor.slides()[1]?.shapes()[0]?.text).toBe("Last");
    expect(() => middle.shapes()).toThrow(/removed/);
  });
});

describe("PptxSlide.notes internals", () => {
  it("builds the paragraph as one a:r holding one a:t", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.notes = "Inner";
    const notesRoot = rootElement(
      editor.toPackage().parts["ppt/notesSlides/notesSlide1.xml"],
    );
    const tags = (node: XmlElement | undefined): (string | undefined)[] =>
      node?.children.map((c) => (c.type === "element" ? c.tag : undefined)) ??
      [];
    const paragraph = findDeep(notesRoot, "a:p");
    expect(tags(paragraph)).toEqual(["a:r"]);
    expect(tags(childOf(paragraph, "a:r"))).toEqual(["a:t"]);
  });

  it("reads the empty string when the relationship points at a part that is gone", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.notes = "Vanishing";
    const pkg = editor.toPackage();
    delete pkg.parts["ppt/notesSlides/notesSlide1.xml"];
    expect(slide.notes).toBe("");
  });

  it("a non-notes part name in the directory does not shift the next index", () => {
    const editor = createPptx();
    const first = editor.addSlide();
    const second = editor.addSlide();
    first.notes = "One";
    editor.toPackage().parts["ppt/notesSlides/notesSlide1.xml.bak"] = {
      kind: "xml",
      nodes: [],
    };
    second.notes = "Two";
    expect(
      Object.keys(editor.toPackage().parts).some(
        (p) => p === "ppt/notesSlides/notesSlide2.xml",
      ),
    ).toBe(true);
  });
});

describe("nextIdIn attribute scanning", () => {
  it("reads the id from a cNvPr whose other attribute could parse as one", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    const slidePartPath = Object.keys(editor.toPackage().parts).find((p) =>
      /^ppt\/slides\/slide1\.xml$/.test(p),
    );
    const slideRoot = rootElement(
      editor.toPackage().parts[slidePartPath ?? ""],
    );
    const cSld = childOf(slideRoot, "p:cSld");
    const spTree = childOf(cSld, "p:spTree");
    spTree?.children.push(
      el("p:nested", { descr: "9", id: "50" }, [
        el("p:nvSpPr", {}, [
          el("p:cNvPr", { descr: "12", id: "7" }),
          el("p:cNvSpPr"),
          el("p:nvPr"),
        ]),
      ]),
    );
    const added = slide.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "after",
    });
    // Only a p:cNvPr's own id attribute counts: the descr values (9 and 12)
    // and the wrapper's own id attribute never shift the allocation.
    expect(added.name).toBe("TextBox 8");
  });
});

describe("remove() attribute order", () => {
  it("finds r:id on a sldId whose attributes list it after another", () => {
    const editor = createPptx();
    const only = editor.addSlide();
    only.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "Solo",
    });
    const presentationRoot = rootElement(
      editor.toPackage().parts["ppt/presentation.xml"],
    );
    const sldIdLst = childOf(presentationRoot, "p:sldIdLst");
    const sldId = sldIdLst?.children.find(
      (c): c is XmlElement => c.type === "element" && c.tag === "p:sldId",
    );
    if (sldId !== undefined) {
      const idAttr = sldId.attributes.find((a) => a.name === "r:id");
      sldId.attributes = [
        { name: "descr", value: "first" },
        ...(idAttr ? [idAttr] : []),
      ];
    }
    only.remove();
    const remaining =
      sldIdLst?.children.filter(
        (c): c is XmlElement => c.type === "element" && c.tag === "p:sldId",
      ) ?? [];
    expect(remaining).toHaveLength(0);
    expect(editor.slides()).toHaveLength(0);
  });
});

describe("PptxSlide over a hand-built malformed slide", () => {
  it("throws when the slide has no p:cSld/p:spTree element", () => {
    const editor = createPptx();
    const context = {
      pkg: editor.toPackage(),
      slidePartPath: "ppt/slides/slide1.xml",
      mediaDir: "ppt/media",
      presentationPartPath: "ppt/presentation.xml",
    };
    const malformed = el("p:sld");
    const slide = new PptxSlide([malformed], malformed, context);
    expect(() => slide.shapes()).toThrow(/spTree/);
  });

  it("finds the spTree past an earlier sibling element inside p:cSld", () => {
    const editor = createPptx();
    const context = {
      pkg: editor.toPackage(),
      slidePartPath: "ppt/slides/slide1.xml",
      mediaDir: "ppt/media",
      presentationPartPath: "ppt/presentation.xml",
    };
    const shape = el("p:sp", {}, [
      el("p:nvSpPr", {}, [
        el("p:cNvPr", { id: "2", name: "X" }),
        el("p:cNvSpPr"),
        el("p:nvPr"),
      ]),
      el("p:spPr"),
      el("p:txBody", {}, [el("a:bodyPr"), el("a:lstStyle"), el("a:p")]),
    ]);
    const slideNode = el("p:sld", {}, [
      el("p:cSld", {}, [el("p:bg"), el("p:spTree", {}, [shape])]),
    ]);
    const slide = new PptxSlide([slideNode], slideNode, context);
    expect(slide.shapes()).toHaveLength(1);
  });
});
