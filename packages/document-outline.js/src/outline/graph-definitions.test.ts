import { describe, expect, it } from "vitest";
import {
  type DefinitionEntry,
  type DocumentTree,
  type SectionGroupNode,
} from "document-schema.js";
import {
  type ExtractionPolicy,
  type PropertyGraph,
  defaultExtractionPolicy,
  orderKeys,
  projectDocumentGraph,
} from "./graph";
import { expectSchemaValid } from "../test-support/graph-assertions";
import {
  headingGroup,
  paragraph,
  sectionGroup,
  wordprocessingPackage,
} from "../test-support/fixtures";

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
    const expectedEntryCount = 4; // all four exist whether or not anything references them
    expect(entries).toHaveLength(expectedEntryCount);
    expect(
      entries
        .map((node) => String(node.tenantKind))
        .sort((a, b) => (a < b ? -1 : 1)),
    ).toEqual(["attachment", "destination", "footnote", "layer"]);
    // Table-entry nodes are flushed sorted by their own content-hash id (project()'s own pendingEntryNodes.sort), so two differently-spelled key sets emit these four nodes in the same, id-ascending order — comparing the emitted order against a FRESH, independent default sort of the same ids (rather than re-deriving expected ids by hand, which the hash recipe makes impractical) is what actually distinguishes a genuinely-sorted emission from an unsorted or wrongly-ordered one.
    const ids = entries.map((node) => node.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("walks a null-valued property in a definitions entry as a scalar, never as a record", () => {
    // A generic definitions entry is a z.looseObject, so an extra key can carry any JSON value including a bare null — isRecord's own `value !== null` guard is what keeps typeof null === "object" from being walked as a record (which would throw on Object.keys(null)).
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
    // DefinitionEntry bodies are tenant vocabulary, loose by design (src/definitions.ts): a glossary entry legitimately spells `definition` for a term's meaning, so the deref is gated on the containing record being an anchor descriptor, not on the key name. A value that coincidentally names a real key must stay content too — hashed verbatim, never silently swapped for a ref id.
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
    expect(
      glossary
        .map((node) => String(node.definition))
        .sort((a, b) => (a < b ? -1 : 1)),
    ).toEqual(["n1", "the minimum number of members needed"]);
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
    // Two footnotes whose bodies reference each other — the mutual-reference case the graph hardenings name as legitimate-looking input. No content hash can cover it (the hash would have to include itself), so the projection refuses it loudly.
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
    // A hand-built, deliberately non-schema-valid leaf: TreeLeaf's own type never actually allows an array, so this can only be reached by bypassing the type system exactly as this test does — the invariant recordOf's own comment names ("every schema payload is a plain record") holds for every real DocumentTree, and this proves the guard actually fires rather than silently walking Object.keys([]) or similar if it were ever violated.
    const malformedPkg = wordprocessingPackage([
      [] as unknown as SectionGroupNode,
    ]);
    expect(() =>
      projectDocumentGraph([{ id: "doc", package: malformedPkg }]),
    ).toThrow(/schema payload is not a plain record/);
  });

  it("decideEntry refuses an entry whose own table slot is explicitly undefined, the same defensive invariant recordOf enforces for non-record payloads", () => {
    // Every real call site (resolveStyleRef/resolveDefinitionRef's own pre-checks, and the root table walk's own Object.keys(table) enumeration) already guarantees a defined entry before decideEntry ever runs — so this, like the test above, can only be reached by hand-building a table whose value is explicitly `undefined` for one of its own keys, bypassing the type system exactly as this test does.
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
    for (const edge of graph.edges.filter(
      (candidate) => candidate.kind === "PROPERTY",
    )) {
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
    // The dereferenced ENTRY CONTENT rides on the node — never the document-local key 's1'.
    expect(heading.style).toEqual(entry);
    expect(
      graph.nodes.find((node) => node.kind === "documentTree")!.styles,
    ).toEqual({ s1: entry });
  });

  it("emits a DEFINED_BY edge discovered inside a policy-extracted record value nested in a table entry's own body", () => {
    const metaPathDepth = 3;
    const extractMeta: ExtractionPolicy = (path, value) =>
      path.length === metaPathDepth &&
      path[0] === "definitions" &&
      path[2] === "meta"
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
    // mintValueNode's non-record branch (isRecord(value) === false) also covers arrays — walk() recurses into each element and accumulates their own edges, unlike a genuine scalar which never carries any.
    const metaPathDepth = 3;
    const extractMeta: ExtractionPolicy = (path, value) =>
      path.length === metaPathDepth &&
      path[0] === "definitions" &&
      path[2] === "meta"
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
