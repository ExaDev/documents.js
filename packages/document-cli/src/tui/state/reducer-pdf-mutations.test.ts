import {
  createOdt,
  formulaOfBlock,
  type MathMlNode,
  openOdt,
  readOdtContent,
} from "documents.js";
import { describe, expect, it } from "vitest";
import { appReducer, createInitialState } from "./reducer.js";
import type { AppState, OdtOpenDocument } from "./types.js";
function odtDocument(state: AppState): OdtOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "odt") {
    throw new Error("expected an open odt document");
  }
  return doc;
}

function openOdtDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/doc.odt",
): AppState {
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "odt", editor: openOdt(bytes), path },
  });
}

describe("appReducer INSERT_ODT_FORMULA", () => {
  it("rebuilds an element/text tree as fresh mutable objects, and collapses cdata/comment/declaration/pi nodes to their documented empty stand-ins", () => {
    const opened = openOdtDocument(createOdt().toBytes());
    const mathml: MathMlNode[] = [
      {
        type: "element",
        tag: "mrow",
        attributes: [{ name: "class", value: "unit" }],
        children: [
          { type: "text", value: "a" },
          { type: "cdata" },
          { type: "comment" },
          { type: "declaration" },
          { type: "pi" },
        ],
      },
    ];
    const withFormula = appReducer(opened, {
      type: "INSERT_ODT_FORMULA",
      mathml,
      frame: { xPt: 0, yPt: 0, widthPt: 20, heightPt: 10 },
    });
    expect(withFormula.hasUnsavedChanges).toBe(true);

    const content = readOdtContent(odtDocument(withFormula).editor.toPackage());
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
    if (formula === undefined) {
      throw new Error("expected the embedded object to carry a formula");
    }
    const root = formula.mathml[0];
    if (root?.type !== "element") {
      throw new Error("expected the root node to survive as a real element");
    }
    expect(root.tag).toBe("mrow");
    expect(root.attributes).toStrictEqual([{ name: "class", value: "unit" }]);
    expect(root.children).toStrictEqual([
      { type: "text", value: "a" },
      { type: "cdata", value: "" },
      { type: "comment", value: "" },
      { type: "declaration", attributes: [] },
      { type: "pi", target: "", content: "" },
    ]);
  });

  it("warns rather than crashing when the open document is not odt", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "INSERT_ODT_FORMULA",
      mathml: [{ type: "element", tag: "mi", attributes: [], children: [] }],
      frame: { xPt: 0, yPt: 0, widthPt: 20, heightPt: 10 },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("an odt document");
  });
});
