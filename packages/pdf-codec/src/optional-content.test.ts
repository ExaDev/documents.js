import { describe, expect, it } from "vitest";
import type { PdfDiagnostic } from "./diagnostics";
import type { PdfObjectResolver } from "./interpret";
import type { LayoutText } from "./layout";
import { readOptionalContent } from "./optional-content";
import type { PdfDict, PdfObject } from "./objects";
import { asDict, pdfArray, pdfDict, pdfLiteralString, pdfRef } from "./objects";
import { readPdf } from "./read";
import { ocgPdf } from "./test-support/pdf";

// A resolver over a plain ref-number -> object table, matching interpret.test.ts's/navigation.test.ts's own makeResolver.
function makeResolver(
  objects = new Map<number, PdfObject>(),
): PdfObjectResolver {
  const resolve = (obj: PdfObject | undefined): PdfObject | undefined =>
    obj?.kind === "ref" ? objects.get(obj.num) : obj;
  const resolveDict = (obj: PdfObject | undefined): PdfDict | undefined =>
    asDict(resolve(obj));
  return { resolve, resolveDict };
}

function collectDiagnostics(): {
  readonly sink: (d: PdfDiagnostic) => void;
  readonly diagnostics: PdfDiagnostic[];
} {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (d) => diagnostics.push(d), diagnostics };
}

function str(text: string): PdfObject {
  return pdfLiteralString(new TextEncoder().encode(text));
}

// Optional content (#721 phase 3): /OCProperties groups with the default configuration's visibility state, /OC membership from BDC spans (both the named-property-list and inline-dict forms) stamped onto extracted items as a layer name, and /ActualText from a marked-content property dict. The visibility state is what fixes the active bug the issue names: content an author placed in an OFF layer no longer extracts as if unconditionally visible -- the membership is now on the item for a consumer to act on.

describe("readPdf: optional content groups", () => {
  it("reads each OCG with its name and default-configuration visibility", () => {
    const doc = readPdf(ocgPdf());
    expect(doc.layers).toEqual([
      { name: "Background", visible: false },
      { name: "Notes", visible: true },
    ]);
  });

  it("stamps items inside a /OC BDC span with the layer name, in both property-list forms", () => {
    const doc = readPdf(ocgPdf());
    const texts = doc.pages[0]!.items.filter(
      (i): i is LayoutText => i.kind === "text",
    ).map((t) => ({
      text: t.text,
      ...(t.layer !== undefined ? { layer: t.layer } : {}),
    }));
    expect(texts).toEqual([
      { text: "Visible text" },
      { text: "Hidden layer text", layer: "Background" },
      { text: "Form text", layer: "Background" },
      { text: "Annotated text", layer: "Notes" },
      { text: "Owned form text", layer: "Notes" },
    ]);
  });

  it("reads /ActualText from a marked-content property dict onto the span's text items", () => {
    const doc = readPdf(ocgPdf());
    const annotated = doc.pages[0]!.items.find(
      (i) => i.kind === "text" && i.text === "Annotated text",
    );
    expect(annotated).toMatchObject({ actualText: "Replacement reading" });
  });

  it("carries the outer span's layer into a form XObject's items", () => {
    const doc = readPdf(ocgPdf());
    const formText = doc.pages[0]!.items.find(
      (i) => i.kind === "text" && i.text === "Form text",
    );
    expect(formText).toMatchObject({ layer: "Background" });
  });

  it("applies a form XObject's own /OC over the outer span for its items", () => {
    const doc = readPdf(ocgPdf());
    const ownedFormText = doc.pages[0]!.items.find(
      (i) => i.kind === "text" && i.text === "Owned form text",
    );
    expect(ownedFormText).toMatchObject({ layer: "Notes" });
  });
});

describe("readOptionalContent, driven directly against a synthetic catalog", () => {
  it("reports and skips an /OCGs entry that does not resolve to a dictionary", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const catalog = pdfDict({
      OCProperties: pdfDict({
        // Object 99 is never in the resolver's own table, so this ref resolves to nothing.
        OCGs: pdfArray([pdfRef(99, 0)]),
      }),
    });
    const context = readOptionalContent(catalog, makeResolver(), sink);
    expect(context.layers).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toEqual({
      code: "pdf/ocg-unresolved",
      severity: "warning",
      message:
        "an entry in /OCProperties /OCGs did not resolve to a dictionary; skipping it",
    });
  });

  it("mints the next free layerN name, skipping one a real /Name already claimed", () => {
    // Group 1 carries a real /Name of "layer1"; group 2 carries no /Name at all, so mintLayerName must skip the already-taken "layer1" and mint "layer2" -- landing on "layer1" a second time (an unmutated loop that never advances n, or a broken template literal) would collide two distinct OCGs onto the same layer name.
    const namedGroup = pdfDict({ Name: str("layer1") });
    const unnamedGroup = pdfDict({});
    const objects = new Map<number, PdfObject>([
      [1, namedGroup],
      [2, unnamedGroup],
    ]);
    const catalog = pdfDict({
      OCProperties: pdfDict({
        OCGs: pdfArray([pdfRef(1, 0), pdfRef(2, 0)]),
      }),
    });
    const { sink } = collectDiagnostics();
    const context = readOptionalContent(catalog, makeResolver(objects), sink);
    expect(context.layers.map((l) => l.name)).toEqual(["layer1", "layer2"]);
  });
});
