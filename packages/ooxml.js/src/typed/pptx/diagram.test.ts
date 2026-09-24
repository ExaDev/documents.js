import { describe, expect, it } from "vitest";
import { el, txt } from "../../xml/fragment";
import { readDiagramResidue, readDiagramText } from "./diagram";

function txBody(...paragraphs: readonly ReturnType<typeof el>[]) {
  return el("dgm:t", {}, paragraphs);
}

function run(text: string) {
  return el("a:r", {}, [el("a:t", {}, [txt(text)])]);
}

function pt(
  modelId: string,
  type: string | undefined,
  body?: ReturnType<typeof txBody>,
) {
  return el(
    "dgm:pt",
    type === undefined ? { modelId } : { modelId, type },
    body === undefined ? [] : [body],
  );
}

function cxn(
  srcId: string,
  destId: string,
  opts: Readonly<{ type?: string; srcOrd?: string }> = {},
) {
  const attrs: Record<string, string> = { srcId, destId };
  if (opts.type !== undefined) {
    attrs.type = opts.type;
  }
  if (opts.srcOrd !== undefined) {
    attrs.srcOrd = opts.srcOrd;
  }
  return el("dgm:cxn", attrs);
}

function dataModel(
  points: readonly ReturnType<typeof pt>[],
  cxns: readonly ReturnType<typeof cxn>[] = [],
) {
  return el("dgm:dataModel", {}, [
    el("dgm:ptLst", {}, points),
    el("dgm:cxnLst", {}, cxns),
  ]);
}

describe("readDiagramText", () => {
  it("returns no paragraphs when the data model has no <dgm:ptLst> at all", () => {
    expect(readDiagramText(el("dgm:dataModel"))).toEqual([]);
  });

  it("returns no paragraphs when no point is typed 'doc'", () => {
    const model = dataModel([
      pt("1", "node", txBody(el("a:p", {}, [run("hi")]))),
    ]);
    expect(readDiagramText(model)).toEqual([]);
  });

  it("reads a single node's own text as a paragraph, walked from the doc root", () => {
    const model = dataModel(
      [
        pt("doc", "doc"),
        pt("n1", "node", txBody(el("a:p", {}, [run("Hello")]))),
      ],
      [cxn("doc", "n1")],
    );
    expect(readDiagramText(model)).toEqual([
      { kind: "paragraph", origin: "diagram", runs: [{ text: "Hello" }] },
    ]);
  });

  it("reads an 'asst' point's text just like a 'node' point", () => {
    const model = dataModel(
      [
        pt("doc", "doc"),
        pt("n1", "asst", txBody(el("a:p", {}, [run("Aside")]))),
      ],
      [cxn("doc", "n1")],
    );
    expect(readDiagramText(model)).toEqual([
      { kind: "paragraph", origin: "diagram", runs: [{ text: "Aside" }] },
    ]);
  });

  it("skips a parTrans/sibTrans/pres point's text — only node and asst carry real content", () => {
    const model = dataModel(
      [
        pt("doc", "doc"),
        pt("n1", "parTrans", txBody(el("a:p", {}, [run("connector text")]))),
      ],
      [cxn("doc", "n1")],
    );
    expect(readDiagramText(model)).toEqual([]);
  });

  it("reads an a:fld the same way as an a:r", () => {
    const model = dataModel(
      [
        pt("doc", "doc"),
        pt(
          "n1",
          "node",
          txBody(
            el("a:p", {}, [
              el("a:fld", {}, [el("a:t", {}, [txt("Field text")])]),
            ]),
          ),
        ),
      ],
      [cxn("doc", "n1")],
    );
    expect(readDiagramText(model)).toEqual([
      { kind: "paragraph", origin: "diagram", runs: [{ text: "Field text" }] },
    ]);
  });

  it("reads a run with no <a:t> as empty text, not a crash", () => {
    const model = dataModel(
      [pt("doc", "doc"), pt("n1", "node", txBody(el("a:p", {}, [el("a:r")])))],
      [cxn("doc", "n1")],
    );
    // The node has one run whose text is "" — since no run is non-empty, the paragraph is dropped entirely (see the "only pushes paragraphs" test below), so this specific node contributes nothing.
    expect(readDiagramText(model)).toEqual([]);
  });

  it("contributes nothing for a paragraph child that is neither a:r/a:fld nor a:br", () => {
    const model = dataModel(
      [
        pt(
          "n1",
          "node",
          txBody(el("a:p", {}, [run("real"), el("a:endParaRPr"), run("text")])),
        ),
        pt("doc", "doc"),
      ],
      [cxn("doc", "n1")],
    );
    expect(readDiagramText(model)).toEqual([
      {
        kind: "paragraph",
        origin: "diagram",
        runs: [{ text: "real" }, { text: "text" }],
      },
    ]);
  });

  it("reads an a:br as a literal newline run", () => {
    const model = dataModel(
      [
        pt(
          "n1",
          "node",
          txBody(el("a:p", {}, [run("line one"), el("a:br"), run("line two")])),
        ),
        pt("doc", "doc"),
      ],
      [cxn("doc", "n1")],
    );
    expect(readDiagramText(model)).toEqual([
      {
        kind: "paragraph",
        origin: "diagram",
        runs: [{ text: "line one" }, { text: "\n" }, { text: "line two" }],
      },
    ]);
  });

  it("keeps every paragraph of a node once ANY of its runs is non-empty, blank paragraphs included", () => {
    const model = dataModel(
      [
        pt("doc", "doc"),
        pt(
          "n1",
          "node",
          txBody(el("a:p", {}, [run("")]), el("a:p", {}, [run("real text")])),
        ),
      ],
      [cxn("doc", "n1")],
    );
    expect(readDiagramText(model)).toEqual([
      { kind: "paragraph", origin: "diagram", runs: [{ text: "" }] },
      { kind: "paragraph", origin: "diagram", runs: [{ text: "real text" }] },
    ]);
  });

  it("drops a node whose runs are ALL empty text, contributing nothing", () => {
    const model = dataModel(
      [pt("doc", "doc"), pt("n1", "node", txBody(el("a:p", {}, [run("")])))],
      [cxn("doc", "n1")],
    );
    expect(readDiagramText(model)).toEqual([]);
  });

  it("orders siblings by srcOrd, not document order", () => {
    const model = dataModel(
      [
        pt("doc", "doc"),
        pt("n1", "node", txBody(el("a:p", {}, [run("first")]))),
        pt("n2", "node", txBody(el("a:p", {}, [run("second")]))),
      ],
      [cxn("doc", "n2", { srcOrd: "1" }), cxn("doc", "n1", { srcOrd: "0" })],
    );
    expect(readDiagramText(model).map((p) => p.runs[0]?.text)).toEqual([
      "first",
      "second",
    ]);
  });

  it("sorts a missing srcOrd as zero, ordering it before an explicit later one", () => {
    const model = dataModel(
      [
        pt("doc", "doc"),
        pt("n1", "node", txBody(el("a:p", {}, [run("no-ord")]))),
        pt("n2", "node", txBody(el("a:p", {}, [run("ord-5")]))),
      ],
      [cxn("doc", "n2", { srcOrd: "5" }), cxn("doc", "n1")],
    );
    expect(readDiagramText(model).map((p) => p.runs[0]?.text)).toEqual([
      "no-ord",
      "ord-5",
    ]);
  });

  it("walks depth-first: a child's own subtree is fully visited before its next sibling", () => {
    const model = dataModel(
      [
        pt("doc", "doc"),
        pt("n1", "node", txBody(el("a:p", {}, [run("n1")]))),
        pt("n1a", "node", txBody(el("a:p", {}, [run("n1a")]))),
        pt("n2", "node", txBody(el("a:p", {}, [run("n2")]))),
      ],
      [
        cxn("doc", "n1", { srcOrd: "0" }),
        cxn("doc", "n2", { srcOrd: "1" }),
        cxn("n1", "n1a", { srcOrd: "0" }),
      ],
    );
    expect(readDiagramText(model).map((p) => p.runs[0]?.text)).toEqual([
      "n1",
      "n1a",
      "n2",
    ]);
  });

  it("treats a cxn with no type attribute as parOf (its own ST_CxnType default)", () => {
    const model = dataModel(
      [pt("doc", "doc"), pt("n1", "node", txBody(el("a:p", {}, [run("x")])))],
      [cxn("doc", "n1")],
    );
    expect(readDiagramText(model)).toHaveLength(1);
  });

  it("skips a non-parOf cxn (presOf/presParOf), never walking through it", () => {
    const model = dataModel(
      [pt("doc", "doc"), pt("n1", "node", txBody(el("a:p", {}, [run("x")])))],
      [cxn("doc", "n1", { type: "presOf" })],
    );
    expect(readDiagramText(model)).toEqual([]);
  });

  it("skips a cxn missing srcId or destId", () => {
    const model = dataModel(
      [pt("doc", "doc"), pt("n1", "node", txBody(el("a:p", {}, [run("x")])))],
      [el("dgm:cxn", { srcId: "doc" }), el("dgm:cxn", { destId: "n1" })],
    );
    expect(readDiagramText(model)).toEqual([]);
  });

  it("skips a <dgm:pt> with no modelId, never registering it", () => {
    const model = dataModel([
      el("dgm:pt", { type: "doc" }, []),
      pt("n1", "node", txBody(el("a:p", {}, [run("x")]))),
    ]);
    // No modelId means no docModelId is ever set, so the walk never starts.
    expect(readDiagramText(model)).toEqual([]);
  });

  it("defaults an untyped point to 'node' (ST_PtType's own default)", () => {
    const model = dataModel(
      [
        pt("doc", "doc"),
        pt("n1", undefined, txBody(el("a:p", {}, [run("x")]))),
      ],
      [cxn("doc", "n1")],
    );
    expect(readDiagramText(model)).toEqual([
      { kind: "paragraph", origin: "diagram", runs: [{ text: "x" }] },
    ]);
  });

  it("never visits the same point twice, protecting against a self-referential or cyclic cxn graph", () => {
    const model = dataModel(
      [pt("doc", "doc"), pt("n1", "node", txBody(el("a:p", {}, [run("x")])))],
      [cxn("doc", "n1"), cxn("n1", "doc")],
    );
    // Without the visited guard this would recurse forever; with it, "x" is read exactly once.
    expect(readDiagramText(model)).toEqual([
      { kind: "paragraph", origin: "diagram", runs: [{ text: "x" }] },
    ]);
  });
});

describe("readDiagramResidue", () => {
  it("returns undefined when all three parts are absent", () => {
    expect(readDiagramResidue(undefined, undefined, undefined)).toBeUndefined();
  });

  it("quarantines whichever of layout/quickStyle/colours parts actually resolved, in that order", () => {
    const layout = el("dsp:dataModel", { id: "layout" });
    const colors = el("cs:colorsDefinition", { id: "colors" });
    const residue = readDiagramResidue(layout, undefined, colors);
    expect(residue?.format).toBe("pptx");
    const layoutIndex = residue?.xml.indexOf("layout") ?? -1;
    const colorsIndex = residue?.xml.indexOf("colors") ?? -1;
    expect(layoutIndex).toBeGreaterThanOrEqual(0);
    expect(colorsIndex).toBeGreaterThan(layoutIndex);
  });

  it("caches by the exact (layout, quickStyle, colors) triple's own identity", () => {
    const layout = el("dsp:dataModel");
    const quickStyle = el("qs:styleDefinition");
    const first = readDiagramResidue(layout, quickStyle, undefined);
    const second = readDiagramResidue(layout, quickStyle, undefined);
    expect(second).toBe(first);
  });

  it("does not collide two different triples sharing a partially-overlapping key", () => {
    const layout = el("dsp:dataModel");
    const colorsA = el("cs:colorsDefinition", { id: "a" });
    const colorsB = el("cs:colorsDefinition", { id: "b" });
    const residueA = readDiagramResidue(layout, undefined, colorsA);
    const residueB = readDiagramResidue(layout, undefined, colorsB);
    expect(residueA).not.toEqual(residueB);
  });
});
