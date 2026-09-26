import {
  createOdg,
  createOdp,
  drawingOfBlock,
  formulaOfBlock,
  type MathMlNode,
  openOdg,
  openOdp,
  readDocxContent,
  readOdpContent,
} from "documents.js";
import { describe, expect, it } from "vitest";
import type { Action } from "./actions.js";
import { appReducer, createInitialState } from "./reducer.js";
import type {
  AppState,
  DocxOpenDocument,
  OdgOpenDocument,
  OdpOpenDocument,
} from "./types.js";
function applyAll(
  actions: readonly Action[],
  from: AppState = createInitialState(),
): AppState {
  return actions.reduce<AppState>(appReducer, from);
}

function docxDocument(state: AppState): DocxOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "docx") {
    throw new Error("expected an open docx document");
  }
  return doc;
}

function odpDocument(state: AppState): OdpOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "odp") {
    throw new Error("expected an open odp document");
  }
  return doc;
}

function odgDocument(state: AppState): OdgOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "odg") {
    throw new Error("expected an open odg document");
  }
  return doc;
}

function openOdpDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/deck.odp",
): AppState {
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "odp", editor: openOdp(bytes), path },
  });
}

function openOdgDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/drawing.odg",
): AppState {
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "odg", editor: openOdg(bytes), path },
  });
}

describe("appReducer INSERT_DOCX_FORMULA", () => {
  it("writes a real OMML equation, read back as an embedded formula block through readDocxContent", () => {
    const state = applyAll([
      { type: "CREATE_DOCUMENT", format: "docx" },
      {
        type: "APPEND_PARAGRAPH",
        text: undefined,
        styleId: undefined,
        alignment: undefined,
      },
    ]);
    const mathml: MathMlNode[] = [
      {
        type: "element",
        tag: "mi",
        attributes: [],
        children: [{ type: "text", value: "x" }],
      },
    ];
    const withFormula = appReducer(state, {
      type: "INSERT_DOCX_FORMULA",
      blockIndex: 0,
      mathml,
    });
    expect(withFormula.hasUnsavedChanges).toBe(true);
    expect(withFormula.status?.severity).not.toBe("warning");

    const content = readDocxContent(
      docxDocument(withFormula).editor.toPackage(),
    );
    if (content.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing ContentDocument, got ${content.kind}`,
      );
    }
    const block = content.sections
      .flatMap((section) => section.blocks)
      .find((candidate) => candidate.kind === "embeddedObject");
    if (block?.kind !== "embeddedObject") {
      throw new Error("expected an embedded formula block");
    }
    const formula = formulaOfBlock(block);
    expect(formula?.mathml[0]).toStrictEqual({
      type: "element",
      tag: "mi",
      attributes: [],
      children: [{ type: "text", value: "x" }],
    });
  });

  it("warns instead of writing an empty paragraph when the formula produces no OMML content", () => {
    const state = applyAll([
      { type: "CREATE_DOCUMENT", format: "docx" },
      {
        type: "APPEND_PARAGRAPH",
        text: undefined,
        styleId: undefined,
        alignment: undefined,
      },
    ]);
    const withFormula = appReducer(state, {
      type: "INSERT_DOCX_FORMULA",
      blockIndex: 0,
      mathml: [],
    });
    expect(withFormula.status?.severity).toBe("warning");
    expect(withFormula.status?.text).toBe(
      "The formula produced no OMML content and was not written",
    );

    const content = readDocxContent(
      docxDocument(withFormula).editor.toPackage(),
    );
    if (content.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing ContentDocument, got ${content.kind}`,
      );
    }
    expect(
      content.sections
        .flatMap((section) => section.blocks)
        .some((candidate) => candidate.kind === "embeddedObject"),
    ).toBe(false);
  });

  it("warns rather than crashing for a paragraph index that does not exist", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "INSERT_DOCX_FORMULA",
      blockIndex: 7,
      mathml: [{ type: "element", tag: "mi", attributes: [], children: [] }],
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no paragraph at index 7");
  });

  it("warns rather than crashing when the open document is not docx", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "odt",
    });
    const result = appReducer(created, {
      type: "INSERT_DOCX_FORMULA",
      blockIndex: 0,
      mathml: [{ type: "element", tag: "mi", attributes: [], children: [] }],
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("a docx document");
  });
});

describe("appReducer ADD_RECT / ADD_ELLIPSE / ADD_LINE / ADD_PATH on odp", () => {
  it("adds each real vector kind to an odp slide, reachable through OdpSlide.addVector — recovered by readOdpContent as a synthetic embedded drawing block, since ContentSlide itself has no vectors array", () => {
    const editor = createOdp();
    editor.addSlide();
    const opened = openOdpDocument(editor.toBytes());

    const withRect = appReducer(opened, {
      type: "ADD_RECT",
      containerIndex: 0,
      init: {
        frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 30 },
        fill: { r: 1, g: 0, b: 0 },
      },
    });
    const withEllipse = appReducer(withRect, {
      type: "ADD_ELLIPSE",
      containerIndex: 0,
      init: { frame: { xPt: 60, yPt: 10, widthPt: 40, heightPt: 30 } },
    });
    const withLine = appReducer(withEllipse, {
      type: "ADD_LINE",
      containerIndex: 0,
      init: {
        from: { xPt: 0, yPt: 100 },
        to: { xPt: 100, yPt: 100 },
        stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
      },
    });
    const withPath = appReducer(withLine, {
      type: "ADD_PATH",
      containerIndex: 0,
      init: {
        frame: { xPt: 0, yPt: 150, widthPt: 50, heightPt: 50 },
        subpaths: [
          {
            start: { xPt: 0, yPt: 50 },
            segments: [
              { kind: "line", to: { xPt: 25, yPt: 0 } },
              { kind: "line", to: { xPt: 50, yPt: 50 } },
            ],
            closed: true,
          },
        ],
      },
    });
    expect(withPath.hasUnsavedChanges).toBe(true);

    const content = readOdpContent(odpDocument(withPath).editor.toPackage());
    if (content.kind !== "presentation") {
      throw new Error(
        `expected a presentation ContentDocument, got ${content.kind}`,
      );
    }
    const drawingShape = content.slides[0]?.shapes.find(
      (shape) => shape.blocks[0]?.kind === "embeddedObject",
    );
    const drawingBlock = drawingShape?.blocks[0];
    if (drawingBlock?.kind !== "embeddedObject") {
      throw new Error(
        "expected a synthetic embeddedObject shape carrying the four recovered vectors",
      );
    }
    const drawing = drawingOfBlock(drawingBlock);
    if (drawing === undefined) {
      throw new Error("expected the embedded object to be a drawing document");
    }
    expect(drawing.pages[0]?.vectors.map((vector) => vector.kind)).toEqual([
      "rect",
      "ellipse",
      "line",
      "path",
    ]);
  });

  it("warns rather than crashing for a slide index that does not exist", () => {
    const editor = createOdp();
    editor.addSlide();
    const opened = openOdpDocument(editor.toBytes());

    const result = appReducer(opened, {
      type: "ADD_RECT",
      containerIndex: 5,
      init: { frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 } },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no slide at index 5");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns rather than crashing when the open document is neither odg nor odp", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "ADD_RECT",
      containerIndex: 0,
      init: { frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 } },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("odg or odp");
  });

  // The rename of this action family's own addressing field from `pageIndex` to `containerIndex` (see actions.ts's own top-of-file note) must not have disturbed odg's own pre-existing behaviour.
  it("still adds a real vector to an odg page, unchanged from before the containerIndex rename", () => {
    const editor = createOdg();
    editor.addPage();
    const opened = openOdgDocument(editor.toBytes());

    const withRect = appReducer(opened, {
      type: "ADD_RECT",
      containerIndex: 0,
      init: { frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 30 } },
    });
    expect(withRect.hasUnsavedChanges).toBe(true);
    const vectors = odgDocument(withRect).editor.pages()[0]?.vectors();
    expect(vectors).toHaveLength(1);
    // A rect and an ellipse share the identical OdgBoxVectorInit shape (frame/fill/stroke), so a mutation that lets ADD_RECT's own case fall through into ADD_ELLIPSE's addEllipse call would still add exactly one vector — just the wrong kind. The length check above alone cannot catch that.
    expect(vectors?.[0]?.kind).toBe("rect");
  });

  // The odg branch dispatches through its own inner switch (addRect/addEllipse/addLine/addPath), one case per real OdgPage method — distinct from the ADD_RECT/ADD_ELLIPSE/ADD_LINE/ADD_PATH coverage above, which only ever reaches odg via ADD_RECT. Each case is its own switch-statement mutant, so proving the rect case works says nothing about whether removing the ellipse/line/path cases would still pass.
  it("adds each real vector kind to an odg page via the page's own addEllipse/addLine/addPath", () => {
    const editor = createOdg();
    editor.addPage();
    const opened = openOdgDocument(editor.toBytes());

    const withEllipse = appReducer(opened, {
      type: "ADD_ELLIPSE",
      containerIndex: 0,
      init: { frame: { xPt: 60, yPt: 10, widthPt: 40, heightPt: 30 } },
    });
    const withLine = appReducer(withEllipse, {
      type: "ADD_LINE",
      containerIndex: 0,
      init: {
        from: { xPt: 0, yPt: 100 },
        to: { xPt: 100, yPt: 100 },
        stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
      },
    });
    const withPath = appReducer(withLine, {
      type: "ADD_PATH",
      containerIndex: 0,
      init: {
        frame: { xPt: 0, yPt: 150, widthPt: 50, heightPt: 50 },
        subpaths: [
          {
            start: { xPt: 0, yPt: 50 },
            segments: [{ kind: "line", to: { xPt: 25, yPt: 0 } }],
            closed: false,
          },
        ],
      },
    });
    expect(withPath.hasUnsavedChanges).toBe(true);
    const vectors = odgDocument(withPath).editor.pages()[0]?.vectors();
    expect(vectors?.map((vector) => vector.kind)).toEqual([
      "ellipse",
      "line",
      "path",
    ]);
  });
});

describe("appReducer SET_VECTOR_FILL / SET_VECTOR_STROKE on odg", () => {
  it("edits a real rect vector's fill and stroke, and the change round-trips through re-decoding the package", () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addRect({
      frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 30 },
      fill: { r: 1, g: 0, b: 0 },
    });
    const opened = openOdgDocument(editor.toBytes());

    const liveVector = odgDocument(opened).editor.pages()[0]?.vectors()[0];
    if (liveVector === undefined || liveVector.kind === "line") {
      throw new Error("expected a rect vector");
    }

    const filled = appReducer(opened, {
      type: "SET_VECTOR_FILL",
      vector: liveVector,
      fill: { r: 0, g: 1, b: 0 },
    });
    expect(filled.hasUnsavedChanges).toBe(true);
    // The live view means the vector object captured before the action already reflects the mutation.
    expect(liveVector.fill).toEqual({ r: 0, g: 1, b: 0 });

    const stroked = appReducer(filled, {
      type: "SET_VECTOR_STROKE",
      vector: liveVector,
      stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 2 },
    });
    expect(stroked.hasUnsavedChanges).toBe(true);
    expect(liveVector.stroke).toEqual({
      color: { r: 0, g: 0, b: 1 },
      widthPt: 2,
    });

    // Re-decoding the saved bytes as a completely fresh package proves both edits were written into the real draw:rect element, not just held on the live in-memory object.
    const reopened = openOdg(odgDocument(stroked).editor.toBytes());
    const reopenedVector = reopened.pages()[0]?.vectors()[0];
    if (reopenedVector === undefined || reopenedVector.kind === "line") {
      throw new Error("expected a rect vector after re-decoding");
    }
    expect(reopenedVector.fill).toEqual({ r: 0, g: 1, b: 0 });
    expect(reopenedVector.stroke).toEqual({
      color: { r: 0, g: 0, b: 1 },
      widthPt: 2,
    });
  });

  it("warns instead of mutating when the open document is the wrong format", () => {
    const editor = createOdg();
    const page = editor.addPage();
    const rect = page.addRect({
      frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 30 },
    });
    const state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });

    const result = appReducer(state, {
      type: "SET_VECTOR_FILL",
      vector: rect,
      fill: { r: 1, g: 1, b: 1 },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe(
      "That action needs an odg document; the open document is docx",
    );
    expect(result.hasUnsavedChanges).toBe(false);

    // SET_VECTOR_STROKE has its own, separate copy of the identical wrongDocument call — covering SET_VECTOR_FILL's above says nothing about this one.
    const strokeResult = appReducer(state, {
      type: "SET_VECTOR_STROKE",
      vector: rect,
      stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
    });
    expect(strokeResult.status?.severity).toBe("warning");
    expect(strokeResult.status?.text).toBe(
      "That action needs an odg document; the open document is docx",
    );
    expect(strokeResult.hasUnsavedChanges).toBe(false);
  });
});

describe("appReducer diagnostics and selection", () => {
  it("appends, dismisses and clears diagnostics", () => {
    const withTwo = applyAll([
      {
        type: "APPEND_DIAGNOSTIC",
        diagnostic: { severity: "info", message: "first" },
      },
      {
        type: "APPEND_DIAGNOSTIC",
        diagnostic: { severity: "warning", message: "second", pageIndex: 1 },
      },
    ]);
    expect(withTwo.diagnostics).toHaveLength(2);

    const dismissed = appReducer(withTwo, {
      type: "DISMISS_DIAGNOSTIC",
      index: 0,
    });
    expect(
      dismissed.diagnostics.map((diagnostic) => diagnostic.message),
    ).toEqual(["second"]);
    expect(
      appReducer(dismissed, { type: "CLEAR_DIAGNOSTICS" }).diagnostics,
    ).toEqual([]);
  });

  it("records a selection index per key", () => {
    const state = applyAll([
      { type: "SET_SELECTION", key: "bodyList", index: 4 },
      { type: "SET_SELECTION", key: "slideDetail:2", index: 1 },
    ]);
    expect(state.selection).toEqual({ bodyList: 4, "slideDetail:2": 1 });
  });
});
