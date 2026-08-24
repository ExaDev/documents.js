import type { Package, XmlElement } from "odf.js";
import { findChildElement } from "odf.js";
import { describe, expect, it } from "vitest";
import { createOdp, openOdp } from "./editor";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

// The first draw:page's own children, navigated directly from a live Package -- returns the SAME array reference the slide's own live view holds, so mutating it (as the document-order test below does) is visible through that slide.
function firstDrawPageChildren(pkg: Package): XmlElement["children"] {
  const part = pkg.parts["content.xml"];
  const root =
    part?.kind === "xml"
      ? part.nodes.find((n): n is XmlElement => n.type === "element")
      : undefined;
  const body =
    root === undefined
      ? undefined
      : findChildElement(root.children, "office:body");
  const presentation =
    body === undefined
      ? undefined
      : findChildElement(body.children, "office:presentation");
  const page =
    presentation === undefined
      ? undefined
      : findChildElement(presentation.children, "draw:page");
  if (page === undefined) {
    throw new Error("expected an office:presentation/draw:page element");
  }
  return page.children;
}

describe("OdpSlide.shapes / tables", () => {
  it("shapes() excludes a table frame (a draw:frame whose direct content is table:table) -- only the text box and picture come back", () => {
    const editor = createOdp();
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

  it("tables() returns exactly the one added table, a fully working OdpTableShape", () => {
    const editor = createOdp();
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
    expect(tables[0]?.table.rows()).toHaveLength(2);
    expect(tables[0]?.table.rows()[0]?.cells()).toHaveLength(2);
    expect(tables[0]?.shape.frame).toEqual({
      xPt: 0,
      yPt: 60,
      widthPt: 200,
      heightPt: 80,
    });

    tables[0]?.table.cell(1, 1).appendParagraph({ text: "B2" });

    // Round-trips through re-decoding the package, not merely through the live JS reference.
    const reopened = openOdp(editor.toBytes());
    const reopenedTable = reopened.slides()[0]?.tables()[0];
    expect(reopenedTable?.table.cell(1, 1).text).toContain("B2");
  });

  it("tables() reflects true document position, not addTable call order -- swapping the two table frames in the raw XML tree reorders tables()", () => {
    const editor = createOdp();
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
    expect(
      slide.tables().map((t) => t.table.rows()[0]?.cells().length),
    ).toEqual([3, 1]);

    // firstDrawPageChildren navigates the SAME live Package the editor/slide already hold, so mutating this array is visible through `slide` itself on its next tables() call -- no re-decoding, no separate snapshot to go stale.
    const pageChildren = firstDrawPageChildren(editor.toPackage());
    const tableFrameIndices: number[] = [];
    pageChildren.forEach((c, i) => {
      if (
        c.type === "element" &&
        c.tag === "draw:frame" &&
        findChildElement(c.children, "table:table") !== undefined
      ) {
        tableFrameIndices.push(i);
      }
    });
    const [firstIndex, secondIndex] = tableFrameIndices;
    if (firstIndex === undefined || secondIndex === undefined) {
      throw new Error("expected exactly two table draw:frame children");
    }
    const firstFrame = pageChildren[firstIndex];
    const secondFrame = pageChildren[secondIndex];
    if (firstFrame === undefined || secondFrame === undefined) {
      throw new Error(
        "expected both table draw:frame indices to resolve to a real element",
      );
    }
    pageChildren[firstIndex] = secondFrame;
    pageChildren[secondIndex] = firstFrame;

    expect(
      slide.tables().map((t) => t.table.rows()[0]?.cells().length),
    ).toEqual([1, 3]);
  });

  it("a table survives a full toBytes() -> decodePackage round trip and is still found by tables()", () => {
    const editor = createOdp();
    const slide = editor.addSlide();
    slide.addTable({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 40 },
      table: { rows: 1, columns: 1 },
    });

    const bytes = editor.toBytes();
    const reopened = openOdp(bytes);
    const reopenedSlide = reopened.slides()[0];
    expect(reopenedSlide?.tables()).toHaveLength(1);
    expect(reopenedSlide?.shapes()).toHaveLength(0);
  });
});
