import { describe, expect, it } from "vitest";
import { NOOP_DIAGNOSTIC_SINK } from "./diagnostics";
import type { PdfDiagnosticSink } from "./diagnostics";
import { walkNameTree } from "./names";
import type { PdfDict, PdfObject } from "./objects";
import { pdfArray, pdfDict, pdfName, pdfNum, pdfRef } from "./objects";

// The names-tree walker (ISO 32000-1 7.9.6): flattens a name tree's /Names pairs across /Kids recursion into one ordered entry list. This is the hard prerequisite the #721 verdict calls out -- one walker serves destinations, embedded files, and any later names-tree tenant (JavaScript names, etc.). Tests build synthetic PdfObject trees with an in-memory resolver so the walker's own structural rules (recursion, ordering, cycle safety, non-dict handling) are pinned independently of any full-document fixture.

function resolverOf(objects: Map<number, PdfObject>) {
  return {
    resolve(obj: PdfObject | undefined): PdfObject | undefined {
      return obj?.kind === "ref" ? objects.get(obj.num) : obj;
    },
    resolveDict(obj: PdfObject | undefined): PdfDict | undefined {
      const resolved = this.resolve(obj);
      return resolved?.kind === "dict" ? resolved : undefined;
    },
  };
}

function stringObj(text: string): PdfObject {
  return { kind: "string", bytes: new TextEncoder().encode(text), hex: false };
}

describe("walkNameTree", () => {
  it("returns the name/value pairs of a leaf node in order", () => {
    const root = pdfDict({
      Names: pdfArray([
        stringObj("alpha"),
        pdfNum(1),
        stringObj("beta"),
        pdfNum(2),
      ]),
    });
    const entries = walkNameTree(
      root,
      resolverOf(new Map()),
      NOOP_DIAGNOSTIC_SINK,
    );
    expect(entries).toEqual([
      { name: "alpha", value: { kind: "number", value: 1 } },
      { name: "beta", value: { kind: "number", value: 2 } },
    ]);
  });

  it("flattens a Kids chain of intermediate nodes depth-first, preserving document order", () => {
    const kidA = pdfDict({ Names: pdfArray([stringObj("a1"), pdfNum(1)]) });
    const kidB = pdfDict({
      Names: pdfArray([stringObj("b1"), pdfNum(2), stringObj("b2"), pdfNum(3)]),
    });
    const root = pdfDict({ Kids: pdfArray([kidA, kidB]) });
    const entries = walkNameTree(
      root,
      resolverOf(new Map()),
      NOOP_DIAGNOSTIC_SINK,
    );
    expect(entries.map((e) => e.name)).toEqual(["a1", "b1", "b2"]);
  });

  it("resolves indirect references to intermediate nodes", () => {
    const kid = pdfDict({
      Names: pdfArray([stringObj("nested"), pdfName("value")]),
    });
    const root = pdfDict({ Kids: pdfArray([pdfRef(7, 0)]) });
    const entries = walkNameTree(
      root,
      resolverOf(new Map([[7, kid]])),
      NOOP_DIAGNOSTIC_SINK,
    );
    expect(entries).toEqual([
      { name: "nested", value: { kind: "name", name: "value" } },
    ]);
  });

  it("mixes a node's own /Names with its /Kids after them, matching the spec's ordering rule", () => {
    const kid = pdfDict({ Names: pdfArray([stringObj("kid"), pdfNum(2)]) });
    const root = pdfDict({
      Names: pdfArray([stringObj("own"), pdfNum(1)]),
      Kids: pdfArray([kid]),
    });
    const entries = walkNameTree(
      root,
      resolverOf(new Map()),
      NOOP_DIAGNOSTIC_SINK,
    );
    expect(entries.map((e) => e.name)).toEqual(["own", "kid"]);
  });

  it("reports a warning and stops descent at a cycle", () => {
    const diagnostics: string[] = [];
    const sink: PdfDiagnosticSink = (d) => diagnostics.push(d.code);
    const root = pdfDict({});
    root.entries.set("Kids", pdfArray([root]));
    const entries = walkNameTree(root, resolverOf(new Map()), sink);
    expect(entries).toEqual([]);
    expect(diagnostics).toEqual(["pdf/name-tree-cycle"]);
  });

  it("reports a warning for a node that is not a dictionary and skips it", () => {
    const diagnostics: string[] = [];
    const sink: PdfDiagnosticSink = (d) => diagnostics.push(d.code);
    const root = pdfDict({ Kids: pdfArray([pdfNum(42)]) });
    const entries = walkNameTree(root, resolverOf(new Map()), sink);
    expect(entries).toEqual([]);
    expect(diagnostics).toEqual(["pdf/name-tree-node-invalid"]);
  });

  it("ignores a trailing name with no value pair rather than reading past the array", () => {
    const root = pdfDict({
      Names: pdfArray([stringObj("paired"), pdfNum(1), stringObj("dangling")]),
    });
    const entries = walkNameTree(
      root,
      resolverOf(new Map()),
      NOOP_DIAGNOSTIC_SINK,
    );
    expect(entries).toEqual([
      { name: "paired", value: { kind: "number", value: 1 } },
    ]);
  });

  it("skips a pair whose key is not a PDF string", () => {
    const root = pdfDict({
      Names: pdfArray([
        pdfName("not-a-string"),
        pdfNum(1),
        stringObj("real"),
        pdfNum(2),
      ]),
    });
    const entries = walkNameTree(
      root,
      resolverOf(new Map()),
      NOOP_DIAGNOSTIC_SINK,
    );
    expect(entries).toEqual([
      { name: "real", value: { kind: "number", value: 2 } },
    ]);
  });

  it("returns no entries for an absent root", () => {
    expect(
      walkNameTree(undefined, resolverOf(new Map()), NOOP_DIAGNOSTIC_SINK),
    ).toEqual([]);
  });
});
