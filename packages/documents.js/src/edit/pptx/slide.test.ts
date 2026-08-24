import type { Part, XmlElement } from "ooxml.js";
import { rootElement } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { createPptx, openPptx } from "./editor";

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
  it("shapes() excludes a table graphic frame -- only the text box and picture come back", () => {
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

  it("tables() reflects true document position, not addTable call order -- swapping the two graphic frames in the raw XML tree reorders tables()", () => {
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
