import { describe, expect, it } from "vitest";
import {
  documentTreeWithSchema,
  type ContentParagraph,
  type DocumentTree,
  type StylesTable,
} from "document-schema.js";
import {
  orderKeys,
  projectDocumentGraph,
  type GraphNode,
  type PropertyGraph,
} from "./graph";
import {
  expectSchemaValid,
  nodeByText,
} from "../test-support/graph-assertions";
import {
  drawPageGroup,
  drawingPackage,
  embeddedObject,
  formulaPackage,
  headingGroup,
  listGroup,
  minimalSymbolTable,
  paragraph,
  presentationPackage,
  sectionGroup,
  shapeGroup,
  sheetGroup,
  sheetImage,
  slideGroup,
  spreadsheetPackage,
  vectorLine,
  vectorRect,
  wordprocessingPackage,
} from "../test-support/fixtures";

// The worked example of ExaDev/documents.js#659: a report document whose heading paragraph carries a styles-table ref, plus a second document sharing the boilerplate line and the heading style content but nothing else. The projection must share exactly those two things and nothing besides.
const H1_BOLD_RUN = { bold: true, fontFamily: "Times New Roman" };
const REPORT_STYLES: StylesTable = { "h1-bold": { run: H1_BOLD_RUN } };
const MEMO_STYLES: StylesTable = { "heading-1": { run: H1_BOLD_RUN } }; // same entry content, different local key

function reportPackage(
  boilerplate: ReturnType<typeof paragraph>,
): DocumentTree {
  return wordprocessingPackage(
    [
      sectionGroup([
        headingGroup(
          "Summary",
          1,
          [
            boilerplate,
            {
              kind: "paragraph",
              runs: [
                {
                  text: "Revenue grew 12% quarter over quarter.",
                  italic: true,
                },
              ],
            },
          ],
          { style: "h1-bold" },
        ),
      ]),
    ],
    {
      metadata: { title: "Q3 Report", author: "Alice" },
      styles: REPORT_STYLES,
    },
  );
}

function memoPackage(boilerplate: ReturnType<typeof paragraph>): DocumentTree {
  return wordprocessingPackage(
    [
      sectionGroup([
        headingGroup("Memo", 1, [boilerplate], { style: "heading-1" }),
      ]),
    ],
    {
      metadata: { title: "Staff Memo" },
      styles: MEMO_STYLES,
    },
  );
}

function nodesOf(graph: PropertyGraph, kind: string): GraphNode[] {
  return graph.nodes.filter((node) => node.kind === kind);
}

function edgesBetween(
  graph: PropertyGraph,
  from: string,
  kind: string,
): PropertyGraph["edges"][number][] {
  return graph.edges.filter((edge) => edge.from === from && edge.kind === kind);
}

describe("every document kind projects", () => {
  it("presentation: slide and shape groups with list nesting", () => {
    const pkg = presentationPackage([
      slideGroup([
        shapeGroup([listGroup("Top", 0, [listGroup("Nested", 1, [])])]),
      ]),
    ]);
    expectSchemaValid(pkg, "presentation");
    const graph = projectDocumentGraph([{ id: "deck", package: pkg }]);
    // Both list anchors are paragraphs in the tree vocabulary, so the projected kinds name payloads, not wrappers.
    expect(graph.nodes.map((node) => node.kind).sort()).toEqual([
      "documentTree",
      "paragraph",
      "paragraph",
      "shape",
      "slide",
    ]);
    const slide = graph.nodes.find((node) => node.kind === "slide")!;
    const shape = graph.nodes.find((node) => node.kind === "shape")!;
    const top = nodeByText(graph, "Top");
    expect(graph.edges).toEqual([
      {
        from: "deck",
        to: slide.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
      {
        from: slide.id,
        to: shape.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
      {
        from: shape.id,
        to: top.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
      {
        from: top.id,
        to: nodeByText(graph, "Nested").id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
    ]);
  });

  it("spreadsheet: sheet node with image and embedded-object children, envelope facts inline", () => {
    const pkg = spreadsheetPackage(
      [
        sheetGroup({
          name: "Revenue",
          images: [sheetImage("chart")],
          embeddedObjects: [embeddedObject()],
        }),
      ],
      {
        pages: [{ widthPt: 842, heightPt: 595 }],
      },
    );
    expectSchemaValid(pkg, "spreadsheet");
    const graph = projectDocumentGraph([{ id: "book", package: pkg }]);
    expect(graph.nodes.map((node) => node.kind).sort()).toEqual([
      "documentTree",
      "embeddedObject",
      "image",
      "sheet",
    ]);
    const root = graph.nodes.find((node) => node.kind === "documentTree")!;
    expect(root.pages).toEqual([{ widthPt: 842, heightPt: 595 }]);
    const sheet = graph.nodes.find((node) => node.kind === "sheet")!;
    expect(sheet).toMatchObject({ kind: "sheet", name: "Revenue" });
    const contains = graph.edges.filter(
      (edge) => edge.from === sheet.id && edge.kind === "CONTAINS",
    );
    expect(
      contains.map((edge) => [
        edge.orderKey,
        graph.nodes.find((node) => node.id === edge.to)!.kind,
      ]),
    ).toEqual([
      [orderKeys.orderKeyForIndex(0), "image"],
      [orderKeys.orderKeyForIndex(1), "embeddedObject"],
    ]);
  });

  it("drawing: draw page with shapes and vector leaves", () => {
    const pkg = drawingPackage([
      drawPageGroup([
        shapeGroup([paragraph("Caption.")]),
        vectorLine(),
        vectorRect(),
      ]),
    ]);
    expectSchemaValid(pkg, "drawing");
    const graph = projectDocumentGraph([{ id: "poster", package: pkg }]);
    expect(graph.nodes.map((node) => node.kind).sort()).toEqual([
      "documentTree",
      "drawPage",
      "line",
      "paragraph",
      "rect",
      "shape",
    ]);
    const page = graph.nodes.find((node) => node.kind === "drawPage")!;
    const contains = graph.edges.filter(
      (edge) => edge.from === page.id && edge.kind === "CONTAINS",
    );
    expect(
      contains.map((edge) => [
        edge.orderKey,
        graph.nodes.find((node) => node.id === edge.to)!.kind,
      ]),
    ).toEqual([
      [orderKeys.orderKeyForIndex(0), "shape"],
      [orderKeys.orderKeyForIndex(1), "line"],
      [orderKeys.orderKeyForIndex(2), "rect"],
    ]);
  });

  it("formula: the single leaf is the whole tree", () => {
    const pkg = formulaPackage("x^2");
    expectSchemaValid(pkg, "formula");
    const graph = projectDocumentGraph([{ id: "eq", package: pkg }]);
    expect(graph.nodes.map((node) => node.kind).sort()).toEqual([
      "documentTree",
      "formula",
    ]);
    expect(graph.edges).toEqual([
      {
        from: "eq",
        to: graph.nodes.find((node) => node.kind === "formula")!.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
    ]);
  });
});

describe("projectDocumentGraph", () => {
  it("includes symbolTable and source on the root only when the package actually carries them", () => {
    const bare = wordprocessingPackage([sectionGroup([paragraph("Body.")])]);
    const bareRoot = projectDocumentGraph([
      { id: "doc", package: bare },
    ]).nodes.find((node) => node.kind === "documentTree")!;
    expect("symbolTable" in bareRoot).toBe(false);
    expect("source" in bareRoot).toBe(false);
    expect("pages" in bareRoot).toBe(false);

    const withEnvelope: DocumentTree = {
      ...wordprocessingPackage([sectionGroup([paragraph("Body.")])], {
        symbolTable: minimalSymbolTable(),
        pages: [{ widthPt: 595, heightPt: 842 }],
      }),
      source: { part1: { format: "docx", xml: "<a/>" } },
    };
    expectSchemaValid(withEnvelope, "withEnvelope");
    const fullRoot = projectDocumentGraph([
      { id: "doc", package: withEnvelope },
    ]).nodes.find((node) => node.kind === "documentTree")!;
    expect(fullRoot.symbolTable).toEqual(minimalSymbolTable());
    expect(fullRoot.source).toEqual({
      part1: { format: "docx", xml: "<a/>" },
    });
    expect(fullRoot.pages).toEqual([{ widthPt: 595, heightPt: 842 }]);
  });

  it("is deterministic: the same input projects to the same graph, nodes and edges in the same order", () => {
    const boilerplate = paragraph("Please see attached.");
    const first = projectDocumentGraph([
      { id: "report-1", package: reportPackage(boilerplate) },
      { id: "memo-1", package: memoPackage(boilerplate) },
    ]);
    const second = projectDocumentGraph([
      { id: "report-1", package: reportPackage(boilerplate) },
      { id: "memo-1", package: memoPackage(boilerplate) },
    ]);
    expect(second).toEqual(first);
  });

  it("emits table-entry nodes in content order, so differently spelled key sets yield the same graph", () => {
    const boldRun = { run: { bold: true } };
    const italicRun = { run: { italic: true } };
    // The same two entries and the same referencing tree, under two different key spellings and two different insertion orders.
    const spelledA = wordprocessingPackage(
      [
        sectionGroup([
          headingGroup("One", 1, [], { style: "bold" }),
          headingGroup("Two", 2, [], { style: "italic" }),
        ]),
      ],
      { styles: { bold: boldRun, italic: italicRun } },
    );
    const spelledB = wordprocessingPackage(
      [
        sectionGroup([
          headingGroup("One", 1, [], { style: "weight" }),
          headingGroup("Two", 2, [], { style: "slant" }),
        ]),
      ],
      { styles: { slant: italicRun, weight: boldRun } },
    );
    expectSchemaValid(spelledA, "spelledA");
    expectSchemaValid(spelledB, "spelledB");

    const graphA = projectDocumentGraph([{ id: "doc", package: spelledA }]);
    const graphB = projectDocumentGraph([{ id: "doc", package: spelledB }]);
    // Root nodes identical (same id, same envelope); every content node identical and in the same order.
    expect(graphB.nodes.filter((node) => node.kind !== "documentTree")).toEqual(
      graphA.nodes.filter((node) => node.kind !== "documentTree"),
    );
    expect(graphB.edges).toEqual(graphA.edges);

    // The deref-before-hash rule itself: two documents whose identical paragraphs reference identical entry content under different keys produce the identical referencing node — the two spellings collapse onto one shared subgraph, distinct only at their roots.
    const cross = projectDocumentGraph([
      { id: "a", package: spelledA },
      { id: "b", package: spelledB },
    ]);
    const styleNodes = cross.nodes.filter((node) => node.kind === "styleEntry");
    expect(styleNodes).toHaveLength(2);
    const headingNodes = cross.nodes.filter(
      (node) => node.kind === "paragraph" && node.headingLevel !== undefined,
    );
    expect(headingNodes).toHaveLength(2); // 'One' and 'Two', each shared across a and b
    expect(
      cross.nodes
        .filter((node) => node.kind === "documentTree")
        .map((node) => node.id)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(
      cross.edges
        .filter(
          (edge) =>
            edge.kind === "CONTAINS" &&
            (edge.from === "a" || edge.from === "b"),
        )
        .map((edge) => edge.from)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("projects the worked example: containment edges, a shared style node, and a shared boilerplate leaf", () => {
    const boilerplate = paragraph("Please see attached.");
    const report = reportPackage(boilerplate);
    const memo = memoPackage(boilerplate);
    expectSchemaValid(report, "report");
    expectSchemaValid(memo, "memo");

    const graph = projectDocumentGraph([
      { id: "report-1", package: report },
      { id: "memo-1", package: memo },
    ]);

    // The two document roots carry their own caller-assigned ids and their metadata inline.
    const roots = nodesOf(graph, "documentTree");
    expect(roots).toEqual([
      {
        id: "report-1",
        kind: "documentTree",
        documentKind: "wordprocessing",
        metadata: { title: "Q3 Report", author: "Alice" },
      },
      {
        id: "memo-1",
        kind: "documentTree",
        documentKind: "wordprocessing",
        metadata: { title: "Staff Memo" },
      },
    ]);

    // One style entry node shared by both documents (identical entry content, different local keys).
    const styleNodes = nodesOf(graph, "styleEntry");
    expect(styleNodes).toEqual([
      { id: styleNodes[0]?.id, kind: "styleEntry", run: H1_BOLD_RUN },
    ]);
    // A StyleEntry never carries its own `kind` field (only a generic definitions-table entry does), so the face's tenantKind key must be genuinely ABSENT here, not merely undefined-valued — toEqual alone treats {tenantKind: undefined} as equal to no key at all.
    expect("tenantKind" in styleNodes[0]!).toBe(false);
    expect(styleNodes[0]!.id).toMatch(/^[0-9a-f]{64}$/);

    // Each document keeps its own section (its subtree differs), carrying its own payload.
    const sections = nodesOf(graph, "section");
    expect(sections).toHaveLength(2);
    for (const section of sections)
      expect(section).toMatchObject({
        kind: "section",
        pageSize: { widthPt: 595, heightPt: 842 },
      });
    const headings = graph.nodes.filter(
      (node) => node.kind === "paragraph" && node.headingLevel === 1,
    );
    expect(headings).toHaveLength(2);
    const summary = nodeByText(graph, "Summary");
    expect(summary.headingLevel).toBe(1);
    expect("style" in summary).toBe(false);

    // The boilerplate paragraph is ONE node shared by both documents.
    const shared = nodeByText(graph, "Please see attached.");
    const sharedContains = graph.edges.filter(
      (edge) => edge.to === shared.id && edge.kind === "CONTAINS",
    );
    expect(sharedContains).toHaveLength(2);
    expect(sharedContains.map((edge) => edge.from)).toEqual([
      summary.id,
      headings.find((node) => node !== summary)!.id,
    ]);

    // Containment edges are stamped with an orderKey derived from document order.
    const reportSection = sections.find((section) =>
      graph.edges.some(
        (edge) =>
          edge.kind === "CONTAINS" &&
          edge.from === section.id &&
          edge.to === summary.id,
      ),
    )!;
    const rootContains = edgesBetween(graph, "report-1", "CONTAINS");
    expect(rootContains).toEqual([
      {
        from: "report-1",
        to: reportSection.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
    ]);
    const sectionContains = edgesBetween(graph, reportSection.id, "CONTAINS");
    expect(sectionContains).toEqual([
      {
        from: reportSection.id,
        to: summary.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
    ]);
    const summaryContains = edgesBetween(graph, summary.id, "CONTAINS");
    expect(summaryContains.map((edge) => edge.orderKey)).toEqual([
      orderKeys.orderKeyForIndex(0),
      orderKeys.orderKeyForIndex(1),
    ]);
    expect(summaryContains.map((edge) => edge.to)).toEqual([
      shared.id,
      nodeByText(graph, "Revenue grew 12% quarter over quarter.").id,
    ]);

    // Both heading paragraphs point at the one shared style node from their own document's ref, and so does every bare, non-anchor paragraph leaf sitting inside a heading's chain (#660): the boilerplate leaf (shared, so its one inherited edge dedupes across both documents) and report's own second paragraph.
    const revenueParagraph = nodeByText(
      graph,
      "Revenue grew 12% quarter over quarter.",
    );
    const styledBy = graph.edges.filter((edge) => edge.kind === "STYLED_BY");
    expect(styledBy.every((edge) => edge.to === styleNodes[0]!.id)).toBe(true);
    expect(styledBy.map((edge) => edge.from).sort()).toEqual(
      [
        ...headings.map((node) => node.id),
        shared.id,
        revenueParagraph.id,
      ].sort(),
    );
    expect(
      styledBy.every((edge) => edge.orderKey === orderKeys.orderKeyForIndex(0)),
    ).toBe(true);

    // Every node id is unique, and content ids are lowercase hex content hashes.
    expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(
      graph.nodes.length,
    );
    for (const node of graph.nodes) {
      if (node.kind !== "documentTree")
        expect(node.id).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const edge of graph.edges) {
      expect(graph.nodes.some((node) => node.id === edge.from)).toBe(true);
      expect(graph.nodes.some((node) => node.id === edge.to)).toBe(true);
    }
  });

  it("treats a $schema-stamped dump exactly like its parsed original", () => {
    const pkg = wordprocessingPackage([sectionGroup([paragraph("Body.")])], {
      metadata: { title: "T" },
    });
    const stamped = documentTreeWithSchema(pkg);
    expect(projectDocumentGraph([{ id: "doc", package: stamped }])).toEqual(
      projectDocumentGraph([{ id: "doc", package: pkg }]),
    );
  });

  it("excludes a $schema key discovered inside a table entry's own body from both the id and the face", () => {
    // documentTreeWithSchema only ever stamps $schema at the document ROOT, which project()'s own hand-built envelope never copies from `this.pkg` in the first place — so a root-level $schema is excluded structurally, not by walkRecord's own key check. This test instead puts $schema INSIDE a definitions-entry body (a genuine z.looseObject, so an arbitrary extra key is schema-valid), the one place walkRecord's own "$schema" exclusion is actually exercised.
    const withSchemaKey = wordprocessingPackage(
      [sectionGroup([paragraph("Body.")])],
      {
        definitions: {
          n1: {
            kind: "footnote",
            blocks: [],
            $schema: "https://example.test/should-be-stripped",
          },
        },
      },
    );
    const withoutSchemaKey = wordprocessingPackage(
      [sectionGroup([paragraph("Body.")])],
      { definitions: { n1: { kind: "footnote", blocks: [] } } },
    );
    const graphWith = projectDocumentGraph([
      { id: "doc", package: withSchemaKey },
    ]);
    const graphWithout = projectDocumentGraph([
      { id: "doc", package: withoutSchemaKey },
    ]);
    const entryWith = graphWith.nodes.find(
      (node) => node.kind === "definitionEntry",
    )!;
    const entryWithout = graphWithout.nodes.find(
      (node) => node.kind === "definitionEntry",
    )!;
    expect("$schema" in entryWith).toBe(false);
    expect(entryWith.id).toBe(entryWithout.id);
  });

  it("dereferences a run-level anchor extent definition through the owning paragraph node", () => {
    const carrier: ContentParagraph = {
      kind: "paragraph",
      runs: [{ text: "before " }, { text: "words" }, { text: " after" }],
      constructs: [
        {
          descriptor: {
            kind: "anchor",
            anchorType: "footnote",
            name: "1",
            definition: "n1",
          },
          startRun: 1,
          endRun: 3,
        },
      ],
    };
    const pkg = wordprocessingPackage([sectionGroup([carrier])], {
      definitions: {
        n1: {
          kind: "footnote",
          blocks: [{ kind: "paragraph", runs: [{ text: "The note body." }] }],
        },
      },
    });
    expectSchemaValid(pkg, "run-extent");
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const entry = graph.nodes.find((node) => node.kind === "definitionEntry")!;
    const definedBy = graph.edges.filter((edge) => edge.kind === "DEFINED_BY");
    expect(definedBy).toHaveLength(1);
    expect(definedBy[0]!.to).toBe(entry.id);
    expect(definedBy[0]!.path).toEqual([
      "constructs",
      0,
      "descriptor",
      "definition",
    ]);
    const owner = graph.nodes.find((node) => node.id === definedBy[0]!.from)!;
    expect(owner.kind).toBe("paragraph");
    expect(JSON.stringify(owner).includes('"definition"')).toBe(false);
  });

  it("refuses a document id assigned to more than one document", () => {
    const first = wordprocessingPackage([sectionGroup([paragraph("A.")])]);
    const second = wordprocessingPackage([sectionGroup([paragraph("B.")])]);
    expect(() =>
      projectDocumentGraph([
        { id: "same", package: first },
        { id: "same", package: second },
      ]),
    ).toThrow(/document id "same" assigned to more than one document/);
  });
});
