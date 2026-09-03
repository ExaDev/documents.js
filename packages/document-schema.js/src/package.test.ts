import { describe, expect, it } from "vitest";
import { type DocumentTree, DocumentTreeSchema } from "./package";

const PAGE = { widthPt: 612, heightPt: 792 };
const MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

// A wordprocessing package in the tree form: the root carries kind/metadata/pages, and one section group per section with the section's own blocks grouped inside it -- a heading group wrapping a leaf paragraph, plus the section's own trailing leaf.
function wordprocessingPackage(): DocumentTree {
  return {
    kind: "wordprocessing",
    metadata: { title: "Package round trip", author: "document-schema.js" },
    pages: [PAGE],
    children: [
      {
        node: { kind: "section", pageSize: PAGE, margins: MARGINS },
        children: [
          {
            node: {
              kind: "paragraph",
              headingLevel: 1,
              runs: [
                {
                  text: "Hello, package.",
                  // A run rendered onto a single page -- the frame's own pageIndex matches the root pages array's own index.
                  frames: [
                    {
                      pageIndex: 0,
                      xPt: 72,
                      yPt: 720,
                      widthPt: 96,
                      heightPt: 12,
                    },
                  ],
                },
              ],
              frames: [
                { pageIndex: 0, xPt: 72, yPt: 720, widthPt: 96, heightPt: 12 },
              ],
            },
            children: [
              {
                kind: "paragraph",
                runs: [{ text: "Body under the heading." }],
              },
            ],
          },
        ],
      },
    ],
  };
}

// A spreadsheet package whose sheet group carries its grid on the node and an anchored image child -- the other end of the per-kind children typing.
function spreadsheetPackage(): DocumentTree {
  return {
    kind: "spreadsheet",
    metadata: {},
    children: [
      {
        node: {
          kind: "sheet",
          name: "Sheet1",
          cells: [
            {
              row: 0,
              column: 0,
              value: { kind: "number", value: 1 },
              displayText: "1",
            },
          ],
          columns: [],
          rows: [],
          printSettings: {
            pageSize: PAGE,
            margins: MARGINS,
            gridlines: true,
            headers: true,
            pageOrder: "downThenOver",
          },
        },
        children: [
          {
            kind: "image",
            format: "png",
            base64: "aGk=",
            widthPt: 50,
            heightPt: 50,
            anchorRow: 0,
            anchorColumn: 0,
            offsetXPt: 0,
            offsetYPt: 0,
          },
        ],
      },
    ],
  };
}

// A formula package: the one kind whose single child is a leaf, not a group.
function formulaPackage(): DocumentTree {
  return {
    kind: "formula",
    metadata: {},
    children: [
      {
        mathml: [
          { type: "element", tag: "math", attributes: [], children: [] },
        ],
      },
    ],
  };
}

describe("DocumentTreeSchema round trips (tree form)", () => {
  it("deep-equals the original package after a JSON round trip when pages/frames are present", () => {
    const original = wordprocessingPackage();
    const parsed = DocumentTreeSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(DocumentTreeSchema.parse(roundTripped)).toEqual(original);
  });

  it("deep-equals a content-only package (no pages, no styles, no definitions) after a JSON round trip", () => {
    const original = wordprocessingPackage();
    delete original.pages;
    const parsed = DocumentTreeSchema.parse(original);
    expect(parsed.pages).toBeUndefined();
    const serialized: unknown = JSON.parse(JSON.stringify(parsed));
    expect(serialized).not.toHaveProperty("pages");
    expect(DocumentTreeSchema.parse(serialized)).toEqual(original);
  });

  it("round trips a spreadsheet package and a formula package", () => {
    for (const original of [spreadsheetPackage(), formulaPackage()]) {
      const parsed = DocumentTreeSchema.parse(original);
      const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
      expect(DocumentTreeSchema.parse(roundTripped)).toEqual(original);
    }
  });

  it("tolerates and strips an incoming $schema key, and accepts styles and definitions tables at the root", () => {
    const original = wordprocessingPackage();
    const withTables = {
      $schema:
        "https://cdn.jsdelivr.net/npm/document-schema.js@4.0.0/schemas/document-package.schema.json",
      ...original,
      styles: {
        s1: { paragraph: { alignment: "justify" }, run: { sizePt: 11 } },
      },
      definitions: { l1: { kind: "link", url: "https://example.com" } },
    };
    const parsed = DocumentTreeSchema.parse(withTables);
    expect(parsed.styles).toEqual({
      s1: { paragraph: { alignment: "justify" }, run: { sizePt: 11 } },
    });
    expect(parsed.definitions).toEqual({
      l1: { kind: "link", url: "https://example.com" },
    });
    expect("$schema" in parsed).toBe(false);
  });

  it("rejects the retired 3.x flat shape -- a value with no children and no tree kind at the root", () => {
    const oldShape = {
      formatVersion: 2,
      content: {
        kind: "wordprocessing",
        metadata: {},
        sections: [{ pageSize: PAGE, margins: MARGINS, blocks: [] }],
      },
      pages: [PAGE],
    };
    expect(DocumentTreeSchema.safeParse(oldShape).success).toBe(false);
  });

  it("rejects a root child of the wrong group kind for the package kind", () => {
    const mixed = {
      kind: "presentation",
      metadata: {},
      children: [
        {
          node: { kind: "section", pageSize: PAGE, margins: MARGINS },
          children: [],
        },
      ],
    };
    expect(DocumentTreeSchema.safeParse(mixed).success).toBe(false);
  });

  it("rejects a malformed leaf deep in the tree (a style entry carrying the banned frames key, and a non-group slide child)", () => {
    const withBannedStyle = {
      ...wordprocessingPackage(),
      styles: { s1: { frames: [] } },
    };
    expect(DocumentTreeSchema.safeParse(withBannedStyle).success).toBe(false);

    const slideWithStrayParagraph = {
      kind: "presentation",
      metadata: {},
      children: [
        {
          node: {
            kind: "slide",
            size: { widthPt: 960, heightPt: 540 },
            notes: "",
          },
          children: [{ kind: "paragraph", runs: [{ text: "stray" }] }],
        },
      ],
    };
    expect(DocumentTreeSchema.safeParse(slideWithStrayParagraph).success).toBe(
      false,
    );
  });

  it("rejects an unknown key on a group wrapper and a style ref on a bare leaf -- the runtime guard matches the published JSON Schema fragments key for key", () => {
    const withJunkWrapperKey = {
      kind: "wordprocessing",
      metadata: {},
      children: [
        {
          node: { kind: "section", pageSize: PAGE, margins: MARGINS },
          junkKey: "x",
          children: [],
        },
      ],
    };
    expect(DocumentTreeSchema.safeParse(withJunkWrapperKey).success).toBe(
      false,
    );

    const withLeafStyleRef = {
      kind: "wordprocessing",
      metadata: {},
      children: [
        {
          node: { kind: "section", pageSize: PAGE, margins: MARGINS },
          children: [
            { kind: "paragraph", runs: [{ text: "Body." }], style: "s1" },
          ],
        },
      ],
    };
    expect(DocumentTreeSchema.safeParse(withLeafStyleRef).success).toBe(false);
  });

  it("pins the formula package to exactly one child -- decompose emits one ContentFormula and flatten requires one", () => {
    const empty = { kind: "formula", metadata: {}, children: [] };
    expect(DocumentTreeSchema.safeParse(empty).success).toBe(false);
    const two = {
      kind: "formula",
      metadata: {},
      children: [{ mathml: [] }, { mathml: [] }],
    };
    expect(DocumentTreeSchema.safeParse(two).success).toBe(false);
  });

  it("keeps the document-level symbolTable on the package root, spliced from the same declaration the content arms use", () => {
    const original = wordprocessingPackage();
    const withSymbols = {
      ...original,
      symbolTable: { symbols: [], units: [] },
    };
    const parsed = DocumentTreeSchema.parse(withSymbols);
    expect(parsed.symbolTable).toEqual({ symbols: [], units: [] });
  });
});

// The 4.1.0 additions at the root (ExaDev/document-schema.js#24): three more tables of the same generic type `definitions` already uses, and the additivity guarantee that made them a minor.
describe("the construct tables at the package root", () => {
  it("accepts layers, attachments, and destinations, each its own key namespace over kind-tagged entries", () => {
    const withTables = {
      ...wordprocessingPackage(),
      layers: {
        ocg1: { kind: "layer", name: "Watermark", defaultVisible: false },
        d: { kind: "layerConfig", baseState: "ON", order: ["ocg1"] },
      },
      attachments: {
        a1: {
          kind: "attachment",
          fileName: "source.csv",
          description: "The source data",
        },
      },
      destinations: {
        ch1: { kind: "destination", pageIndex: 0 },
        o1: { kind: "outline", title: "Chapter 1", destination: "ch1" },
      },
    };
    const parsed = DocumentTreeSchema.parse(withTables);
    expect(parsed.layers?.ocg1).toEqual({
      kind: "layer",
      name: "Watermark",
      defaultVisible: false,
    });
    expect(parsed.attachments?.a1).toEqual({
      kind: "attachment",
      fileName: "source.csv",
      description: "The source data",
    });
    expect(parsed.destinations?.o1).toEqual({
      kind: "outline",
      title: "Chapter 1",
      destination: "ch1",
    });
  });

  it("lets one name appear in more than one table without collision -- separate root fields are separate namespaces", () => {
    const withTables = {
      ...wordprocessingPackage(),
      layers: { x: { kind: "layer", name: "Layer x" } },
      destinations: { x: { kind: "destination", pageIndex: 3 } },
    };
    const parsed = DocumentTreeSchema.parse(withTables);
    expect(parsed.layers?.x).toEqual({ kind: "layer", name: "Layer x" });
    expect(parsed.destinations?.x).toEqual({
      kind: "destination",
      pageIndex: 3,
    });
  });

  it("requires the kind discriminator on every entry, exactly as the definitions table does", () => {
    for (const field of ["layers", "attachments", "destinations"]) {
      const broken = {
        ...wordprocessingPackage(),
        [field]: { e1: { name: "no kind here" } },
      };
      expect(DocumentTreeSchema.safeParse(broken).success).toBe(false);
    }
  });

  it("preserves each tenant body through a JSON round trip, since the entry body is the tenant vocabulary and not this package to strip", () => {
    const original = {
      ...wordprocessingPackage(),
      attachments: {
        a1: { kind: "attachment", fileName: "source.csv", bytesBase64: "aGk=" },
      },
    };
    const roundTripped: unknown = JSON.parse(
      JSON.stringify(DocumentTreeSchema.parse(original)),
    );
    expect(DocumentTreeSchema.parse(roundTripped)).toEqual(original);
  });
});

describe("the package-level source residue table at the root", () => {
  it("accepts a keyed table of residue values, each keyed by the producer's own identifier for what it reconstructs", () => {
    const withResidue = {
      ...wordprocessingPackage(),
      source: {
        "word/settings.xml": { format: "docx", xml: "<w:settings/>" },
        frontmatter: {
          format: "markdown",
          xml: "<dc:custom>unmapped half</dc:custom>",
        },
      },
    };
    const parsed = DocumentTreeSchema.parse(withResidue);
    expect(parsed.source?.["word/settings.xml"]).toEqual({
      format: "docx",
      xml: "<w:settings/>",
    });
    expect(parsed.source?.frontmatter).toEqual({
      format: "markdown",
      xml: "<dc:custom>unmapped half</dc:custom>",
    });
  });

  it("rejects a malformed residue value -- the table validates the channel's shape, it does not tenant it", () => {
    const broken = {
      ...wordprocessingPackage(),
      // 'ooxml' is a package name, never a format name, so it can never join the enum the way 'rtf' since has -- which is what makes it a stable stand-in for a value outside the closed vocabulary.
      source: { s: { format: "ooxml", xml: "<x/>" } },
    };
    expect(DocumentTreeSchema.safeParse(broken).success).toBe(false);
    const shapeless = {
      ...wordprocessingPackage(),
      source: { s: { kind: "source", xml: "<x/>" } },
    };
    expect(DocumentTreeSchema.safeParse(shapeless).success).toBe(false);
  });

  it("is its own root field, not a definitions tenant -- a residue key and a definitions key never collide because they are separate namespaces", () => {
    const parsed = DocumentTreeSchema.parse({
      ...wordprocessingPackage(),
      definitions: {
        frontmatter: {
          kind: "some-tenant",
          note: "an unrelated entry under the same name",
        },
      },
      source: { frontmatter: { format: "markdown", xml: "<x/>" } },
    });
    expect(parsed.definitions?.frontmatter).toEqual({
      kind: "some-tenant",
      note: "an unrelated entry under the same name",
    });
    expect(parsed.source?.frontmatter).toEqual({
      format: "markdown",
      xml: "<x/>",
    });
  });

  it("preserves the table through a JSON round trip", () => {
    const original = {
      ...wordprocessingPackage(),
      source: { "meta/custom.xml": { format: "docx", xml: "<ds:customXML/>" } },
    };
    const roundTripped: unknown = JSON.parse(
      JSON.stringify(DocumentTreeSchema.parse(original)),
    );
    expect(DocumentTreeSchema.parse(roundTripped)).toEqual(original);
  });
});

describe("the construct kinds are additive over 4.0.0", () => {
  it("parses a 4.0.0 tree carrying none of the new kinds or tables, unchanged and field for field", () => {
    for (const original of [
      wordprocessingPackage(),
      spreadsheetPackage(),
      formulaPackage(),
    ]) {
      const parsed = DocumentTreeSchema.parse(original);
      expect(parsed).toEqual(original);
      expect(parsed).not.toHaveProperty("layers");
      expect(parsed).not.toHaveProperty("attachments");
      expect(parsed).not.toHaveProperty("destinations");
    }
  });

  it("parses a package whose tree carries construct groups, at the root children position it belongs under", () => {
    const withConstructs: DocumentTree = {
      kind: "wordprocessing",
      metadata: {},
      definitions: { n1: { kind: "footnote", blocks: [] } },
      children: [
        {
          node: { kind: "section", pageSize: PAGE, margins: MARGINS },
          children: [
            {
              node: { kind: "division", name: "Chapter1" },
              children: [
                {
                  node: {
                    kind: "anchor",
                    anchorType: "footnote",
                    name: "1",
                    definition: "n1",
                  },
                  children: [],
                },
                {
                  node: {
                    kind: "provenance",
                    change: "insertion",
                    author: "A. Reviewer",
                  },
                  children: [
                    {
                      kind: "paragraph",
                      runs: [{ text: "Inserted sentence." }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const roundTripped: unknown = JSON.parse(
      JSON.stringify(DocumentTreeSchema.parse(withConstructs)),
    );
    expect(DocumentTreeSchema.parse(roundTripped)).toEqual(withConstructs);
  });

  it("still rejects a construct group at the root children position -- a package holds containers, not extents", () => {
    const broken = {
      kind: "wordprocessing",
      metadata: {},
      children: [
        { node: { kind: "division", name: "Chapter1" }, children: [] },
      ],
    };
    expect(DocumentTreeSchema.safeParse(broken).success).toBe(false);
  });
});
