import {
  createOdg,
  elementsWithTag,
  openOdg,
  rootElement,
  type XmlElement,
} from "documents.js";
import { describe, expect, it } from "vitest";
import { appReducer, createInitialState } from "../../../state/reducer.js";
import type { OdgOpenDocument } from "../../../state/types.js";
import { buildPageItems, vectorsParityMatch } from "./shared.js";

function openOdgDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/drawing.odg",
): OdgOpenDocument {
  const state = appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "odg", editor: openOdg(bytes), path },
  });
  const doc = state.openDocument;
  if (doc?.format !== "odg") {
    throw new Error("expected an open odg document");
  }
  return doc;
}

describe("vectorsParityMatch", () => {
  it("matches two empty arrays", () => {
    expect(vectorsParityMatch([], [])).toBe(true);
  });

  it("matches when every kind lines up index-for-index", () => {
    expect(
      vectorsParityMatch(
        [{ kind: "rect" }, { kind: "line" }],
        [{ kind: "rect" }, { kind: "line" }],
      ),
    ).toBe(true);
  });

  it("fails on a synthetic length mismatch -- the shape a page with an extra reader-only element produces", () => {
    expect(
      vectorsParityMatch(
        [{ kind: "rect" }],
        [{ kind: "rect" }, { kind: "ellipse" }],
      ),
    ).toBe(false);
  });

  it("fails on a synthetic kind mismatch at the same length", () => {
    expect(
      vectorsParityMatch(
        [{ kind: "rect" }, { kind: "path" }],
        [{ kind: "rect" }, { kind: "ellipse" }],
      ),
    ).toBe(false);
  });
});

describe("buildPageItems vector parity", () => {
  it("threads a live handle through for every vector on a page built entirely through the live-view editor", () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addRect({
      frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 30 },
      fill: { r: 1, g: 0, b: 0 },
    });
    page.addEllipse({ frame: { xPt: 60, yPt: 10, widthPt: 40, heightPt: 30 } });
    page.addLine({
      from: { xPt: 0, yPt: 100 },
      to: { xPt: 100, yPt: 100 },
      stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
    });

    const doc = openOdgDocument(editor.toBytes());
    const items = buildPageItems(doc, 0);
    const vectorItems = items.filter((item) => item.kind === "vector");
    expect(vectorItems).toHaveLength(3);
    expect(vectorItems.map((item) => item.vector.kind)).toEqual([
      "rect",
      "ellipse",
      "line",
    ]);
    for (const item of vectorItems) {
      expect(item.liveVector).toBeDefined();
      expect(item.liveVector?.kind).toBe(item.vector.kind);
    }
  });

  // odf.js's own reader (readOdgContent, via typed/draw/shapes.ts) recognises a WIDER vector vocabulary than documents.js's own writer-side OdgPage.vectors() (wrapVectorElement, src/edit/odg/vector.ts): a bare draw:circle salvages into the identical ContentVector 'ellipse' kind on the read side, but OdgPage.vectors() has no wrapper for the draw:circle TAG at all and silently skips the element -- producing a real, page-scoped length mismatch between the two arrays, not merely a hypothetical one. Injected directly into the live package (`doc.editor.toPackage()`) rather than round-tripped through raw bytes, since both `page.vectors()` and `readOdgContent` read that identical live tree.
  it("falls back to read-only for the whole page when it also carries a draw:circle OdgPage.vectors() cannot wrap", () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addRect({
      frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 30 },
      fill: { r: 1, g: 0, b: 0 },
    });

    const doc = openOdgDocument(editor.toBytes());
    const pkg = doc.editor.toPackage();
    const root = rootElement(pkg.parts["content.xml"]);
    if (root === undefined) {
      throw new Error("expected a content.xml root element");
    }
    const [drawPage] = elementsWithTag([root], "draw:page");
    if (drawPage === undefined) {
      throw new Error("expected a draw:page element");
    }
    const circle: XmlElement = {
      type: "element",
      tag: "draw:circle",
      attributes: [
        { name: "svg:x", value: "200pt" },
        { name: "svg:y", value: "200pt" },
        { name: "svg:width", value: "40pt" },
        { name: "svg:height", value: "40pt" },
      ],
      children: [],
    };
    drawPage.children.push(circle);

    // odf.js's own reader recognises the injected draw:circle (salvaged as an 'ellipse'-kind ContentVector); OdgPage.vectors() still only recognises the original rect, so the two arrays now disagree in length for this page.
    const liveVectorCount = doc.editor.pages()[0]?.vectors().length;
    expect(liveVectorCount).toBe(1);

    const items = buildPageItems(doc, 0);
    const vectorItems = items.filter((item) => item.kind === "vector");
    expect(vectorItems).toHaveLength(2);
    for (const item of vectorItems) {
      expect(item.liveVector).toBeUndefined();
    }
  });

  // The parity failure above is scoped to the one page that actually mismatches -- a second page whose own vectors all line up still gets live handles, proving `buildPageItems` re-checks parity per page rather than once for the whole document.
  it("does not let a mismatch on one page fall back the parity check on another", () => {
    const editor = createOdg();
    const mismatchingPage = editor.addPage();
    mismatchingPage.addRect({
      frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 30 },
    });
    const matchingPage = editor.addPage();
    matchingPage.addEllipse({
      frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 30 },
    });

    const doc = openOdgDocument(editor.toBytes());
    const pkg = doc.editor.toPackage();
    const root = rootElement(pkg.parts["content.xml"]);
    if (root === undefined) {
      throw new Error("expected a content.xml root element");
    }
    const [firstDrawPage] = elementsWithTag([root], "draw:page");
    if (firstDrawPage === undefined) {
      throw new Error("expected a draw:page element");
    }
    firstDrawPage.children.push({
      type: "element",
      tag: "draw:circle",
      attributes: [
        { name: "svg:x", value: "200pt" },
        { name: "svg:y", value: "200pt" },
        { name: "svg:width", value: "40pt" },
        { name: "svg:height", value: "40pt" },
      ],
      children: [],
    });

    const mismatchingItems = buildPageItems(doc, 0).filter(
      (item) => item.kind === "vector",
    );
    expect(
      mismatchingItems.every((item) => item.liveVector === undefined),
    ).toBe(true);

    const matchingItems = buildPageItems(doc, 1).filter(
      (item) => item.kind === "vector",
    );
    expect(matchingItems).toHaveLength(1);
    expect(matchingItems[0]?.liveVector).toBeDefined();
  });
});
