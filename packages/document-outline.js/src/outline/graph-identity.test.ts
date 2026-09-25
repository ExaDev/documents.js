import { describe, expect, it } from "vitest";
import {
  type ContentParagraph,
  type DocumentTree,
  type DocumentTreeJson,
  type LayoutMetadata,
  documentTreeWithSchema,
  factorStyles,
} from "document-schema.js";
import { effectivePackage } from "./effective";
import {
  type ExtractionPolicy,
  type PropertyGraph,
  contentHashV1,
  entryIdAscComparator,
  orderKeyAscComparator,
  orderKeys,
  projectDocumentGraph,
} from "./graph";
import {
  expectSchemaValid,
  nodeByText,
} from "../test-support/graph-assertions";
import {
  headingGroup,
  paragraph,
  sectionGroup,
  wordprocessingPackage,
} from "../test-support/fixtures";

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
    const expectedSectionCount = 3; // the shared one plus each document's own final section
    const sections = graph.nodes.filter((node) => node.kind === "section");
    expect(sections).toHaveLength(expectedSectionCount);
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
    const expectedParagraphCount = 5;
    expect(
      graph.nodes.filter((node) => node.kind === "paragraph"),
    ).toHaveLength(expectedParagraphCount);
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

describe("factoring and node identity", () => {
  // One document, two spellings: the unfactored tree carries the recurring tuple inline on every styled paragraph; factorStyles (the minting pass itself) hoists it onto a section wrapper's ref plus a styles-table entry. The projection deliberately hashes each node's own projected content, not style-resolved content, so the two spellings' node ids differ wherever the style rides while everything it does not touch is shared — and effectivePackage first is the caller's route to factoring-invariant ids, exactly as it already is for leafContentHash.
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
    // The recurring tuple is hoisted onto the first section's own ref (1 STYLED_BY edge), and both styled paragraphs — now bare, non-anchor leaves under that styled section — inherit the chain too (#660): one edge each, 3 in total, all resolving to the same shared style entry.
    const expectedStyledByCount = 3;
    expect(
      factoredGraph.edges.filter((edge) => edge.kind === "STYLED_BY"),
    ).toHaveLength(expectedStyledByCount);
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
    const expectedKeyCount = 3;
    expect(keys).toHaveLength(expectedKeyCount);
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
    // Nested midpoints keep landing in the shrinking interval until the digits run out — the documented rebalance signal, not a silent duplicate.
    let low = first;
    let landed = true;
    const iterationSafetyBound = 10_000;
    for (let i = 0; i < iterationSafetyBound && landed; i += 1) {
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
    const rebalanceSiblingCount = 3;
    expect(renumberedOrderKeys(rebalanceSiblingCount)).toEqual([
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
    // Two serialisation labels naming two different schema releases — additive-compatible releases stamp different URIs on the same semantics, and the recipe strips the label before hashing.
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
    // A table entry whose body spells the face's reserved word — the projection's own hash decides the id, so a caller cannot steer it.
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
    // The anchor's own content spells the face's reserved word directly on the node, not inside a table entry — projectGroup's mint site must shadow it exactly as entryNodeFace's does.
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
    const expectedEntryCount = 3;
    expect(entryIds).toHaveLength(expectedEntryCount);
    // A default (string) sort is exactly the ascending order pendingEntryNodes.sort's own comparator must produce — if the real comparator were flipped, tied at 0 unconditionally, or otherwise wrong, entryIds would not already come out matching its own re-sorted copy.
    expect(entryIds).toEqual([...entryIds].sort());
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
