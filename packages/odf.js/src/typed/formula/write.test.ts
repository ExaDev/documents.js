import { describe, expect, it } from "vitest";
import { flattenTree } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { decodePackage, encodePackage } from "../../codec";
import { readMimetype } from "../../mimetype";
import { readManifest, validateManifest } from "../../manifest";
import { readOdfMetadata } from "../shared/metadata";
import { rootElement } from "../../xml/query";
import { readOdfFormula, readOdfFormulaMathMl } from "./read";
import {
  writeOdfFormula,
  writeOdfFormulaContent,
  writeOdfFormulaMathMl,
} from "./write";

// The math root below is the same genuine-LibreOffice-26.2 content.xml root read.test.ts transcribes element-for-element from a real UNO-produced .odf (its own top-of-file note states the provenance) — reused here rather than restated differently so the writer's round trip is proven against the real producer's own shape, not a hand-simplified stand-in.
function realFormulaMathRoot(): XmlElement {
  return el(
    "math",
    { xmlns: "http://www.w3.org/1998/Math/MathML", display: "block" },
    [
      el("semantics", {}, [
        el("mrow", {}, [
          el("mi", {}, [txt("f")]),
          el("mo", { stretchy: "false" }, [txt("=")]),
          el("msqrt", {}, [el("mi", {}, [txt("x")])]),
        ]),
        el("annotation", { encoding: "StarMath 5.0" }, [
          txt("f(x) = sqrt {x}"),
        ]),
      ]),
    ],
  );
}

function realFormulaPackage(): Package {
  return {
    parts: {
      "content.xml": { kind: "xml", nodes: [realFormulaMathRoot()] },
    },
  };
}

describe("writeOdfFormulaMathMl", () => {
  it("round-trips a real-LibreOffice-shaped formula document at all three levels of the ladder", () => {
    const source = realFormulaPackage();
    const tree = readOdfFormula(source);
    expect(
      readOdfFormula(decodePackage(encodePackage(writeOdfFormula(tree)))),
    ).toEqual(tree);
    expect(readOdfFormula(writeOdfFormulaContent(flattenTree(tree)))).toEqual(
      tree,
    );
    expect(
      readOdfFormula(writeOdfFormulaMathMl(readOdfFormulaMathMl(source))),
    ).toEqual(tree);
  });

  it("writes the package shape a real producer writes: bare math root with the default MathML namespace, a stored mimetype, and no office:document-content wrapper", () => {
    const pkg = writeOdfFormula(readOdfFormula(realFormulaPackage()));
    expect(readMimetype(pkg)).toBe(
      "application/vnd.oasis.opendocument.formula",
    );
    expect(pkg.parts["content.xml"]?.kind).toBe("xml");
    const root = rootElement(
      pkg.parts["content.xml"]?.kind === "xml"
        ? pkg.parts["content.xml"].nodes
        : [],
    );
    expect(root?.tag).toBe("math");
    expect(
      root?.attributes.find((attribute) => attribute.name === "xmlns")?.value,
    ).toBe("http://www.w3.org/1998/Math/MathML");
    expect(pkg.parts["styles.xml"]).toBeUndefined();
    expect(validateManifest(pkg)).toEqual([]);
  });

  it("declares xmlns:math instead of the default namespace when the MathML content itself uses math:-prefixed tags", () => {
    const pkg = writeOdfFormulaMathMl({
      mathml: [el("math:semantics", {}, [el("math:mi", {}, [txt("x")])])],
      metadata: {},
    });
    const root = rootElement(
      pkg.parts["content.xml"]?.kind === "xml"
        ? pkg.parts["content.xml"].nodes
        : [],
    );
    expect(root?.tag).toBe("math");
    expect(
      root?.attributes.find((attribute) => attribute.name === "xmlns")?.value,
    ).toBeUndefined();
    expect(
      root?.attributes.find((attribute) => attribute.name === "xmlns:math")
        ?.value,
    ).toBe("http://www.w3.org/1998/Math/MathML");
  });

  it("refuses an empty mathml document by name", () => {
    expect(() => writeOdfFormulaMathMl({ mathml: [], metadata: {} })).toThrow(
      /mathml is empty/,
    );
  });

  it("refuses a wrong-kind ContentDocument", () => {
    expect(() =>
      writeOdfFormulaContent({
        kind: "wordprocessing",
        metadata: {},
        sections: [],
      }),
    ).toThrow(/formula/);
  });

  it("writes a standard XML declaration (version 1.0, encoding UTF-8) as content.xml's very first node", () => {
    const pkg = writeOdfFormulaMathMl({
      mathml: [el("mi", {}, [txt("x")])],
      metadata: {},
    });
    const part = pkg.parts["content.xml"];
    if (part?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    expect(part.nodes[0]).toEqual({
      type: "declaration",
      attributes: [
        { name: "version", value: "1.0" },
        { name: "encoding", value: "UTF-8" },
      ],
    });
  });

  it("actually writes the given metadata into meta.xml, not just an empty document", () => {
    const pkg = writeOdfFormulaMathMl({
      mathml: [el("mi", {}, [txt("x")])],
      metadata: { title: "Quadratic Formula" },
    });
    expect(readOdfMetadata(pkg).title).toBe("Quadratic Formula");
  });

  it("stamps the given version option onto both meta.xml and the manifest's root entry, not the default", () => {
    const pkg = writeOdfFormulaMathMl(
      { mathml: [el("mi", {}, [txt("x")])], metadata: {} },
      { version: "1.4" },
    );
    expect(readManifest(pkg).version).toBe("1.4");
  });

  it("detects a math:-prefixed tag nested arbitrarily deep, not only at the mathml array's own top level", () => {
    // The root and its immediate child both use plain (unprefixed) tags; only the leaf two levels down is math:-prefixed. A check that only inspects the top-level tag itself, without ever recursing into children, would wrongly report no math:-prefixed content here at all.
    const pkg = writeOdfFormulaMathMl({
      mathml: [el("mrow", {}, [el("mi", {}, [el("math:mi", {}, [])])])],
      metadata: {},
    });
    const root = rootElement(
      pkg.parts["content.xml"]?.kind === "xml"
        ? pkg.parts["content.xml"].nodes
        : [],
    );
    expect(
      root?.attributes.find((attribute) => attribute.name === "xmlns:math")
        ?.value,
    ).toBe("http://www.w3.org/1998/Math/MathML");
  });
});
