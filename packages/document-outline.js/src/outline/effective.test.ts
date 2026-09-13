import { describe, expect, it } from "vitest";
import {
  DocumentTreeSchema,
  type ContentParagraph,
  type DocumentTree,
  type StylesTable,
} from "document-schema.js";
import {
  assertResolvedHeadingAnchor,
  assertResolvedListAnchor,
  effectivePackage,
} from "./effective";
import {
  drawPageGroup,
  drawingPackage,
  formulaPackage,
  headingGroup,
  listGroup,
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
  vectorLine,
  wordprocessingPackage,
} from "../test-support/fixtures";

// 'outer' carries both halves (paragraph geometry + run weight); 'inner' carries a paragraph half that conflicts with outer's on indentLeftPt -- enough surface to prove gap-filling, own-property precedence, nearest-wins overlay, and the run half with one table.
const styles: StylesTable = {
  outer: { paragraph: { indentLeftPt: 24 }, run: { bold: true } },
  inner: { paragraph: { indentLeftPt: 48 } },
  // Neither a paragraph nor a run half: resolving against this ref changes nothing, so a group carrying it as its OWN style still has its ref consumed (stripped) even though its anchor and children come back unaffected.
  emptyEntry: {},
};

function expectSchemaValid(pkg: DocumentTree, label: string): void {
  const result = DocumentTreeSchema.safeParse(pkg);
  expect(
    result.success
      ? "valid"
      : `invalid (${label}): ${JSON.stringify(result.error.issues[0])}`,
  ).toBe("valid");
}

// Narrows a children element to a group (the walk never returns a leaf at a group position, but the array element type is the whole child union).
function asGroup(
  child: unknown,
): asserts child is { node: unknown; children: unknown[] } {
  if (
    typeof child !== "object" ||
    child === null ||
    !("node" in child) ||
    !("children" in child)
  )
    throw new Error("expected a group node");
}

describe("effectivePackage", () => {
  it("returns a styles-free package as the same object", () => {
    const pkg = wordprocessingPackage([sectionGroup([paragraph("body")])]);
    expect(effectivePackage(pkg)).toBe(pkg);
  });

  it("drops an unreferenced styles table without touching the tree", () => {
    const pkg = wordprocessingPackage([sectionGroup([paragraph("body")])], {
      styles,
    });
    const resolved = effectivePackage(pkg);
    expect(resolved.styles).toBeUndefined();
    // No group referenced the table, so every child object is shared, not rebuilt.
    expect(resolved.children[0]).toBe(pkg.children[0]);
  });

  it("fills property gaps on a heading anchor and its subtree, own properties winning", () => {
    const factored = wordprocessingPackage(
      [
        sectionGroup([
          headingGroup(
            "Chapter",
            1,
            [paragraph("plain"), paragraph("own", { indentLeftPt: 12 })],
            { style: "outer" },
          ),
        ]),
      ],
      { styles },
    );
    const resolved = effectivePackage(factored);
    expectSchemaValid(resolved, "resolved");
    // The styles table is consumed along with every ref, and both halves of the entry landed: paragraph gaps filled (indentLeftPt), run gaps filled (bold), own direct values preserved (the 12).
    expect(resolved).toEqual(
      wordprocessingPackage([
        sectionGroup([
          {
            node: {
              kind: "paragraph",
              runs: [{ text: "Chapter", bold: true }],
              headingLevel: 1,
              indentLeftPt: 24,
            },
            children: [
              {
                kind: "paragraph",
                runs: [{ text: "plain", bold: true }],
                indentLeftPt: 24,
              },
              {
                kind: "paragraph",
                runs: [{ text: "own", bold: true }],
                indentLeftPt: 12,
              },
            ],
          },
        ]),
      ]),
    );
  });

  it("overlays nested refs nearest-wins while merging non-conflicting properties", () => {
    const factored = wordprocessingPackage(
      [
        sectionGroup(
          [listGroup("A", 0, [paragraph("body")], { style: "inner" })],
          { style: "outer" },
        ),
      ],
      { styles },
    );
    const resolved = effectivePackage(factored);
    expectSchemaValid(resolved, "resolved");
    // The chain is [outer, inner]: inner (nearest) wins the indent conflict at 48; outer still contributes what inner does not name (the run half). Both the list anchor and its subtree paragraph resolve against the same chain.
    expect(resolved).toEqual(
      wordprocessingPackage([
        sectionGroup([
          {
            node: {
              kind: "paragraph",
              runs: [{ text: "A", bold: true }],
              list: { level: 0 },
              indentLeftPt: 48,
            },
            children: [
              {
                kind: "paragraph",
                runs: [{ text: "body", bold: true }],
                indentLeftPt: 48,
              },
            ],
          },
        ]),
      ]),
    );
  });

  it("applies the run half alone when the entry names no paragraph properties", () => {
    const runOnly: StylesTable = {
      title: { run: { fontFamily: "Test Serif" } },
    };
    const factored = wordprocessingPackage(
      [sectionGroup([headingGroup("Chapter", 1, [], { style: "title" })])],
      {
        styles: runOnly,
      },
    );
    expect(effectivePackage(factored)).toEqual(
      wordprocessingPackage([
        sectionGroup([
          {
            node: {
              kind: "paragraph",
              runs: [{ text: "Chapter", fontFamily: "Test Serif" }],
              headingLevel: 1,
            },
            children: [],
          },
        ]),
      ]),
    );
  });

  it("threads a section construct group's own ref down to its subtree, same as a heading group's", () => {
    const factored = wordprocessingPackage(
      [
        sectionGroup([
          sectionConstructGroup([paragraph("inside")], { style: "outer" }),
        ]),
      ],
      { styles },
    );
    const resolved = effectivePackage(factored);
    expectSchemaValid(resolved, "resolved");
    expect(resolved).toEqual(
      wordprocessingPackage([
        sectionGroup([
          {
            node: { kind: "contentControl", controlType: "richText" },
            children: [
              {
                kind: "paragraph",
                runs: [{ text: "inside", bold: true }],
                indentLeftPt: 24,
              },
            ],
          },
        ]),
      ]),
    );
  });

  it("threads a shape construct group's own ref down to its subtree, same as a shape group's", () => {
    const factored = presentationPackage(
      [
        slideGroup([
          shapeGroup([
            shapeConstructGroup([paragraph("inside")], { style: "outer" }),
          ]),
        ]),
      ],
      { styles },
    );
    const resolved = effectivePackage(factored);
    expectSchemaValid(resolved, "presentation resolved");
    asGroup(resolved.children[0]!);
    asGroup(resolved.children[0].children[0]!);
    expect(resolved.children[0].children[0].children[0]).toEqual({
      node: { kind: "contentControl", controlType: "richText" },
      children: [
        {
          kind: "paragraph",
          runs: [{ text: "inside", bold: true }],
          indentLeftPt: 24,
        },
      ],
    });
  });

  it("does not rewrite leaf-local payload: table cell paragraphs pass through untouched", () => {
    const cells = table([["cell"]]);
    const pkg = wordprocessingPackage(
      [sectionGroup([cells], { style: "outer" })],
      { styles },
    );
    const resolved = effectivePackage(pkg);
    expectSchemaValid(resolved, "resolved");
    asGroup(resolved.children[0]!);
    // The table is the very same object: a table's cell paragraphs are the table's own payload, and style entries carry block-flow properties only.
    expect(resolved.children[0].children[0]).toBe(cells);
  });

  it("resolves through the presentation shape chain", () => {
    const factored = presentationPackage(
      [slideGroup([shapeGroup([paragraph("body")], { style: "outer" })])],
      { styles },
    );
    const resolved = effectivePackage(factored);
    expectSchemaValid(resolved, "presentation resolved");
    asGroup(resolved.children[0]!);
    asGroup(resolved.children[0].children[0]!);
    expect(resolved.children[0].children[0].children[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "body", bold: true }],
      indentLeftPt: 24,
    });
  });

  it("resolves through the drawing shape chain and leaves vector leaves untouched", () => {
    const line = vectorLine();
    const factored = drawingPackage(
      [
        drawPageGroup([
          shapeGroup([paragraph("body")], { style: "outer" }),
          line,
        ]),
      ],
      {
        styles,
      },
    );
    const resolved = effectivePackage(factored);
    expectSchemaValid(resolved, "drawing resolved");
    asGroup(resolved.children[0]!);
    asGroup(resolved.children[0].children[0]!);
    expect(resolved.children[0].children[0].children[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "body", bold: true }],
      indentLeftPt: 24,
    });
    expect(resolved.children[0].children[1]).toBe(line);
  });

  it("consumes a spreadsheet sheet group ref, its image children passing through as the same objects", () => {
    const chart = sheetImage("a chart");
    const factored = spreadsheetPackage(
      [sheetGroup({ name: "Revenue", images: [chart], style: "outer" })],
      { styles },
    );
    const resolved = effectivePackage(factored);
    expectSchemaValid(resolved, "spreadsheet resolved");
    asGroup(resolved.children[0]!);
    expect(resolved.children[0].children[0]).toBe(chart);
  });

  it("drops a formula package styles table, the ContentFormula child untouched", () => {
    const bare = formulaPackage("x^2");
    const pkg: DocumentTree = { ...bare, styles: {} };
    expect(effectivePackage(pkg)).toEqual(bare);
  });

  it("strips a section group's own consumed style ref even when its children are otherwise unaffected", () => {
    const cellsTable = table([["cell"]]);
    const pkg = wordprocessingPackage(
      [sectionGroup([cellsTable], { style: "outer" })],
      { styles },
    );
    const resolved = effectivePackage(pkg);
    const group = resolved.children[0]!;
    expect("style" in group).toBe(false);
    asGroup(group);
    expect(group.children[0]).toBe(cellsTable);
  });

  it("returns the identical slide group by reference when nothing in it needs resolving", () => {
    const slide = slideGroup([shapeGroup([table([["x"]])])]);
    const pkg = presentationPackage([slide], { styles });
    expect(effectivePackage(pkg).children[0]).toBe(slide);
  });

  it("strips a slide group's own consumed style ref even when none of its shapes change", () => {
    const slide = slideGroup([shapeGroup([table([["x"]])])], {
      style: "outer",
    });
    const pkg = presentationPackage([slide], { styles });
    const resolvedSlide = effectivePackage(pkg).children[0]!;
    expect("style" in resolvedSlide).toBe(false);
  });

  it("returns the identical sheet group by reference when it carries no style, and a stripped rebuild when it does", () => {
    const noStyleSheet = sheetGroup({ name: "NoStyle" });
    const styledSheet = sheetGroup({ name: "Styled", style: "outer" });
    const pkg = spreadsheetPackage([noStyleSheet, styledSheet], { styles });
    const resolved = effectivePackage(pkg);
    expect(resolved.children[0]).toBe(noStyleSheet);
    expect(resolved.children[1]).not.toBe(styledSheet);
    expect("style" in resolved.children[1]!).toBe(false);
  });

  it("returns the identical draw page group by reference when nothing in it needs resolving", () => {
    const line = vectorLine();
    const page = drawPageGroup([line]);
    const pkg = drawingPackage([page], { styles });
    expect(effectivePackage(pkg).children[0]).toBe(page);
  });

  it("strips a draw page group's own consumed style ref even when its children are unaffected", () => {
    const page = drawPageGroup([vectorLine()], { style: "outer" });
    const pkg = drawingPackage([page], { styles });
    expect("style" in effectivePackage(pkg).children[0]!).toBe(false);
  });

  it("returns the identical shape group by reference when unaffected, and a stripped rebuild when styled but otherwise unchanged", () => {
    const noStyleShape = shapeGroup([table([["x"]])]);
    const styledShape = shapeGroup([table([["x"]])], { style: "outer" });
    const pkg = presentationPackage([slideGroup([noStyleShape, styledShape])], {
      styles,
    });
    const resolved = effectivePackage(pkg);
    asGroup(resolved.children[0]!);
    expect(resolved.children[0].children[0]).toBe(noStyleShape);
    expect(resolved.children[0].children[1]).not.toBe(styledShape);
    asGroup(resolved.children[0].children[1]!);
    expect("style" in resolved.children[0].children[1]).toBe(false);
  });

  it("returns the identical section construct group by reference when unaffected, and a stripped rebuild when styled but otherwise unchanged", () => {
    const noStyleConstruct = sectionConstructGroup([table([["x"]])]);
    const styledConstruct = sectionConstructGroup([table([["x"]])], {
      style: "outer",
    });
    const pkg = wordprocessingPackage(
      [sectionGroup([noStyleConstruct, styledConstruct])],
      { styles },
    );
    const resolved = effectivePackage(pkg);
    const section = resolved.children[0]!;
    asGroup(section);
    expect(section.children[0]).toBe(noStyleConstruct);
    expect(section.children[1]).not.toBe(styledConstruct);
    asGroup(section.children[1]);
    expect("style" in section.children[1]).toBe(false);
  });

  it("returns the identical shape construct group by reference when unaffected, and a stripped rebuild when styled but otherwise unchanged", () => {
    const noStyleConstruct = shapeConstructGroup([table([["x"]])]);
    const styledConstruct = shapeConstructGroup([table([["x"]])], {
      style: "outer",
    });
    const pkg = presentationPackage(
      [slideGroup([shapeGroup([noStyleConstruct, styledConstruct])])],
      { styles },
    );
    const resolved = effectivePackage(pkg);
    asGroup(resolved.children[0]!);
    asGroup(resolved.children[0].children[0]!);
    expect(resolved.children[0].children[0].children[0]).toBe(noStyleConstruct);
    expect(resolved.children[0].children[0].children[1]).not.toBe(
      styledConstruct,
    );
    asGroup(resolved.children[0].children[0].children[1]!);
    expect("style" in resolved.children[0].children[0].children[1]).toBe(false);
  });

  it("rebuilds a section construct group with no own style whose children genuinely changed via an inherited ref", () => {
    // The construct group itself carries no style ref (its own clause is trivially satisfied), but its child paragraph resolves against the OUTER section's inherited "outer" chain and genuinely changes -- proving the children clause is actually evaluated, not just assumed true because the group has no ref of its own.
    const pkg = wordprocessingPackage(
      [
        sectionGroup([sectionConstructGroup([paragraph("Body")])], {
          style: "outer",
        }),
      ],
      { styles },
    );
    const resolved = effectivePackage(pkg);
    expectSchemaValid(resolved, "resolved");
    expect(resolved).toEqual(
      wordprocessingPackage([
        sectionGroup([
          {
            node: { kind: "contentControl", controlType: "richText" },
            children: [
              {
                kind: "paragraph",
                runs: [{ text: "Body", bold: true }],
                indentLeftPt: 24,
              },
            ],
          },
        ]),
      ]),
    );
  });

  it("rebuilds a shape construct group with no own style whose children genuinely changed via an inherited ref", () => {
    const pkg = presentationPackage(
      [
        slideGroup([
          shapeGroup([shapeConstructGroup([paragraph("Body")])], {
            style: "outer",
          }),
        ]),
      ],
      { styles },
    );
    const resolved = effectivePackage(pkg);
    expectSchemaValid(resolved, "presentation resolved");
    asGroup(resolved.children[0]!);
    asGroup(resolved.children[0].children[0]!);
    expect(resolved.children[0].children[0].children[0]).toEqual({
      node: { kind: "contentControl", controlType: "richText" },
      children: [
        {
          kind: "paragraph",
          runs: [{ text: "Body", bold: true }],
          indentLeftPt: 24,
        },
      ],
    });
  });

  it("returns the identical heading group by reference when no style applies anywhere in its chain", () => {
    const heading = headingGroup("Chapter", 1, []);
    const section = sectionGroup([heading]);
    const pkg = wordprocessingPackage([section], { styles });
    expect(effectivePackage(pkg).children[0]).toBe(section);
  });

  it("resolves a nested heading anchor via an inherited style even though it carries no ref of its own", () => {
    const pkg = wordprocessingPackage(
      [
        sectionGroup([
          headingGroup("Outer", 1, [headingGroup("Inner", 2, [])], {
            style: "outer",
          }),
        ]),
      ],
      { styles },
    );
    const resolved = effectivePackage(pkg);
    expectSchemaValid(resolved, "resolved");
    expect(resolved).toEqual(
      wordprocessingPackage([
        sectionGroup([
          {
            node: {
              kind: "paragraph",
              runs: [{ text: "Outer", bold: true }],
              headingLevel: 1,
              indentLeftPt: 24,
            },
            children: [
              {
                node: {
                  kind: "paragraph",
                  runs: [{ text: "Inner", bold: true }],
                  headingLevel: 2,
                  indentLeftPt: 24,
                },
                children: [],
              },
            ],
          },
        ]),
      ]),
    );
  });

  it("returns the identical list group by reference when no style applies anywhere in its chain", () => {
    const list = listGroup("Item", 0, []);
    const section = sectionGroup([list]);
    const pkg = wordprocessingPackage([section], { styles });
    expect(effectivePackage(pkg).children[0]).toBe(section);
  });

  it("resolves a nested list anchor via an inherited style even though it carries no ref of its own", () => {
    const pkg = wordprocessingPackage(
      [
        sectionGroup([
          listGroup("Outer", 0, [listGroup("Inner", 1, [])], {
            style: "outer",
          }),
        ]),
      ],
      { styles },
    );
    const resolved = effectivePackage(pkg);
    expectSchemaValid(resolved, "resolved");
    expect(resolved).toEqual(
      wordprocessingPackage([
        sectionGroup([
          {
            node: {
              kind: "paragraph",
              runs: [{ text: "Outer", bold: true }],
              list: { level: 0 },
              indentLeftPt: 24,
            },
            children: [
              {
                node: {
                  kind: "paragraph",
                  runs: [{ text: "Inner", bold: true }],
                  list: { level: 1 },
                  indentLeftPt: 24,
                },
                children: [],
              },
            ],
          },
        ]),
      ]),
    );
  });

  it("rebuilds a list group whose own anchor and inherited entry are both unaffected, but whose children genuinely changed", () => {
    // Mirrors the heading Grandparent/Parent/Child test above: Parent has no own style but inherits Grandparent's "emptyEntry" chain (a real, non-empty chain that nonetheless resolves to no actual change to Parent's own anchor). Child, nested inside Parent, carries its own REAL style ref and so genuinely changes -- which must still rebuild Parent's own children array, and therefore Parent itself, even though Parent's own anchor/style clauses are both trivially satisfied.
    const pkg = wordprocessingPackage(
      [
        sectionGroup([
          listGroup(
            "Grandparent",
            0,
            [
              listGroup("Parent", 1, [
                listGroup("Child", 2, [], { style: "outer" }),
              ]),
            ],
            { style: "emptyEntry" },
          ),
        ]),
      ],
      { styles },
    );
    const resolved = effectivePackage(pkg);
    expectSchemaValid(resolved, "resolved");
    expect(resolved).toEqual(
      wordprocessingPackage([
        sectionGroup([
          {
            node: {
              kind: "paragraph",
              runs: [{ text: "Grandparent" }],
              list: { level: 0 },
            },
            children: [
              {
                node: {
                  kind: "paragraph",
                  runs: [{ text: "Parent" }],
                  list: { level: 1 },
                },
                children: [
                  {
                    node: {
                      kind: "paragraph",
                      runs: [{ text: "Child", bold: true }],
                      list: { level: 2 },
                      indentLeftPt: 24,
                    },
                    children: [],
                  },
                ],
              },
            ],
          },
        ]),
      ]),
    );
  });

  it("returns a bare paragraph leaf by the identical reference when no style applies to it at all", () => {
    const body = paragraph("body");
    const pkg = wordprocessingPackage([sectionGroup([body])], { styles });
    const section = effectivePackage(pkg).children[0]!;
    asGroup(section);
    expect(section.children[0]).toBe(body);
  });

  it("applies a paragraph-only style entry without touching the paragraph's own runs", () => {
    const paragraphOnly: StylesTable = {
      indentOnly: { paragraph: { indentLeftPt: 30 } },
    };
    const original = paragraph("body");
    const pkg = wordprocessingPackage(
      [sectionGroup([original], { style: "indentOnly" })],
      { styles: paragraphOnly },
    );
    const resolved = effectivePackage(pkg);
    expect(resolved).toEqual(
      wordprocessingPackage([
        sectionGroup([paragraph("body", { indentLeftPt: 30 })]),
      ]),
    );
    // The entry has no run half, so applyEntry must hand back the SAME runs array rather than rebuilding it through an unnecessary map.
    const section = resolved.children[0]!;
    asGroup(section);
    const resolvedLeaf = section.children[0] as ContentParagraph;
    expect(resolvedLeaf.runs).toBe(original.runs);
  });

  it("strips a heading anchor's own consumed style ref even when the entry resolves to no actual change", () => {
    const pkg = wordprocessingPackage(
      [sectionGroup([headingGroup("Chapter", 1, [], { style: "emptyEntry" })])],
      { styles },
    );
    const resolved = effectivePackage(pkg);
    const section = resolved.children[0]!;
    asGroup(section);
    const group = section.children[0]!;
    expect("style" in group).toBe(false);
  });

  it("strips a list anchor's own consumed style ref even when the entry resolves to no actual change", () => {
    const pkg = wordprocessingPackage(
      [sectionGroup([listGroup("Item", 0, [], { style: "emptyEntry" })])],
      { styles },
    );
    const resolved = effectivePackage(pkg);
    const section = resolved.children[0]!;
    asGroup(section);
    const group = section.children[0]!;
    expect("style" in group).toBe(false);
  });

  it("rebuilds a heading group whose own anchor and inherited entry are both unaffected, but whose children genuinely changed", () => {
    // Parent has no own style but inherits Grandparent's "emptyEntry" chain (a real, non-empty chain that nonetheless resolves to no actual change to Parent's own anchor). Child, nested inside Parent, carries its own REAL style ref and so genuinely changes -- which must still rebuild Parent's own children array, and therefore Parent itself, even though Parent's own anchor/style clauses are both trivially satisfied.
    const pkg = wordprocessingPackage(
      [
        sectionGroup([
          headingGroup(
            "Grandparent",
            1,
            [
              headingGroup("Parent", 2, [
                headingGroup("Child", 3, [], { style: "outer" }),
              ]),
            ],
            { style: "emptyEntry" },
          ),
        ]),
      ],
      { styles },
    );
    const resolved = effectivePackage(pkg);
    expectSchemaValid(resolved, "resolved");
    expect(resolved).toEqual(
      wordprocessingPackage([
        sectionGroup([
          {
            node: {
              kind: "paragraph",
              runs: [{ text: "Grandparent" }],
              headingLevel: 1,
            },
            children: [
              {
                node: {
                  kind: "paragraph",
                  runs: [{ text: "Parent" }],
                  headingLevel: 2,
                },
                children: [
                  {
                    node: {
                      kind: "paragraph",
                      runs: [{ text: "Child", bold: true }],
                      headingLevel: 3,
                      indentLeftPt: 24,
                    },
                    children: [],
                  },
                ],
              },
            ],
          },
        ]),
      ]),
    );
  });

  it("throws loudly on a ref the styles table does not carry", () => {
    const pkg = wordprocessingPackage(
      [sectionGroup([paragraph("body")], { style: "missing" })],
      { styles },
    );
    expect(() => effectivePackage(pkg)).toThrow(/missing/);
  });

  it("law ii: the resolved factored tree deep-equals its unfactored twin", () => {
    const factored = wordprocessingPackage(
      [
        sectionGroup([
          headingGroup("Chapter", 1, [paragraph("body")], { style: "outer" }),
        ]),
      ],
      { styles },
    );
    const twin = wordprocessingPackage([
      sectionGroup([
        {
          node: {
            kind: "paragraph",
            runs: [{ text: "Chapter", bold: true }],
            headingLevel: 1,
            indentLeftPt: 24,
          },
          children: [
            {
              kind: "paragraph",
              runs: [{ text: "body", bold: true }],
              indentLeftPt: 24,
            },
          ],
        },
      ]),
    ]);
    const resolved = effectivePackage(factored);
    expectSchemaValid(resolved, "resolved");
    expect(resolved).toEqual(twin);
  });
});

describe("assertResolvedHeadingAnchor", () => {
  it("throws if a resolved heading anchor ever comes back without its headingLevel -- a document-schema.js fill-only contract regression, never reachable through effectivePackage's own construction", () => {
    const droppedHeadingLevel: ContentParagraph = {
      kind: "paragraph",
      runs: [{ text: "orphaned" }],
    };
    expect(() => {
      assertResolvedHeadingAnchor(droppedHeadingLevel);
    }).toThrow(
      "effectivePackage: resolution dropped a heading anchor's headingLevel",
    );
  });

  it("does not throw once headingLevel is present", () => {
    const withHeadingLevel: ContentParagraph = {
      kind: "paragraph",
      runs: [{ text: "titled" }],
      headingLevel: 2,
    };
    expect(() => {
      assertResolvedHeadingAnchor(withHeadingLevel);
    }).not.toThrow();
  });
});

describe("assertResolvedListAnchor", () => {
  it("throws if a resolved list anchor ever comes back without its list membership -- a document-schema.js fill-only contract regression, never reachable through effectivePackage's own construction", () => {
    const droppedListMembership: ContentParagraph = {
      kind: "paragraph",
      runs: [{ text: "orphaned" }],
    };
    expect(() => {
      assertResolvedListAnchor(droppedListMembership);
    }).toThrow(
      "effectivePackage: resolution dropped a list anchor's list membership",
    );
  });

  it("does not throw once list membership is present", () => {
    const withListMembership: ContentParagraph = {
      kind: "paragraph",
      runs: [{ text: "itemised" }],
      list: { level: 0 },
    };
    expect(() => {
      assertResolvedListAnchor(withListMembership);
    }).not.toThrow();
  });
});
