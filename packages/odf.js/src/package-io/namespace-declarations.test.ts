import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentDocument,
  ContentShape,
} from "document-schema.js";
import {
  PAGE_SIZE_A4,
  SLIDE_SIZE_WIDESCREEN,
  rgbHexToColor,
} from "document-schema.js";
import type { Package } from "../model/package";
import type { XmlElement, XmlNode } from "../model/node";
import { rootElement } from "../xml/query";
import { writeOdtContent } from "../typed/odt/write";
import { writeOdsContent } from "../typed/ods/write";
import { writeOdpContent } from "../typed/odp/write";
import { writeOdgContent } from "../typed/odg/write";
import {
  writeSxwContent,
  writeSxcContent,
  writeSxiContent,
  writeSxdContent,
} from "../ooo1/write";

// THE STRUCTURAL GUARD AGAINST AN UNDECLARED NAMESPACE PREFIX, for every writer in this package at once.
//
// A qualified name reaches an emitted part verbatim: xml/build.ts writes whatever `tag`/attribute name an element carries, and nothing between a writer and the bytes ever checks that the prefix in that name is actually bound on the part's own root. A writer reaching for a prefix package-io/scaffold.ts's own ODF_DOCUMENT_PREFIXES does not declare therefore produces a part that is not namespace-well-formed XML -- bytes that look right, round-trip perfectly through this package's own (prefix-string-matching, namespace-unaware) reader, and that no real consumer can parse. That is not hypothetical: writeOdp shipped emitting presentation:notes/presentation:class against a root that declared no presentation: prefix at all, and LibreOffice's own import silently re-homed every slide's speaker notes onto its visible shape list rather than its notes page as a result.
//
// So rather than pinning the prefix list itself (which would only restate scaffold.ts's own constant), this suite drives each writer over a document exercising as much of its vocabulary as it has, then walks every XML part of the resulting package -- every element tag and every attribute name, at any depth -- and asserts each prefix used is one the part's own root binds. A future writer emitting a smil:/anim:/chart:/form: name fails here, whatever the prefix, without anyone having to remember this failure mode.
//
// The two ooo1 (OpenOffice.org 1.x) writers are included for the same reason and get the check for free: transformToOoo1Package rewrites a package's root namespace DECLARATIONS wholesale, so a prefix it renames on the root but not in the tree (or the reverse) is exactly this same defect wearing a different hat.

// xml: is bound implicitly by the XML specification itself and never declared; xmlns: is the declaration mechanism, not a prefix that needs binding.
const IMPLICITLY_BOUND_PREFIXES: ReadonlySet<string> = new Set([
  "xml",
  "xmlns",
]);

function prefixOf(qualifiedName: string): string | undefined {
  const colon = qualifiedName.indexOf(":");
  return colon === -1 ? undefined : qualifiedName.slice(0, colon);
}

function declaredPrefixes(root: XmlElement): ReadonlySet<string> {
  const declared = new Set<string>(IMPLICITLY_BOUND_PREFIXES);
  for (const attribute of root.attributes) {
    if (attribute.name.startsWith("xmlns:")) {
      declared.add(attribute.name.slice("xmlns:".length));
    }
  }
  return declared;
}

interface PrefixUse {
  readonly prefix: string;
  readonly where: string;
}

function collectPrefixUses(
  nodes: readonly XmlNode[],
  path: string,
  out: PrefixUse[],
): void {
  for (const node of nodes) {
    if (node.type !== "element") {
      continue;
    }
    const here = `${path}/${node.tag}`;
    const tagPrefix = prefixOf(node.tag);
    if (tagPrefix !== undefined) {
      out.push({ prefix: tagPrefix, where: here });
    }
    for (const attribute of node.attributes) {
      const attributePrefix = prefixOf(attribute.name);
      if (attributePrefix !== undefined) {
        out.push({
          prefix: attributePrefix,
          where: `${here}@${attribute.name}`,
        });
      }
    }
    collectPrefixUses(node.children, here, out);
  }
}

// Every (prefix, location) pair the package uses without its own part's root binding it. Returned rather than asserted inside so a failure names the exact element/attribute path, not just a count.
function undeclaredPrefixUses(pkg: Package): string[] {
  const failures: string[] = [];
  for (const [partPath, part] of Object.entries(pkg.parts)) {
    if (part.kind !== "xml") {
      continue;
    }
    const root = rootElement(part.nodes);
    if (root === undefined) {
      throw new Error(`${partPath}: an XML part with no root element`);
    }
    const declared = declaredPrefixes(root);
    const uses: PrefixUse[] = [];
    collectPrefixUses(part.nodes, partPath, uses);
    for (const use of uses) {
      if (!declared.has(use.prefix)) {
        failures.push(`${use.where} uses undeclared prefix "${use.prefix}:"`);
      }
    }
  }
  return failures;
}

const MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

// A 1x1 PNG, genuinely decodable (sniffImageFormat reads real magic bytes, not a name) -- the same fixture the writers' own suites use.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const IMAGE_BLOCK = {
  kind: "image",
  format: "png",
  base64: PNG_BASE64,
  widthPt: 96,
  heightPt: 96,
  altText: "A tiny square",
} as const satisfies ContentBlock;

const TABLE_BLOCK = {
  kind: "table",
  columnWidthsPt: [80, 120],
  rows: [
    {
      heightPt: 18,
      cells: [
        {
          blocks: [{ kind: "paragraph", runs: [{ text: "Merged" }] }],
          colSpan: 2,
          background: { kind: "solid", color: rgbHexToColor("#DDEEFF") },
          borders: {
            top: {
              style: "solid",
              widthPt: 1,
              color: rgbHexToColor("#112233"),
            },
          },
        },
      ],
    },
    {
      cells: [
        { blocks: [{ kind: "paragraph", runs: [{ text: "Left" }] }] },
        { blocks: [{ kind: "paragraph", runs: [{ text: "Right" }] }] },
      ],
    },
  ],
} as const satisfies ContentBlock;

const TEXT_BLOCKS: ContentBlock[] = [
  { kind: "paragraph", runs: [{ text: "Plain" }] },
  {
    kind: "paragraph",
    headingLevel: 1,
    runs: [{ text: "Heading", bold: true }],
  },
  {
    kind: "paragraph",
    runs: [
      { text: "Linked", hyperlink: "https://example.invalid/", italic: true },
      { text: "\ttabbed   and spaced" },
    ],
    list: { numId: "L1", level: 0 },
  },
  { kind: "pageBreak" },
  TABLE_BLOCK,
  // An odt image anchors into the paragraph before it (writeSectionBlocks refuses one that has none), so this paragraph is load-bearing rather than filler.
  { kind: "paragraph", runs: [{ text: "Figure:" }] },
  IMAGE_BLOCK,
];

const WORDPROCESSING: ContentDocument = {
  kind: "wordprocessing",
  metadata: {
    title: "Namespace audit",
    author: "A. Author",
    keywords: ["one", "two"],
  },
  sections: [{ pageSize: PAGE_SIZE_A4, margins: MARGINS, blocks: TEXT_BLOCKS }],
};

const SPREADSHEET: ContentDocument = {
  kind: "spreadsheet",
  metadata: { title: "Namespace audit" },
  sheets: [
    {
      name: "Sheet1",
      cells: [
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "Header" },
          displayText: "Header",
          background: { kind: "solid", color: rgbHexToColor("#FFEECC") },
          alignment: "center",
          verticalAlignment: "middle",
          borders: {
            bottom: {
              style: "double",
              widthPt: 2,
              color: rgbHexToColor("#334455"),
            },
          },
          colSpan: 2,
        },
        {
          row: 1,
          column: 0,
          value: { kind: "number", value: 42 },
          displayText: "42",
        },
        {
          row: 1,
          column: 1,
          value: { kind: "number", value: 43 },
          displayText: "43",
          formula: "of:=SUM([.A2]+1)",
        },
        {
          row: 2,
          column: 0,
          value: { kind: "date", value: "2026-01-31" },
          displayText: "31/01/2026",
        },
        {
          row: 2,
          column: 1,
          value: { kind: "boolean", value: true },
          displayText: "TRUE",
        },
      ],
      columns: [
        { index: 0, widthPt: 90 },
        { index: 1, hidden: true },
      ],
      rows: [{ index: 0, heightPt: 24 }],
      images: [
        {
          ...IMAGE_BLOCK,
          anchorRow: 3,
          anchorColumn: 0,
          offsetXPt: 2,
          offsetYPt: 3,
        },
      ],
      printSettings: {
        pageSize: PAGE_SIZE_A4,
        margins: MARGINS,
        gridlines: true,
        headers: true,
        pageOrder: "downThenOver",
        printRange: { startRow: 0, startColumn: 0, endRow: 9, endColumn: 3 },
        repeatRows: { start: 0, end: 0 },
        scalePercent: 90,
        manualBreaks: { rows: [2], columns: [1] },
      },
    },
  ],
};

function shape(
  overrides: Partial<ContentShape>,
  blocks: ContentShape["blocks"],
): ContentShape {
  return {
    frame: { xPt: 10, yPt: 20, widthPt: 300, heightPt: 100 },
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks,
    ...overrides,
  };
}

const PRESENTATION: ContentDocument = {
  kind: "presentation",
  metadata: { title: "Namespace audit" },
  slides: [
    {
      size: SLIDE_SIZE_WIDESCREEN,
      shapes: [
        shape({ name: "Title" }, [
          { kind: "paragraph", runs: [{ text: "Title", bold: true }] },
        ]),
        shape({ rotationDeg: 30, insetLeftPt: 4, insetTopPt: 4 }, [
          { kind: "paragraph", runs: [{ text: "Rotated" }] },
          {
            kind: "paragraph",
            runs: [{ text: "Bulleted" }],
            list: { numId: "L1", level: 0 },
          },
        ]),
        shape({}, [TABLE_BLOCK]),
        shape({}, [IMAGE_BLOCK]),
      ],
      notes: "First note line\nSecond note line",
    },
    { size: PAGE_SIZE_A4, shapes: [], notes: "" },
  ],
};

// The drawing exercises what only a .odg page carries: every vector-primitive kind, each with the fill/stroke/fill-rule vocabulary typed/draw/write-vectors.ts mints a graphic style for, alongside a shape so both halves of a draw:page are covered in one pass.
const DRAWING: ContentDocument = {
  kind: "drawing",
  metadata: { title: "Namespace audit" },
  pages: [
    {
      size: PAGE_SIZE_A4,
      shapes: [shape({ name: "Caption" }, [IMAGE_BLOCK])],
      vectors: [
        {
          kind: "rect",
          frame: { xPt: 20, yPt: 20, widthPt: 80, heightPt: 40 },
          fill: rgbHexToColor("#DDEEFF"),
          stroke: {
            color: rgbHexToColor("#112233"),
            widthPt: 1,
            style: "dashed",
          },
          paintOrder: 4,
        },
        {
          kind: "ellipse",
          frame: { xPt: 120, yPt: 20, widthPt: 80, heightPt: 40 },
          rotationDeg: 15,
          fill: rgbHexToColor("#FFEECC"),
        },
        {
          kind: "line",
          from: { xPt: 20, yPt: 100 },
          to: { xPt: 200, yPt: 140 },
          stroke: { color: rgbHexToColor("#334455"), widthPt: 2 },
        },
        {
          kind: "path",
          frame: { xPt: 20, yPt: 180, widthPt: 160, heightPt: 90 },
          subpaths: [
            {
              start: { xPt: 0, yPt: 0 },
              segments: [
                { kind: "line", to: { xPt: 160, yPt: 0 } },
                {
                  kind: "cubic",
                  control1: { xPt: 160, yPt: 45 },
                  control2: { xPt: 80, yPt: 90 },
                  to: { xPt: 0, yPt: 90 },
                },
              ],
              closed: true,
            },
          ],
          fillRule: "evenodd",
          fill: rgbHexToColor("#00AA44"),
        },
      ],
    },
  ],
};

describe("every emitted prefix is declared on its own part's root", () => {
  it.each([
    ["writeOdtContent", () => writeOdtContent(WORDPROCESSING)],
    ["writeOdsContent", () => writeOdsContent(SPREADSHEET)],
    ["writeOdpContent", () => writeOdpContent(PRESENTATION)],
    ["writeOdgContent", () => writeOdgContent(DRAWING)],
    ["writeSxwContent", () => writeSxwContent(WORDPROCESSING)],
    ["writeSxcContent", () => writeSxcContent(SPREADSHEET)],
    ["writeSxiContent", () => writeSxiContent(PRESENTATION)],
    ["writeSxdContent", () => writeSxdContent(DRAWING)],
  ])("%s", (_name, write) => {
    expect(undeclaredPrefixUses(write())).toEqual([]);
  });

  // The audit itself has to be able to fail, or an "everything passed" run above says nothing: an undeclared prefix planted in a real writer's own output is reported, with the element path that used it.
  it("reports an undeclared prefix rather than passing it over", () => {
    const pkg = writeOdpContent(PRESENTATION);
    const content = pkg.parts["content.xml"];
    if (content?.kind !== "xml") {
      throw new Error("expected an XML content.xml");
    }
    const root = rootElement(content.nodes);
    if (root === undefined) {
      throw new Error("expected a content.xml root element");
    }
    root.children.push({
      type: "element",
      tag: "anim:par",
      attributes: [{ name: "smil:begin", value: "0s" }],
      children: [],
    });
    expect(undeclaredPrefixUses(pkg)).toEqual([
      'content.xml/office:document-content/anim:par uses undeclared prefix "anim:"',
      'content.xml/office:document-content/anim:par@smil:begin uses undeclared prefix "smil:"',
    ]);
  });
});
