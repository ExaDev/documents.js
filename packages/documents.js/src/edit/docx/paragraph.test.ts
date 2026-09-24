import type { XmlElement, XmlNode } from "ooxml.js";
import { attr, resolveRelationships, rootElement } from "ooxml.js";
import type { ContentVector } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { el } from "../../xml/fragment";
import type { MathMlNode } from "../../mathml/nodes";
import { createDocx } from "./editor";
import { buildParagraph, DocxParagraph } from "./paragraph";

function paragraphFromXml(): {
  container: XmlNode[];
  paragraph: DocxParagraph;
  paragraphElement: XmlElement;
} {
  const paragraphElement = el("w:p", {}, [
    el("w:r", {}, [el("w:t", {}, [{ type: "text", value: "Hello " }])]),
    el("w:r", {}, [el("w:t", {}, [{ type: "text", value: "world" }])]),
  ]);
  const container: XmlNode[] = [paragraphElement];
  return {
    container,
    paragraph: new DocxParagraph(container, paragraphElement),
    paragraphElement,
  };
}

describe("DocxParagraph.text and runs", () => {
  it("concatenates text across all runs", () => {
    const { paragraph } = paragraphFromXml();
    expect(paragraph.text).toBe("Hello world");
  });

  it("runs() returns one DocxRun per w:r in document order", () => {
    const { paragraph } = paragraphFromXml();
    const runs = paragraph.runs();
    expect(runs).toHaveLength(2);
    expect(runs[0]?.text).toBe("Hello ");
    expect(runs[1]?.text).toBe("world");
  });

  it("appendRun adds a run at the end", () => {
    const { paragraph } = paragraphFromXml();
    paragraph.appendRun({ text: "!" });
    expect(paragraph.text).toBe("Hello world!");
    expect(paragraph.runs()).toHaveLength(3);
  });

  it("insertRunAt inserts a run at the given run-index, not the raw child index", () => {
    const { paragraph } = paragraphFromXml();
    paragraph.insertRunAt(1, { text: "brave " });
    expect(paragraph.text).toBe("Hello brave world");
  });
});

describe("DocxParagraph styleId / alignment / list", () => {
  it("styleId defaults to undefined and can be set and cleared", () => {
    const { paragraph } = paragraphFromXml();
    expect(paragraph.styleId).toBeUndefined();
    paragraph.styleId = "Heading1";
    expect(paragraph.styleId).toBe("Heading1");
    paragraph.styleId = undefined;
    expect(paragraph.styleId).toBeUndefined();
  });

  it("alignment defaults to undefined and can be set to each value and cleared", () => {
    const { paragraph } = paragraphFromXml();
    expect(paragraph.alignment).toBeUndefined();
    for (const value of ["left", "center", "right", "justify"] as const) {
      paragraph.alignment = value;
      expect(paragraph.alignment).toBe(value);
    }
    paragraph.alignment = undefined;
    expect(paragraph.alignment).toBeUndefined();
  });

  it("list defaults to undefined and round-trips numId/level, and can be cleared", () => {
    const { paragraph } = paragraphFromXml();
    expect(paragraph.list).toBeUndefined();
    paragraph.list = { numId: "3", level: 2 };
    expect(paragraph.list).toEqual({ numId: "3", level: 2 });
    paragraph.list = undefined;
    expect(paragraph.list).toBeUndefined();
  });

  it("headingLevel defaults to undefined, stores as 0-based w:outlineLvl, and can be cleared", () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    expect(paragraph.headingLevel).toBeUndefined();
    paragraph.headingLevel = 2;
    // w:outlineLvl is 0-based where the schema's headingLevel is 1-based — the same +1 mapping ooxml.js's own docx reader applies on the way back in.
    const pPr = paragraphElement.children.find(
      (c): c is XmlElement => c.type === "element" && c.tag === "w:pPr",
    );
    const outlineLvl = pPr?.children.find(
      (c): c is XmlElement => c.type === "element" && c.tag === "w:outlineLvl",
    );
    expect(
      outlineLvl === undefined ? undefined : attr(outlineLvl, "w:val"),
    ).toBe("1");
    expect(paragraph.headingLevel).toBe(2);
    paragraph.headingLevel = undefined;
    expect(paragraph.headingLevel).toBeUndefined();
  });
});

describe("DocxParagraph.appendTab", () => {
  it("appends a w:tab element inside its own run, not a literal tab character in text", () => {
    const paragraphElement = el("w:p", {}, []);
    const paragraph = new DocxParagraph([paragraphElement], paragraphElement);
    paragraph.appendTab();
    const run = paragraphElement.children[0];
    if (run?.type !== "element" || run.tag !== "w:r") {
      throw new Error("expected a w:r child");
    }
    const tab = run.children[0];
    expect(tab?.type === "element" ? tab.tag : undefined).toBe("w:tab");
  });

  it("interleaves correctly between real runs, in document order", () => {
    const paragraphElement = el("w:p", {}, []);
    const paragraph = new DocxParagraph([paragraphElement], paragraphElement);
    paragraph.appendRun({ text: "before" });
    paragraph.appendTab();
    paragraph.appendRun({ text: "after" });
    const tags = paragraphElement.children.map((c) =>
      c.type === "element" ? c.tag : undefined,
    );
    expect(tags).toEqual(["w:r", "w:r", "w:r"]);
    expect(paragraph.text).toBe("beforeafter"); // w:tab contributes no text-content characters (ooxml.js's textContent has no WordprocessingML-specific knowledge of it) — its presence is verified structurally above
  });
});

describe("DocxParagraph.remove", () => {
  it("removes the paragraph from its container and throws on further use", () => {
    const { container, paragraph } = paragraphFromXml();
    paragraph.remove();
    expect(container).toHaveLength(0);
    expect(() => paragraph.text).toThrow(/removed/);
  });
});

describe("buildParagraph", () => {
  it("builds an empty paragraph with no properties", () => {
    const paragraphElement = buildParagraph();
    expect(paragraphElement.children).toHaveLength(0);
  });

  it("builds a paragraph with initial text, style, and alignment", () => {
    const paragraphElement = buildParagraph({
      text: "Title",
      styleId: "Heading1",
      alignment: "center",
    });
    const paragraph = new DocxParagraph([paragraphElement], paragraphElement);
    expect(paragraph.text).toBe("Title");
    expect(paragraph.styleId).toBe("Heading1");
    expect(paragraph.alignment).toBe("center");
  });
});

function mathmlOf(...tokens: string[]): MathMlNode[] {
  return tokens.map((token) => ({
    type: "element" as const,
    tag: /^[0-9.]+$/.test(token) ? "mn" : token === "+" ? "mo" : "mi",
    attributes: [],
    children: [{ type: "text" as const, value: token }],
  }));
}

function paragraphFromInit(pPrChildren: XmlElement[]): {
  paragraph: DocxParagraph;
  paragraphElement: XmlElement;
} {
  const paragraphElement = el("w:p", {}, [
    el("w:r", {}, [el("w:t", {}, [{ type: "text", value: "x" }])]),
    el("w:pPr", {}, pPrChildren),
  ]);
  return {
    paragraph: new DocxParagraph([paragraphElement], paragraphElement),
    paragraphElement,
  };
}

function onlyChildElement(
  parent: XmlElement | undefined,
  tag: string,
): XmlElement | undefined {
  return parent?.children.find(
    (c): c is XmlElement => c.type === "element" && c.tag === tag,
  );
}

function pPrOf(paragraphElement: XmlElement): XmlElement | undefined {
  return onlyChildElement(paragraphElement, "w:pPr");
}

function attrOf(
  element: XmlElement | undefined,
  name: string,
): string | undefined {
  return element === undefined ? undefined : attr(element, name);
}

// An editor-opened paragraph plus the live w:p element (the body's last one,
// since it was just appended).
function editorParagraph(): {
  editor: ReturnType<typeof createDocx>;
  paragraph: DocxParagraph;
  paragraphElement: XmlElement;
} {
  const editor = createDocx();
  const paragraph = editor.body.appendParagraph();
  const documentRoot = rootElement(
    editor.toPackage().parts["word/document.xml"],
  );
  const body = documentRoot && onlyChildElement(documentRoot, "w:body");
  const paragraphs =
    body?.children.filter(
      (c): c is XmlElement => c.type === "element" && c.tag === "w:p",
    ) ?? [];
  const paragraphElement = paragraphs.at(-1);
  if (paragraphElement === undefined) {
    throw new Error("no paragraph element found");
  }
  return { editor, paragraph, paragraphElement };
}

describe("DocxParagraph spacingBeforePt / spacingAfterPt", () => {
  it("is undefined with no w:spacing, writes twentieths of a point, and clears", () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    expect(paragraph.spacingBeforePt).toBeUndefined();
    expect(paragraph.spacingAfterPt).toBeUndefined();
    paragraph.spacingBeforePt = 6;
    const spacing = onlyChildElement(pPrOf(paragraphElement), "w:spacing");
    expect(attrOf(spacing, "w:before")).toBe("120");
    expect(paragraph.spacingBeforePt).toBe(6);
    paragraph.spacingAfterPt = 12.5;
    // Both share the ONE w:spacing element the first setter minted.
    const spacingAgain = onlyChildElement(pPrOf(paragraphElement), "w:spacing");
    expect(spacingAgain).toBe(spacing);
    expect(attrOf(spacingAgain, "w:after")).toBe("250");
    expect(paragraph.spacingAfterPt).toBe(12.5);
    paragraph.spacingBeforePt = undefined;
    expect(attrOf(spacing, "w:before")).toBeUndefined();
    expect(paragraph.spacingAfterPt).toBe(12.5);
    paragraph.spacingAfterPt = undefined;
    expect(attrOf(spacing, "w:after")).toBeUndefined();
    expect(paragraph.spacingBeforePt).toBeUndefined();
  });

  it("a lone spacingAfterPt set on a pristine paragraph mints the spacing", () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    paragraph.spacingAfterPt = 12.5;
    const spacing = onlyChildElement(pPrOf(paragraphElement), "w:spacing");
    expect(attrOf(spacing, "w:after")).toBe("250");
    expect(paragraph.spacingAfterPt).toBe(12.5);
  });

  it("reads through earlier run siblings to the pPr element", () => {
    const { paragraph } = paragraphFromInit([
      el("w:spacing", { "w:before": "40", "w:after": "60" }),
    ]);
    expect(paragraph.spacingBeforePt).toBe(2);
    expect(paragraph.spacingAfterPt).toBe(3);
  });
});

describe("DocxParagraph lineSpacing", () => {
  it("writes 240ths of a line under lineRule auto, reads it back, and clears both attributes", () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    expect(paragraph.lineSpacing).toBeUndefined();
    paragraph.lineSpacing = 1.5;
    const spacing = onlyChildElement(pPrOf(paragraphElement), "w:spacing");
    expect(attrOf(spacing, "w:line")).toBe("360");
    expect(attrOf(spacing, "w:lineRule")).toBe("auto");
    expect(paragraph.lineSpacing).toBe(1.5);
    paragraph.lineSpacing = undefined;
    expect(attrOf(spacing, "w:line")).toBeUndefined();
    expect(attrOf(spacing, "w:lineRule")).toBeUndefined();
    expect(paragraph.lineSpacing).toBeUndefined();
  });

  it("reads a w:line with no lineRule as a multiplier", () => {
    const { paragraph } = paragraphFromInit([
      el("w:spacing", { "w:line": "120" }),
    ]);
    expect(paragraph.lineSpacing).toBe(0.5);
  });

  it("reads exact and atLeast line rules as undefined (fixed-point spacing)", () => {
    for (const lineRule of ["exact", "atLeast"]) {
      const { paragraph } = paragraphFromInit([
        el("w:spacing", { "w:line": "240", "w:lineRule": lineRule }),
      ]);
      expect(paragraph.lineSpacing).toBeUndefined();
    }
  });
});

describe("DocxParagraph indentLeftPt / indentFirstLinePt", () => {
  it("indentLeftPt writes w:left in twentieths of a point and clears", () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    expect(paragraph.indentLeftPt).toBeUndefined();
    paragraph.indentLeftPt = 12;
    expect(
      attrOf(onlyChildElement(pPrOf(paragraphElement), "w:ind"), "w:left"),
    ).toBe("240");
    expect(paragraph.indentLeftPt).toBe(12);
    paragraph.indentLeftPt = undefined;
    expect(
      attrOf(onlyChildElement(pPrOf(paragraphElement), "w:ind"), "w:left"),
    ).toBeUndefined();
  });

  it("indentFirstLinePt positive writes w:firstLine, negative writes positive w:hanging", () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    expect(paragraph.indentFirstLinePt).toBeUndefined();
    paragraph.indentFirstLinePt = 24;
    let ind = onlyChildElement(pPrOf(paragraphElement), "w:ind");
    expect(attrOf(ind, "w:firstLine")).toBe("480");
    expect(attrOf(ind, "w:hanging")).toBeUndefined();
    expect(paragraph.indentFirstLinePt).toBe(24);
    paragraph.indentFirstLinePt = -24;
    ind = onlyChildElement(pPrOf(paragraphElement), "w:ind");
    expect(attrOf(ind, "w:firstLine")).toBeUndefined();
    expect(attrOf(ind, "w:hanging")).toBe("480");
    expect(paragraph.indentFirstLinePt).toBe(-24);
    paragraph.indentFirstLinePt = undefined;
    expect(attrOf(ind, "w:firstLine")).toBeUndefined();
    expect(attrOf(ind, "w:hanging")).toBeUndefined();
    expect(paragraph.indentFirstLinePt).toBeUndefined();
  });

  it("a zero first-line indent writes w:firstLine of 0, not a hanging", () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    paragraph.indentFirstLinePt = 0;
    const ind = onlyChildElement(pPrOf(paragraphElement), "w:ind");
    expect(attrOf(ind, "w:firstLine")).toBe("0");
    expect(attrOf(ind, "w:hanging")).toBeUndefined();
    expect(paragraph.indentFirstLinePt).toBe(0);
  });

  it("reads w:firstLine in preference to w:hanging when both are present", () => {
    const { paragraph } = paragraphFromInit([
      el("w:ind", { "w:firstLine": "100", "w:hanging": "200" }),
    ]);
    expect(paragraph.indentFirstLinePt).toBe(5);
  });

  it("setting a positive first-line indent removes a pre-existing hanging, and vice versa", () => {
    const hangingOnly = paragraphFromInit([
      el("w:ind", { "w:hanging": "200" }),
    ]);
    hangingOnly.paragraph.indentFirstLinePt = 24;
    expect(
      attrOf(
        onlyChildElement(pPrOf(hangingOnly.paragraphElement), "w:ind"),
        "w:hanging",
      ),
    ).toBeUndefined();
    expect(
      attrOf(
        onlyChildElement(pPrOf(hangingOnly.paragraphElement), "w:ind"),
        "w:firstLine",
      ),
    ).toBe("480");

    const firstLineOnly = paragraphFromInit([
      el("w:ind", { "w:firstLine": "100" }),
    ]);
    firstLineOnly.paragraph.indentFirstLinePt = -24;
    expect(
      attrOf(
        onlyChildElement(pPrOf(firstLineOnly.paragraphElement), "w:ind"),
        "w:firstLine",
      ),
    ).toBeUndefined();
    expect(
      attrOf(
        onlyChildElement(pPrOf(firstLineOnly.paragraphElement), "w:ind"),
        "w:hanging",
      ),
    ).toBe("480");
  });

  it("shares one w:ind element with the left indent", () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    paragraph.indentLeftPt = 6;
    paragraph.indentFirstLinePt = 12;
    const pPr = pPrOf(paragraphElement);
    const inds =
      pPr?.children.filter(
        (c): c is XmlElement => c.type === "element" && c.tag === "w:ind",
      ) ?? [];
    expect(inds).toHaveLength(1);
    expect(attrOf(inds[0], "w:left")).toBe("120");
    expect(attrOf(inds[0], "w:firstLine")).toBe("240");
  });
});

describe("DocxParagraph list edge cases", () => {
  it("reads level 0 when w:numPr carries a numId but no w:ilvl", () => {
    const { paragraph } = paragraphFromInit([
      el("w:numPr", {}, [el("w:numId", { "w:val": "7" })]),
    ]);
    expect(paragraph.list).toEqual({ numId: "7", level: 0 });
  });

  it("reads undefined when w:numPr carries no w:numId at all", () => {
    const { paragraph } = paragraphFromInit([
      el("w:numPr", {}, [el("w:ilvl", { "w:val": "2" })]),
    ]);
    expect(paragraph.list).toBeUndefined();
  });

  it("writes w:ilvl before w:numId per CT_NumPr's sequence", () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    paragraph.list = { numId: "5", level: 3 };
    const numPr = onlyChildElement(pPrOf(paragraphElement), "w:numPr");
    expect(
      numPr?.children.map((c) => (c.type === "element" ? c.tag : undefined)),
    ).toEqual(["w:ilvl", "w:numId"]);
    const ilvl = onlyChildElement(numPr, "w:ilvl");
    const numId = onlyChildElement(numPr, "w:numId");
    expect(attrOf(ilvl, "w:val")).toBe("3");
    expect(attrOf(numId, "w:val")).toBe("5");
  });

  it("refuses a membership with no numId, naming the numbering module", () => {
    const { paragraph } = paragraphFromXml();
    expect(() => {
      paragraph.list = { level: 1 };
    }).toThrow(/numbering\.ts/);
  });
});

describe("DocxParagraph.appendOfficeMath", () => {
  it("appends a real m:oMathPara as a direct child of w:p and reports written", () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    const result = paragraph.appendOfficeMath(mathmlOf("x", "+", "1"));
    expect(result.written).toBe(true);
    expect(result.element).toBeDefined();
    const last = paragraphElement.children.at(-1);
    expect(last?.type === "element" ? last.tag : undefined).toBe("m:oMathPara");
    // Direct child of w:p, never nested inside a run.
    for (const child of paragraphElement.children) {
      if (child.type === "element" && child.tag === "w:r") {
        expect(
          child.children.some(
            (c) => c.type === "element" && c.tag === "m:oMathPara",
          ),
        ).toBe(false);
      }
    }
  });

  it("reports written false and appends nothing for empty MathML", () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    const before = paragraphElement.children.length;
    const result = paragraph.appendOfficeMath([]);
    expect(result.written).toBe(false);
    expect(result.element).toBeUndefined();
    expect(paragraphElement.children).toHaveLength(before);
  });
});

describe("DocxParagraph.appendVectorAnchors", () => {
  const RECT_A: ContentVector = {
    kind: "rect",
    frame: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 },
    fill: { r: 1, g: 0, b: 0 },
  };
  const RECT_B: ContentVector = {
    kind: "rect",
    frame: { xPt: 50, yPt: 60, widthPt: 70, heightPt: 80 },
  };

  it("throws without an editor-provided image context", () => {
    const paragraphElement = el("w:p", {}, []);
    const paragraph = new DocxParagraph([paragraphElement], paragraphElement);
    expect(() => {
      paragraph.appendVectorAnchors([RECT_A]);
    }).toThrow(/DocxEditor/);
  });

  it("appends one anchored drawing run per vector, z-ordered by index", () => {
    const { editor, paragraph, paragraphElement } = editorParagraph();
    paragraph.appendVectorAnchors([RECT_A, RECT_B]);
    expect(paragraph.runs()).toHaveLength(2);
    expect(
      paragraphElement.children.filter(
        (c) => c.type === "element" && c.tag === "w:r",
      ),
    ).toHaveLength(2);
    const anchors: XmlElement[] = [];
    const walk = (node: XmlElement) => {
      for (const child of node.children) {
        if (child.type === "element") {
          if (child.tag === "wp:anchor") {
            anchors.push(child);
          }
          walk(child);
        }
      }
    };
    const documentRoot = rootElement(
      editor.toPackage().parts["word/document.xml"],
    );
    if (documentRoot !== undefined) {
      walk(documentRoot);
    }
    expect(anchors).toHaveLength(2);
    // relativeHeight is stamped from each vector's own index, preserving the
    // recovered paint order as Word's floating-object z-order.
    expect(anchors.map((a) => attrOf(a, "relativeHeight"))).toEqual(["0", "1"]);
    const docPrIds = anchors.map((a) =>
      attrOf(onlyChildElement(a, "wp:docPr"), "id"),
    );
    expect(docPrIds).toEqual(["1", "2"]);
  });
});

describe("DocxParagraph.wrapLastRunInHyperlink", () => {
  it("silently skips a paragraph with no package reference", () => {
    const paragraphElement = el("w:p", {}, [
      el("w:r", {}, [el("w:t", {}, [{ type: "text", value: "x" }])]),
    ]);
    const paragraph = new DocxParagraph([paragraphElement], paragraphElement);
    expect(() => {
      paragraph.wrapLastRunInHyperlink("https://example.com");
    }).not.toThrow();
    expect(paragraphElement.children[0]?.type === "element").toBe(true);
    expect(
      paragraphElement.children[0]?.type === "element"
        ? paragraphElement.children[0].tag
        : undefined,
    ).toBe("w:r");
  });

  it("skips when the last child is not a run (a trailing equation) without registering anything", () => {
    const { editor, paragraph } = editorParagraph();
    paragraph.appendRun({ text: "x" });
    paragraph.appendOfficeMath(mathmlOf("y"));
    paragraph.wrapLastRunInHyperlink("https://example.com");
    const rels = resolveRelationships(editor.toPackage(), "word/document.xml");
    expect(
      [...rels.values()].some((r) => r.target === "https://example.com"),
    ).toBe(false);
  });

  it("wraps the last run in a w:hyperlink carrying an external r:id relationship", () => {
    const { editor, paragraph } = editorParagraph();
    paragraph.appendRun({ text: "visit " });
    paragraph.appendRun({ text: "here" });
    paragraph.wrapLastRunInHyperlink("https://example.com/docs");
    const paragraphElement = rootElement(
      editor.toPackage().parts["word/document.xml"],
    );
    // Find the body's paragraph (the only one), take its last child.
    const body =
      paragraphElement && onlyChildElement(paragraphElement, "w:body");
    const wps =
      body?.children.filter(
        (c): c is XmlElement => c.type === "element" && c.tag === "w:p",
      ) ?? [];
    const last = wps[0]?.children.at(-1);
    expect(last?.type === "element" ? last.tag : undefined).toBe("w:hyperlink");
    expect(
      last?.type === "element" ? attrOf(last, "r:id") : undefined,
    ).toBeDefined();
    const rels = resolveRelationships(editor.toPackage(), "word/document.xml");
    const rel = [...rels.values()].find(
      (r) => r.target === "https://example.com/docs",
    );
    expect(rel).toBeDefined();
    expect(rel?.targetMode).toBe("External");
    // The wrapped run survives inside the hyperlink with its text.
    expect(paragraph.text).toBe("visit here");
  });
});

describe("DocxParagraph.insertRunAt boundaries", () => {
  it("inserts before the first run at index 0", () => {
    const { paragraph } = paragraphFromXml();
    paragraph.insertRunAt(0, { text: "Well " });
    expect(paragraph.text).toBe("Well Hello world");
  });

  it("appends at the end for an index past the run count", () => {
    const { paragraph } = paragraphFromXml();
    paragraph.insertRunAt(99, { text: "!" });
    expect(paragraph.text).toBe("Hello world!");
  });

  it("indexes runs past the pPr without ever inserting ahead of it", () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    paragraph.styleId = "Keep"; // mints the pPr as the first child
    paragraph.insertRunAt(0, { text: "Well " });
    expect(paragraph.text).toBe("Well Hello world");
    expect(
      paragraphElement.children.map((c) =>
        c.type === "element" ? c.tag : undefined,
      ),
    ).toEqual(["w:pPr", "w:r", "w:r", "w:r"]);
  });
});

describe("buildParagraph property order and justify spelling", () => {
  it("spells justify as w:jc val both", () => {
    const paragraphElement = buildParagraph({ alignment: "justify" });
    const paragraph = new DocxParagraph([paragraphElement], paragraphElement);
    expect(paragraph.alignment).toBe("justify");
    const jc = onlyChildElement(pPrOf(paragraphElement), "w:jc");
    expect(attrOf(jc, "w:val")).toBe("both");
  });

  it("emits pStyle, jc, outlineLvl in CT_PPrGeneral order with the run after", () => {
    const paragraphElement = buildParagraph({
      text: "T",
      styleId: "Heading1",
      alignment: "center",
      headingLevel: 2,
    });
    expect(
      paragraphElement.children.map((c) =>
        c.type === "element" ? c.tag : undefined,
      ),
    ).toEqual(["w:pPr", "w:r"]);
    const pPr = pPrOf(paragraphElement)!;
    expect(
      pPr.children.map((c) => (c.type === "element" ? c.tag : undefined)),
    ).toEqual(["w:pStyle", "w:jc", "w:outlineLvl"]);
  });
});

describe("DocxParagraph getters and clearers never mint elements", () => {
  it("reading every property on a pristine paragraph leaves the tree unchanged", () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    expect(paragraph.styleId).toBeUndefined();
    expect(paragraph.alignment).toBeUndefined();
    expect(paragraph.spacingBeforePt).toBeUndefined();
    expect(paragraph.spacingAfterPt).toBeUndefined();
    expect(paragraph.lineSpacing).toBeUndefined();
    expect(paragraph.indentLeftPt).toBeUndefined();
    expect(paragraph.indentFirstLinePt).toBeUndefined();
    expect(paragraph.list).toBeUndefined();
    expect(paragraph.headingLevel).toBeUndefined();
    expect(paragraphElement.children).toHaveLength(2);
    expect(
      paragraphElement.children.every(
        (c) => c.type === "element" && c.tag === "w:r",
      ),
    ).toBe(true);
  });

  it("clearing every non-list property on a pristine paragraph leaves the tree unchanged", () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    paragraph.styleId = undefined;
    paragraph.alignment = undefined;
    paragraph.spacingBeforePt = undefined;
    paragraph.spacingAfterPt = undefined;
    paragraph.lineSpacing = undefined;
    paragraph.indentLeftPt = undefined;
    paragraph.indentFirstLinePt = undefined;
    paragraph.headingLevel = undefined;
    expect(paragraphElement.children).toHaveLength(2);
    expect(
      paragraphElement.children.every(
        (c) => c.type === "element" && c.tag === "w:r",
      ),
    ).toBe(true);
  });

  it("clearing a spacing or indent that was never set mints no w:spacing or w:ind", () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    paragraph.styleId = "Heading1"; // mints the pPr, but nothing else
    paragraph.spacingBeforePt = undefined;
    paragraph.spacingAfterPt = undefined;
    paragraph.lineSpacing = undefined;
    paragraph.indentLeftPt = undefined;
    paragraph.indentFirstLinePt = undefined;
    const pPr = pPrOf(paragraphElement);
    expect(
      pPr?.children.map((c) => (c.type === "element" ? c.tag : undefined)),
    ).toEqual(["w:pStyle"]);
  });
  it("clearing list on a pristine paragraph mints an empty pPr, pinned as current behaviour", () => {
    // The list setter resolves pPr(true) unconditionally before deciding
    // there is nothing to remove: a clear on a paragraph with no properties
    // leaves an empty w:pPr behind. Pinned as-is rather than silently
    // assumed otherwise.
    const { paragraph, paragraphElement } = paragraphFromXml();
    paragraph.list = undefined;
    expect(
      paragraphElement.children.map((c) =>
        c.type === "element" ? c.tag : undefined,
      ),
    ).toEqual(["w:pPr", "w:r", "w:r"]);
    expect(pPrOf(paragraphElement)?.children).toHaveLength(0);
  });
});

describe("DocxParagraph.runs counts only w:r children", () => {
  it("ignores pPr, hyperlink and equation children", () => {
    const paragraphElement = el("w:p", {}, [
      el("w:pPr", {}, [el("w:pStyle", { "w:val": "Heading1" })]),
      el("w:r", {}, [el("w:t", {}, [{ type: "text", value: "a" }])]),
      el("w:hyperlink", { "r:id": "rId1" }, [
        el("w:r", {}, [el("w:t", {}, [{ type: "text", value: "b" }])]),
      ]),
      el("m:oMathPara"),
    ]);
    const paragraph = new DocxParagraph([paragraphElement], paragraphElement);
    // Only the two direct w:r children: the hyperlink's inner run is not a
    // direct child, and no other element kind counts.
    expect(paragraph.runs()).toHaveLength(1);
    expect(paragraph.runs()[0]?.text).toBe("a");
  });
});

describe("DocxParagraph repeat setters reuse the existing element", () => {
  it("setting list twice replaces the membership rather than adding a second numPr", () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    paragraph.list = { numId: "3", level: 2 };
    paragraph.list = { numId: "9", level: 0 };
    expect(paragraph.list).toEqual({ numId: "9", level: 0 });
    const pPr = pPrOf(paragraphElement);
    const numPrs =
      pPr?.children.filter(
        (c): c is XmlElement => c.type === "element" && c.tag === "w:numPr",
      ) ?? [];
    expect(numPrs).toHaveLength(1);
  });

  it("setting headingLevel twice updates the one outlineLvl in place", () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    paragraph.headingLevel = 2;
    paragraph.headingLevel = 4;
    expect(paragraph.headingLevel).toBe(4);
    const pPr = pPrOf(paragraphElement);
    const outlineLvls =
      pPr?.children.filter(
        (c): c is XmlElement =>
          c.type === "element" && c.tag === "w:outlineLvl",
      ) ?? [];
    expect(outlineLvls).toHaveLength(1);
    expect(attrOf(outlineLvls[0], "w:val")).toBe("3");
  });

  it("clearing an indent removes both firstLine and hanging attributes", () => {
    const { paragraph, paragraphElement } = paragraphFromInit([
      el("w:ind", { "w:firstLine": "100", "w:hanging": "200" }),
    ]);
    paragraph.indentFirstLinePt = undefined;
    expect(paragraph.indentFirstLinePt).toBeUndefined();
    const ind = onlyChildElement(pPrOf(paragraphElement), "w:ind");
    expect(attrOf(ind, "w:firstLine")).toBeUndefined();
    expect(attrOf(ind, "w:hanging")).toBeUndefined();
  });
});

describe("DocxParagraph.wrapLastRunInHyperlink relationship type", () => {
  it("registers the relationship under the hyperlink relationship type", () => {
    const { editor, paragraph } = editorParagraph();
    paragraph.appendRun({ text: "link" });
    paragraph.wrapLastRunInHyperlink("https://example.com/typed");
    const rels = resolveRelationships(editor.toPackage(), "word/document.xml");
    const rel = [...rels.values()].find(
      (r) => r.target === "https://example.com/typed",
    );
    expect(rel?.type).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
    );
  });
});

describe("buildParagraph single-property and value forms", () => {
  it("a styleId alone mints the pPr", () => {
    const paragraphElement = buildParagraph({ styleId: "Heading1" });
    const paragraph = new DocxParagraph([paragraphElement], paragraphElement);
    expect(paragraph.styleId).toBe("Heading1");
    expect(
      paragraphElement.children.map((c) =>
        c.type === "element" ? c.tag : undefined,
      ),
    ).toEqual(["w:pPr"]);
  });

  it("an alignment alone mints the pPr", () => {
    const paragraphElement = buildParagraph({ alignment: "right" });
    const paragraph = new DocxParagraph([paragraphElement], paragraphElement);
    expect(paragraph.alignment).toBe("right");
    expect(
      paragraphElement.children.map((c) =>
        c.type === "element" ? c.tag : undefined,
      ),
    ).toEqual(["w:pPr"]);
  });

  it("a headingLevel alone stores outlineLvl as one less than the depth", () => {
    const paragraphElement = buildParagraph({ headingLevel: 2 });
    const paragraph = new DocxParagraph([paragraphElement], paragraphElement);
    expect(paragraph.headingLevel).toBe(2);
    expect(
      attrOf(
        onlyChildElement(pPrOf(paragraphElement), "w:outlineLvl"),
        "w:val",
      ),
    ).toBe("1");
  });
});
