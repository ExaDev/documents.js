import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentParagraph } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { readPptxContent } from "./read";
function asParagraph(block: ContentBlock | undefined): ContentParagraph {
  if (block?.kind !== "paragraph") {
    throw new Error("expected a paragraph block");
  }
  return block;
}

const SLIDE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
function rels(
  entries: readonly {
    id: string;
    type: string;
    target: string;
    external?: boolean;
  }[],
): XmlElement {
  return el(
    "Relationships",
    {},
    entries.map((e) =>
      el(
        "Relationship",
        e.external === true
          ? { Id: e.id, Type: e.type, Target: e.target, TargetMode: "External" }
          : { Id: e.id, Type: e.type, Target: e.target },
      ),
    ),
  );
}

// Only the PNG magic-byte signature matters to sniffImageFormat — the rest is arbitrary filler, not a real encoded image.
function smartArtFixturePackage(): Package {
  const para = (...runs: readonly XmlElement[]) => el("a:p", {}, runs);
  const r = (text: string) => el("a:r", {}, [el("a:t", {}, [txt(text)])]);
  const textPt = (
    modelId: string,
    type: string | undefined,
    paragraphs: readonly XmlElement[],
  ): XmlElement =>
    el("dgm:pt", type === undefined ? { modelId } : { modelId, type }, [
      el("dgm:t", {}, [el("a:bodyPr"), el("a:lstStyle"), ...paragraphs]),
    ]);
  const cxn = (srcId: string, destId: string, srcOrd: string, type?: string) =>
    el(
      "dgm:cxn",
      type === undefined
        ? { modelId: `${srcId}-${destId}`, srcId, destId, srcOrd, destOrd: "0" }
        : {
            modelId: `${srcId}-${destId}`,
            type,
            srcId,
            destId,
            srcOrd,
            destOrd: "0",
          },
    );

  const dataModel = el("dgm:dataModel", {}, [
    el("dgm:ptLst", {}, [
      textPt("0", "doc", [para()]),
      textPt("1", undefined, [para(r("Strategy"))]),
      textPt("2", undefined, [para(r("Cost"))]),
      textPt("3", undefined, [para(r("Quality")), para(r("Details"))]),
      textPt("4", undefined, [para()]),
      textPt("5", "asst", [para(r("Assistant"))]),
      textPt("6", "parTrans", [para(r("transition text"))]),
    ]),
    el("dgm:cxnLst", {}, [
      cxn("0", "2", "1"),
      cxn("0", "1", "0"),
      cxn("0", "4", "2"),
      cxn("0", "5", "3"),
      cxn("1", "3", "0"),
      cxn("1", "6", "1"),
      cxn("0", "2", "9", "presOf"),
    ]),
  ]);

  const diagramFrame = el("p:graphicFrame", {}, [
    el("p:nvGraphicFramePr", {}, [
      el("p:cNvPr", { id: "2", name: "Diagram 1" }),
    ]),
    el("p:xfrm", {}, [
      el("a:off", { x: "914400", y: "1828800" }),
      el("a:ext", { cx: "4572000", cy: "2743200" }),
    ]),
    el("a:graphic", {}, [
      el(
        "a:graphicData",
        { uri: "http://schemas.openxmlformats.org/drawingml/2006/diagram" },
        [
          el("dgm:relIds", {
            "r:dm": "rIdDm",
            "r:lo": "rIdLo",
            "r:qs": "rIdQs",
            "r:cs": "rIdCs",
          }),
        ],
      ),
    ]),
  ]);
  const slide = el("p:sld", {}, [
    el("p:cSld", {}, [el("p:spTree", {}, [diagramFrame])]),
  ]);
  const presentation = el("p:presentation", {}, [
    el("p:sldIdLst", {}, [el("p:sldId", { id: "256", "r:id": "rId1" })]),
  ]);
  const presentationRels = rels([
    { id: "rId1", type: SLIDE_REL, target: "slides/slide1.xml" },
  ]);
  const slideRels = rels([
    {
      id: "rIdDm",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData",
      target: "../diagrams/data1.xml",
    },
  ]);

  return {
    parts: {
      "ppt/presentation.xml": { kind: "xml", nodes: [presentation] },
      "ppt/_rels/presentation.xml.rels": {
        kind: "xml",
        nodes: [presentationRels],
      },
      "ppt/slides/slide1.xml": { kind: "xml", nodes: [slide] },
      "ppt/slides/_rels/slide1.xml.rels": { kind: "xml", nodes: [slideRels] },
      "ppt/diagrams/data1.xml": { kind: "xml", nodes: [dataModel] },
    },
  };
}

describe("readPptxContent: SmartArt graphic frames", () => {
  it("reads the data model's node text as paragraphs in diagram order (depth-first, siblings by srcOrd)", () => {
    const doc = readPptxContent(smartArtFixturePackage());
    const diagramShape = doc.slides[0]?.shapes.find(
      (s) => s.name === "Diagram 1",
    );
    const texts = (diagramShape?.blocks ?? []).map((b) =>
      asParagraph(b)
        .runs.map((run) => run.text)
        .join(""),
    );
    expect(texts).toEqual([
      "Strategy",
      "Quality",
      "Details",
      "Cost",
      "Assistant",
    ]);
  });

  it("marks the shape origin: 'diagram' — the diagram's own node text, not freeform slide prose", () => {
    const doc = readPptxContent(smartArtFixturePackage());
    const diagramShape = doc.slides[0]?.shapes.find(
      (s) => s.name === "Diagram 1",
    );
    expect(diagramShape?.origin).toBe("diagram");
  });

  it("keeps the frame's geometry with empty content when the data model relationship resolves to no readable part", () => {
    const pkg = smartArtFixturePackage();
    delete pkg.parts["ppt/diagrams/data1.xml"];
    const doc = readPptxContent(pkg);
    const diagramShape = doc.slides[0]?.shapes.find(
      (s) => s.name === "Diagram 1",
    );
    expect(diagramShape?.frame).toEqual({
      xPt: 72,
      yPt: 144,
      widthPt: 360,
      heightPt: 216,
    });
    expect(diagramShape?.blocks).toEqual([]);
  });

  it("assigns sourcePath to each diagram paragraph", () => {
    const doc = readPptxContent(smartArtFixturePackage());
    const diagramShape = doc.slides[0]?.shapes.find(
      (s) => s.name === "Diagram 1",
    );
    expect(asParagraph(diagramShape?.blocks[0]).sourcePath).toBe(
      "slides[0].shapes[0].blocks[0]",
    );
    expect(asParagraph(diagramShape?.blocks[4]).sourcePath).toBe(
      "slides[0].shapes[0].blocks[4]",
    );
  });

  it("leaves the shape's own source undefined when relIds names no layout/quickStyle/colour relationship the slide actually carries", () => {
    const doc = readPptxContent(smartArtFixturePackage());
    const diagramShape = doc.slides[0]?.shapes.find(
      (s) => s.name === "Diagram 1",
    );
    expect(diagramShape?.source).toBeUndefined();
  });

  it("quarantines whichever of the layout/quickStyle/colour parts resolve as pptx residue on the diagram's own shape, in r:lo/r:qs/r:cs order", () => {
    const pkg = smartArtFixturePackage();
    const layout = el("dgm:layoutDef", { uniqueId: "layout1" });
    const quickStyle = el("dgm:styleDef", { uniqueId: "style1" });
    pkg.parts["ppt/diagrams/layout1.xml"] = { kind: "xml", nodes: [layout] };
    pkg.parts["ppt/diagrams/quickStyle1.xml"] = {
      kind: "xml",
      nodes: [quickStyle],
    };
    // Replaces the fixture's own dm-only relationships with dm+lo+qs — rIdCs is deliberately left unresolved (no relationship, no part) to prove residue quarantines whichever parts actually resolve rather than requiring all three.
    pkg.parts["ppt/slides/_rels/slide1.xml.rels"] = {
      kind: "xml",
      nodes: [
        rels([
          {
            id: "rIdDm",
            type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData",
            target: "../diagrams/data1.xml",
          },
          {
            id: "rIdLo",
            type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramLayout",
            target: "../diagrams/layout1.xml",
          },
          {
            id: "rIdQs",
            type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramQuickStyle",
            target: "../diagrams/quickStyle1.xml",
          },
        ]),
      ],
    };
    const doc = readPptxContent(pkg);
    const diagramShape = doc.slides[0]?.shapes.find(
      (s) => s.name === "Diagram 1",
    );
    expect(diagramShape?.source?.format).toBe("pptx");
    const xml = diagramShape?.source?.xml ?? "";
    expect(xml.indexOf("dgm:layoutDef")).toBeGreaterThanOrEqual(0);
    expect(xml.indexOf("dgm:styleDef")).toBeGreaterThan(
      xml.indexOf("dgm:layoutDef"),
    );
  });
});

// An OLE graphic frame's a:graphicData wraps an mc:AlternateContent: the mc:Choice side's p:oleObj names the embedded payload, while the mc:Fallback side repeats the p:oleObj carrying the raster picture every renderer actually displays. The payload target is parameterised so a test can point rIdOle at whatever part shape it needs (the ZIP-payload case reuses the default .xlsx target; the classic-OLE case retargets to a .bin part), and frameCount emits that many frames all pointing at the SAME payload relationship — the copy-pasted-object shape — while the fixture still ships no embeddings part, so the default fixture keeps exercising exactly the fallback/progId paths.
