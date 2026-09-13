import { describe, expect, it } from "vitest";
import {
  documentTreeWithSchema,
  DocumentTreeSchema,
  factorStyles,
  type ContentParagraph,
  type DefinitionEntry,
  type DocumentTree,
  type DocumentTreeJson,
  type LayoutMetadata,
  type SectionGroupNode,
  type StylesTable,
} from "document-schema.js";
import { effectivePackage } from "./effective";
import { OrderKeyBudgetExhaustedError } from "./order-keys";
import {
  AmbiguousEdgeError,
  AmbiguousSiblingError,
  boundedOrderKey,
  contentHashV1,
  ContainsCycleError,
  defaultExtractionPolicy,
  dpAt,
  entryIdAscComparator,
  insertEdge,
  insertNode,
  NodeKindMismatchError,
  orderKeyAscComparator,
  orderKeys,
  projectDocumentGraph,
  removeEdge,
  replaceEdge,
  runOrRebalance,
  UnknownEdgeError,
  UnknownSiblingError,
  walkPropertyGraph,
  type ExtractionPolicy,
  type GraphEdge,
  type GraphNode,
  type PropertyGraph,
} from "./graph";
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
  sectionConstructGroup,
  sectionGroup,
  shapeGroup,
  sheetGroup,
  sheetImage,
  slideGroup,
  spreadsheetPackage,
  table,
  vectorLine,
  vectorRect,
  wordprocessingPackage,
} from "../test-support/fixtures";

// The worked example of ExaDev/documents.js#659: a report document whose heading paragraph carries a styles-table ref, plus a second document sharing the boilerplate line and the heading style content but nothing else -- the projection must share exactly those two things and nothing besides.
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

function expectSchemaValid(pkg: DocumentTree, label: string): void {
  const result = DocumentTreeSchema.safeParse(pkg);
  expect(
    result.success
      ? "valid"
      : `invalid (${label}): ${JSON.stringify(result.error.issues[0])}`,
  ).toBe("valid");
}

function nodesOf(graph: PropertyGraph, kind: string): GraphNode[] {
  return graph.nodes.filter((node) => node.kind === kind);
}

function nodeByText(graph: PropertyGraph, text: string): GraphNode {
  const matches = graph.nodes.filter((node) =>
    JSON.stringify(node).includes(JSON.stringify(text)),
  );
  expect(matches.length).toBe(1);
  return matches[0]!;
}

function edgesBetween(
  graph: PropertyGraph,
  from: string,
  kind: string,
): PropertyGraph["edges"][number][] {
  return graph.edges.filter((edge) => edge.from === from && edge.kind === kind);
}

describe("content-addressed deduplication", () => {
  it("splits nodes when the same style KEY names different entry content in two documents", () => {
    const docA = wordprocessingPackage(
      [sectionGroup([headingGroup("Shared", 1, [], { style: "s1" })])],
      {
        styles: { s1: { run: { bold: true } } },
      },
    );
    const docB = wordprocessingPackage(
      [sectionGroup([headingGroup("Shared", 1, [], { style: "s1" })])],
      {
        styles: { s1: { run: { italic: true } } },
      },
    );
    const graph = projectDocumentGraph([
      { id: "a", package: docA },
      { id: "b", package: docB },
    ]);
    // Hashing the bare ref key would wrongly merge these; the entry content keeps them apart, cascading to the referencing headings.
    expect(
      graph.nodes.filter((node) => node.kind === "styleEntry"),
    ).toHaveLength(2);
    const headings = graph.nodes.filter(
      (node) => node.kind === "paragraph" && node.headingLevel === 1,
    );
    expect(headings).toHaveLength(2);
    expect(headings[0]!.id).not.toBe(headings[1]!.id);
  });

  it("collapses an identical whole subtree to one shared subtree with only seam edges per document", () => {
    const sharedSection = sectionGroup([
      headingGroup("Terms", 1, [paragraph("All rights reserved.")]),
      paragraph("Fine print."),
    ]);
    const docA = wordprocessingPackage(
      [sharedSection, sectionGroup([paragraph("Document A only.")])],
      { metadata: { title: "A" } },
    );
    const docB = wordprocessingPackage(
      [sectionGroup([paragraph("Document B only.")]), sharedSection],
      { metadata: { title: "B" } },
    );
    const graph = projectDocumentGraph([
      { id: "a", package: docA },
      { id: "b", package: docB },
    ]);
    expectSchemaValid(docA, "docA");
    expectSchemaValid(docB, "docB");
    const sections = graph.nodes.filter((node) => node.kind === "section");
    expect(sections).toHaveLength(3); // the shared one plus each document's own final section
    const shared = sections.find((section) =>
      graph.edges.some(
        (edge) =>
          edge.kind === "CONTAINS" &&
          edge.from === section.id &&
          edge.orderKey === orderKeys.orderKeyForIndex(0) &&
          graph.edges.some(
            (rootEdge) =>
              rootEdge.kind === "CONTAINS" &&
              rootEdge.from === "a" &&
              rootEdge.to === section.id,
          ),
      ),
    )!;
    // One shared section node, referenced by each document's own root at its own local orderKey.
    const seams = graph.edges.filter(
      (edge) => edge.kind === "CONTAINS" && edge.to === shared.id,
    );
    expect(
      seams
        .map((edge) => ({ from: edge.from, orderKey: edge.orderKey }))
        .sort((x, y) => x.from.localeCompare(y.from)),
    ).toEqual([
      { from: "a", orderKey: orderKeys.orderKeyForIndex(0) },
      { from: "b", orderKey: orderKeys.orderKeyForIndex(1) },
    ]);
    // Every descendant of the shared section is also emitted exactly once: the heading anchor, two paragraphs, and each document's own leaf.
    expect(
      graph.nodes.filter((node) => node.kind === "paragraph"),
    ).toHaveLength(5);
  });

  it("deduplicates repeated content within one document: one node, one edge per position", () => {
    const repeated = paragraph("Standard disclaimer.");
    const pkg = wordprocessingPackage([
      sectionGroup([repeated, paragraph("Body."), repeated]),
    ]);
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const matches = graph.nodes.filter(
      (node) =>
        node.kind === "paragraph" &&
        JSON.stringify(node).includes("Standard disclaimer."),
    );
    expect(matches).toHaveLength(1);
    const contains = graph.edges.filter(
      (edge) => edge.to === matches[0]!.id && edge.kind === "CONTAINS",
    );
    expect(contains.map((edge) => edge.orderKey)).toEqual([
      orderKeys.orderKeyForIndex(0),
      orderKeys.orderKeyForIndex(2),
    ]);
  });
});

describe("Merkle-DAG edit behaviour", () => {
  const before = () =>
    wordprocessingPackage([
      sectionGroup([paragraph("First."), paragraph("Last.")]),
    ]);
  const after = () =>
    wordprocessingPackage([
      sectionGroup([
        paragraph("First."),
        paragraph("Inserted."),
        paragraph("Last."),
      ]),
    ]);

  it("insertion between siblings changes no sibling identity, only local orderKey values", () => {
    const beforeGraph = projectDocumentGraph([
      { id: "doc", package: before() },
    ]);
    const afterGraph = projectDocumentGraph([{ id: "doc", package: after() }]);
    const idOf = (graph: PropertyGraph, text: string) =>
      nodeByText(graph, text).id;
    expect(idOf(afterGraph, "First.")).toBe(idOf(beforeGraph, "First."));
    expect(idOf(afterGraph, "Last.")).toBe(idOf(beforeGraph, "Last."));
    const afterSection = afterGraph.nodes.find(
      (node) => node.kind === "section",
    )!;
    const orders = afterGraph.edges
      .filter(
        (edge) => edge.from === afterSection.id && edge.kind === "CONTAINS",
      )
      .map((edge) => ({ orderKey: edge.orderKey, to: edge.to }));
    expect(orders).toEqual([
      {
        orderKey: orderKeys.orderKeyForIndex(0),
        to: idOf(afterGraph, "First."),
      },
      {
        orderKey: orderKeys.orderKeyForIndex(1),
        to: idOf(afterGraph, "Inserted."),
      },
      {
        orderKey: orderKeys.orderKeyForIndex(2),
        to: idOf(afterGraph, "Last."),
      },
    ]);
  });

  it("modification mints a new node and new ancestors while the old nodes persist beside them", () => {
    const edited = wordprocessingPackage([
      sectionGroup([paragraph("First, revised."), paragraph("Last.")]),
    ]);
    const graph = projectDocumentGraph([
      { id: "v1", package: before() },
      { id: "v2", package: edited },
    ]);
    const v1First = nodeByText(graph, "First.");
    const v2First = nodeByText(graph, "First, revised.");
    expect(v1First.id).not.toBe(v2First.id);
    // The Merkle cascade: every ancestor of the edited leaf is a new node too, so the two sections are distinct.
    expect(graph.nodes.filter((node) => node.kind === "section")).toHaveLength(
      2,
    );
    // The unchanged sibling keeps its identity and is shared by both versions.
    const last = graph.nodes.filter(
      (node) =>
        node.kind === "paragraph" && JSON.stringify(node).includes("Last."),
    );
    expect(last).toHaveLength(1);
    expect(
      graph.edges.filter(
        (edge) => edge.kind === "CONTAINS" && edge.to === last[0]!.id,
      ),
    ).toHaveLength(2);
  });
});

describe("definitions tables", () => {
  const NOTE_BODY: DefinitionEntry = {
    kind: "footnote",
    blocks: [{ kind: "paragraph", runs: [{ text: "The note body." }] }],
  };

  function footnotePackage(
    styleKey: string,
    definitionKey = "n1",
  ): DocumentTree {
    return wordprocessingPackage(
      [
        sectionGroup([
          {
            node: {
              kind: "anchor",
              anchorType: "footnote",
              name: "1",
              definition: definitionKey,
            },
            children: [],
          },
          paragraph("Body text."),
        ]),
      ],
      {
        styles: { [styleKey]: { run: { bold: true } } },
        definitions: { [definitionKey]: NOTE_BODY },
      },
    );
  }

  it("projects an anchor definition ref as a DEFINED_BY edge to a definitionEntry node", () => {
    const pkg = footnotePackage("bold");
    expectSchemaValid(pkg, "footnote");
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);

    const entryNodes = graph.nodes.filter(
      (node) => node.kind === "definitionEntry",
    );
    // The entry's own tenant discriminator re-houses under tenantKind; the graph kind names the table.
    expect(entryNodes).toEqual([
      {
        id: entryNodes[0]!.id,
        kind: "definitionEntry",
        tenantKind: "footnote",
        blocks: NOTE_BODY.blocks,
      },
    ]);

    const anchorNode = graph.nodes.find((node) => node.kind === "anchor")!;
    expect(anchorNode).toMatchObject({
      kind: "anchor",
      anchorType: "footnote",
      name: "1",
    });
    expect("definition" in anchorNode).toBe(false); // the local key never reaches the node face
    expect(graph.edges.filter((edge) => edge.kind === "DEFINED_BY")).toEqual([
      {
        from: anchorNode.id,
        to: entryNodes[0]!.id,
        kind: "DEFINED_BY",
        orderKey: orderKeys.orderKeyForIndex(0),
        path: ["definition"],
      },
    ]);
  });

  it("deduplicates anchor refs across documents naming the same entry content differently", () => {
    // Document b spells the identical entry under a different key and references it from an identically-shaped anchor.
    const a = footnotePackage("bold");
    const b = footnotePackage("bold", "noteOne");
    expectSchemaValid(b, "footnote-b");
    const graph = projectDocumentGraph([
      { id: "a", package: a },
      { id: "b", package: b },
    ]);
    expect(
      graph.nodes.filter((node) => node.kind === "definitionEntry"),
    ).toHaveLength(1);
    expect(graph.nodes.filter((node) => node.kind === "anchor")).toHaveLength(
      1,
    );
    expect(
      graph.edges.filter((edge) => edge.kind === "DEFINED_BY"),
    ).toHaveLength(1);
  });

  it("emits definitionEntry nodes for unreferenced entries in every generic table", () => {
    const pkg = wordprocessingPackage([sectionGroup([paragraph("Body.")])], {
      definitions: { n1: NOTE_BODY },
      layers: { ocg1: { kind: "layer", name: "Background" } },
      attachments: { file1: { kind: "attachment", name: "data.csv" } },
      destinations: { top: { kind: "destination", page: 1 } },
    });
    expectSchemaValid(pkg, "tables");
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const entries = graph.nodes.filter(
      (node) => node.kind === "definitionEntry",
    );
    expect(entries).toHaveLength(4); // all four exist whether or not anything references them
    expect(entries.map((node) => node.tenantKind).sort()).toEqual([
      "attachment",
      "destination",
      "footnote",
      "layer",
    ]);
    // Table-entry nodes are flushed sorted by their own content-hash id (project()'s own pendingEntryNodes.sort), so two differently-spelled key sets emit these four nodes in the same, id-ascending order -- comparing the emitted order against a FRESH, independent default sort of the same ids (rather than re-deriving expected ids by hand, which the hash recipe makes impractical) is what actually distinguishes a genuinely-sorted emission from an unsorted or wrongly-ordered one.
    const ids = entries.map((node) => node.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("walks a null-valued property in a definitions entry as a scalar, never as a record", () => {
    // A generic definitions entry is a z.looseObject, so an extra key can carry any JSON value including a bare null -- isRecord's own `value !== null` guard is what keeps typeof null === "object" from being walked as a record (which would throw on Object.keys(null)).
    const pkg = wordprocessingPackage([sectionGroup([paragraph("Body.")])], {
      definitions: { n1: { kind: "footnote", note: null } },
    });
    expectSchemaValid(pkg, "null-valued definitions entry");
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const entry = graph.nodes.find((node) => node.kind === "definitionEntry");
    expect(entry?.note).toBeNull();
  });

  it("refuses a ref the table does not carry, loudly", () => {
    const danglingStyle = wordprocessingPackage(
      [sectionGroup([headingGroup("H", 1, [], { style: "missing" })])],
      {
        styles: { s1: { run: { bold: true } } },
      },
    );
    expect(() =>
      projectDocumentGraph([{ id: "doc", package: danglingStyle }]),
    ).toThrow(/style ref "missing" names no entry in the styles table/);

    const danglingDefinition = wordprocessingPackage(
      [
        sectionGroup([
          {
            node: {
              kind: "anchor",
              anchorType: "footnote",
              name: "1",
              definition: "gone",
            },
            children: [],
          },
        ]),
      ],
      { definitions: { n1: NOTE_BODY } },
    );
    expect(() =>
      projectDocumentGraph([{ id: "doc", package: danglingDefinition }]),
    ).toThrow(/definition ref "gone" names no entry in the definitions table/);
  });

  it('treats a definitions-entry body key spelled "definition" as tenant content, never a table ref', () => {
    // DefinitionEntry bodies are tenant vocabulary, loose by design (src/definitions.ts): a glossary entry legitimately spells `definition` for a term's meaning, so the deref is gated on the containing record being an anchor descriptor, not on the key name. A value that coincidentally names a real key must stay content too -- hashed verbatim, never silently swapped for a ref id.
    const pkg = wordprocessingPackage(
      [
        sectionGroup([
          {
            node: {
              kind: "anchor",
              anchorType: "footnote",
              name: "1",
              definition: "n1",
            },
            children: [],
          },
        ]),
      ],
      {
        definitions: {
          g1: {
            kind: "glossary",
            term: "quorum",
            definition: "the minimum number of members needed",
          },
          g2: { kind: "glossary", term: "proxy", definition: "n1" }, // coincidentally names a real key
          n1: NOTE_BODY,
        },
      },
    );
    expectSchemaValid(pkg, "glossary");
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const glossary = graph.nodes.filter(
      (node) =>
        node.kind === "definitionEntry" && node.tenantKind === "glossary",
    );
    expect(glossary.map((node) => node.definition).sort()).toEqual([
      "n1",
      "the minimum number of members needed",
    ]);
    // The one DEFINED_BY edge is the tree anchor's own ref; neither glossary body produced one.
    expect(
      graph.edges.filter((edge) => edge.kind === "DEFINED_BY"),
    ).toHaveLength(1);
  });

  it("extends deref-before-hash into entry bodies: an entry referencing another entry hashes its content", () => {
    const chain = (secondBody: string): DocumentTree =>
      wordprocessingPackage(
        [
          sectionGroup([
            {
              node: {
                kind: "anchor",
                anchorType: "footnote",
                name: "1",
                definition: "n1",
              },
              children: [],
            },
          ]),
        ],
        {
          definitions: {
            n1: {
              kind: "footnote",
              blocks: [
                {
                  kind: "paragraph",
                  runs: [{ text: "See also." }],
                  constructs: [
                    {
                      descriptor: {
                        kind: "anchor",
                        anchorType: "footnote",
                        name: "2",
                        definition: "n2",
                      },
                      startRun: 0,
                      endRun: 0,
                    },
                  ],
                },
              ],
            },
            n2: {
              kind: "footnote",
              blocks: [{ kind: "paragraph", runs: [{ text: secondBody }] }],
            },
          },
        },
      );
    expectSchemaValid(chain("Second body."), "chain");
    const graphA = projectDocumentGraph([
      { id: "doc", package: chain("Second body.") },
    ]);
    const graphB = projectDocumentGraph([
      { id: "doc", package: chain("Second body, revised.") },
    ]);
    const entryByBody = (graph: PropertyGraph, text: string) =>
      graph.nodes.find(
        (node) =>
          node.kind === "definitionEntry" &&
          JSON.stringify(node).includes(JSON.stringify(text)),
      )!;
    // n2's content feeds n1's hash through the body's anchor deref, so editing n2 mints a new n1 beside it.
    expect(entryByBody(graphA, "See also.").id).not.toBe(
      entryByBody(graphB, "See also.").id,
    );
    expect(entryByBody(graphA, "Second body.").id).not.toBe(
      entryByBody(graphB, "Second body, revised.").id,
    );
  });

  it("refuses a cycle of definition refs among entries by name, not with a stack overflow", () => {
    // Two footnotes whose bodies reference each other -- the mutual-reference case the graph hardenings name as legitimate-looking input. No content hash can cover it (the hash would have to include itself), so the projection refuses it loudly.
    const mutual: DocumentTree = wordprocessingPackage(
      [sectionGroup([paragraph("Body.")])],
      {
        definitions: {
          n1: {
            kind: "footnote",
            blocks: [
              {
                kind: "paragraph",
                runs: [{ text: "See n2." }],
                constructs: [
                  {
                    descriptor: {
                      kind: "anchor",
                      anchorType: "footnote",
                      name: "2",
                      definition: "n2",
                    },
                    startRun: 0,
                    endRun: 0,
                  },
                ],
              },
            ],
          },
          n2: {
            kind: "footnote",
            blocks: [
              {
                kind: "paragraph",
                runs: [{ text: "See n1." }],
                constructs: [
                  {
                    descriptor: {
                      kind: "anchor",
                      anchorType: "footnote",
                      name: "1",
                      definition: "n1",
                    },
                    startRun: 0,
                    endRun: 0,
                  },
                ],
              },
            ],
          },
        },
      },
    );
    expectSchemaValid(mutual, "mutual");
    expect(() =>
      projectDocumentGraph([{ id: "doc", package: mutual }]),
    ).toThrow(/definitions table entry "n1" is reachable from its own body/);
  });

  it("folds an inlined definitions-entry ref's own walked content into the anchor's hash and face, never the bare local key", () => {
    // Mirrors the existing "custom: inlining style entries" coverage, but for the DEFINITIONS tenant specifically: a custom policy that inlines every definitions-table entry takes the anchor's resolveDefinitionRef down the "inline" branch (resolved.id === undefined), which folds resolved.walked.hash/properties directly rather than substituting a DEFINED_BY-edge id.
    const inlineDefinitions: ExtractionPolicy = (path, value) =>
      path.length === 2 && path[0] === "definitions"
        ? "inline"
        : defaultExtractionPolicy(path, value);
    const pkg = wordprocessingPackage(
      [
        sectionGroup([
          {
            node: {
              kind: "anchor",
              anchorType: "footnote",
              name: "1",
              definition: "n1",
            },
            children: [],
          },
        ]),
      ],
      { definitions: { n1: NOTE_BODY } },
    );
    expectSchemaValid(pkg, "inlined definitions ref");
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }], {
      policy: inlineDefinitions,
    });
    // No definitionEntry node was ever minted (the entry was never extracted), and no DEFINED_BY edge exists (an inlined position contributes no edge, per this module's own styleChainEdges-adjacent design note).
    expect(
      graph.nodes.filter((node) => node.kind === "definitionEntry"),
    ).toEqual([]);
    expect(graph.edges.filter((edge) => edge.kind === "DEFINED_BY")).toEqual(
      [],
    );
    // The anchor's own face instead carries the entry's walked content directly under `definition`.
    const anchorNode = graph.nodes.find((node) => node.kind === "anchor")!;
    expect(anchorNode.definition).toEqual(NOTE_BODY);
  });

  it("recordOf refuses a non-record payload loudly rather than silently walking it (a walk bug, not a valid document shape)", () => {
    // A hand-built, deliberately non-schema-valid leaf: TreeLeaf's own type never actually allows an array, so this can only be reached by bypassing the type system exactly as this test does -- the invariant recordOf's own comment names ("every schema payload is a plain record") holds for every real DocumentTree, and this proves the guard actually fires rather than silently walking Object.keys([]) or similar if it were ever violated.
    const malformedPkg = wordprocessingPackage([
      [] as unknown as SectionGroupNode,
    ]);
    expect(() =>
      projectDocumentGraph([{ id: "doc", package: malformedPkg }]),
    ).toThrow(/schema payload is not a plain record/);
  });

  it("decideEntry refuses an entry whose own table slot is explicitly undefined, the same defensive invariant recordOf enforces for non-record payloads", () => {
    // Every real call site (resolveStyleRef/resolveDefinitionRef's own pre-checks, and the root table walk's own Object.keys(table) enumeration) already guarantees a defined entry before decideEntry ever runs -- so this, like the test above, can only be reached by hand-building a table whose value is explicitly `undefined` for one of its own keys, bypassing the type system exactly as this test does.
    const malformedPkg = wordprocessingPackage(
      [sectionGroup([paragraph("Body.")])],
      {
        definitions: { n1: undefined as unknown as DefinitionEntry },
      },
    );
    expect(() =>
      projectDocumentGraph([{ id: "doc", package: malformedPkg }]),
    ).toThrow(/definitions table entry "n1" referenced but not present/);
  });
});

describe("factoring and node identity", () => {
  // One document, two spellings: the unfactored tree carries the recurring tuple inline on every styled paragraph; factorStyles (the minting pass itself) hoists it onto a section wrapper's ref plus a styles-table entry. The projection deliberately hashes each node's own projected content, not style-resolved content, so the two spellings' node ids differ wherever the style rides while everything it does not touch is shared -- and effectivePackage first is the caller's route to factoring-invariant ids, exactly as it already is for leafContentHash.
  const styled = (text: string): ContentParagraph => ({
    kind: "paragraph",
    runs: [{ text, bold: true }],
    alignment: "center",
  });
  const unfactored = (): DocumentTree =>
    wordprocessingPackage([
      sectionGroup([styled("Styled one."), styled("Styled two.")]),
      sectionGroup([paragraph("Plain.")]),
    ]);

  it("gives a factored and an unfactored spelling of one document different styled-node ids, sharing the untouched remainder", () => {
    const factored = factorStyles(unfactored());
    expectSchemaValid(unfactored(), "unfactored");
    expectSchemaValid(factored, "factored");
    // The minting pass really factored the recurring tuple: one entry, hoisted onto the first section's wrapper ref.
    expect(factored.styles).toEqual({
      s1: { paragraph: { alignment: "center" }, run: { bold: true } },
    });

    const factoredGraph = projectDocumentGraph([
      { id: "doc", package: factored },
    ]);
    const unfactoredGraph = projectDocumentGraph([
      { id: "doc", package: unfactored() },
    ]);

    // The plain paragraph, untouched by the style, is the same node in both spellings.
    expect(nodeByText(factoredGraph, "Plain.").id).toBe(
      nodeByText(unfactoredGraph, "Plain.").id,
    );
    // The styled paragraphs are not: the factored hash folds in the style entry's hash, the unfactored hashes the properties inline.
    expect(nodeByText(factoredGraph, "Styled one.").id).not.toBe(
      nodeByText(unfactoredGraph, "Styled one.").id,
    );
    // The extraction difference is visible as nodes and edges the unfactored spelling cannot have.
    expect(
      factoredGraph.nodes.filter((node) => node.kind === "styleEntry"),
    ).toHaveLength(1);
    expect(
      unfactoredGraph.nodes.filter((node) => node.kind === "styleEntry"),
    ).toHaveLength(0);
    // The recurring tuple is hoisted onto the first section's own ref (1 STYLED_BY edge), and both styled paragraphs -- now bare, non-anchor leaves under that styled section -- inherit the chain too (#660): one edge each, 3 in total, all resolving to the same shared style entry.
    expect(
      factoredGraph.edges.filter((edge) => edge.kind === "STYLED_BY"),
    ).toHaveLength(3);
    expect(
      unfactoredGraph.edges.filter((edge) => edge.kind === "STYLED_BY"),
    ).toHaveLength(0);
  });

  it("projects the two spellings to the identical graph once effectivePackage has resolved them", () => {
    const factored = factorStyles(unfactored());
    const resolvedFactored = projectDocumentGraph([
      { id: "doc", package: effectivePackage(factored) },
    ]);
    const resolvedUnfactored = projectDocumentGraph([
      { id: "doc", package: effectivePackage(unfactored()) },
    ]);
    expect(resolvedFactored).toEqual(resolvedUnfactored);
  });
});

describe("extraction policy", () => {
  it("default: metadata stays inline on the root even when identical across documents, and nothing else is extracted", () => {
    const docA = wordprocessingPackage([sectionGroup([paragraph("A body.")])], {
      metadata: { title: "Same title" },
    });
    const docB = wordprocessingPackage([sectionGroup([paragraph("B body.")])], {
      metadata: { title: "Same title" },
    });
    const graph = projectDocumentGraph([
      { id: "a", package: docA },
      { id: "b", package: docB },
    ]);
    expect(graph.nodes.filter((node) => node.kind === "value")).toEqual([]);
    expect(graph.edges.filter((edge) => edge.kind === "PROPERTY")).toEqual([]);
    const roots = graph.nodes.filter((node) => node.kind === "documentTree");
    expect(roots).toHaveLength(2);
    for (const root of roots)
      expect(root.metadata).toEqual({ title: "Same title" });
  });

  it("custom: extracting a recurring scalar promotes it to a shared value node with a PROPERTY edge", () => {
    const extractTitles: ExtractionPolicy = (path, value) =>
      path.length === 2 &&
      path[0] === "metadata" &&
      path[1] === "title" &&
      typeof value === "string"
        ? "extract"
        : "inline";
    const docA = wordprocessingPackage([sectionGroup([paragraph("A body.")])], {
      metadata: { title: "Shared title" },
    });
    const docB = wordprocessingPackage([sectionGroup([paragraph("B body.")])], {
      metadata: { title: "Shared title" },
    });
    const graph = projectDocumentGraph(
      [
        { id: "a", package: docA },
        { id: "b", package: docB },
      ],
      { policy: extractTitles },
    );
    const valueNodes = graph.nodes.filter((node) => node.kind === "value");
    expect(valueNodes).toEqual([
      { id: valueNodes[0]!.id, kind: "value", value: "Shared title" },
    ]);
    const roots = graph.nodes.filter((node) => node.kind === "documentTree");
    expect(roots).toHaveLength(2);
    for (const root of roots)
      expect("title" in (root.metadata as Record<string, unknown>)).toBe(false);
    expect(graph.edges.filter((edge) => edge.kind === "PROPERTY")).toHaveLength(
      2,
    );
    for (const edge of graph.edges.filter((edge) => edge.kind === "PROPERTY")) {
      expect(edge.path).toEqual(["metadata", "title"]);
      expect(edge.to).toBe(valueNodes[0]!.id);
      expect(edge.orderKey).toBe(orderKeys.orderKeyForIndex(0));
    }
  });

  it("custom: inlining style entries folds the dereferenced entry content into the referencing node", () => {
    const inlineStyles: ExtractionPolicy = (path, value) =>
      path.length === 2 && path[0] === "styles"
        ? "inline"
        : defaultExtractionPolicy(path, value);
    const entry = { run: { bold: true } };
    const doc = wordprocessingPackage(
      [sectionGroup([headingGroup("H", 1, [], { style: "s1" })])],
      { styles: { s1: entry } },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: doc }], {
      policy: inlineStyles,
    });
    expect(graph.nodes.filter((node) => node.kind === "styleEntry")).toEqual(
      [],
    );
    expect(graph.edges.filter((edge) => edge.kind === "STYLED_BY")).toEqual([]);
    const heading = graph.nodes.find(
      (node) => node.kind === "paragraph" && node.headingLevel === 1,
    )!;
    // The dereferenced ENTRY CONTENT rides on the node -- never the document-local key 's1'.
    expect(heading.style).toEqual(entry);
    expect(
      graph.nodes.find((node) => node.kind === "documentTree")!.styles,
    ).toEqual({ s1: entry });
  });

  it("emits a DEFINED_BY edge discovered inside a policy-extracted record value nested in a table entry's own body", () => {
    const extractMeta: ExtractionPolicy = (path, value) =>
      path.length === 3 && path[0] === "definitions" && path[2] === "meta"
        ? "extract"
        : defaultExtractionPolicy(path, value);
    const pkg = wordprocessingPackage([sectionGroup([paragraph("Body.")])], {
      definitions: {
        n1: {
          kind: "footnote",
          blocks: [],
          meta: {
            kind: "anchor",
            anchorType: "footnote",
            name: "y",
            definition: "n2",
          },
        },
        n2: { kind: "footnote", blocks: [{ kind: "paragraph", runs: [] }] },
      },
    });
    expectSchemaValid(pkg, "nested extracted anchor");
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }], {
      policy: extractMeta,
    });
    const valueNode = graph.nodes.find((node) => node.kind === "value")!;
    const edges = graph.edges.filter(
      (edge) => edge.kind === "DEFINED_BY" && edge.from === valueNode.id,
    );
    expect(edges).toHaveLength(1);
  });

  it("emits a DEFINED_BY edge discovered inside a policy-extracted ARRAY value's own elements", () => {
    // mintValueNode's non-record branch (isRecord(value) === false) also covers arrays -- walk() recurses into each element and accumulates their own edges, unlike a genuine scalar which never carries any.
    const extractMeta: ExtractionPolicy = (path, value) =>
      path.length === 3 && path[0] === "definitions" && path[2] === "meta"
        ? "extract"
        : defaultExtractionPolicy(path, value);
    const pkg = wordprocessingPackage([sectionGroup([paragraph("Body.")])], {
      definitions: {
        n1: {
          kind: "footnote",
          blocks: [],
          meta: [
            {
              kind: "anchor",
              anchorType: "footnote",
              name: "y",
              definition: "n2",
            },
          ],
        },
        n2: { kind: "footnote", blocks: [{ kind: "paragraph", runs: [] }] },
      },
    });
    expectSchemaValid(pkg, "nested extracted anchor array");
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }], {
      policy: extractMeta,
    });
    const valueNode = graph.nodes.find((node) => node.kind === "value")!;
    const edges = graph.edges.filter(
      (edge) => edge.kind === "DEFINED_BY" && edge.from === valueNode.id,
    );
    expect(edges).toHaveLength(1);
  });
});

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

    // The deref-before-hash rule itself: two documents whose identical paragraphs reference identical entry content under different keys produce the identical referencing node -- the two spellings collapse onto one shared subgraph, distinct only at their roots.
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
    // A StyleEntry never carries its own `kind` field (only a generic definitions-table entry does), so the face's tenantKind key must be genuinely ABSENT here, not merely undefined-valued -- toEqual alone treats {tenantKind: undefined} as equal to no key at all.
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
    // documentTreeWithSchema only ever stamps $schema at the document ROOT, which project()'s own hand-built envelope never copies from `this.pkg` in the first place -- so a root-level $schema is excluded structurally, not by walkRecord's own key check. This test instead puts $schema INSIDE a definitions-entry body (a genuine z.looseObject, so an arbitrary extra key is schema-valid), the one place walkRecord's own "$schema" exclusion is actually exercised.
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

// The #660 hardening rows, each named in the issue: fractional ordering keys (insertion between siblings touches one edge, never a renumber), the versioned content-hash contract, the no-external-ids rule pinned against face shadowing, ordered STYLED_BY chains (one edge per ancestor entry, outermost first), and the per-kind cycle policy a shared walker applies.

describe("order keys (#660)", () => {
  it("mints lexicographically sorted sibling keys with insertion room between every adjacent pair", () => {
    const pkg = wordprocessingPackage([
      sectionGroup([
        paragraph("First."),
        paragraph("Second."),
        paragraph("Third."),
      ]),
    ]);
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const section = graph.nodes.find((node) => node.kind === "section")!;
    const keys = graph.edges
      .filter((edge) => edge.kind === "CONTAINS" && edge.from === section.id)
      .map((edge) => edge.orderKey)
      .sort();
    expect(keys).toHaveLength(3);
    // Equal-width lexicographic sort is numeric sort: the minted keys sort in document order and leave room between each adjacent pair for a consumer-side insert that touches no sibling edge.
    expect(keys[0]! < keys[1]!).toBe(true);
    expect(keys[1]! < keys[2]!).toBe(true);
    // The mint is index-derived and deterministic: re-projecting the same package yields the identical keys.
    const again = projectDocumentGraph([{ id: "doc", package: pkg }]);
    expect(
      again.edges
        .filter((edge) => edge.kind === "CONTAINS" && edge.from === section.id)
        .map((edge) => edge.orderKey)
        .sort(),
    ).toEqual(keys);
  });

  it("orderKeyBetween mints a key strictly between two neighbours, and refuses loudly when the room is exhausted", () => {
    const { orderKeyForIndex, orderKeyBetween } = orderKeys;
    const first = orderKeyForIndex(0);
    const second = orderKeyForIndex(1);
    const mid = orderKeyBetween(first, second);
    expect(first < mid && mid < second).toBe(true);
    // Nested midpoints keep landing in the shrinking interval until the digits run out -- the documented rebalance signal, not a silent duplicate.
    let low = first;
    let landed = true;
    for (let i = 0; i < 10_000 && landed; i += 1) {
      try {
        const next = orderKeyBetween(low, mid);
        if (!(low < next && next < mid))
          throw new Error("midpoint out of interval");
        low = next;
      } catch {
        landed = false;
      }
    }
    expect(landed).toBe(false);
  });

  it("renumberedOrderKeys re-mints a fresh, roomy sibling list (the rebalance operation)", () => {
    const { orderKeyForIndex, renumberedOrderKeys } = orderKeys;
    expect(renumberedOrderKeys(3)).toEqual([
      orderKeyForIndex(0),
      orderKeyForIndex(1),
      orderKeyForIndex(2),
    ]);
  });
});

describe("contentHashV1 (#660)", () => {
  it("is the projection's named hash contract: identical content carries identical ids regardless of the $schema release label it was serialised under", () => {
    const docA = wordprocessingPackage([sectionGroup([paragraph("Same.")])]);
    const docB = wordprocessingPackage([sectionGroup([paragraph("Same.")])]);
    // Two serialisation labels naming two different schema releases -- additive-compatible releases stamp different URIs on the same semantics, and the recipe strips the label before hashing.
    const taggedA: DocumentTreeJson = {
      ...documentTreeWithSchema(docA),
      $schema: "https://exadev.dev/schemas/document-tree@4.1.0/schema.json",
    };
    const taggedB: DocumentTreeJson = {
      ...documentTreeWithSchema(docB),
      $schema: "https://exadev.dev/schemas/document-tree@4.9.0/schema.json",
    };
    const a = projectDocumentGraph([{ id: "a", package: taggedA }]);
    const b = projectDocumentGraph([{ id: "b", package: taggedB }]);
    const idA = nodeByText(a, "Same.").id;
    const idB = nodeByText(b, "Same.").id;
    expect(idA).toBe(idB);
    expect(contentHashV1({ text: "Same." })).toBe(
      contentHashV1({ text: "Same." }),
    );
    expect(contentHashV1({ text: "A" })).not.toBe(contentHashV1({ text: "B" }));
  });

  it("is stable across additive schema growth: a field a later release added and this document never populated hashes the same as the field present but explicitly unset", () => {
    // No multi-version document-schema.js fixtures exist in this repo (only one version is ever installed at a time), so the additive-compatible-schema-versions guarantee is operationalised directly against the mechanism that provides it: JSON.stringify drops undefined-valued keys (hash.ts's own step 3), so "the field was never in this shape" and "the field is in scope but this document leaves it unset" must hash identically.
    const withoutField = contentHashV1({ metadata: { title: "X" } });
    const withFieldUndefined = contentHashV1({
      metadata: { title: "X", author: undefined },
    });
    expect(withFieldUndefined).toBe(withoutField);
  });
});

describe("no externally supplied node ids (#660)", () => {
  it("ignores an id-shaped field in content: the body value is hashed verbatim and never becomes the node's identity", () => {
    // A table entry whose body spells the face's reserved word -- the projection's own hash decides the id, so a caller cannot steer it.
    const pkg = wordprocessingPackage([sectionGroup([paragraph("Body.")])], {
      definitions: {
        n1: {
          kind: "footnote",
          label: "1",
          id: "caller-chosen",
          body: "note text",
        },
      },
    });
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const entry = graph.nodes.find((node) => node.tenantKind === "footnote")!;
    expect(entry.id).not.toBe("caller-chosen");
  });

  it("ignores an id-shaped field on a group anchor's own node payload (projectGroup)", () => {
    // The anchor's own content spells the face's reserved word directly on the node, not inside a table entry -- projectGroup's mint site must shadow it exactly as entryNodeFace's does.
    const anchorNode: ContentParagraph & { headingLevel: number; id: string } =
      {
        kind: "paragraph",
        runs: [{ text: "Anchored." }],
        headingLevel: 1,
        id: "caller-chosen",
      };
    const pkg = wordprocessingPackage([
      sectionGroup([{ node: anchorNode, children: [] }]),
    ]);
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const heading = graph.nodes.find(
      (node) => node.kind === "paragraph" && node.headingLevel === 1,
    )!;
    expect(heading.id).not.toBe("caller-chosen");
  });

  it("ignores an id-shaped field in an extracted value's own content (mintValueNode)", () => {
    // A custom policy promotes the whole metadata record to a shared value node; the record itself spells the face's reserved word, which mintValueNode's record branch must shadow exactly as the other mint sites do.
    const metadataWithId: LayoutMetadata & { id: string } = {
      title: "T",
      id: "caller-chosen",
    };
    const pkg = wordprocessingPackage([sectionGroup([paragraph("Body.")])], {
      metadata: metadataWithId,
    });
    const extractMetadata: ExtractionPolicy = (path) =>
      path.length === 1 && path[0] === "metadata" ? "extract" : "inline";
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }], {
      policy: extractMetadata,
    });
    const valueNode = graph.nodes.find((node) => node.kind === "value")!;
    expect(valueNode.id).not.toBe("caller-chosen");
    expect(valueNode.title).toBe("T"); // the record's own content still rides through, only the reserved word is shadowed
  });
});

describe("ordered STYLED_BY chains (#660)", () => {
  it("emits one edge per ancestor chain entry, outermost first, so walking in orderKey order reconstructs the resolution chain", () => {
    // A section wrapper styled s1 containing a heading wrapper styled s2: the heading's chain is [s1, s2] -- outermost first, nearest last, exactly the order effectivePackage overlays in.
    const pkg = wordprocessingPackage(
      [
        sectionGroup(
          [headingGroup("T", 1, [paragraph("x.")], { style: "s2" })],
          { style: "s1" },
        ),
      ],
      {
        styles: { s1: { run: { bold: true } }, s2: { run: { italic: true } } },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const heading = graph.nodes.find(
      (node) => node.kind === "paragraph" && node.headingLevel === 1,
    )!;
    const chain = graph.edges
      .filter((edge) => edge.kind === "STYLED_BY" && edge.from === heading.id)
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    expect(chain).toHaveLength(2);
    const boldEntry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("bold"),
    )!;
    const italicEntry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("italic"),
    )!;
    expect(chain.map((edge) => edge.to)).toEqual([
      boldEntry.id,
      italicEntry.id,
    ]);
  });

  it("emits the full chain for a list anchor exactly as for a heading anchor", () => {
    const pkg = wordprocessingPackage(
      [
        sectionGroup([listGroup("Item", 0, [], { style: "s2" })], {
          style: "s1",
        }),
      ],
      {
        styles: { s1: { run: { bold: true } }, s2: { run: { italic: true } } },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const item = nodeByText(graph, "Item");
    const chain = graph.edges
      .filter((edge) => edge.kind === "STYLED_BY" && edge.from === item.id)
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    const boldEntry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("bold"),
    )!;
    const italicEntry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("italic"),
    )!;
    expect(chain.map((edge) => edge.to)).toEqual([
      boldEntry.id,
      italicEntry.id,
    ]);
  });

  it("emits an inherited-chain edge for a bare, non-anchor paragraph leaf sitting directly in a styled scope", () => {
    const pkg = wordprocessingPackage(
      [sectionGroup([paragraph("Plain body.")], { style: "s1" })],
      {
        styles: { s1: { run: { bold: true } } },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const leaf = nodeByText(graph, "Plain body.");
    const edges = graph.edges.filter(
      (edge) => edge.kind === "STYLED_BY" && edge.from === leaf.id,
    );
    const entry = graph.nodes.find((node) => node.kind === "styleEntry")!;
    expect(edges).toEqual([
      {
        from: leaf.id,
        to: entry.id,
        kind: "STYLED_BY",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
    ]);
  });

  it("emits no STYLED_BY edge for a non-paragraph leaf sitting in the identical styled scope", () => {
    const cells = table([["cell"]]);
    const pkg = wordprocessingPackage(
      [sectionGroup([cells], { style: "s1" })],
      {
        styles: { s1: { run: { bold: true } } },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const tableNode = graph.nodes.find((node) => node.kind === "table")!;
    const edges = graph.edges.filter(
      (edge) => edge.kind === "STYLED_BY" && edge.from === tableNode.id,
    );
    expect(edges).toEqual([]);
  });

  it("threads the chain through three levels of nested anchors down to a bare leaf", () => {
    const pkg = wordprocessingPackage(
      [
        sectionGroup(
          [
            headingGroup(
              "H",
              1,
              [listGroup("Item", 0, [paragraph("Deepest.")], { style: "s3" })],
              { style: "s2" },
            ),
          ],
          { style: "s1" },
        ),
      ],
      {
        styles: {
          s1: { run: { bold: true } },
          s2: { run: { italic: true } },
          s3: { run: { underline: true } },
        },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const deepest = nodeByText(graph, "Deepest.");
    const chain = graph.edges
      .filter((edge) => edge.kind === "STYLED_BY" && edge.from === deepest.id)
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    const s1Entry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("bold"),
    )!;
    const s2Entry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("italic"),
    )!;
    const s3Entry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" &&
        JSON.stringify(node).includes("underline"),
    )!;
    expect(chain.map((edge) => edge.to)).toEqual([
      s1Entry.id,
      s2Entry.id,
      s3Entry.id,
    ]);
  });

  it("a non-anchor styled group emits only its own single ref for itself, but still passes the full chain to its children", () => {
    const pkg = wordprocessingPackage(
      [
        sectionGroup(
          [
            sectionConstructGroup([paragraph("Inside construct.")], {
              style: "s2",
            }),
          ],
          { style: "s1" },
        ),
      ],
      {
        styles: { s1: { run: { bold: true } }, s2: { run: { italic: true } } },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const construct = graph.nodes.find(
      (node) => node.kind === "contentControl",
    )!;
    const s1Entry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("bold"),
    )!;
    const s2Entry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("italic"),
    )!;
    // Non-anchor: only its own direct ref, never the inherited chain -- unchanged from pre-#660 behaviour.
    const constructEdges = graph.edges.filter(
      (edge) => edge.kind === "STYLED_BY" && edge.from === construct.id,
    );
    expect(constructEdges).toEqual([
      {
        from: construct.id,
        to: s2Entry.id,
        kind: "STYLED_BY",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
    ]);
    // Its child leaf still inherits the FULL chain (s1, s2) passed through the non-anchor wrapper.
    const inside = nodeByText(graph, "Inside construct.");
    const leafChain = graph.edges
      .filter((edge) => edge.kind === "STYLED_BY" && edge.from === inside.id)
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    expect(leafChain.map((edge) => edge.to)).toEqual([s1Entry.id, s2Entry.id]);
  });

  it("custom: an inlined ancestor entry in the chain contributes no edge, leaving extracted entries at their own chain position", () => {
    const inlineS1: ExtractionPolicy = (path, value) =>
      path.length === 2 && path[0] === "styles" && path[1] === "s1"
        ? "inline"
        : defaultExtractionPolicy(path, value);
    const pkg = wordprocessingPackage(
      [
        sectionGroup([headingGroup("T", 1, [], { style: "s2" })], {
          style: "s1",
        }),
      ],
      {
        styles: { s1: { run: { bold: true } }, s2: { run: { italic: true } } },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }], {
      policy: inlineS1,
    });
    const heading = graph.nodes.find(
      (node) => node.kind === "paragraph" && node.headingLevel === 1,
    )!;
    const chain = graph.edges.filter(
      (edge) => edge.kind === "STYLED_BY" && edge.from === heading.id,
    );
    // s1 (chain position 0) inlines -- no edge; s2 (chain position 1) is still extracted, at its own chain position.
    const s2Entry = graph.nodes.find((node) => node.kind === "styleEntry")!;
    expect(chain).toEqual([
      {
        from: heading.id,
        to: s2Entry.id,
        kind: "STYLED_BY",
        orderKey: orderKeys.orderKeyForIndex(1),
      },
    ]);
  });
});

describe("walkPropertyGraph (#660)", () => {
  it("sorts outgoing edges by orderKey ascending regardless of the array's own insertion order", () => {
    // Six edges deliberately inserted in a fully reverse-of-ascending order (f, e, d, c, b, a) -- wide enough that no small-array sort implementation quirk (insertion sort, binary insertion, or otherwise) can coincidentally reproduce ascending order from an already-favourable insertion sequence; every adjacent pair in the insertion order is itself a descending pair, so a genuinely-ascending comparator is the only way to reach the expected order.
    const graph: PropertyGraph = {
      nodes: [
        { id: "root", kind: "test" },
        { id: "a", kind: "test" },
        { id: "b", kind: "test" },
        { id: "c", kind: "test" },
        { id: "d", kind: "test" },
        { id: "e", kind: "test" },
        { id: "f", kind: "test" },
      ],
      edges: [
        { from: "root", to: "f", kind: "CONTAINS", orderKey: "f" },
        { from: "root", to: "e", kind: "CONTAINS", orderKey: "e" },
        { from: "root", to: "d", kind: "CONTAINS", orderKey: "d" },
        { from: "root", to: "c", kind: "CONTAINS", orderKey: "c" },
        { from: "root", to: "b", kind: "CONTAINS", orderKey: "b" },
        { from: "root", to: "a", kind: "CONTAINS", orderKey: "a" },
      ],
    };
    const visited = walkPropertyGraph(graph, "root").map(({ node }) => node.id);
    expect(visited).toEqual(["root", "a", "b", "c", "d", "e", "f"]);
  });

  it("still guards a genuine cycle when the requested kinds exclude CONTAINS entirely, not just when CONTAINS is included alongside another kind", () => {
    // needsGuard's own kind-filter check (kinds.some((kind) => kind !== "CONTAINS")) must genuinely test "is some requested kind NOT CONTAINS", not "is CONTAINS among the requested kinds" -- the two conditions agree whenever CONTAINS sits alongside another kind (both true), which is all the sibling test above this one exercises, but they diverge sharply when CONTAINS is excluded from `kinds` altogether: the correct condition is still true (STYLED_BY !== "CONTAINS"), while the swapped one is false (no element equals "CONTAINS"), wrongly skipping the cycle guard's on-path Set entirely.
    const nodes = [
      { id: "a", kind: "x" },
      { id: "b", kind: "x" },
    ];
    const edges = [
      { from: "a", to: "b", kind: "STYLED_BY", orderKey: "k0" },
      { from: "b", to: "a", kind: "STYLED_BY", orderKey: "k0" },
    ];
    const walked = walkPropertyGraph({ nodes, edges }, "a", {
      kinds: ["STYLED_BY"],
    });
    // Without the guard this recurses forever; the assertion below is only reachable at all if the guard genuinely engaged and suppressed the revisit.
    expect(walked.filter(({ node }) => node.id === "a").length).toBe(1);
  });

  it("walks containment-only in document order without a cycle guard (a Merkle DAG is provably acyclic), revisiting a shared node once per path", () => {
    const shared = paragraph("Shared.");
    const pkg = wordprocessingPackage([sectionGroup([shared, shared])]);
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const visited = walkPropertyGraph(graph, "doc", {
      kinds: ["CONTAINS"],
    }).map(({ node }) => node.id);
    // The same shared leaf is reachable by two paths, and the walker reports it per path: termination is the acyclicity guarantee, uniqueness is the caller's to coalesce.
    expect(
      visited.filter(
        (id) => id === visited.find((candidate) => candidate === id),
      ).length,
    ).toBeGreaterThanOrEqual(1);
    expect(visited).toHaveLength(4); // root, section, then the shared leaf once per path
  });

  it("guards reference-kind edges by default: a hand-built cyclic graph terminates, and the cycle is reported rather than looping", () => {
    const nodes = [
      { id: "a", kind: "x" },
      { id: "b", kind: "x" },
    ];
    // Two nodes pointing at each other through DEFINED_BY edges -- the author-supplied-pointer shape the issue names.
    const edges = [
      { from: "a", to: "b", kind: "DEFINED_BY", orderKey: "k0" },
      { from: "b", to: "a", kind: "DEFINED_BY", orderKey: "k0" },
    ];
    const walked = walkPropertyGraph({ nodes, edges }, "a");
    expect(walked.map(({ node }) => node.id)).toContain("b");
    expect(walked.filter(({ node }) => node.id === "a").length).toBe(1); // the revisit was suppressed by the guard
  });

  it("walks every kind present by default, mixing CONTAINS with STYLED_BY and DEFINED_BY in one traversal", () => {
    const pkg = wordprocessingPackage(
      [
        sectionGroup([
          headingGroup(
            "T",
            1,
            [
              {
                node: {
                  kind: "anchor",
                  anchorType: "footnote",
                  name: "1",
                  definition: "n1",
                },
                children: [],
              },
            ],
            { style: "s1" },
          ),
        ]),
      ],
      {
        styles: { s1: { run: { bold: true } } },
        definitions: {
          n1: {
            kind: "footnote",
            blocks: [{ kind: "paragraph", runs: [{ text: "Note." }] }],
          },
        },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const visited = walkPropertyGraph(graph, "doc");
    const kindsSeen = new Set(
      visited
        .map(({ edge }) => edge?.kind)
        .filter((kind): kind is string => kind !== undefined),
    );
    expect(kindsSeen).toEqual(new Set(["CONTAINS", "STYLED_BY", "DEFINED_BY"]));
    // Every node in the graph is reachable from the root once every kind is in play.
    expect(new Set(visited.map(({ node }) => node.id))).toEqual(
      new Set(graph.nodes.map((node) => node.id)),
    );
  });

  it("restricting kinds excludes edges of a kind actually present, not just kinds absent from the graph", () => {
    const pkg = wordprocessingPackage(
      [
        sectionGroup([
          headingGroup("T", 1, [paragraph("Body.")], { style: "s1" }),
        ]),
      ],
      { styles: { s1: { run: { bold: true } } } },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const heading = graph.nodes.find(
      (node) => node.kind === "paragraph" && node.headingLevel === 1,
    )!;
    const body = nodeByText(graph, "Body.");
    // The heading has both a CONTAINS edge to its own body paragraph and a STYLED_BY edge to its style entry -- restricting to STYLED_BY must never surface the CONTAINS-reached body, even though the graph genuinely has CONTAINS edges to filter out.
    const walked = walkPropertyGraph(graph, heading.id, {
      kinds: ["STYLED_BY"],
    });
    expect(walked.map(({ node }) => node.id)).not.toContain(body.id);
  });

  it("still guards a genuine cycle among non-CONTAINS edges even when CONTAINS is also included in the requested kinds", () => {
    const nodes = [
      { id: "a", kind: "x" },
      { id: "b", kind: "x" },
    ];
    const edges = [
      { from: "a", to: "b", kind: "STYLED_BY", orderKey: "k0" },
      { from: "b", to: "a", kind: "STYLED_BY", orderKey: "k0" },
    ];
    const walked = walkPropertyGraph({ nodes, edges }, "a", {
      kinds: ["CONTAINS", "STYLED_BY"],
    });
    expect(walked.filter(({ node }) => node.id === "a").length).toBe(1);
  });

  it("walking STYLED_BY alone in orderKey order reconstructs the resolution chain from a starting anchor", () => {
    const pkg = wordprocessingPackage(
      [
        sectionGroup([headingGroup("T", 1, [], { style: "s2" })], {
          style: "s1",
        }),
      ],
      {
        styles: { s1: { run: { bold: true } }, s2: { run: { italic: true } } },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const heading = graph.nodes.find(
      (node) => node.kind === "paragraph" && node.headingLevel === 1,
    )!;
    const s1Entry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("bold"),
    )!;
    const s2Entry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("italic"),
    )!;
    const walked = walkPropertyGraph(graph, heading.id, {
      kinds: ["STYLED_BY"],
    });
    // The start node itself, then s1 (outermost) before s2 (nearest) -- orderKey order reproduces resolution order.
    expect(walked.map(({ node }) => node.id)).toEqual([
      heading.id,
      s1Entry.id,
      s2Entry.id,
    ]);
  });

  it("WalkedNode.edge names the exact edge traversed to reach each node, and is undefined only for the start node", () => {
    const nodes = [
      { id: "a", kind: "x" },
      { id: "b", kind: "x" },
      { id: "c", kind: "x" },
    ];
    const edges = [
      {
        from: "a",
        to: "b",
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
      {
        from: "a",
        to: "c",
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(1),
      },
    ];
    const walked = walkPropertyGraph({ nodes, edges }, "a");
    expect(walked).toEqual([
      { node: nodes[0], edge: undefined },
      { node: nodes[1], edge: edges[0] },
      { node: nodes[2], edge: edges[1] },
    ]);
  });
});

describe("write API: insertNode / insertEdge (#935)", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("mints a real content-addressed id for a newly inserted node, ignoring an id-shaped field in its own content", () => {
    const { graph, id } = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: {
        kind: "paragraph",
        runs: [{ text: "Inserted." }],
        id: "caller-chosen",
      },
    });
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toBe("caller-chosen");
    const node = graph.nodes.find((candidate) => candidate.id === id)!;
    expect(node.id).toBe(id);
    expect(node.id).not.toBe("caller-chosen");
    // InsertNodeContent carries no id field at all -- the supplied "id" reaches the node only as ordinary hashed content, then is shadowed on the face by the real computed value, exactly the discipline every read-side mint site already follows.
    expect(
      contentHashV1({
        kind: "paragraph",
        runs: [{ text: "Inserted." }],
        id: "caller-chosen",
      }),
    ).toBe(id);
  });

  it("shadows a properties field named kind with the explicit kind parameter, the same discipline mintValueNode applies", () => {
    const { graph, id } = insertNode(EMPTY_GRAPH, {
      kind: "value",
      properties: { kind: "not-a-real-graph-kind", title: "T" },
    });
    const node = graph.nodes.find((candidate) => candidate.id === id)!;
    expect(node.kind).toBe("value");
    expect(node.title).toBe("T");
  });

  it("folds children into the hash input exactly as projectGroup does: omitting children and passing an empty list mint different ids", () => {
    const leafOnly = insertNode(EMPTY_GRAPH, {
      kind: "section",
      properties: { kind: "section" },
    });
    const emptyChildren = insertNode(EMPTY_GRAPH, {
      kind: "section",
      properties: { kind: "section" },
      children: [],
    });
    expect(leafOnly.id).not.toBe(emptyChildren.id);
    expect(leafOnly.id).toBe(contentHashV1({ kind: "section" }));
    expect(emptyChildren.id).toBe(
      contentHashV1({ kind: "section", children: [] }),
    );
  });

  it("mints one CONTAINS edge per child at orderKeyForIndex(index), and re-inserting identical content is a no-op past the first call", () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const leafB = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const group = insertNode(leafB.graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafB.id],
    });
    const childEdges = group.graph.edges.filter(
      (edge) => edge.from === group.id && edge.kind === "CONTAINS",
    );
    expect(childEdges).toEqual([
      {
        from: group.id,
        to: leafA.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
      {
        from: group.id,
        to: leafB.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(1),
      },
    ]);
    // Re-inserting the identical leaf again mints the identical id and adds no second copy of the node.
    const again = insertNode(group.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    expect(again.id).toBe(leafA.id);
    expect(again.graph).toEqual(group.graph);
  });

  it('hasPriorContainsEdges\' own (from === id && kind === "CONTAINS") check ignores a decoy edge satisfying only one clause, still taking the wide-key fresh-mint fast path rather than reconciliation', () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const leafB = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [leafA.id, leafB.id],
    });
    // Two decoys, each satisfying exactly one clause: a STYLED_BY edge FROM sectionId (right owner, wrong kind) and a CONTAINS edge from an unrelated id (wrong owner, right kind). Neither is a genuine prior CONTAINS edge from sectionId itself, so hasPriorContainsEdges must read false and insertNode must still take its own plain, wide-key mint loop -- reconcileChildren's bisection-based insertion would produce different (though still validly ordered) keys for a first-ever child, which the exact orderKeyForIndex equality below would catch.
    const withDecoys = insertEdge(
      insertEdge(leafB.graph, sectionId, leafA.id, { kind: "STYLED_BY" }),
      "unrelated-id",
      leafA.id,
    );
    const group = insertNode(withDecoys, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafB.id],
    });
    const childEdges = group.graph.edges.filter(
      (edge) => edge.from === group.id && edge.kind === "CONTAINS",
    );
    expect(childEdges).toEqual([
      {
        from: group.id,
        to: leafA.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
      {
        from: group.id,
        to: leafB.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(1),
      },
    ]);
  });

  it("re-projecting after insertion is consistent: a subtree built via insertNode/insertEdge mints the identical ids and edges projectDocumentGraph mints for the equivalent DocumentTree", () => {
    const pkg = wordprocessingPackage([
      sectionGroup([paragraph("First."), paragraph("Second.")]),
    ]);
    expectSchemaValid(pkg, "consistency");
    const real = projectDocumentGraph([{ id: "doc", package: pkg }]);

    const first = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "First." }] },
    });
    const second = insertNode(first.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Second." }] },
    });
    const section = insertNode(second.graph, {
      kind: "section",
      properties: {
        pageSize: { widthPt: 595, heightPt: 842 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        kind: "section",
      },
      children: [first.id, second.id],
    });
    const built = insertEdge(section.graph, "doc", section.id);

    const realFirst = nodeByText(real, "First.");
    const realSecond = nodeByText(real, "Second.");
    const realSection = real.nodes.find((node) => node.kind === "section")!;

    expect(first.id).toBe(realFirst.id);
    expect(second.id).toBe(realSecond.id);
    expect(section.id).toBe(realSection.id);

    const realSectionContains = real.edges.filter(
      (edge) => edge.from === realSection.id && edge.kind === "CONTAINS",
    );
    const builtSectionContains = built.edges.filter(
      (edge) => edge.from === section.id && edge.kind === "CONTAINS",
    );
    expect(builtSectionContains).toEqual(realSectionContains);

    const realRootContains = real.edges.filter(
      (edge) => edge.from === "doc" && edge.kind === "CONTAINS",
    );
    const builtRootContains = built.edges.filter(
      (edge) => edge.from === "doc" && edge.kind === "CONTAINS",
    );
    expect(builtRootContains).toEqual(realRootContains);
  });

  it("insertEdge rebalances the whole sibling list when bisection has no room left, rather than surfacing the exhaustion", () => {
    const b = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const graphWithB = insertEdge(b.graph, "parent", b.id); // b lands at orderKeyForIndex(0), the scheme's own floor
    const originalBKey = graphWithB.edges[0]!.orderKey;
    expect(originalBKey).toBe(orderKeys.orderKeyForIndex(0));
    // The floor genuinely has no room below it -- this is the exact exhaustion insertEdge must catch and rebalance past.
    expect(() => orderKeys.orderKeyBefore(originalBKey)).toThrow(
      OrderKeyBudgetExhaustedError,
    );

    const a = insertNode(graphWithB, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    // An edge that must survive the rebalance untouched: a different `from`, sharing nothing with "parent"'s own sibling group being rebalanced -- proves rebalancedInsert's own `kept` filter genuinely carries over every OTHER edge in the graph, not just happening to end up empty because every edge present was part of the rebalanced group.
    const withUnrelated = insertEdge(a.graph, "unrelated-parent", a.id);
    const rebalanced = insertEdge(withUnrelated, "parent", a.id, {
      position: { at: "start" },
    });

    const contains = rebalanced.edges
      .filter((edge) => edge.from === "parent" && edge.kind === "CONTAINS")
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    expect(contains.map((edge) => edge.to)).toEqual([a.id, b.id]);
    // b's own edge really was rewritten, not merely left in place beneath a new one: its orderKey changed, and the pair now carries a fresh, evenly spaced renumberedOrderKeys(2) set.
    expect(contains.find((edge) => edge.to === b.id)!.orderKey).not.toBe(
      originalBKey,
    );
    expect(contains.map((edge) => edge.orderKey)).toEqual(
      orderKeys.renumberedOrderKeys(2),
    );
    // Neither edge carried a path, so the rebuilt edges must genuinely omit the key, not carry it as `undefined`.
    for (const edge of contains) expect("path" in edge).toBe(false);
    // The unrelated edge is untouched: still present, unchanged.
    expect(
      rebalanced.edges.filter((edge) => edge.from === "unrelated-parent"),
    ).toHaveLength(1);
  });

  it("insertEdge: start/end/before/after mint keys that sort into the requested position, and reject a sibling id the parent does not carry", () => {
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const b = insertNode(a.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const c = insertNode(b.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "C." }] },
    });
    const d = insertNode(c.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "D." }] },
    });
    const e = insertNode(d.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "E." }] },
    });

    let graph = insertEdge(e.graph, "parent", b.id); // default: end
    graph = insertEdge(graph, "parent", d.id); // default: end -- b, d
    graph = insertEdge(graph, "parent", a.id, { position: { at: "start" } }); // a, b, d
    graph = insertEdge(graph, "parent", e.id, { position: { at: "end" } }); // a, b, d, e
    graph = insertEdge(graph, "parent", c.id, {
      position: { at: "after", siblingId: b.id },
    }); // a, b, c, d, e

    const orderedEdges = graph.edges
      .filter((edge) => edge.from === "parent" && edge.kind === "CONTAINS")
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    expect(orderedEdges.map((edge) => edge.to)).toEqual([
      a.id,
      b.id,
      c.id,
      d.id,
      e.id,
    ]);
    // None of these calls passed a `path` option, so every minted edge must genuinely omit the key.
    for (const edge of orderedEdges) expect("path" in edge).toBe(false);

    let caught: unknown;
    try {
      insertEdge(graph, "parent", a.id, {
        position: { at: "before", siblingId: "not-a-real-sibling" },
      });
    } catch (error) {
      caught = error;
    }
    // A named error class with structured fields, this module's own convention (OrderKeyBudgetExhaustedError), rather than a message a caller would have to parse.
    expect(caught).toBeInstanceOf(UnknownSiblingError);
    const unknownSibling = caught as UnknownSiblingError;
    expect(unknownSibling.from).toBe("parent");
    expect(unknownSibling.kind).toBe("CONTAINS");
    expect(unknownSibling.siblingId).toBe("not-a-real-sibling");
  });

  it("insertEdge never mutates the graph handed to it", () => {
    const leaf = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Solo." }] },
    });
    const before = leaf.graph;
    insertEdge(before, "parent", leaf.id);
    expect(before.edges).toEqual([]);
  });

  it("insertEdge rebalances rather than throwing when two adjacent siblings already share one orderKey (e.g. the uniform floor key emitWalkEdges mints for every PROPERTY/DEFINED_BY edge from one owner)", () => {
    // Extract two metadata scalars off the same document root: emitWalkEdges (graph.ts's own PROPERTY/DEFINED_BY emission) gives both edges orderKeyForIndex(0) -- a real tie between two siblings of the SAME kind from the SAME owner, not merely a narrow interval.
    const extractMetadataScalars: ExtractionPolicy = (path) =>
      path.length === 2 &&
      path[0] === "metadata" &&
      (path[1] === "title" || path[1] === "author")
        ? "extract"
        : "inline";
    const pkg = wordprocessingPackage([sectionGroup([paragraph("Body.")])], {
      metadata: { title: "T", author: "A" },
    });
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }], {
      policy: extractMetadataScalars,
    });
    const tiedSiblings = graph.edges.filter(
      (edge) => edge.from === "doc" && edge.kind === "PROPERTY",
    );
    expect(tiedSiblings).toHaveLength(2);
    expect(tiedSiblings[0]!.orderKey).toBe(tiedSiblings[1]!.orderKey);
    expect(tiedSiblings[0]!.orderKey).toBe(orderKeys.orderKeyForIndex(0));

    const inserted = insertNode(graph, {
      kind: "value",
      properties: { value: "inserted" },
    });
    // Inserting directly between the two tied siblings is exactly the case boundedOrderKey must recognise before ever calling orderKeyBetween(tied, tied) -- this must rebalance, not throw.
    const result = insertEdge(inserted.graph, "doc", inserted.id, {
      kind: "PROPERTY",
      position: { at: "after", siblingId: tiedSiblings[0]!.to },
      path: ["metadata", "inserted"],
    });

    const rebalanced = result.edges.filter(
      (edge) => edge.from === "doc" && edge.kind === "PROPERTY",
    );
    expect(rebalanced).toHaveLength(3);
    // The tie is gone -- every sibling now sorts uniquely.
    expect(new Set(rebalanced.map((edge) => edge.orderKey)).size).toBe(3);
    const ordered = [...rebalanced].sort((x, y) =>
      x.orderKey < y.orderKey ? -1 : 1,
    );
    expect(ordered.map((edge) => edge.to)).toEqual([
      tiedSiblings[0]!.to,
      inserted.id,
      tiedSiblings[1]!.to,
    ]);
    // Each rebalanced edge kept its own path -- rebalancedInsert carries path through, it does not drop it.
    expect(ordered.map((edge) => edge.path)).toEqual([
      tiedSiblings[0]!.path,
      ["metadata", "inserted"],
      tiedSiblings[1]!.path,
    ]);
  });

  it("front-inserting against a tied PROPERTY sibling group still renumbers it into a real sequence -- verified directly rather than left as an assumption", () => {
    // { at: 'start' } against a single tied PROPERTY sibling walks the orderKeyBefore(floor) path, which was already OrderKeyBudgetExhaustedError before the tie fix above (unrelated code path -- `before` is undefined here, not tied-with-`after`), so this is pre-existing rebalance behaviour, not something the tie fix changed. Documented here so it is a verified fact, not an unverified assumption.
    const extractMetadataScalars: ExtractionPolicy = (path) =>
      path.length === 2 && path[0] === "metadata" && path[1] === "title"
        ? "extract"
        : "inline";
    const pkg = wordprocessingPackage([sectionGroup([paragraph("Body.")])], {
      metadata: { title: "T" },
    });
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }], {
      policy: extractMetadataScalars,
    });
    const original = graph.edges.filter(
      (edge) => edge.from === "doc" && edge.kind === "PROPERTY",
    );
    expect(original).toHaveLength(1);
    expect(original[0]!.orderKey).toBe(orderKeys.orderKeyForIndex(0)); // the uniform floor key, carrying no real sequence

    const inserted = insertNode(graph, {
      kind: "value",
      properties: { value: "inserted" },
    });
    const result = insertEdge(inserted.graph, "doc", inserted.id, {
      kind: "PROPERTY",
      position: { at: "start" },
      path: ["metadata", "inserted"],
    });

    const after = result.edges.filter(
      (edge) => edge.from === "doc" && edge.kind === "PROPERTY",
    );
    expect(after).toHaveLength(2);
    // The pre-existing PROPERTY edge's orderKey really was rewritten by the rebalance -- confirmed, not assumed. Harmless here: PROPERTY/DEFINED_BY edge identity (edgeKey) is disambiguated by `path` as much as by orderKey, and this edge's own path is untouched.
    const originalAfterInsert = after.find(
      (edge) => edge.path === original[0]!.path,
    )!;
    expect(originalAfterInsert.orderKey).not.toBe(original[0]!.orderKey);
    expect(originalAfterInsert.path).toEqual(original[0]!.path);
  });
});

describe("containsWouldReach internals (#935)", () => {
  it("only follows CONTAINS edges, never a STYLED_BY edge that happens to point the same direction", () => {
    const graph: PropertyGraph = {
      nodes: [
        { id: "a", kind: "x" },
        { id: "b", kind: "x" },
      ],
      edges: [{ from: "a", to: "b", kind: "STYLED_BY", orderKey: "k0" }],
    };
    expect(() => insertEdge(graph, "b", "a")).not.toThrow();
  });

  it("checks every CONTAINS child of a node with more than one, not only the first", () => {
    const graph: PropertyGraph = {
      nodes: [
        { id: "x", kind: "t" },
        { id: "p", kind: "t" },
        { id: "q", kind: "t" },
        { id: "target", kind: "t" },
      ],
      edges: [
        { from: "x", to: "p", kind: "CONTAINS", orderKey: "k0" },
        { from: "x", to: "q", kind: "CONTAINS", orderKey: "k1" },
        { from: "q", to: "target", kind: "CONTAINS", orderKey: "k0" },
      ],
    };
    // x reaches target only through its SECOND child q -- a check that only ever recorded the first CONTAINS child per node would miss this path entirely.
    expect(() => insertEdge(graph, "target", "x")).toThrow(ContainsCycleError);
  });

  it("terminates instead of looping forever when the existing edges already contain a genuine CONTAINS cycle unrelated to the new attachment", () => {
    const graph: PropertyGraph = {
      nodes: [
        { id: "p", kind: "t" },
        { id: "q", kind: "t" },
        { id: "x", kind: "t" },
      ],
      edges: [
        { from: "p", to: "q", kind: "CONTAINS", orderKey: "k0" },
        { from: "q", to: "p", kind: "CONTAINS", orderKey: "k0" },
      ],
    };
    expect(() => insertEdge(graph, "x", "p")).not.toThrow();
  });

  it("a dead-end search (the target has no CONTAINS children of its own) genuinely finds nothing, not a fabricated match", () => {
    // childrenOf.get(current) is undefined at a genuine dead end (a leaf with no CONTAINS children recorded at all), and the DFS's own `?? []` must contribute nothing further to the stack there. Naming the new edge's own `from` "Stryker was here" turns any fallback OTHER than a genuinely empty array into a self-fulfilling false positive: a placeholder array whose element happens to equal `from` would make the dead-end's own popped placeholder satisfy `current === from` on the very next iteration, incorrectly reporting a cycle that doesn't exist.
    const leaf = insertNode(
      { nodes: [], edges: [] },
      {
        kind: "paragraph",
        properties: { kind: "paragraph", runs: [{ text: "Leaf." }] },
      },
    );
    expect(() =>
      insertEdge(leaf.graph, "Stryker was here", leaf.id),
    ).not.toThrow();
  });
});

describe("write API: insertEdge refuses a CONTAINS cycle (#935)", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("insertEdge refuses to attach a CONTAINS edge that would close a cycle (re-parenting a node under its own descendant)", () => {
    const leaf = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Leaf." }] },
    });
    const group = insertNode(leaf.graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [leaf.id],
    });
    // group already CONTAINS leaf; attaching leaf -> group would close a cycle (leaf -> group -> leaf), which is exactly the shape that used to crash walkPropertyGraph's CONTAINS-only walk with a stack overflow once someone walked it.
    let caught: unknown;
    try {
      insertEdge(group.graph, leaf.id, group.id);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContainsCycleError);
    const cycleError = caught as ContainsCycleError;
    expect(cycleError.from).toBe(leaf.id);
    expect(cycleError.to).toBe(group.id);
  });

  it("insertEdge refuses a CONTAINS self-loop", () => {
    const leaf = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Solo." }] },
    });
    expect(() => insertEdge(leaf.graph, leaf.id, leaf.id)).toThrow(
      ContainsCycleError,
    );
  });

  it("insertEdge still allows attaching one already-minted node under two independent parents -- multi-parent DAG sharing is not a cycle", () => {
    const shared = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Shared." }] },
    });
    let graph = insertEdge(shared.graph, "parentA", shared.id);
    graph = insertEdge(graph, "parentB", shared.id);
    const contains = graph.edges
      .filter((edge) => edge.kind === "CONTAINS")
      .map((edge) => `${edge.from}->${edge.to}`);
    expect(contains).toEqual([
      `parentA->${shared.id}`,
      `parentB->${shared.id}`,
    ]);
  });

  it("insertNode refuses a CONTAINS cycle closing through an id that had no node when the first edge was attached, since its fresh-mint children-wiring is checked exactly like insertEdge's own attachment rather than a node-lookup-based check that could not see a cycle closing through an id with no node yet", () => {
    const leaf = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Leaf." }] },
    });
    // Compute the section's id WITHOUT minting it -- exactly the shape that defeated the old node-presence-gated check.
    const sectionId = contentHashV1({
      kind: "section",
      children: [leaf.id],
    });
    // insertEdge onto a not-yet-existing id is allowed by design (a dangling forward edge); at this point it closes no cycle, since sectionId has no outgoing CONTAINS edges yet.
    const withDanglingEdge = insertEdge(leaf.graph, leaf.id, sectionId);
    expect(
      withDanglingEdge.edges.some(
        (edge) => edge.from === leaf.id && edge.to === sectionId,
      ),
    ).toBe(true);
    expect(withDanglingEdge.nodes.some((node) => node.id === sectionId)).toBe(
      false,
    );

    // Minting the section now, with children: [leaf.id], would wire section -> leaf on top of the already-attached leaf -> section edge, closing the cycle. Must throw, not silently succeed and leave a graph walkPropertyGraph can no longer traverse.
    let caught: unknown;
    try {
      insertNode(withDanglingEdge, {
        kind: "section",
        properties: { kind: "section" },
        children: [leaf.id],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContainsCycleError);
    const cycleError = caught as ContainsCycleError;
    expect(cycleError.from).toBe(sectionId);
    expect(cycleError.to).toBe(leaf.id);

    // The graph never actually gained the section node or the section -> leaf edge -- insertNode threw before either was appended.
    expect(withDanglingEdge.nodes.some((node) => node.id === sectionId)).toBe(
      false,
    );
    expect(
      withDanglingEdge.edges.some(
        (edge) => edge.from === sectionId && edge.to === leaf.id,
      ),
    ).toBe(false);
  });

  it("insertNode refuses ContainsCycleError for a multi-child fresh mint when only a LATER child in the list closes the cycle, and mints nothing before the throw", () => {
    const leaf = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Leaf." }] },
    });
    const otherLeaf = insertNode(leaf.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Other." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [otherLeaf.id, leaf.id],
    });
    const withDanglingEdge = insertEdge(otherLeaf.graph, leaf.id, sectionId);

    expect(() =>
      insertNode(withDanglingEdge, {
        kind: "section",
        properties: { kind: "section" },
        children: [otherLeaf.id, leaf.id],
      }),
    ).toThrow(ContainsCycleError);
    // otherLeaf's own CONTAINS edge from the not-yet-existing section id must not have been left behind by the throw.
    expect(
      withDanglingEdge.edges.some(
        (edge) => edge.from === sectionId && edge.to === otherLeaf.id,
      ),
    ).toBe(false);
  });
});

describe("write API: insertNode's fresh-mint children-wiring reconciles pre-existing dangling CONTAINS edges (#935)", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("reconciles against pre-existing dangling edges by their own sorted orderKey, not by the edges array's own creation order", () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const leafB = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const leafC = insertNode(leafB.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "C." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [leafA.id, leafB.id, leafC.id],
    });
    // Attached in an order that scrambles the edges ARRAY relative to sorted orderKey: C first (appended, gets the widest/earliest key), then A at the very start, then B spliced between A and C -- so the array's own creation order is [C, A, B] even though the orderKeys sort as A, B, C.
    const withC = insertEdge(leafC.graph, sectionId, leafC.id);
    const withA = insertEdge(withC, sectionId, leafA.id, {
      position: { at: "start" },
    });
    const withDangling = insertEdge(withA, sectionId, leafB.id, {
      position: { at: "before", siblingId: leafC.id },
    });

    const result = insertNode(withDangling, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafB.id, leafC.id],
    });
    // A correct sorted read recognises every requested child as already wired in the requested order and inserts nothing new; a broken sort could fail to match the existing subsequence and mint spurious duplicate edges instead.
    const contains = result.graph.edges.filter(
      (edge) => edge.from === sectionId && edge.kind === "CONTAINS",
    );
    expect(contains).toHaveLength(3);
    // Genuinely exercises byOrderKeyAsc, not just "no duplicates": reading originalSiblings by CREATION order (unsorted) would see [C, A, B], which is NOT a subsequence of the requested [A, B, C] (C can never precede A in a subsequence of [A,B,C]) -- so a broken sort would fail to match at least one requested position against its existing edge and mint a spurious extra one, changing this exact final order.
    expect(
      contains
        .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))
        .map((edge) => edge.to),
    ).toEqual([leafA.id, leafB.id, leafC.id]);
  });

  it("insertNode does not duplicate a CONTAINS edge that insertEdge already attached onto this id before it had a node", () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const leafB = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [leafA.id, leafB.id],
    });
    // leafA is wired under the section before the section has a node of its own -- the exact "edge exists before its node" shape insertEdge tolerates by design.
    const withDanglingEdge = insertEdge(leafB.graph, sectionId, leafA.id);
    expect(
      withDanglingEdge.edges.filter(
        (edge) => edge.from === sectionId && edge.to === leafA.id,
      ),
    ).toHaveLength(1);

    const section = insertNode(withDanglingEdge, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafB.id],
    });
    expect(section.id).toBe(sectionId);

    const contains = section.graph.edges.filter(
      (edge) => edge.from === sectionId && edge.kind === "CONTAINS",
    );
    // Exactly one edge per child -- the fresh-mint wiring must not have minted a second, byte-identical copy of the edge insertEdge already attached to leafA.
    expect(contains).toHaveLength(2);
    expect(contains.filter((edge) => edge.to === leafA.id)).toHaveLength(1);
    expect(contains.filter((edge) => edge.to === leafB.id)).toHaveLength(1);
    // Document order still matches the requested children order.
    const ordered = [...contains]
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))
      .map((edge) => edge.to);
    expect(ordered).toEqual([leafA.id, leafB.id]);
  });

  it("insertNode does not tie a freshly minted child's orderKey against a pre-existing dangling CONTAINS edge to a different child sitting at that same index-derived key", () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const leafB = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const leafC = insertNode(leafB.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "C." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [leafA.id, leafB.id, leafC.id],
    });
    // leafC is wired under the not-yet-minted section first, so it lands at orderKeyForIndex(0) -- the same floor key a bare index-keyed fresh mint would hand its own first requested child (leafA) without consulting this edge at all.
    const withDanglingEdge = insertEdge(leafC.graph, sectionId, leafC.id);
    const danglingEdge = withDanglingEdge.edges.find(
      (edge) => edge.from === sectionId,
    )!;
    expect(danglingEdge.orderKey).toBe(orderKeys.orderKeyForIndex(0));

    const section = insertNode(withDanglingEdge, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafB.id, leafC.id],
    });

    const contains = section.graph.edges.filter(
      (edge) => edge.from === sectionId && edge.kind === "CONTAINS",
    );
    expect(contains).toHaveLength(3);
    const orderKeysUsed = contains.map((edge) => edge.orderKey);
    // No two siblings share an orderKey -- the degenerate shape boundedOrderKey/siblingInsertIndex refuse everywhere else in this module.
    expect(new Set(orderKeysUsed).size).toBe(orderKeysUsed.length);
    // Requested document order is preserved once the tie is resolved.
    const ordered = [...contains]
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))
      .map((edge) => edge.to);
    expect(ordered).toEqual([leafA.id, leafB.id, leafC.id]);
  });

  it("insertNode's fresh-mint reconciliation preserves a repeated child id's own multiplicity and position, not just its first occurrence", () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const leafB = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [leafA.id, leafB.id, leafA.id],
    });
    // Wire only ONE occurrence of leafA -- the REPEATED id -- directly, before the section has a node of its own; leafB has no existing edge at all. A plain existingChildren Set (membership only, no count) sees leafA present and treats BOTH of its requested occurrences as already satisfied, silently dropping the second one; a multiplicity-aware reconciliation must recognise that only the first occurrence is actually wired and the second is still missing.
    const withDanglingEdge = insertEdge(leafB.graph, sectionId, leafA.id);

    const section = insertNode(withDanglingEdge, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafB.id, leafA.id],
    });
    expect(section.id).toBe(sectionId);

    const contains = section.graph.edges.filter(
      (edge) => edge.from === sectionId && edge.kind === "CONTAINS",
    );
    // Three edges total -- both requested occurrences of leafA survive, not just the one that was already wired.
    expect(contains).toHaveLength(3);
    expect(contains.filter((edge) => edge.to === leafA.id)).toHaveLength(2);
    expect(contains.filter((edge) => edge.to === leafB.id)).toHaveLength(1);
    const ordered = [...contains]
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))
      .map((edge) => edge.to);
    expect(ordered).toEqual([leafA.id, leafB.id, leafA.id]);
  });

  it("insertNode's fresh-mint reconciliation anchors a missing child to the SPECIFIC pre-wired occurrence of a repeated sibling id, not to whichever occurrence of that id sorts earliest", () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const leafX = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "X." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [leafA.id, leafX.id, leafA.id],
    });
    // Wire BOTH occurrences of the repeated id (leafA) directly, in requested order, before the section has a node of its own. leafX -- the one genuinely missing child -- must anchor to the SECOND of these two leafA edges specifically: anchoring by the bare value "leafA" instead resolves (via insertEdge's own before/after lookup) to whichever leafA edge sorts earliest, landing leafX before the FIRST leafA rather than between the two.
    const firstA = insertEdge(leafX.graph, sectionId, leafA.id);
    const secondA = insertEdge(firstA, sectionId, leafA.id);

    const section = insertNode(secondA, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafX.id, leafA.id],
    });
    expect(section.id).toBe(sectionId);

    const ordered = section.graph.edges
      .filter((edge) => edge.from === sectionId && edge.kind === "CONTAINS")
      .sort((p, q) => (p.orderKey < q.orderKey ? -1 : 1))
      .map((edge) => edge.to);
    // The exact requested order is reproduced: leafX lands between the two leafA occurrences, not before the first (or after the second).
    expect(ordered).toEqual([leafA.id, leafX.id, leafA.id]);
  });

  it("a fresh mint with no pre-existing CONTAINS edges at all still mints the wide, evenly spaced orderKeyForIndex(index) keys directly, without paying for reconciliation", () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const leafB = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const section = insertNode(leafB.graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafB.id],
    });
    const contains = section.graph.edges.filter(
      (edge) => edge.from === section.id && edge.kind === "CONTAINS",
    );
    expect(contains).toEqual([
      {
        from: section.id,
        to: leafA.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
      {
        from: section.id,
        to: leafB.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(1),
      },
    ]);
  });

  it("reconciliation counts only this id's own CONTAINS edges as pre-existing siblings, never a differently-kinded or differently-owned edge that happens to sit in the same graph", () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const leafB = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [leafA.id, leafB.id],
    });
    // Three decoys, each satisfying exactly one clause of the (from === id && kind === "CONTAINS") filter and not the other: a STYLED_BY edge FROM this id (right owner, wrong kind), a CONTAINS edge from a wholly unrelated id TO leafA (wrong owner, right kind, right target), and a CONTAINS edge from this id's own dangling attachment reused for a genuinely different (unrequested) child. A filter with either clause dropped, or swapped to `||`, would miscount `originalSiblings`/`currentSiblings` against these decoys.
    const withDecoys = insertEdge(
      insertEdge(
        insertEdge(leafB.graph, sectionId, leafA.id, { kind: "STYLED_BY" }),
        "unrelated-id",
        leafA.id,
      ),
      sectionId,
      leafA.id,
    );
    const reconciled = insertNode(withDecoys, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafB.id],
    });
    expect(reconciled.id).toBe(sectionId);
    const contains = reconciled.graph.edges.filter(
      (edge) => edge.from === sectionId && edge.kind === "CONTAINS",
    );
    // Exactly one edge to A (the genuine pre-wired CONTAINS decoy is reused, not duplicated) and one freshly inserted to B -- the STYLED_BY and unrelated-id decoys must never have been treated as part of this id's own CONTAINS sibling set.
    expect(contains).toHaveLength(2);
    expect(contains.filter((edge) => edge.to === leafA.id)).toHaveLength(1);
    expect(contains.filter((edge) => edge.to === leafB.id)).toHaveLength(1);
  });

  it("reconciliation refuses a CONTAINS cycle when an unmatched child would close one, exactly as insertEdge's own attachment does", () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const loopNode = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Loop." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [leafA.id, loopNode.id],
    });
    // Pre-wire the section's genuine first child (A), so hasPriorContainsEdges is true and insertNode's fresh mint routes through reconcileChildren rather than its own plain forEach loop -- reconcileChildren's OWN assertNoContainsCycle call (for a child position the LCS pass left unmatched, requiring a fresh insertion) is what this test targets, not insertNode's separate check for the no-prior-edges case (already covered elsewhere).
    const withA = insertEdge(loopNode.graph, sectionId, leafA.id);
    // loopNode already dangles a CONTAINS edge back at the not-yet-existing sectionId: attaching sectionId's own second, genuinely unmatched child (loopNode) would close that cycle.
    const cyclic = insertEdge(withA, loopNode.id, sectionId);
    expect(() =>
      insertNode(cyclic, {
        kind: "section",
        properties: { kind: "section" },
        children: [leafA.id, loopNode.id],
      }),
    ).toThrow(ContainsCycleError);
  });
});

describe("write API: insertNode handles a dedup hit's kind and children correctly (#935)", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("insertNode throws NodeKindMismatchError when two different requested kinds hash to the identical id, rather than silently handing back the first call's kind", () => {
    const first = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { text: "Same content." },
    });
    let caught: unknown;
    try {
      insertNode(first.graph, {
        kind: "heading",
        properties: { text: "Same content." },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NodeKindMismatchError);
    const mismatch = caught as NodeKindMismatchError;
    expect(mismatch.id).toBe(first.id);
    expect(mismatch.existingKind).toBe("paragraph");
    expect(mismatch.requestedKind).toBe("heading");
    // Confirms the collision is genuine: `kind` never enters hashInput, so both calls really do compute the identical id.
    expect(contentHashV1({ text: "Same content." })).toBe(first.id);
  });

  it("insertNode succeeds as a plain no-op dedup when the SAME kind is re-requested for an id already in the graph", () => {
    const first = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { text: "Same content." },
    });
    const second = insertNode(first.graph, {
      kind: "paragraph",
      properties: { text: "Same content." },
    });
    expect(second.id).toBe(first.id);
    expect(second.graph).toEqual(first.graph);
  });

  it("insertNode reconciles a dedup hit's requested children rather than silently dropping them when an earlier call minted the identical id via a different spelling", () => {
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const b = insertNode(a.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });

    // First spelling: "children" folded directly into properties as ordinary data, with no top-level `children` parameter at all -- mints the node with NO CONTAINS edges, since insertNode only ever emits them from the explicit parameter.
    const foldedSpelling = insertNode(b.graph, {
      kind: "section",
      properties: { kind: "section", children: [a.id, b.id] },
    });
    expect(
      foldedSpelling.graph.edges.filter(
        (edge) => edge.from === foldedSpelling.id && edge.kind === "CONTAINS",
      ),
    ).toEqual([]);

    // Second spelling of the IDENTICAL content: `children` given as the explicit top-level parameter this time -- hashInput folds `properties` + `children` into the same shape either spelling arrives at, so this is a genuine dedup hit against the node the first spelling already minted.
    const explicitSpelling = insertNode(foldedSpelling.graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [a.id, b.id],
    });
    expect(explicitSpelling.id).toBe(foldedSpelling.id);

    // The requested CONTAINS edges must be present now -- not silently dropped just because the id already existed under the no-edges spelling.
    const childEdges = explicitSpelling.graph.edges
      .filter(
        (edge) => edge.from === explicitSpelling.id && edge.kind === "CONTAINS",
      )
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    expect(childEdges.map((edge) => edge.to)).toEqual([a.id, b.id]);
  });

  it("insertNode's dedup reconciliation inserts each missing child at its OWN requested position relative to already-present siblings, rather than always appending missing ones at the end -- so the reconciled CONTAINS order agrees with the order the node's own content-hash was minted from", () => {
    const x = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "X." }] },
    });
    const a = insertNode(x.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const y = insertNode(a.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Y." }] },
    });

    // Folded spelling mints the section with NO CONTAINS edges (established behaviour above); the requested order is [x, a, y].
    const foldedSpelling = insertNode(y.graph, {
      kind: "section",
      properties: { kind: "section", children: [x.id, a.id, y.id] },
    });

    // Wire only the MIDDLE child directly, as if some earlier caller had partially populated this id's containment before the full reconciling call arrives.
    const partiallyWired = insertEdge(
      foldedSpelling.graph,
      foldedSpelling.id,
      a.id,
    );

    // Explicit spelling of the IDENTICAL content -- a genuine dedup hit -- requesting the full [x, a, y] order. x and y are both missing; a naive "append missing at the end" would produce [a, x, y], disagreeing with the order the id was actually minted from.
    const explicitSpelling = insertNode(partiallyWired, {
      kind: "section",
      properties: { kind: "section" },
      children: [x.id, a.id, y.id],
    });
    expect(explicitSpelling.id).toBe(foldedSpelling.id);

    const ordered = explicitSpelling.graph.edges
      .filter(
        (edge) => edge.from === explicitSpelling.id && edge.kind === "CONTAINS",
      )
      .sort((p, q) => (p.orderKey < q.orderKey ? -1 : 1))
      .map((edge) => edge.to);
    expect(ordered).toEqual([x.id, a.id, y.id]);
  });

  it("insertNode's dedup reconciliation preserves a repeated child id's own multiplicity and position, not just its first occurrence", () => {
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const b = insertNode(a.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });

    // Folded spelling mints the section with NO CONTAINS edges (established behaviour above), requesting [a, b, a] -- a repeated id, the same shape projectDocumentGraph and insertEdge already support elsewhere in this file.
    const foldedSpelling = insertNode(b.graph, {
      kind: "section",
      properties: { kind: "section", children: [a.id, b.id, a.id] },
    });

    // Wire only ONE occurrence of a -- the REPEATED id -- directly, as if an earlier caller had partially populated this id's containment before the full reconciling call arrives; b has no existing edge at all. A plain existingChildren Set (membership only, no count) sees a present and treats BOTH requested occurrences as satisfied, silently dropping the second; a multiplicity-aware reconciliation must recognise only the first occurrence is wired and the second is still missing.
    const partiallyWired = insertEdge(
      foldedSpelling.graph,
      foldedSpelling.id,
      a.id,
    );

    const explicitSpelling = insertNode(partiallyWired, {
      kind: "section",
      properties: { kind: "section" },
      children: [a.id, b.id, a.id],
    });
    expect(explicitSpelling.id).toBe(foldedSpelling.id);

    const ordered = explicitSpelling.graph.edges
      .filter(
        (edge) => edge.from === explicitSpelling.id && edge.kind === "CONTAINS",
      )
      .sort((p, q) => (p.orderKey < q.orderKey ? -1 : 1));
    // Three edges total -- both requested occurrences of a survive, not just one.
    expect(ordered).toHaveLength(3);
    expect(ordered.filter((edge) => edge.to === a.id)).toHaveLength(2);
    expect(ordered.map((edge) => edge.to)).toEqual([a.id, b.id, a.id]);
  });

  it("insertNode's dedup reconciliation is idempotent: requesting the same children twice adds no duplicate edges", () => {
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const first = insertNode(a.graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [a.id],
    });
    const second = insertNode(first.graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [a.id],
    });
    expect(second.id).toBe(first.id);
    expect(second.graph).toEqual(first.graph);
  });
});

describe("write API: insertEdge refuses an ambiguous before/after sibling only on a genuine orderKey tie (#935)", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("insertEdge resolves before/after deterministically -- against the EARLIEST match in orderKey order -- when the named sibling id matches more than one edge but those edges carry distinct orderKeys, rather than refusing the ordinary two-identical-children shape as ambiguous", () => {
    const v = insertNode(EMPTY_GRAPH, {
      kind: "value",
      properties: { value: "shared" },
    });
    // Two sequential insertEdge appends of the SAME target: insertEdge's own bisection never ties two of its own siblings, so these two PROPERTY edges to v.id carry distinct orderKeys even though they share a target -- exactly the "duplicate CONTAINS/PROPERTY children with distinct orderKeys" shape this module resolves deterministically, rather than refusing.
    let graph = insertEdge(v.graph, "parent", v.id, {
      kind: "PROPERTY",
      path: ["a"],
    });
    graph = insertEdge(graph, "parent", v.id, {
      kind: "PROPERTY",
      path: ["b"],
    });
    const matches = graph.edges.filter(
      (edge) =>
        edge.from === "parent" && edge.kind === "PROPERTY" && edge.to === v.id,
    );
    expect(matches).toHaveLength(2);
    expect(new Set(matches.map((edge) => edge.orderKey)).size).toBe(2); // genuinely distinct, not tied

    const other = insertNode(graph, {
      kind: "value",
      properties: { value: "other" },
    });
    // Must NOT throw: the earliest of the two v.id matches (path "a", the lower orderKey) is the deterministic boundary for "after v.id".
    const result = insertEdge(other.graph, "parent", other.id, {
      kind: "PROPERTY",
      position: { at: "after", siblingId: v.id },
      path: ["c"],
    });
    const ordered = result.edges
      .filter((edge) => edge.from === "parent" && edge.kind === "PROPERTY")
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    expect(ordered.map((edge) => edge.path)).toEqual([["a"], ["c"], ["b"]]);
  });

  it("insertEdge refuses an ambiguous before/after position when the named sibling id matches more than one edge that GENUINELY TIE on orderKey -- projectDocumentGraph's own emitWalkEdges mints exactly this shape when two metadata fields extract to the identical shared value node", () => {
    const extractSameValueTwice: ExtractionPolicy = (path) =>
      path.length === 2 &&
      path[0] === "metadata" &&
      (path[1] === "title" || path[1] === "subject")
        ? "extract"
        : "inline";
    const pkg = wordprocessingPackage([sectionGroup([paragraph("Body.")])], {
      metadata: { title: "shared", subject: "shared" },
    });
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }], {
      policy: extractSameValueTwice,
    });
    const tied = graph.edges.filter(
      (edge) => edge.from === "doc" && edge.kind === "PROPERTY",
    );
    // Identical content ("shared") dedupes to ONE value node, referenced by TWO PROPERTY edges (one per metadata key) -- both minted by emitWalkEdges at the uniform floor orderKey, a genuine tie.
    expect(tied).toHaveLength(2);
    expect(tied[0]!.to).toBe(tied[1]!.to);
    expect(tied[0]!.orderKey).toBe(tied[1]!.orderKey);

    const other = insertNode(graph, {
      kind: "value",
      properties: { value: "other" },
    });
    let caught: unknown;
    try {
      insertEdge(other.graph, "doc", other.id, {
        kind: "PROPERTY",
        position: { at: "after", siblingId: tied[0]!.to },
        path: ["metadata", "creator"],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AmbiguousSiblingError);
    const ambiguous = caught as AmbiguousSiblingError;
    expect(ambiguous.from).toBe("doc");
    expect(ambiguous.kind).toBe("PROPERTY");
    expect(ambiguous.siblingId).toBe(tied[0]!.to);
    expect(ambiguous.matchCount).toBe(2);
  });

  it("insertEdge resolves a duplicate CONTAINS child deterministically against its earliest occurrence, rather than hard-blocking the ordinary two-identical-children shape", () => {
    const shared = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Shared." }] },
    });
    // "parent" CONTAINS the same shared node twice, at two different (necessarily distinct) sibling positions.
    let graph = insertEdge(shared.graph, "parent", shared.id);
    graph = insertEdge(graph, "parent", shared.id, { position: { at: "end" } });
    const sharedEdges = graph.edges.filter(
      (edge) =>
        edge.from === "parent" &&
        edge.kind === "CONTAINS" &&
        edge.to === shared.id,
    );
    expect(sharedEdges).toHaveLength(2);
    expect(new Set(sharedEdges.map((edge) => edge.orderKey)).size).toBe(2);

    const newLeaf = insertNode(graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "New." }] },
    });
    // Must resolve against the FIRST occurrence, not throw AmbiguousSiblingError.
    const result = insertEdge(newLeaf.graph, "parent", newLeaf.id, {
      position: { at: "before", siblingId: shared.id },
    });
    const ordered = result.edges
      .filter((edge) => edge.from === "parent" && edge.kind === "CONTAINS")
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))
      .map((edge) => edge.to);
    expect(ordered).toEqual([newLeaf.id, shared.id, shared.id]);
  });

  it("insertEdge resolves before/after normally when the named sibling matches exactly one edge, even when other siblings share its orderKey-tying structure", () => {
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const b = insertNode(a.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    let graph = insertEdge(b.graph, "parent", a.id);
    graph = insertEdge(graph, "parent", b.id, {
      position: { at: "after", siblingId: a.id },
    });
    const ordered = graph.edges
      .filter((edge) => edge.from === "parent" && edge.kind === "CONTAINS")
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))
      .map((edge) => edge.to);
    expect(ordered).toEqual([a.id, b.id]);
  });
});

// Exhaustive correctness proof for reconcileChildren (#935 round 10): every requested `children` sequence over a pool of 2 or 3 distinct ids, up to a bounded length, crossed with every GENUINE SUBSEQUENCE of that exact sequence as the pre-wired existing edge state -- not merely the "first K occurrences of each id, independently" shape round 9's own generator was limited to. A genuine subsequence is built by choosing an arbitrary SUBSET of the request's own positions (in ascending order) and pre-wiring exactly those, in that order, as literal CONTAINS edges -- covering every possible interleaving of which occurrences of which ids are already wired, including the interleaved shape round 9's classifier still mishandled: requested [A, B, A] with positions {1, 2} pre-wired gives existing edges [B, A], a genuine subsequence (drop the request's own first A) that round 9's per-id, front-to-back matcher paired incorrectly, because it matched each id's own occurrences against its own existing edges independently and never considered A's and B's existing edges relative to EACH OTHER.
//
// Choosing a subset of a sequence's own positions can never produce a relative ordering the source sequence itself does not exhibit, so every case this enumeration builds is, by construction, a genuine subsequence -- the earlier round-9 suite's claim that an arbitrary subset "cannot be encoded" was true only of that round's own per-id matcher (which had no way to represent a pre-wiring that was not a prefix of each id's own occurrence count), not of the underlying data: an edge set recording exactly the wired positions above is a perfectly ordinary graph state, and the LCS-based classifier below reconciles it correctly. This enumeration therefore proves reconcileChildren's ORDER-CONSISTENT guarantee (exact reproduction, in order and multiplicity) exhaustively over the space it covers; the separate, genuinely order-INCONSISTENT case -- existing edges wired in a relative order no subsequence of the request could produce at all -- is not reachable this way and is covered by its own dedicated test below instead, which checks only the narrower no-inflation guarantee that case actually promises.
//
// Two pool sizes are run: 2 distinct ids up to length 6, and 3 distinct ids up to length 5 -- a combined ~14,790-case enumeration (sum of 4^length for length 1..6, plus 6^length for length 1..5: poolSize^length sequences times 2^length position-subsets, at each length), preferred here over fast-check (not a dependency of this package) precisely because it is a genuine proof over that space rather than probabilistic sampling.
describe("write API: reconcileChildren reproduces every requested children list exhaustively, over every genuine-subsequence pre-wiring (#935 round 10)", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  // Mints `count` distinct paragraph leaves up front, returning the graph carrying them plus their ids in mint order -- the pool every generated `children` sequence indexes into.
  function mintLeafPool(count: number): {
    graph: PropertyGraph;
    pool: string[];
  } {
    let graph = EMPTY_GRAPH;
    const pool: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const minted = insertNode(graph, {
        kind: "paragraph",
        properties: {
          kind: "paragraph",
          runs: [{ text: `Leaf ${String(index)}.` }],
        },
      });
      graph = minted.graph;
      pool.push(minted.id);
    }
    return { graph, pool };
  }

  // Every sequence of the given length over a pool of `poolSize` distinct ids (as pool indices, not ids themselves): poolSize^length arrangements, covering every possible multiplicity and every relative order.
  function allSequences(length: number, poolSize: number): number[][] {
    if (length === 0) return [[]];
    const shorter = allSequences(length - 1, poolSize);
    const sequences: number[][] = [];
    for (const seq of shorter) {
      for (let label = 0; label < poolSize; label += 1) {
        sequences.push([...seq, label]);
      }
    }
    return sequences;
  }

  // Every subset of {0, ..., length - 1}, each returned ascending, via a bitmask enumeration -- 2^length subsets, including the empty one (nothing pre-wired) and the full one (everything pre-wired).
  function allPositionSubsets(length: number): number[][] {
    const subsets: number[][] = [];
    for (let mask = 0; mask < 2 ** length; mask += 1) {
      const subset: number[] = [];
      for (let bit = 0; bit < length; bit += 1) {
        if ((mask & (1 << bit)) !== 0) subset.push(bit);
      }
      subsets.push(subset);
    }
    return subsets;
  }

  // Attaches exactly the requested positions named by `positions` (ascending) as literal CONTAINS edges from `id`, via plain sequential insertEdge appends -- the resulting existing edges' mutual order is therefore exactly the same relative order those positions hold in `children`, which is what makes the pre-wiring a genuine subsequence rather than an arbitrary edge set.
  function preWirePositions(
    graph: PropertyGraph,
    id: string,
    children: readonly number[],
    pool: readonly string[],
    positions: readonly number[],
  ): PropertyGraph {
    return positions.reduce(
      (acc, position) => insertEdge(acc, id, pool[children[position]!]!),
      graph,
    );
  }

  function assertExactReconciliation(
    graph: PropertyGraph,
    id: string,
    children: readonly number[],
    pool: readonly string[],
    caseLabel: string,
  ): void {
    const contains = graph.edges
      .filter((edge) => edge.from === id && edge.kind === "CONTAINS")
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    try {
      expect(contains.map((edge) => edge.to)).toEqual(
        children.map((label) => pool[label]!),
      );
      expect(new Set(contains.map((edge) => edge.orderKey)).size).toBe(
        contains.length,
      );
    } catch (error) {
      throw new Error(`${caseLabel}: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  // Runs both the fresh-mint and dedup-hit reconciliation branches over every (sequence, genuine-subsequence pre-wiring) pair for a given pool size, up to `maxLength`.
  function runExhaustive(poolSize: number, maxLength: number): void {
    const { graph: baseGraph, pool } = mintLeafPool(poolSize);
    let casesRun = 0;
    for (let length = 1; length <= maxLength; length += 1) {
      for (const children of allSequences(length, poolSize)) {
        for (const preWired of allPositionSubsets(length)) {
          const caseLabel = `pool=${String(poolSize)} children=[${children.join(",")}] preWired=[${preWired.join(",")}]`;

          // Fresh-mint branch: children named explicitly, id computed with children folded into the hash, no prior CONTAINS edges of its own -- pre-wiring attaches dangling edges onto that not-yet-minted id first.
          const sectionId = contentHashV1({
            kind: "section",
            children: children.map((label) => pool[label]!),
          });
          const wiredFresh = preWirePositions(
            baseGraph,
            sectionId,
            children,
            pool,
            preWired,
          );
          const freshMint = insertNode(wiredFresh, {
            kind: "section",
            properties: { kind: "section" },
            children: children.map((label) => pool[label]!),
          });
          expect(freshMint.id).toBe(sectionId);
          assertExactReconciliation(
            freshMint.graph,
            sectionId,
            children,
            pool,
            `fresh-mint ${caseLabel}`,
          );

          // Dedup-hit branch: children folded directly into `properties` at first mint (no `children` parameter, so no CONTAINS edges at all), pre-wiring attaches onto that already-minted id, then a second call names `children` explicitly and must reconcile against the pre-wired state.
          const foldedSpelling = insertNode(baseGraph, {
            kind: "section",
            properties: {
              kind: "section",
              children: children.map((label) => pool[label]!),
            },
          });
          const wiredDedup = preWirePositions(
            foldedSpelling.graph,
            foldedSpelling.id,
            children,
            pool,
            preWired,
          );
          const dedupHit = insertNode(wiredDedup, {
            kind: "section",
            properties: { kind: "section" },
            children: children.map((label) => pool[label]!),
          });
          expect(dedupHit.id).toBe(foldedSpelling.id);
          assertExactReconciliation(
            dedupHit.graph,
            foldedSpelling.id,
            children,
            pool,
            `dedup-hit ${caseLabel}`,
          );

          casesRun += 1;
        }
      }
    }
    // A sanity check on the enumeration itself: every (sequence, subset) pair must actually have run, exactly once each -- sum over length 1..maxLength of poolSize^length * 2^length.
    const expectedCases = Array.from({ length: maxLength }, (_, i) => i + 1)
      .map((length) => poolSize ** length * 2 ** length)
      .reduce((total, count) => total + count, 0);
    expect(casesRun).toBe(expectedCases);
  }

  it("2-id pool, sequences up to length 6, every genuine-subsequence pre-wiring", () => {
    runExhaustive(2, 6);
  });

  it("3-id pool, sequences up to length 5, every genuine-subsequence pre-wiring", () => {
    runExhaustive(3, 5);
  });

  it("order-inconsistent pre-wiring never inflates multiplicity beyond max(existingCount, requestedCount) (#935 round 9's edge case)", () => {
    const { graph: baseGraph, pool } = mintLeafPool(2);
    const [a, b] = pool as [string, string];
    const sectionId = contentHashV1({ kind: "section", children: [a, b] });

    // Wire B then A -- the reverse of the request's own order, and not constructible as any subsequence of [A, B] (a subsequence can never reverse its source's relative order), so this is the genuinely order-inconsistent shape no amount of insertion alone can reconcile into the requested order.
    const wired = insertEdge(insertEdge(baseGraph, sectionId, b), sectionId, a);

    const reconciled = insertNode(wired, {
      kind: "section",
      properties: { kind: "section" },
      children: [a, b],
    });
    expect(reconciled.id).toBe(sectionId);

    const contains = reconciled.graph.edges.filter(
      (edge) => edge.from === sectionId && edge.kind === "CONTAINS",
    );
    // No inflation: exactly one edge to each of A and B (max(existingCount, requestedCount) is 1 for both), never a third, freshly-minted edge for either -- a naive LCS-only match (with no anti-inflation pass) would leave one of the two existing edges unmatched and mint a fresh duplicate here.
    expect(contains).toHaveLength(2);
    expect(contains.filter((edge) => edge.to === a)).toHaveLength(1);
    expect(contains.filter((edge) => edge.to === b)).toHaveLength(1);

    // A second pre-wiring, against a distinct id, for the anti-inflation pass's own multi-occurrence branch: two existing edges to the SAME id (A) rather than one each to two different ids, with A not requested at all. The LCS pass matches nothing (children holds only B), so both A edges land in the anti-inflation pass's unmatched-by-target bucket for A -- the first populates the bucket, the second appends to it, which is the branch the case above never reaches since every existing edge there has a distinct target of its own.
    const bOnlyId = contentHashV1({ kind: "section", children: [b] });
    const bOnlyWired = insertEdge(
      insertEdge(baseGraph, bOnlyId, a),
      bOnlyId,
      a,
    );

    const bOnlyReconciled = insertNode(bOnlyWired, {
      kind: "section",
      properties: { kind: "section" },
      children: [b],
    });
    expect(bOnlyReconciled.id).toBe(bOnlyId);

    const bOnlyContains = bOnlyReconciled.graph.edges.filter(
      (edge) => edge.from === bOnlyId && edge.kind === "CONTAINS",
    );
    // A's two pre-wired, unmatched edges are left exactly as they were (multiplicity stays 2, neither dropped nor duplicated), and B -- requested but never pre-wired -- is inserted fresh at multiplicity 1.
    expect(bOnlyContains).toHaveLength(3);
    expect(bOnlyContains.filter((edge) => edge.to === a)).toHaveLength(2);
    expect(bOnlyContains.filter((edge) => edge.to === b)).toHaveLength(1);
  });

  // An independent reference model of the exact algorithm reconcileChildren's own doc comment describes (LCS classification, then the anti-inflation multiplicity pass, then anchor-relative insertion), written from that prose rather than copied from graph.ts's own implementation, so it fails to agree with graph.ts whenever graph.ts's own dp/backtrack/anti-inflation/anchor arithmetic diverges from the documented algorithm -- including every off-by-one in the dp table's own bounds, the matchedIndex/matchedByOriginal array sizes, the backtrack's tie-break direction, and the anti-inflation pass's own bookkeeping. Genuinely distinct from the "every genuine-subsequence pre-wiring" exhaustive sweep above: that sweep only ever pre-wires SELECTED positions of `children` itself (by construction always a genuine subsequence of the request), a shape under which the module's own stronger guarantee (reconciliation reproduces `children` exactly) makes many internal wrong-choice bugs unobservable -- any valid maximum-length assignment reconstructs the identical final order, so a backtrack tie-break bug or a dp off-by-one that still finds SOME maximum assignment slips through undetected. Order-INCONSISTENT existing wiring (arbitrary sequences the request cannot embed as a subsequence) carries no such masking guarantee, which is exactly where a wrong dp value or a wrong tie-break produces a genuinely different, independently-checkable final order.
  function reconcileOracle(
    existingSeq: readonly string[],
    children: readonly string[],
  ): string[] {
    const dp: number[][] = Array.from({ length: existingSeq.length + 1 }, () =>
      new Array<number>(children.length + 1).fill(0),
    );
    for (let i = existingSeq.length - 1; i >= 0; i -= 1) {
      for (let j = children.length - 1; j >= 0; j -= 1) {
        dp[i]![j] =
          existingSeq[i] === children[j]
            ? dp[i + 1]![j + 1]! + 1
            : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
    const matchedIndex = new Array<number | undefined>(children.length).fill(
      undefined,
    );
    const matchedByOriginal = new Array<number | undefined>(
      existingSeq.length,
    ).fill(undefined);
    let i = 0;
    let j = 0;
    while (i < existingSeq.length && j < children.length) {
      if (existingSeq[i] === children[j]) {
        matchedIndex[j] = i;
        matchedByOriginal[i] = j;
        i += 1;
        j += 1;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
        i += 1;
      } else {
        j += 1;
      }
    }
    const unmatchedExistingByTarget = new Map<string, number[]>();
    existingSeq.forEach((value, index) => {
      if (matchedByOriginal[index] !== undefined) return;
      const bucket = unmatchedExistingByTarget.get(value);
      if (bucket === undefined) unmatchedExistingByTarget.set(value, [index]);
      else bucket.push(index);
    });
    const leftoverPointer = new Map<string, number>();
    children.forEach((value, position) => {
      if (matchedIndex[position] !== undefined) return;
      const leftovers = unmatchedExistingByTarget.get(value);
      if (leftovers === undefined) return;
      const pointer = leftoverPointer.get(value) ?? 0;
      if (pointer >= leftovers.length) return;
      matchedIndex[position] = leftovers[pointer]!;
      leftoverPointer.set(value, pointer + 1);
    });
    const anchorFor = (position: number): number => {
      for (let later = position + 1; later < children.length; later += 1) {
        const candidate = matchedIndex[later];
        if (candidate !== undefined) return candidate;
      }
      return existingSeq.length;
    };
    const insertedAtOrBefore: number[] = [];
    let current: string[] = [...existingSeq];
    for (let position = 0; position < children.length; position += 1) {
      if (matchedIndex[position] !== undefined) continue;
      const anchorIndex = anchorFor(position);
      const insertIndex =
        anchorIndex +
        insertedAtOrBefore.filter((inserted) => inserted <= anchorIndex).length;
      insertedAtOrBefore.push(anchorIndex);
      current = [
        ...current.slice(0, insertIndex),
        children[position]!,
        ...current.slice(insertIndex),
      ];
    }
    return current;
  }

  // Every sequence over a 3-label pool up to the given length -- deliberately including sequences no `children` value could ever "pre-wire" as a genuine subsequence, unlike the exhaustive sweep above.
  function allLabelSequences(maxLength: number): string[][] {
    const alphabet = ["a", "b", "c"];
    const sequences: string[][] = [[]];
    for (let length = 1; length <= maxLength; length += 1) {
      for (const seq of allLabelSequences(length - 1)) {
        for (const label of alphabet) sequences.push([...seq, label]);
      }
    }
    return sequences;
  }

  it("agrees with an independently-modelled reference algorithm across arbitrary (not just genuinely-subsequence) existing wirings, over every combination of a 3-label pool", () => {
    const { graph: baseGraph, pool } = mintLeafPool(3);
    const byLabel = { a: pool[0]!, b: pool[1]!, c: pool[2]! };
    // Length 4, not 3: the anti-inflation pass's own multi-occurrence reuse (a bucket holding MORE than one leftover index for the same id, and a pointer advancing past its first entry to a second) can only ever matter to the final output when existing carries at least two UNMATCHED occurrences of the same id that children also asks for again -- and forcing even one existing occurrence of a repeated id to go unmatched by direct LCS already needs a THIRD, differently-labelled element interspersed to break the trivial full match a homogeneous run would otherwise get for free (see this suite's own comment on the exhaustive-subsequence sweep above about full-length matches masking wrong-choice bugs). Two such occurrences plus one interleaved break needs four existing slots (e.g. [a,a,x,a]), one more than a length-3 wiring can ever hold -- confirmed directly: a bucket.push/leftover-pointer-advance mutation on this pass survived the length-3 sweep untouched, killed only once existingSeqs reached length 4.
    const existingSeqs = allLabelSequences(4); // every arbitrary existing wiring up to length 4, subsequence or not
    const childrenSeqs = allLabelSequences(4).filter((seq) => seq.length > 0);
    let casesRun = 0;
    for (const existingSeq of existingSeqs) {
      for (const children of childrenSeqs) {
        const sectionId = contentHashV1({
          kind: "section",
          children: children.map((label) => byLabel[label as "a"]),
        });
        const wired = existingSeq.reduce(
          (acc, label) => insertEdge(acc, sectionId, byLabel[label as "a"]),
          baseGraph,
        );
        const reconciled = insertNode(wired, {
          kind: "section",
          properties: { kind: "section" },
          children: children.map((label) => byLabel[label as "a"]),
        });
        const actual = reconciled.graph.edges
          .filter((edge) => edge.from === sectionId && edge.kind === "CONTAINS")
          .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))
          .map((edge) => edge.to);
        const expected = reconcileOracle(
          existingSeq.map((label) => byLabel[label as "a"]),
          children.map((label) => byLabel[label as "a"]),
        );
        expect(
          actual,
          `existing=[${existingSeq.join(",")}] children=[${children.join(",")}]`,
        ).toEqual(expected);
        casesRun += 1;
      }
    }
    expect(casesRun).toBe(existingSeqs.length * childrenSeqs.length);
  });
});

describe("write API: removeEdge / replaceEdge (#1004)", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("removeEdge detaches the one matching CONTAINS edge and leaves every other edge and every node untouched", () => {
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const b = insertNode(a.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const wired = insertEdge(
      insertEdge(
        // Two decoys, each satisfying exactly one clause of selectEdge's own (from, to, kind) match and not the other: a CONTAINS edge to A from a DIFFERENT owner (right to/kind, wrong from), and a STYLED_BY edge from "parent" to A (right from/to, wrong kind). Neither may count as a match for removeEdge(wired, "parent", a.id) -- a filter with either clause forced true would over-match one of these and either throw AmbiguousEdgeError or detach the wrong edge.
        insertEdge(
          insertEdge(b.graph, "unrelated-parent", a.id),
          "parent",
          a.id,
          { kind: "STYLED_BY" },
        ),
        "parent",
        a.id,
      ),
      "parent",
      b.id,
    );

    const bEdgeBefore = wired.edges.find(
      (edge) => edge.from === "parent" && edge.to === b.id,
    )!;

    const result = removeEdge(wired, "parent", a.id);
    const contains = result.edges.filter(
      (edge) => edge.from === "parent" && edge.kind === "CONTAINS",
    );
    expect(contains).toEqual([bEdgeBefore]);
    // The two decoys survive untouched: only the genuine (parent, a, CONTAINS) match was ever removed.
    expect(
      result.edges.some(
        (edge) => edge.from === "unrelated-parent" && edge.to === a.id,
      ),
    ).toBe(true);
    expect(
      result.edges.some(
        (edge) =>
          edge.from === "parent" &&
          edge.to === a.id &&
          edge.kind === "STYLED_BY",
      ),
    ).toBe(true);
    // Nodes are never pruned by removeEdge -- the detached edge's own target, however unreferenced it may now be, is exactly the orphan this module's own top comment already treats as intentional free version history.
    expect(result.nodes).toEqual(wired.nodes);
  });

  it("removeEdge throws UnknownEdgeError, naming the fields that produced the refusal, when no edge matches (from, to, kind)", () => {
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    let caught: unknown;
    try {
      removeEdge(a.graph, "parent", a.id);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnknownEdgeError);
    const unknown = caught as UnknownEdgeError;
    expect(unknown.from).toBe("parent");
    expect(unknown.to).toBe(a.id);
    expect(unknown.kind).toBe("CONTAINS");
    expect(unknown.path).toBeUndefined();
  });

  it("removeEdge disambiguates two PROPERTY edges sharing (from, to, kind) via path, and throws AmbiguousEdgeError naming the match count when path is omitted", () => {
    const v = insertNode(EMPTY_GRAPH, {
      kind: "value",
      properties: { value: "shared" },
    });
    let graph = insertEdge(v.graph, "owner", v.id, {
      kind: "PROPERTY",
      path: ["a"],
    });
    graph = insertEdge(graph, "owner", v.id, { kind: "PROPERTY", path: ["b"] });

    let caught: unknown;
    try {
      removeEdge(graph, "owner", v.id, { kind: "PROPERTY" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AmbiguousEdgeError);
    const ambiguous = caught as AmbiguousEdgeError;
    expect(ambiguous.from).toBe("owner");
    expect(ambiguous.to).toBe(v.id);
    expect(ambiguous.kind).toBe("PROPERTY");
    expect(ambiguous.matchCount).toBe(2);

    // Naming the exact path resolves it unambiguously.
    const result = removeEdge(graph, "owner", v.id, {
      kind: "PROPERTY",
      path: ["a"],
    });
    const remaining = result.edges.filter(
      (edge) => edge.from === "owner" && edge.kind === "PROPERTY",
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.path).toEqual(["b"]);
  });

  it("replaceEdge repoints an edge onto a new target while reusing the OLD edge's own orderKey and path unchanged, rather than appending at a fresh position", () => {
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const b = insertNode(a.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const c = insertNode(b.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "C." }] },
    });
    // Three siblings under "parent": a, b, c -- b is the one being replaced.
    let graph = insertEdge(c.graph, "parent", a.id);
    graph = insertEdge(graph, "parent", b.id);
    graph = insertEdge(graph, "parent", c.id);
    const before = graph.edges.find(
      (edge) => edge.from === "parent" && edge.to === b.id,
    )!;

    const replacement = insertNode(graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B, revised." }] },
    });
    const result = replaceEdge(
      replacement.graph,
      "parent",
      b.id,
      replacement.id,
    );

    const ordered = result.edges
      .filter((edge) => edge.from === "parent" && edge.kind === "CONTAINS")
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    // Same three-slot order (a, replacement, c) -- the replacement lands exactly where b sat, not appended after c.
    expect(ordered.map((edge) => edge.to)).toEqual([
      a.id,
      replacement.id,
      c.id,
    ]);
    const replaced = ordered.find((edge) => edge.to === replacement.id)!;
    expect(replaced.orderKey).toBe(before.orderKey);
    // The old edge carried no path, so the replacement must genuinely omit the key too.
    expect("path" in replaced).toBe(false);
    // The old edge to b is gone; b itself is still an untouched, unreferenced orphan in graph.nodes.
    expect(result.edges.some((edge) => edge.to === b.id)).toBe(false);
    expect(result.nodes.some((node) => node.id === b.id)).toBe(true);
  });

  it("replaceEdge carries an edge's own path over unchanged onto the new target", () => {
    const v = insertNode(EMPTY_GRAPH, {
      kind: "value",
      properties: { value: "old" },
    });
    const graph = insertEdge(v.graph, "owner", v.id, {
      kind: "PROPERTY",
      path: ["metadata", "title"],
    });
    const w = insertNode(graph, {
      kind: "value",
      properties: { value: "new" },
    });
    const oldEdge = graph.edges.find(
      (edge) => edge.from === "owner" && edge.kind === "PROPERTY",
    )!;
    const result = replaceEdge(w.graph, "owner", v.id, w.id, {
      kind: "PROPERTY",
      path: ["metadata", "title"],
    });
    const edges = result.edges.filter(
      (edge) => edge.from === "owner" && edge.kind === "PROPERTY",
    );
    expect(edges).toEqual([{ ...oldEdge, to: w.id }]);
  });

  it("replaceEdge refuses a CONTAINS replacement that would close a self-loop cycle, but allows a genuine no-op replacement onto the SAME target -- proving the cycle check runs with the edge being replaced already excluded, not the raw pre-replace edge set", () => {
    const leaf = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Leaf." }] },
    });
    const group = insertNode(leaf.graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [leaf.id],
    });

    // group -[CONTAINS]-> leaf already exists; replacing it with group -[CONTAINS]-> group would make group contain itself.
    expect(() => replaceEdge(group.graph, group.id, leaf.id, group.id)).toThrow(
      ContainsCycleError,
    );

    // A genuine no-op replacement (new target identical to the old one) must NOT be refused as a self-cycle: with the edge being replaced excluded from the check, leaf has no remaining CONTAINS children of its own, so nothing reaches back to group.
    const noOp = replaceEdge(group.graph, group.id, leaf.id, leaf.id);
    expect(
      noOp.edges.filter(
        (edge) => edge.from === group.id && edge.to === leaf.id,
      ),
    ).toHaveLength(1);
  });

  it("replaceEdge throws UnknownEdgeError when the old edge does not exist, and never mints a fresh unrelated edge in its place", () => {
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const b = insertNode(a.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    expect(() => replaceEdge(b.graph, "parent", a.id, b.id)).toThrow(
      UnknownEdgeError,
    );
    expect(b.graph.edges.some((edge) => edge.from === "parent")).toBe(false);
  });

  it("never runs the CONTAINS-cycle check for a non-CONTAINS replacement, even when the new target genuinely has an unrelated CONTAINS path back to `from`", () => {
    // A hand-built graph (bypassing insertEdge's own CONTAINS-attachment check, which is not what this test targets) where "b" already CONTAINS-reaches "a": a -[CONTAINS]-> b -[CONTAINS]-> a is a genuine, pre-existing cycle in the raw edge data. replaceEdge's own STYLED_BY replacement below repoints a to "b", which (were the CONTAINS-cycle check to wrongly run for a non-CONTAINS kind) would be refused since "b" already reaches "a" -- but a STYLED_BY replacement has nothing to do with CONTAINS reachability at all, and must succeed.
    const graph: PropertyGraph = {
      nodes: [
        { id: "a", kind: "t" },
        { id: "b", kind: "t" },
        { id: "c", kind: "t" },
      ],
      edges: [
        { from: "a", to: "b", kind: "CONTAINS", orderKey: "k0" },
        { from: "b", to: "a", kind: "CONTAINS", orderKey: "k0" },
        { from: "a", to: "c", kind: "STYLED_BY", orderKey: "k0" },
      ],
    };
    const replaced = replaceEdge(graph, "a", "c", "b", { kind: "STYLED_BY" });
    expect(
      replaced.edges.filter(
        (edge) => edge.from === "a" && edge.kind === "STYLED_BY",
      ),
    ).toEqual([{ from: "a", to: "b", kind: "STYLED_BY", orderKey: "k0" }]);
  });
});

// Every named error class's own `.name` and message text, checked directly against a real construction rather than only via `toThrow(SomeClass)` (which never reads either field) -- each class's own module comment explains why the message is worded the way it is.
describe("named error classes: identity and message text", () => {
  it("NodeKindMismatchError", () => {
    const error = new NodeKindMismatchError("id1", "paragraph", "table");
    expect(error.name).toBe("NodeKindMismatchError");
    expect(error.message).toBe(
      'insertNode: id "id1" already names a node of kind "paragraph", cannot also be kind "table"',
    );
  });

  it("UnknownSiblingError", () => {
    const error = new UnknownSiblingError("from1", "CONTAINS", "sib1");
    expect(error.name).toBe("UnknownSiblingError");
    expect(error.message).toBe(
      'insertEdge: sibling "sib1" names no existing CONTAINS edge from "from1"',
    );
  });

  it("AmbiguousSiblingError", () => {
    const error = new AmbiguousSiblingError("from1", "CONTAINS", "sib1", 3);
    expect(error.name).toBe("AmbiguousSiblingError");
    expect(error.message).toBe(
      'insertEdge: sibling "sib1" names 3 existing CONTAINS edges from "from1", not exactly one -- before/after has no single position to resolve against',
    );
  });

  it("UnknownEdgeError, with and without a path", () => {
    const withoutPath = new UnknownEdgeError(
      "from1",
      "to1",
      "CONTAINS",
      undefined,
    );
    expect(withoutPath.name).toBe("UnknownEdgeError");
    expect(withoutPath.message).toBe(
      'no CONTAINS edge from "from1" to "to1" exists to select',
    );
    const withPath = new UnknownEdgeError("from1", "to1", "PROPERTY", ["a", 0]);
    expect(withPath.message).toBe(
      'no PROPERTY edge from "from1" to "to1" at path ["a",0] exists to select',
    );
  });

  it("AmbiguousEdgeError, with and without a path", () => {
    const withoutPath = new AmbiguousEdgeError(
      "from1",
      "to1",
      "CONTAINS",
      undefined,
      2,
    );
    expect(withoutPath.name).toBe("AmbiguousEdgeError");
    expect(withoutPath.message).toBe(
      '2 CONTAINS edges from "from1" to "to1" match -- pass `path` to disambiguate',
    );
    const withPath = new AmbiguousEdgeError(
      "from1",
      "to1",
      "PROPERTY",
      ["a"],
      2,
    );
    expect(withPath.message).toBe(
      '2 PROPERTY edges from "from1" to "to1" at path ["a"] match -- these edges are identical in every field removeEdge/replaceEdge can compare, so none of them can be selected unambiguously',
    );
  });

  it("ContainsCycleError", () => {
    const error = new ContainsCycleError("from1", "to1");
    expect(error.name).toBe("ContainsCycleError");
    expect(error.message).toBe(
      'insertEdge: attaching CONTAINS "from1" -> "to1" would close a cycle -- "to1" already reaches "from1"',
    );
  });
});

describe("orderKeyAscComparator", () => {
  it("returns -1 when a sorts before b, 1 when after, and 0 when equal", () => {
    expect(orderKeyAscComparator({ orderKey: "1" }, { orderKey: "2" })).toBe(
      -1,
    );
    expect(orderKeyAscComparator({ orderKey: "2" }, { orderKey: "1" })).toBe(1);
    expect(orderKeyAscComparator({ orderKey: "1" }, { orderKey: "1" })).toBe(0);
  });

  it("actually sorts a shuffled list into ascending orderKey order", () => {
    const items = [{ orderKey: "c" }, { orderKey: "a" }, { orderKey: "b" }];
    expect([...items].sort(orderKeyAscComparator)).toEqual([
      { orderKey: "a" },
      { orderKey: "b" },
      { orderKey: "c" },
    ]);
  });
});

describe("runOrRebalance", () => {
  it("returns the attempt's own result when it succeeds, never calling onExhausted", () => {
    let exhaustedCalled = false;
    expect(
      runOrRebalance(
        () => "ok",
        () => {
          exhaustedCalled = true;
          return "rebalanced";
        },
      ),
    ).toBe("ok");
    expect(exhaustedCalled).toBe(false);
  });

  it("answers an OrderKeyBudgetExhaustedError with the rebalance callback's own result", () => {
    expect(
      runOrRebalance(
        () => {
          throw new OrderKeyBudgetExhaustedError("no room");
        },
        () => "rebalanced",
      ),
    ).toBe("rebalanced");
  });

  it("rethrows any error that isn't OrderKeyBudgetExhaustedError, never calling onExhausted", () => {
    expect(() =>
      runOrRebalance(
        () => {
          throw new Error("boom");
        },
        () => "never",
      ),
    ).toThrow("boom");
  });
});

describe("boundedOrderKey", () => {
  it("throws the exact tied-siblings message when two adjacent siblings already share one orderKey", () => {
    const tie = orderKeys.orderKeyForIndex(0);
    const siblings: GraphEdge[] = [
      { from: "p", to: "a", kind: "PROPERTY", orderKey: tie },
      { from: "p", to: "b", kind: "PROPERTY", orderKey: tie },
    ];
    expect(() => boundedOrderKey(siblings, 1)).toThrow(
      "boundedOrderKey: adjacent siblings share one orderKey, leaving no room to bisect; rebalance with renumberedOrderKeys",
    );
  });
});

describe("project() entry-node ordering", () => {
  it("emits multiple policy-extracted table entries sorted ascending by id, not by definition order", () => {
    const doc = wordprocessingPackage(
      [
        sectionGroup([
          headingGroup("H1", 1, [], { style: "s1" }),
          headingGroup("H2", 1, [], { style: "s2" }),
          headingGroup("H3", 1, [], { style: "s3" }),
        ]),
      ],
      {
        styles: {
          s1: { paragraph: { indentLeftPt: 1 } },
          s2: { paragraph: { indentLeftPt: 2 } },
          s3: { paragraph: { indentLeftPt: 3 } },
        },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: doc }]);
    const entryIds = graph.nodes
      .filter((node) => node.kind === "styleEntry")
      .map((node) => node.id);
    expect(entryIds).toHaveLength(3);
    // A default (string) sort is exactly the ascending order pendingEntryNodes.sort's own comparator must produce -- if the real comparator were flipped, tied at 0 unconditionally, or otherwise wrong, entryIds would not already come out matching its own re-sorted copy.
    expect(entryIds).toEqual([...entryIds].sort());
  });
});

describe("insertEdge sibling filtering by kind, not just from", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("resolves a before/after position against only the named kind's own siblings, ignoring a CONTAINS sibling to the same id at the same position", () => {
    // Two edges from the same "parent", to the same two targets, but of DIFFERENT kinds -- CONTAINS and STYLED_BY -- interleaved so that filtering by the wrong (hardcoded) kind would see a different sibling list than filtering by the real `kind` parameter, and therefore resolve `{ at: 'after', siblingId: a.id }` to a different position.
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const b = insertNode(a.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const c = insertNode(b.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "C." }] },
    });
    // Wire two STYLED_BY siblings (a then b) and a THIRD, unrelated CONTAINS sibling to c -- if siblingInsertIndex's own kind filter were replaced by a hardcoded "CONTAINS" (or any other single literal), it would see only the CONTAINS sibling to c and resolve the position against that instead of the real STYLED_BY pair.
    const wired = insertEdge(
      insertEdge(
        insertEdge(b.graph, "parent", a.id, { kind: "STYLED_BY" }),
        "parent",
        b.id,
        {
          kind: "STYLED_BY",
        },
      ),
      "parent",
      c.id,
    );
    const result = insertEdge(wired, "parent", c.id, {
      kind: "STYLED_BY",
      position: { at: "after", siblingId: a.id },
    });
    const styledBy = result.edges
      .filter((edge) => edge.from === "parent" && edge.kind === "STYLED_BY")
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))
      .map((edge) => edge.to);
    // c lands right after a (between a and b), among the STYLED_BY siblings specifically -- not appended past the single unrelated CONTAINS sibling, and not refused as ambiguous by conflating the two kinds.
    expect(styledBy).toEqual([a.id, c.id, b.id]);
  });
});

describe("entryIdAscComparator", () => {
  it("returns -1 when a sorts before b, 1 when after, and 0 when equal", () => {
    expect(entryIdAscComparator({ id: "1" }, { id: "2" })).toBe(-1);
    expect(entryIdAscComparator({ id: "2" }, { id: "1" })).toBe(1);
    expect(entryIdAscComparator({ id: "1" }, { id: "1" })).toBe(0);
  });

  it("leaves a genuine tie's relative order exactly as it was, since Array.prototype.sort is stable", () => {
    // Two entries sharing the identical id (a real content-hash tie), interleaved with a third, distinct id: a correct comparator returns 0 for the tie and lets the stable sort keep the two tied entries in their original relative order either side of the distinct one; a broken tie-break (mutating the `a.id > b.id` branch to `true`, `false`, `>=`, or `<=`) can only ever be observed by an ASSIGNED marker surviving on the tied entries themselves, since the tied ids are otherwise indistinguishable in the output.
    const items = [
      { id: "b", marker: "first-b" },
      { id: "a", marker: "only-a" },
      { id: "b", marker: "second-b" },
    ];
    const sorted = [...items].sort(entryIdAscComparator);
    expect(sorted.map((item) => item.id)).toEqual(["a", "b", "b"]);
    // The two tied "b" entries keep their original relative order (first-b before second-b): a stable sort's own guarantee, and the only way this branch's tie behaviour is genuinely observable.
    expect(sorted.map((item) => item.marker)).toEqual([
      "only-a",
      "first-b",
      "second-b",
    ]);
  });
});

describe("dpAt", () => {
  it("returns the value at a valid index", () => {
    expect(dpAt([10, 20, 30], 1)).toBe(20);
  });

  it("throws with the exact out-of-bounds message for an index past the row's length", () => {
    expect(() => dpAt([10, 20, 30], 3)).toThrow(
      "reconcileChildren: dp lookup index 3 out of bounds (0..2)",
    );
  });

  it("throws with the exact out-of-bounds message for a negative index", () => {
    expect(() => dpAt([10, 20, 30], -1)).toThrow(
      "reconcileChildren: dp lookup index -1 out of bounds (0..2)",
    );
  });
});

describe("reconcileChildren's originalSiblings: sorted and filtered, not raw creation order", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("reads pre-existing CONTAINS edges by their own sorted orderKey, not by the edges array's own literal order", () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const leafB = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const leafC = insertNode(leafB.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "C." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [leafA.id, leafB.id, leafC.id],
    });
    const a = {
      from: sectionId,
      to: leafA.id,
      kind: "CONTAINS" as const,
      orderKey: orderKeys.orderKeyForIndex(0),
    };
    const b = {
      from: sectionId,
      to: leafB.id,
      kind: "CONTAINS" as const,
      orderKey: orderKeys.orderKeyForIndex(1),
    };
    const c = {
      from: sectionId,
      to: leafC.id,
      kind: "CONTAINS" as const,
      orderKey: orderKeys.orderKeyForIndex(2),
    };
    // Deliberately out of orderKey order in the edges ARRAY itself (c, a, b): reading originalSiblings by array order would see existingSeq = [C, A, B], which is NOT a subsequence of the requested [A, B, C] (C can never precede A in a subsequence of [A, B, C]), so an unsorted read would fail to match all three and mint a spurious extra edge instead of recognising every position as already wired.
    const graph: PropertyGraph = { nodes: leafC.graph.nodes, edges: [c, a, b] };
    const result = insertNode(graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafB.id, leafC.id],
    });
    const contains = result.graph.edges.filter(
      (edge) => edge.from === sectionId && edge.kind === "CONTAINS",
    );
    expect(contains).toHaveLength(3);
  });

  it("ignores a decoy edge sharing the owner id or the CONTAINS kind but not both", () => {
    // Requests leafA TWICE: with only one genuine existing edge, reconciliation must insert a fresh second CONTAINS edge for the missing occurrence -- UNLESS a decoy is wrongly counted as one of sectionId's own existing siblings, in which case it would falsely look like the second occurrence is already wired and no new edge would be inserted. A single-occurrence request can't expose this: reconciliation never deletes an existing edge just because originalSiblings over-counted it, so a decoy wrongly included alongside one real match produces the identical final edge count as a decoy correctly excluded.
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const other = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Other." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [leafA.id, leafA.id],
    });
    const genuine = {
      from: sectionId,
      to: leafA.id,
      kind: "CONTAINS" as const,
      orderKey: orderKeys.orderKeyForIndex(0),
    };
    // A decoy from a DIFFERENT owner, still CONTAINS, also targeting leafA -- must never be read as one of sectionId's own existing siblings.
    const decoyFrom = {
      from: other.id,
      to: leafA.id,
      kind: "CONTAINS" as const,
      orderKey: orderKeys.orderKeyForIndex(0),
    };
    // A decoy from sectionId, but a different kind, also targeting leafA -- must never be read as a CONTAINS sibling.
    const decoyKind = {
      from: sectionId,
      to: leafA.id,
      kind: "STYLED_BY" as const,
      orderKey: orderKeys.orderKeyForIndex(0),
    };
    const graph: PropertyGraph = {
      nodes: other.graph.nodes,
      edges: [genuine, decoyFrom, decoyKind],
    };
    const result = insertNode(graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafA.id],
    });
    const contains = result.graph.edges.filter(
      (edge) => edge.from === sectionId && edge.kind === "CONTAINS",
    );
    // The genuine edge plus one freshly inserted edge for the second requested occurrence -- if either decoy were wrongly counted as an existing sectionId/CONTAINS sibling, it would falsely satisfy the second occurrence and this length would drop to 1.
    expect(contains).toHaveLength(2);
  });
});

describe("insertEdge: the CONTAINS cycle check is scoped to CONTAINS edges alone", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("does not run the cycle check for a non-CONTAINS edge, even when attaching it would close a CONTAINS cycle", () => {
    const x = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "X." }] },
    });
    const y = insertNode(x.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Y." }] },
    });
    // x CONTAINS y, so y reaches x's own would-be child position: attaching a further CONTAINS edge y -> x would close a cycle.
    const wired = insertEdge(y.graph, x.id, y.id);
    expect(() => insertEdge(wired, y.id, x.id)).toThrow(ContainsCycleError);
    // The identical y -> x attachment as a STYLED_BY edge is not a CONTAINS edge at all, so the cycle check must never run for it -- it succeeds even though "x" (the `to`) already reaches "y" (the `from`) via the CONTAINS edge above.
    const styled = insertEdge(wired, y.id, x.id, { kind: "STYLED_BY" });
    const styledEdge = styled.edges.find(
      (edge) => edge.from === y.id && edge.kind === "STYLED_BY",
    );
    expect(styledEdge?.to).toBe(x.id);
  });
});

describe("insertEdge sorts its own siblings by orderKey before resolving a position", () => {
  it("resolves a before/after position against the sorted index, not the edges array's own raw position", () => {
    const a = {
      from: "p",
      to: "a",
      kind: "STYLED_BY" as const,
      orderKey: orderKeys.orderKeyForIndex(0),
    };
    const b = {
      from: "p",
      to: "b",
      kind: "STYLED_BY" as const,
      orderKey: orderKeys.orderKeyForIndex(1),
    };
    const c = {
      from: "p",
      to: "c",
      kind: "STYLED_BY" as const,
      orderKey: orderKeys.orderKeyForIndex(2),
    };
    // Deliberately out of orderKey order in the edges ARRAY (c, b, a): "a"'s SORTED index is 0 (before b), but its RAW array index is 2 (last). An unsorted read would resolve "after a" to raw-index 3 -- past the end of the raw array -- bisecting via orderKeyAfter(a's key) into a wide, high-valued key (base-36 orderKeyAfter escapes to a short, lexicographically large string). A correctly-sorted read resolves "after a" to sorted-index 1, bisecting via orderKeyBetween(a, b) into a narrow key strictly less than b.
    const graph: PropertyGraph = { nodes: [], edges: [c, b, a] };
    const result = insertEdge(graph, "p", "d", {
      kind: "STYLED_BY",
      position: { at: "after", siblingId: "a" },
    });
    const inserted = result.edges.find((edge) => edge.to === "d");
    expect(inserted).toBeDefined();
    expect(inserted!.orderKey < b.orderKey).toBe(true);
  });
});
