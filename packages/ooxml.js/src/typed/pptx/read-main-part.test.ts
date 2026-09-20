import { describe, expect, it } from "vitest";
import type { Package, Part } from "../../model/package";
import { el, txt } from "../../xml/fragment";
import { readPptxContent } from "./read";

// A presentation whose main part is not ppt/presentation.xml. The package root's officeDocument relationship names it, and its own relationships name the slides (ExaDev/documents.js#1314).

const RELATIONSHIPS_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_BASE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

interface RelationshipSpec {
  readonly id: string;
  readonly type: string;
  readonly target: string;
}

function relsPart(relationships: readonly RelationshipSpec[]): Part {
  return {
    kind: "xml",
    nodes: [
      el(
        "Relationships",
        { xmlns: RELATIONSHIPS_NS },
        relationships.map((rel) =>
          el("Relationship", {
            Id: rel.id,
            Type: rel.type,
            Target: rel.target,
          }),
        ),
      ),
    ],
  };
}

function presentationPart(): Part {
  return {
    kind: "xml",
    nodes: [
      el("p:presentation", {}, [
        el("p:sldIdLst", {}, [el("p:sldId", { id: "256", "r:id": "rId2" })]),
        el("p:sldSz", { cx: "9144000", cy: "6858000" }),
      ]),
    ],
  };
}

function slidePart(text: string): Part {
  return {
    kind: "xml",
    nodes: [
      el("p:sld", {}, [
        el("p:cSld", {}, [
          el("p:spTree", {}, [
            el("p:sp", {}, [
              el("p:spPr", {}, [
                el("a:xfrm", {}, [
                  el("a:off", { x: "0", y: "0" }),
                  el("a:ext", { cx: "914400", cy: "914400" }),
                ]),
              ]),
              el("p:txBody", {}, [
                el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt(text)])])]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ],
  };
}

function renamedPresentationPackage(): Package {
  return {
    parts: {
      "_rels/.rels": relsPart([
        {
          id: "rId1",
          type: `${REL_BASE}/officeDocument`,
          target: "ppt/presentation2.xml",
        },
      ]),
      "ppt/presentation2.xml": presentationPart(),
      "ppt/_rels/presentation2.xml.rels": relsPart([
        { id: "rId2", type: `${REL_BASE}/slide`, target: "slides/slide2.xml" },
      ]),
      "ppt/slides/slide2.xml": slidePart("Renamed deck"),
    },
  };
}

function slideTexts(pkg: Package): string[] {
  return readPptxContent(pkg).slides.flatMap((slide) =>
    slide.shapes.flatMap((shape) =>
      shape.blocks.flatMap((block) =>
        block.kind === "paragraph" ? block.runs.map((run) => run.text) : [],
      ),
    ),
  );
}

describe("readPptxContent: main part named by the officeDocument relationship", () => {
  it("reads slides from a presentation the package puts at ppt/presentation2.xml", () => {
    expect(slideTexts(renamedPresentationPackage())).toEqual(["Renamed deck"]);
  });

  it("reads the slide size from the renamed presentation part", () => {
    const doc = readPptxContent(renamedPresentationPackage());
    expect(doc.slides[0]?.size.widthPt).toBe(720);
  });

  it("still reads a presentation at the conventional path when the package declares no root relationships", () => {
    const pkg: Package = {
      parts: {
        "ppt/presentation.xml": presentationPart(),
        "ppt/_rels/presentation.xml.rels": relsPart([
          {
            id: "rId2",
            type: `${REL_BASE}/slide`,
            target: "slides/slide2.xml",
          },
        ]),
        "ppt/slides/slide2.xml": slidePart("Conventional deck"),
      },
    };
    expect(slideTexts(pkg)).toEqual(["Conventional deck"]);
  });
});
