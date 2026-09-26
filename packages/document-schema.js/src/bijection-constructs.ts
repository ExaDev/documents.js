// The construct-boundary and run-extent corpus halves, split from bijection.test.ts. Imports the shared leaf helpers from bijection-corpus.ts; both functions are called only inside corpus() and the bijection suite, deferred past module evaluation.
import type { ConstructDescriptor } from "./construct";
import type { ContentBlock } from "./content";
import type { ContentShape } from "./content-drawing";
import {
  type CorpusEntry,
  GALLERY_RESIDUE,
  SLIDE_SIZE,
} from "./bijection-corpus";

// --- The construct-boundary corpus ------------------------------------------------------------------------

// 4.2.0 gave ContentBlock the constructStart/constructEnd marker pair, so a construct boundary is a flat-form signal decompose promotes to a construct group and flatten reproduces, exactly like a heading level or a list level. One entry per placement, so a failure names the case.

const CONSTRUCT_SECTION = {
  pageSize: { widthPt: 595, heightPt: 842 },
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
};
const CONSTRUCT_SHAPE_FRAME = { xPt: 0, yPt: 0, widthPt: 400, heightPt: 300 };
const CONSTRUCT_END: ContentBlock = { kind: "constructEnd" };

function constructStart(descriptor: ConstructDescriptor): ContentBlock {
  return { kind: "constructStart", descriptor };
}

function constructParagraph(
  text: string,
  options: Readonly<{
    headingLevel?: number;
    listLevel?: number;
    indentLeftPt?: number;
  }> = {},
): ContentBlock {
  return {
    kind: "paragraph",
    runs: [{ text }],
    ...(options.headingLevel !== undefined
      ? { headingLevel: options.headingLevel }
      : {}),
    ...(options.listLevel !== undefined
      ? { list: { level: options.listLevel } }
      : {}),
    ...(options.indentLeftPt !== undefined
      ? { indentLeftPt: options.indentLeftPt }
      : {}),
  };
}

function constructSectionEntry(
  name: string,
  blocks: readonly ContentBlock[],
): CorpusEntry {
  return {
    name,
    content: {
      kind: "wordprocessing",
      metadata: {},
      sections: [{ ...CONSTRUCT_SECTION, blocks: [...blocks] }],
    },
  };
}

function constructShape(blocks: readonly ContentBlock[]): ContentShape {
  return {
    frame: CONSTRUCT_SHAPE_FRAME,
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: [...blocks],
  };
}

export function constructCorpus(): readonly CorpusEntry[] {
  // Repeated indentLeftPt inside each construct region so the entries mint for real rather than round-tripping a styles-free tree: the ref lands on the construct group itself (the enclosing section's extent also holds the unindented paragraphs, so no ancestor can factor the key), which is what makes laws (ii) and (iii) bite on a construct wrapper and not just on the leaves under it.
  const shapeWithConstruct = constructShape([
    constructParagraph("before the construct"),
    constructStart({ kind: "field", instruction: "PAGE" }),
    constructParagraph("in a shape construct", { indentLeftPt: 18 }),
    constructParagraph("also in it", { indentLeftPt: 18 }),
    CONSTRUCT_END,
  ]);
  return [
    constructSectionEntry("construct at a section root", [
      constructParagraph("before"),
      constructStart({ kind: "field", instruction: "PAGE", cachedResult: "1" }),
      constructParagraph("in a field", { indentLeftPt: 24 }),
      constructParagraph("still in the field", { indentLeftPt: 24 }),
      CONSTRUCT_END,
      constructParagraph("after"),
    ]),
    constructSectionEntry("construct nested inside a heading group", [
      constructParagraph("Chapter", { headingLevel: 1 }),
      constructParagraph("under the heading"),
      constructStart({
        kind: "contentControl",
        controlType: "richText",
        tag: "body",
        alias: "Body",
      }),
      constructParagraph("in a content control", { indentLeftPt: 24 }),
      constructParagraph("still in it", { indentLeftPt: 24 }),
      CONSTRUCT_END,
      constructParagraph("after the control, still under the heading"),
    ]),
    constructSectionEntry(
      "construct at the tail of a list, followed by a further list item",
      [
        constructParagraph("item one", { listLevel: 0 }),
        constructStart({ kind: "anchor", anchorType: "bookmark", name: "b1" }),
        constructParagraph("in a bookmark", { indentLeftPt: 24 }),
        constructParagraph("still in it", { indentLeftPt: 24 }),
        CONSTRUCT_END,
        // ExaDev/document-schema.js#1022: constructStart closes the list scope the same way a plain paragraph would, so decompose does NOT nest the bookmark group inside "item one", and this item does not nest under it either — both land as section-root siblings, "item two" reopening its own list nesting from scratch. The round trip still reproduces every block in place regardless: list.level rides the paragraph object itself, not the tree's own nesting depth, so flatten's document-order walk restores it identically either way.
        constructParagraph("item two, nested", { listLevel: 1 }),
      ],
    ),
    constructSectionEntry(
      "two constructs of different kinds nested inside each other",
      [
        constructStart({
          kind: "provenance",
          change: "insertion",
          author: "A",
          dateIso: "2024-01-15T00:00:00Z",
        }),
        constructParagraph("inserted"),
        constructStart({
          kind: "link",
          target: { kind: "external", uri: "https://example.invalid/" },
          title: "Example",
        }),
        constructParagraph("linked and inserted", { indentLeftPt: 24 }),
        constructParagraph("also linked", { indentLeftPt: 24 }),
        CONSTRUCT_END,
        constructParagraph("inserted again"),
        CONSTRUCT_END,
      ],
    ),
    constructSectionEntry(
      "construct with no children (an open marker immediately closed)",
      [
        constructParagraph("before"),
        constructStart({ kind: "division", name: "empty", columnCount: 2 }),
        CONSTRUCT_END,
        constructParagraph("after"),
      ],
    ),
    {
      name: "construct inside a presentation shape flow",
      content: {
        kind: "presentation",
        metadata: {},
        slides: [{ size: SLIDE_SIZE, shapes: [shapeWithConstruct], notes: "" }],
      },
    },
    {
      name: "construct inside a drawing page shape flow",
      content: {
        kind: "drawing",
        metadata: {},
        pages: [
          {
            size: { widthPt: 300, heightPt: 300 },
            shapes: [shapeWithConstruct],
            vectors: [],
          },
        ],
      },
    },
    ...runExtentCorpus(),
  ];
}

// --- The run-level extent corpus -----------------------------------------------------------------------------

// The run-level extent mechanism (ContentParagraph.constructs, src/content.ts) is a signal the boundary must carry like any other — and, unlike the block markers, one it carries by EMBEDDING rather than by transforming: a paragraph is atomic to decomposition (a bare leaf, or a heading/list group's anchor, its runs never regrouped), so decompose and flatten pass the field through on the same node object and no walk below needs a change. These entries pin that for every placement a run extent can sit in, plus the properties (crossing ranges, descriptor residue, minting alongside) that must survive all three laws verbatim.
export function runExtentCorpus(): readonly CorpusEntry[] {
  // A bare-leaf paragraph carrying a whole-list extent, a crossing pair, a point extent, and a descriptor with residue — every property of the mechanism in one flow, alongside a block marker pair so both encodings of the construct vocabulary sit in the same document and neither disturbs the other.
  const runExtentParagraph: ContentBlock = {
    kind: "paragraph",
    runs: [
      { text: "before " },
      { text: "marked " },
      { text: "words" },
      { text: " after" },
    ],
    constructs: [
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "outer" },
        startRun: 0,
        endRun: 4,
      },
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "crosser" },
        startRun: 1,
        endRun: 3,
      },
      {
        descriptor: {
          kind: "anchor",
          anchorType: "footnote",
          name: "1",
          definition: "n1",
        },
        startRun: 4,
        endRun: 4,
      },
      {
        descriptor: {
          kind: "contentControl",
          controlType: "richText",
          source: GALLERY_RESIDUE,
        },
        startRun: 1,
        endRun: 2,
      },
    ],
  };
  // A heading anchor and a list anchor each carrying a run extent: the tree embeds the whole paragraph as the group's node, so the field must ride the anchor the same way it rides a leaf.
  const headingWithExtent: ContentBlock = {
    kind: "paragraph",
    runs: [{ text: "Chapter" }, { text: " (draft)" }],
    headingLevel: 1,
    constructs: [
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "_Toc1" },
        startRun: 0,
        endRun: 1,
      },
    ],
  };
  const listWithExtent: ContentBlock = {
    kind: "paragraph",
    runs: [{ text: "item with a mid-paragraph field" }],
    list: { numId: "n1", level: 0 },
    constructs: [
      {
        descriptor: { kind: "field", instruction: "DATE" },
        startRun: 0,
        endRun: 1,
      },
    ],
  };
  // A table-cell paragraph carrying a run extent: the cell's blocks are flat in BOTH encodings, so this paragraph never crosses the boundary machinery at all — the same immunity a cell's own marker pair already has.
  const cellWithRunExtent: ContentBlock = {
    kind: "table",
    rows: [
      {
        cells: [
          {
            blocks: [
              {
                kind: "paragraph",
                runs: [{ text: "cell text" }],
                constructs: [
                  {
                    descriptor: {
                      kind: "anchor",
                      anchorType: "bookmark",
                      name: "cellmark",
                    },
                    startRun: 0,
                    endRun: 1,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    columns: [{ widthPt: 120 }],
  };
  // Two paragraphs sharing an indent tuple AND carrying run extents, so minting actually strips-and-copies them (rebuildParagraph's spread must carry the constructs field through the copy, or law (i) fails here while passing the styles-free entries above).
  const mintingExtentParagraph = (
    text: string,
    name: string,
  ): ContentBlock => ({
    kind: "paragraph",
    runs: [{ text }],
    indentLeftPt: 24,
    constructs: [
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name },
        startRun: 0,
        endRun: 1,
      },
    ],
  });
  return [
    constructSectionEntry(
      "run-level extents on a bare leaf, alongside a block marker pair",
      [
        constructParagraph("plain"),
        runExtentParagraph,
        constructStart({ kind: "field", instruction: "PAGE" }),
        constructParagraph("block-scoped", { indentLeftPt: 24 }),
        CONSTRUCT_END,
      ],
    ),
    constructSectionEntry(
      "run-level extents on a heading anchor and a list anchor",
      [
        headingWithExtent,
        constructParagraph("body under the heading"),
        listWithExtent,
      ],
    ),
    constructSectionEntry(
      "run-level extent inside a table cell (flat in both encodings)",
      [
        constructParagraph("before the table"),
        cellWithRunExtent,
        constructParagraph("after the table"),
      ],
    ),
    constructSectionEntry(
      "run-level extents on paragraphs that mint (stripping copies the field)",
      [
        mintingExtentParagraph("one", "b1"),
        mintingExtentParagraph("two", "b2"),
      ],
    ),
  ];
}
