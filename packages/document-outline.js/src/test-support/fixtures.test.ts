// Direct unit tests for the fixture builders themselves: every optional-field pattern here is exercised twice, once with the field set (checking the exact key and value land) and once without (checking the key is genuinely absent, not merely undefined -- `"key" in result` distinguishes a present-but-undefined key from a truly missing one, which is exactly the boundary the builders' own `!== undefined` spreads are guarding). Full-literal builders (no branching beyond an optional field) are checked with toStrictEqual against their expected literal output instead, since that single assertion catches any string/array/object substitution anywhere in the literal.
import { describe, expect, it } from "vitest";
import {
  drawPageGroup,
  drawingPackage,
  embeddedFormulaObject,
  embeddedObject,
  embeddedObjectBlock,
  formulaPackage,
  headingGroup,
  imageBlock,
  layoutFrame,
  listGroup,
  minimalSymbolTable,
  pageBreak,
  paragraph,
  presentationPackage,
  sectionConstructGroup,
  sectionGroup,
  shapeConstructGroup,
  shapeGroup,
  sheetGroup,
  sheetImage,
  slideGroup,
  spreadsheetPackage,
  table,
  textRun,
  wordprocessingPackage,
  wrappedRunParagraph,
} from "./fixtures";

describe("textRun", () => {
  it("includes bold with its exact value when explicitly set", () => {
    const run = textRun("hi", { bold: true });
    expect(run.bold).toBe(true);
    expect("bold" in run).toBe(true);
  });

  it("omits bold entirely when not set", () => {
    const run = textRun("hi");
    expect("bold" in run).toBe(false);
    expect(run).toStrictEqual({ text: "hi" });
  });
});

describe("paragraph", () => {
  it("passes bold through to its own single run", () => {
    const result = paragraph("hi", { bold: true });
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]?.bold).toBe(true);
  });

  it("includes headingLevel with its exact value when set, and omits it entirely otherwise", () => {
    const withLevel = paragraph("hi", { headingLevel: 2 });
    expect(withLevel.headingLevel).toBe(2);
    const without = paragraph("hi");
    expect("headingLevel" in without).toBe(false);
  });

  it("includes a list membership with its exact level when set, and omits list entirely otherwise", () => {
    const withList = paragraph("hi", { listLevel: 3 });
    expect(withList.list).toStrictEqual({ level: 3 });
    const without = paragraph("hi");
    expect("list" in without).toBe(false);
  });

  it("includes styleId with its exact value when set, and omits it entirely otherwise", () => {
    const withStyle = paragraph("hi", { styleId: "s1" });
    expect(withStyle.styleId).toBe("s1");
    const without = paragraph("hi");
    expect("styleId" in without).toBe(false);
  });

  it("includes indentLeftPt with its exact value when set, and omits it entirely otherwise", () => {
    const withIndent = paragraph("hi", { indentLeftPt: 12 });
    expect(withIndent.indentLeftPt).toBe(12);
    const without = paragraph("hi");
    expect("indentLeftPt" in without).toBe(false);
  });

  it("produces a bare paragraph leaf with no signals at all when no options are given", () => {
    expect(paragraph("hi")).toStrictEqual({
      kind: "paragraph",
      runs: [{ text: "hi" }],
    });
  });
});

describe("table", () => {
  it("maps each row's cells through paragraph() and sizes columnWidthsPt from the first row's own length", () => {
    const result = table([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.cells).toStrictEqual([
      { blocks: [paragraph("a")] },
      { blocks: [paragraph("b")] },
    ]);
    expect(result.rows[1]?.cells).toStrictEqual([
      { blocks: [paragraph("c")] },
      { blocks: [paragraph("d")] },
    ]);
    expect(result.columnWidthsPt).toStrictEqual([80, 80]);
  });

  it("falls back to an empty columnWidthsPt (not the map's own result, since there is no first row to map)", () => {
    const result = table([]);
    expect(result.rows).toStrictEqual([]);
    expect(result.columnWidthsPt).toStrictEqual([]);
  });
});

describe("imageBlock", () => {
  it("carries its own fixed format/base64/size fields regardless of altText", () => {
    expect(imageBlock()).toStrictEqual({
      kind: "image",
      format: "png",
      base64: "aW1hZ2U=",
      widthPt: 100,
      heightPt: 60,
    });
  });

  it("includes altText with its exact value when set, and omits it entirely otherwise", () => {
    const withAlt = imageBlock("a logo");
    expect(withAlt.altText).toBe("a logo");
    const without = imageBlock();
    expect("altText" in without).toBe(false);
  });
});

describe("pageBreak", () => {
  it("is exactly a bare pageBreak leaf", () => {
    expect(pageBreak()).toStrictEqual({ kind: "pageBreak" });
  });
});

describe("layoutFrame", () => {
  it("carries all five fields through unchanged, positionally", () => {
    expect(layoutFrame(1, 2, 3, 4, 5)).toStrictEqual({
      pageIndex: 1,
      xPt: 2,
      yPt: 3,
      widthPt: 4,
      heightPt: 5,
    });
  });
});

describe("wrappedRunParagraph", () => {
  it("wraps the text and frames into a single run on a bare paragraph", () => {
    const frames = [layoutFrame(0, 1, 2, 3, 4), layoutFrame(1, 5, 6, 7, 8)];
    expect(wrappedRunParagraph("split text", frames)).toStrictEqual({
      kind: "paragraph",
      runs: [{ text: "split text", frames }],
    });
  });
});

describe("sheetImage", () => {
  it("carries its own fixed format/base64/size/anchor fields regardless of altText", () => {
    expect(sheetImage()).toStrictEqual({
      kind: "image",
      format: "jpeg",
      base64: "c2hlZXQtaW1hZ2U=",
      widthPt: 200,
      heightPt: 120,
      anchorRow: 0,
      anchorColumn: 1,
      offsetXPt: 4,
      offsetYPt: 4,
    });
  });

  it("includes altText with its exact value when set, and omits it entirely otherwise", () => {
    const withAlt = sheetImage("a chart");
    expect(withAlt.altText).toBe("a chart");
    const without = sheetImage();
    expect("altText" in without).toBe(false);
  });
});

describe("embeddedObject", () => {
  it("is the full literal wordprocessing embedded object, exactly", () => {
    expect(embeddedObject()).toStrictEqual({
      objectKind: "wordprocessing",
      frame: { xPt: 10, yPt: 10, widthPt: 300, heightPt: 200 },
      document: {
        kind: "wordprocessing",
        metadata: {},
        sections: [
          {
            pageSize: { widthPt: 595, heightPt: 842 },
            margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
            blocks: [paragraph("embedded document body")],
          },
        ],
      },
    });
  });
});

describe("embeddedFormulaObject", () => {
  it("is the full literal formula embedded object, exactly", () => {
    expect(embeddedFormulaObject()).toStrictEqual({
      objectKind: "formula",
      frame: { xPt: 2, yPt: 2, widthPt: 120, heightPt: 40 },
      document: {
        kind: "formula",
        metadata: {},
        formula: {
          mathml: [
            {
              type: "element",
              tag: "mi",
              attributes: [],
              children: [{ type: "text", value: "P" }],
            },
          ],
          presentation: { latex: "P = VI" },
        },
      },
      anchorRow: 0,
      anchorColumn: 2,
      offsetXPt: 2,
      offsetYPt: 2,
    });
  });
});

describe("embeddedObjectBlock", () => {
  it("is embeddedObject's own fields plus the block discriminator, exactly", () => {
    expect(embeddedObjectBlock()).toStrictEqual({
      ...embeddedObject(),
      kind: "embeddedObject",
    });
  });
});

describe("headingGroup", () => {
  it("defaults to no children when none are given", () => {
    expect(headingGroup("Title", 1).children).toStrictEqual([]);
  });

  it("includes style with its exact value when set, and omits it entirely otherwise", () => {
    const withStyle = headingGroup("Title", 1, [], { style: "h1" });
    expect(withStyle.style).toBe("h1");
    const without = headingGroup("Title", 1, []);
    expect("style" in without).toBe(false);
  });
});

describe("listGroup", () => {
  it("defaults to no children when none are given", () => {
    expect(listGroup("Item", 0).children).toStrictEqual([]);
  });

  it("includes style with its exact value when set, and omits it entirely otherwise", () => {
    const withStyle = listGroup("Item", 0, [], { style: "li" });
    expect(withStyle.style).toBe("li");
    const without = listGroup("Item", 0, []);
    expect("style" in without).toBe(false);
  });
});

describe("sectionConstructGroup", () => {
  it("includes style with its exact value when set, and omits it entirely otherwise", () => {
    const withStyle = sectionConstructGroup([], { style: "sc" });
    expect(withStyle.style).toBe("sc");
    const without = sectionConstructGroup([]);
    expect("style" in without).toBe(false);
  });
});

describe("shapeConstructGroup", () => {
  it("includes style with its exact value when set, and omits it entirely otherwise", () => {
    const withStyle = shapeConstructGroup([], { style: "shc" });
    expect(withStyle.style).toBe("shc");
    const without = shapeConstructGroup([]);
    expect("style" in without).toBe(false);
  });
});

describe("sectionGroup", () => {
  it("includes style with its exact value when set, and omits it entirely otherwise", () => {
    const withStyle = sectionGroup([], { style: "sec" });
    expect(withStyle.style).toBe("sec");
    const without = sectionGroup([]);
    expect("style" in without).toBe(false);
  });
});

describe("shapeGroup", () => {
  it("includes style with its exact value when set, and omits it entirely otherwise", () => {
    const withStyle = shapeGroup([], { style: "shp" });
    expect(withStyle.style).toBe("shp");
    const without = shapeGroup([]);
    expect("style" in without).toBe(false);
  });
});

describe("slideGroup", () => {
  it("defaults notes to the empty string, exactly, when not set", () => {
    expect(slideGroup([]).node.notes).toBe("");
  });

  it("includes style with its exact value when set, and omits it entirely otherwise", () => {
    const withStyle = slideGroup([], { style: "sld" });
    expect(withStyle.style).toBe("sld");
    const without = slideGroup([]);
    expect("style" in without).toBe(false);
  });
});

describe("sheetGroup", () => {
  it("carries its own fixed rows/columns/printSettings fields exactly", () => {
    const result = sheetGroup({ name: "Sheet1" });
    expect(result.node.rows).toStrictEqual([{ index: 0, heightPt: 20 }]);
    expect(result.node.columns).toStrictEqual([{ index: 0, widthPt: 80 }]);
    expect(result.node.printSettings.gridlines).toBe(false);
    expect(result.node.printSettings.headers).toBe(false);
  });

  it("includes style with its exact value when set, and omits it entirely otherwise", () => {
    const withStyle = sheetGroup({ name: "Sheet1", style: "sht" });
    expect(withStyle.style).toBe("sht");
    const without = sheetGroup({ name: "Sheet1" });
    expect("style" in without).toBe(false);
  });
});

describe("drawPageGroup", () => {
  it("includes style with its exact value when set, and omits it entirely otherwise", () => {
    const withStyle = drawPageGroup([], { style: "dp" });
    expect(withStyle.style).toBe("dp");
    const without = drawPageGroup([]);
    expect("style" in without).toBe(false);
  });
});

describe("package envelope options", () => {
  const symbolTable = minimalSymbolTable();
  const pages = [{ widthPt: 842, heightPt: 595 }];
  const styles = { s1: { run: { bold: true } } };

  it("wordprocessingPackage includes symbolTable/pages/styles exactly when set, and omits each entirely otherwise", () => {
    const withAll = wordprocessingPackage([], { symbolTable, pages, styles });
    expect(withAll.symbolTable).toBe(symbolTable);
    expect(withAll.pages).toBe(pages);
    expect(withAll.styles).toBe(styles);
    const without = wordprocessingPackage([]);
    expect("symbolTable" in without).toBe(false);
    expect("pages" in without).toBe(false);
    expect("styles" in without).toBe(false);
  });

  it("presentationPackage includes symbolTable/pages/styles exactly when set, and omits each entirely otherwise", () => {
    const withAll = presentationPackage([], { symbolTable, pages, styles });
    expect(withAll.symbolTable).toBe(symbolTable);
    expect(withAll.pages).toBe(pages);
    expect(withAll.styles).toBe(styles);
    const without = presentationPackage([]);
    expect("symbolTable" in without).toBe(false);
    expect("pages" in without).toBe(false);
    expect("styles" in without).toBe(false);
  });

  it("spreadsheetPackage includes symbolTable/pages/styles exactly when set, and omits each entirely otherwise", () => {
    const withAll = spreadsheetPackage([], { symbolTable, pages, styles });
    expect(withAll.symbolTable).toBe(symbolTable);
    expect(withAll.pages).toBe(pages);
    expect(withAll.styles).toBe(styles);
    const without = spreadsheetPackage([]);
    expect("symbolTable" in without).toBe(false);
    expect("pages" in without).toBe(false);
    expect("styles" in without).toBe(false);
  });

  it("drawingPackage includes symbolTable/pages/styles exactly when set, and omits each entirely otherwise", () => {
    const withAll = drawingPackage([], { symbolTable, pages, styles });
    expect(withAll.symbolTable).toBe(symbolTable);
    expect(withAll.pages).toBe(pages);
    expect(withAll.styles).toBe(styles);
    const without = drawingPackage([]);
    expect("symbolTable" in without).toBe(false);
    expect("pages" in without).toBe(false);
    expect("styles" in without).toBe(false);
  });

  it("shares one generic-tables spread across every package kind for definitions/layers/attachments/destinations", () => {
    const definitions = { n1: { kind: "footnote", blocks: [] } };
    const layers = { ocg1: { kind: "layer", name: "Background" } };
    const attachments = { file1: { kind: "attachment", name: "data.csv" } };
    const destinations = { top: { kind: "destination", page: 1 } };
    const withAll = wordprocessingPackage([], {
      definitions,
      layers,
      attachments,
      destinations,
    });
    expect(withAll.definitions).toBe(definitions);
    expect(withAll.layers).toBe(layers);
    expect(withAll.attachments).toBe(attachments);
    expect(withAll.destinations).toBe(destinations);
    const without = wordprocessingPackage([]);
    expect("definitions" in without).toBe(false);
    expect("layers" in without).toBe(false);
    expect("attachments" in without).toBe(false);
    expect("destinations" in without).toBe(false);
  });
});

describe("formulaPackage", () => {
  it("carries the fixed mathml tree regardless of latex, and includes presentation.latex only when given", () => {
    const withLatex = formulaPackage("x = 1");
    if (withLatex.kind !== "formula")
      throw new Error("formulaPackage must build a formula-kind tree");
    const child = withLatex.children[0];
    expect(child).toBeDefined();
    expect(child?.mathml).toStrictEqual([
      {
        type: "element",
        tag: "mi",
        attributes: [],
        children: [{ type: "text", value: "x" }],
      },
    ]);
    expect(child?.presentation).toStrictEqual({ latex: "x = 1" });

    const without = formulaPackage();
    if (without.kind !== "formula")
      throw new Error("formulaPackage must build a formula-kind tree");
    const withoutChild = without.children[0];
    expect(withoutChild).toBeDefined();
    expect(withoutChild?.mathml).toStrictEqual(child?.mathml);
    expect(withoutChild !== undefined && "presentation" in withoutChild).toBe(
      false,
    );
  });
});

describe("minimalSymbolTable", () => {
  it("is the full literal symbol table, exactly, including the negative dimension exponents", () => {
    expect(minimalSymbolTable()).toStrictEqual({
      symbols: [
        {
          glyph: "U",
          scope: "document",
          id: "symbols:voltage",
          quantityKind: "si:voltage",
          preferredUnit: "si:volt",
        },
      ],
      units: [
        {
          id: "si:volt",
          symbol: "V",
          name: "volt",
          dimension: { mass: 1, length: 2, time: -3, electricCurrent: -1 },
          factorToSi: { numerator: "1", denominator: "1" },
        },
      ],
    });
  });
});
