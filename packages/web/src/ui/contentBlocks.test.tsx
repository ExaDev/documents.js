/// <reference lib="dom" />
// tsconfig.node.json (which typechecks every *.test.ts(x)) deliberately omits the DOM lib — nothing under it needed real DOM types before this file, the first React-component-level test in this package. This file genuinely does (a real jsdom mount via react-dom/client, per the MathMlView note below), so it opts in per-file via this triple-slash reference rather than widening the shared tsconfig's lib for every node-context file it also covers (vite.config.ts, e2e/**).
import type {
  ContentBlock,
  ContentEmbeddedObjectBlock,
  ContentImageBlock,
  ContentParagraph,
  ContentRun,
  ContentTable,
} from "documents.js";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildListForest,
  collectBlockGroups,
  renderBlocksNeutral,
  renderImage,
  renderRuns,
  renderTable,
} from "./contentBlocks";

const FRAME = { xPt: 0, yPt: 0, widthPt: 100, heightPt: 20 };

function paragraph(
  overrides: Partial<ContentParagraph> = {},
): ContentParagraph {
  return { kind: "paragraph", runs: [{ text: "hello" }], ...overrides };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

// MathMlView populates its container imperatively in a useEffect (real browser DOM APIs, createElementNS included), so a real mount via react-dom/client is required — renderToStaticMarkup never runs effects and would see only the empty container div every block renders into.
function renderBlocks(blocks: readonly ContentBlock[]): string {
  act(() => {
    root.render(<>{renderBlocksNeutral(blocks)}</>);
  });
  return container.innerHTML;
}

function renderNode(node: ReactNode): HTMLDivElement {
  act(() => {
    root.render(<>{node}</>);
  });
  return container;
}

function run(overrides: Partial<ContentRun> = {}): ContentRun {
  return { text: "hi", ...overrides };
}

describe("renderBlocksNeutral", () => {
  it("renders a horizontal-rule styleId as <hr>", () => {
    const html = renderBlocks([paragraph({ styleId: "horizontal-rule" })]);
    expect(html).toContain("<hr");
  });

  it("renders a standalone pageBreak block as a break marker, not a horizontal rule", () => {
    const html = renderBlocks([{ kind: "pageBreak" }]);
    expect(html).toContain("Page break");
    expect(html).not.toContain("<hr");
  });

  it("renders a paragraph's pageBreakBefore flag as a break marker preceding its own content", () => {
    const html = renderBlocks([
      paragraph({
        runs: [{ text: "after the break" }],
        pageBreakBefore: true,
      }),
    ]);
    const breakIndex = html.indexOf("Page break");
    const textIndex = html.indexOf("after the break");
    expect(breakIndex).toBeGreaterThanOrEqual(0);
    expect(breakIndex).toBeLessThan(textIndex);
    expect(html.match(/Page break/g)).toHaveLength(1);
  });

  it("renders a paragraph's pageBreakAfter flag as a break marker following its own content", () => {
    const html = renderBlocks([
      paragraph({
        runs: [{ text: "before the break" }],
        pageBreakAfter: true,
      }),
    ]);
    const breakIndex = html.indexOf("Page break");
    const textIndex = html.indexOf("before the break");
    expect(textIndex).toBeGreaterThanOrEqual(0);
    expect(breakIndex).toBeGreaterThan(textIndex);
    expect(html.match(/Page break/g)).toHaveLength(1);
  });

  it("renders both pageBreakBefore and pageBreakAfter on the same paragraph", () => {
    const html = renderBlocks([
      paragraph({ pageBreakBefore: true, pageBreakAfter: true }),
    ]);
    expect(html.match(/Page break/g)).toHaveLength(2);
  });

  it("renders a paragraph with no page-break flags with no break marker", () => {
    const html = renderBlocks([paragraph()]);
    expect(html).not.toContain("Page break");
  });

  it("renders an embedded formula object as native MathML", () => {
    const block: ContentEmbeddedObjectBlock = {
      kind: "embeddedObject",
      objectKind: "formula",
      frame: FRAME,
      document: {
        kind: "formula",
        metadata: {},
        formula: {
          mathml: [
            {
              type: "element",
              tag: "mn",
              attributes: [],
              children: [{ type: "text", value: "2" }],
            },
          ],
        },
      },
    };
    const html = renderBlocks([block]);
    expect(html).toContain("<math");
    expect(html).toContain("<mn>2</mn>");
  });

  it("strips a math: namespace prefix from an embedded formula's element tags", () => {
    const block: ContentEmbeddedObjectBlock = {
      kind: "embeddedObject",
      objectKind: "formula",
      frame: FRAME,
      document: {
        kind: "formula",
        metadata: {},
        formula: {
          mathml: [
            {
              type: "element",
              tag: "math:mrow",
              attributes: [],
              children: [
                {
                  type: "element",
                  tag: "math:mn",
                  attributes: [],
                  children: [{ type: "text", value: "1" }],
                },
              ],
            },
          ],
        },
      },
    };
    const html = renderBlocks([block]);
    expect(html).toContain("<mrow");
    expect(html).not.toContain("math:mrow");
  });

  it.each([
    ["wordprocessing", "Embedded document"],
    ["presentation", "Embedded presentation"],
    ["spreadsheet", "Embedded spreadsheet"],
    ["drawing", "Embedded drawing"],
    ["chart", "Embedded chart"],
  ] as const)(
    "renders a %s embedded object as a labelled placeholder, not nested content",
    (objectKind, label) => {
      const block: ContentEmbeddedObjectBlock = {
        kind: "embeddedObject",
        objectKind,
        frame: FRAME,
        document: {
          kind: "wordprocessing",
          metadata: {},
          sections: [
            {
              pageSize: { widthPt: 595, heightPt: 842 },
              margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
              blocks: [
                { kind: "paragraph", runs: [{ text: "nested content" }] },
              ],
            },
          ],
        },
      };
      const html = renderBlocks([block]);
      expect(html).toContain(label);
      expect(html).not.toContain("nested content");
    },
  );

  it("falls back to a placeholder when objectKind is 'formula' but the document is not actually a formula document", () => {
    const block: ContentEmbeddedObjectBlock = {
      kind: "embeddedObject",
      objectKind: "formula",
      frame: FRAME,
      document: { kind: "wordprocessing", metadata: {}, sections: [] },
    };
    const html = renderBlocks([block]);
    expect(html).toContain("Embedded formula");
    expect(html).not.toContain("<math");
  });

  it("renders the objectKind's own placeholder, not MathML, when the document happens to be a formula document but objectKind says otherwise", () => {
    const block: ContentEmbeddedObjectBlock = {
      kind: "embeddedObject",
      objectKind: "wordprocessing",
      frame: FRAME,
      document: {
        kind: "formula",
        metadata: {},
        formula: { mathml: [] },
      },
    };
    const html = renderBlocks([block]);
    expect(html).toContain("Embedded document");
    expect(html).not.toContain("<math");
  });

  it("renders a heading styleId as its own heading tag, for every level 1-6", () => {
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      const html = renderBlocks([
        paragraph({ styleId: `heading-${level}`, runs: [{ text: "title" }] }),
      ]);
      expect(html).toContain(`<h${level}`);
      expect(html).not.toContain("<p ");
    }
  });

  it("renders a quote styleId as a blockquote", () => {
    const html = renderBlocks([paragraph({ styleId: "quote" })]);
    expect(html).toContain("<blockquote");
  });

  it("renders a code-block styleId as pre/code, joining run text verbatim without run formatting", () => {
    const html = renderBlocks([
      paragraph({
        styleId: "code-block",
        runs: [{ text: "const x", bold: true }, { text: " = 1;" }],
      }),
    ]);
    expect(html).toContain("<pre");
    expect(html).toContain("<code>const x = 1;</code>");
    expect(html).not.toContain("<strong>");
  });

  it("renders a paragraph with no recognised styleId as a plain paragraph", () => {
    const html = renderBlocks([paragraph({ styleId: "SomeCustomStyle" })]);
    expect(html).toContain("<p ");
  });

  it("renders a paragraph with no styleId at all as a plain paragraph", () => {
    const html = renderBlocks([paragraph()]);
    expect(html).toContain("<p ");
  });

  it("renders a table block with its rows, cells, and column span/row span", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [50, 50],
      rows: [
        {
          cells: [
            { blocks: [paragraph({ runs: [{ text: "a" }] })], colSpan: 2 },
          ],
        },
        {
          cells: [
            { blocks: [paragraph({ runs: [{ text: "b" }] })] },
            { blocks: [paragraph({ runs: [{ text: "c" }] })], rowSpan: 2 },
          ],
        },
      ],
    };
    const html = renderBlocks([table]);
    expect(html).toContain("<table");
    expect(html.match(/<tr/g)).toHaveLength(2);
    expect(html.match(/<td/g)).toHaveLength(3);
    expect(html).toContain('colspan="2"');
    expect(html).toContain('rowspan="2"');
    expect(html).toContain(">a<");
    expect(html).toContain(">b<");
    expect(html).toContain(">c<");
  });

  it("renders an image block as an img with its data URL and alt text", () => {
    const block: ContentImageBlock = {
      kind: "image",
      format: "png",
      base64: "AAAA",
      widthPt: 10,
      heightPt: 10,
      altText: "a diagram",
    };
    const html = renderBlocks([block]);
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('alt="a diagram"');
  });

  it("renders an image block with no altText as an img with an empty alt", () => {
    const block: ContentImageBlock = {
      kind: "image",
      format: "jpeg",
      base64: "BBBB",
      widthPt: 10,
      heightPt: 10,
    };
    const html = renderBlocks([block]);
    expect(html).toContain('src="data:image/jpeg;base64,BBBB"');
    expect(html).toContain('alt=""');
  });

  it("renders nothing for a construct boundary marker, neither crashing nor emitting content", () => {
    const html = renderBlocks([
      { kind: "constructStart", descriptor: { kind: "division" } },
    ]);
    expect(html).toBe("<div></div>");
  });

  it("groups consecutive ordered list items into one <ol>, keeping bullet items ungrouped and unclassed", () => {
    const html = renderBlocks([
      paragraph({
        runs: [{ text: "one" }],
        list: { numId: "ordered:1", level: 0 },
      }),
      paragraph({
        runs: [{ text: "two" }],
        list: { numId: "ordered:1", level: 0 },
      }),
    ]);
    expect(html.match(/<ol/g)).toHaveLength(1);
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toContain(">one<");
    expect(html).toContain(">two<");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("neutralListItem");
  });

  it("groups consecutive bullet items into one <ul> with a neutral marker class", () => {
    const html = renderBlocks([
      paragraph({
        runs: [{ text: "one" }],
        list: { numId: "bullet:1", level: 0 },
      }),
    ]);
    expect(html).toContain("<ul");
    expect(html).not.toContain("<ol");
  });

  it("starts a new list group when the ordered/bullet kind changes between consecutive items", () => {
    const html = renderBlocks([
      paragraph({
        runs: [{ text: "one" }],
        list: { numId: "ordered:1", level: 0 },
      }),
      paragraph({
        runs: [{ text: "two" }],
        list: { numId: "bullet:1", level: 0 },
      }),
    ]);
    const olIndex = html.indexOf("<ol");
    const ulIndex = html.indexOf("<ul");
    expect(olIndex).toBeGreaterThanOrEqual(0);
    expect(ulIndex).toBeGreaterThan(olIndex);
  });

  it("nests a deeper-level list item inside its parent item's own <li>", () => {
    const html = renderBlocks([
      paragraph({
        runs: [{ text: "parent" }],
        list: { numId: "bullet:1", level: 0 },
      }),
      paragraph({
        runs: [{ text: "child" }],
        list: { numId: "bullet:1", level: 1 },
      }),
    ]);
    const parentIndex = html.indexOf("parent");
    const nestedUlIndex = html.indexOf("<ul", parentIndex);
    const childIndex = html.indexOf("child");
    expect(nestedUlIndex).toBeGreaterThan(parentIndex);
    expect(childIndex).toBeGreaterThan(nestedUlIndex);
  });

  it("separates a run of list items from surrounding non-list blocks into their own group", () => {
    const html = renderBlocks([
      paragraph({ runs: [{ text: "before" }] }),
      paragraph({
        runs: [{ text: "item" }],
        list: { numId: "bullet:1", level: 0 },
      }),
      paragraph({ runs: [{ text: "after" }] }),
    ]);
    const listIndex = html.indexOf("<ul");
    const beforeIndex = html.indexOf("before");
    const afterIndex = html.indexOf("after");
    expect(beforeIndex).toBeLessThan(listIndex);
    expect(afterIndex).toBeGreaterThan(listIndex);
  });
});

describe("renderRuns", () => {
  function html(
    runs: readonly ContentRun[],
    options?: { treatFontFamilyAsInlineCode?: boolean },
  ): string {
    return renderNode(<>{renderRuns(runs, options)}</>).innerHTML;
  }

  it("renders a plain run as its own text with no formatting wrapper", () => {
    expect(html([run({ text: "plain" })])).toBe("<span>plain</span>");
  });

  it("wraps a bold run in strong", () => {
    expect(html([run({ bold: true })])).toContain("<strong>hi</strong>");
  });

  it("wraps an italic run in em", () => {
    expect(html([run({ italic: true })])).toContain("<em>hi</em>");
  });

  it("wraps an underlined run in u", () => {
    expect(html([run({ underline: true })])).toContain("<u>hi</u>");
  });

  it("wraps a struck-through run in s", () => {
    expect(html([run({ strike: true })])).toContain("<s>hi</s>");
  });

  it("nests every formatting wrapper in a fixed order: strong, then em, then u, then s", () => {
    const rendered = html([
      run({ bold: true, italic: true, underline: true, strike: true }),
    ]);
    expect(rendered).toContain("<s><u><em><strong>hi</strong></em></u></s>");
  });

  it("wraps a hyperlink run in an anchor with target and rel set, outermost", () => {
    const rendered = html([
      run({ hyperlink: "https://example.com", bold: true }),
    ]);
    expect(rendered).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer"><strong>hi</strong></a>',
    );
  });

  it("treats a run with a fontFamily as inline code when the option is set", () => {
    const rendered = html([run({ fontFamily: "Courier" })], {
      treatFontFamilyAsInlineCode: true,
    });
    expect(rendered).toContain("<code");
  });

  it("does not treat a run with a fontFamily as inline code when the option is unset", () => {
    const rendered = html([run({ fontFamily: "Courier" })]);
    expect(rendered).not.toContain("<code");
  });

  it("does not add an inline-code wrapper for a run with no fontFamily even when the option is set", () => {
    const rendered = html([run()], { treatFontFamilyAsInlineCode: true });
    expect(rendered).not.toContain("<code");
  });
});

describe("renderImage", () => {
  it("builds the data URL from the block's own format and base64", () => {
    const html = renderNode(
      renderImage({
        kind: "image",
        format: "gif",
        base64: "ZZZZ",
        widthPt: 1,
        heightPt: 1,
      }),
    ).innerHTML;
    expect(html).toContain('src="data:image/gif;base64,ZZZZ"');
  });
});

describe("renderTable", () => {
  it("passes each cell's own blocks to the given renderBlocks callback", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [10],
      rows: [{ cells: [{ blocks: [paragraph()] }] }],
    };
    const seen: (readonly ContentBlock[])[] = [];
    renderNode(
      renderTable(table, (blocks) => {
        seen.push(blocks);
        return null;
      }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(table.rows[0]!.cells[0]!.blocks);
  });

  function textCell(
    text: string,
    spans: { colSpan?: number; rowSpan?: number } = {},
  ) {
    return { blocks: [paragraph({ runs: [{ text }] })], ...spans };
  }

  function cellsOfRows(table: ContentTable): HTMLTableCellElement[][] {
    const rendered = renderNode(renderTable(table, renderBlocksNeutral));
    return Array.from(rendered.querySelectorAll("tr")).map((tr) =>
      Array.from(tr.querySelectorAll("td")),
    );
  }

  it("renders a horizontally merged region as one td, omitting its covered positions", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [10, 10, 10],
      rows: [
        {
          cells: [textCell("a", { colSpan: 2 }), { blocks: [] }, textCell("b")],
        },
        { cells: [textCell("c"), textCell("d"), textCell("e")] },
      ],
    };
    const rows = cellsOfRows(table);
    expect(rows.map((row) => row.length)).toEqual([2, 3]);
    expect(rows[0]!.map((td) => td.textContent)).toEqual(["a", "b"]);
    expect(rows[0]![0]!.colSpan).toBe(2);
  });

  it("renders a vertically merged region as one td, omitting its covered positions in the rows below", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [10, 10],
      rows: [
        { cells: [textCell("a", { rowSpan: 3 }), textCell("b")] },
        { cells: [{ blocks: [] }, textCell("c")] },
        { cells: [{ blocks: [] }, textCell("d")] },
      ],
    };
    const rows = cellsOfRows(table);
    expect(rows.map((row) => row.length)).toEqual([2, 1, 1]);
    expect(rows[0]![0]!.rowSpan).toBe(3);
    expect(rows[2]![0]!.textContent).toBe("d");
  });

  it("renders a two by two merged region as a single td", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [10, 10, 10],
      rows: [
        {
          cells: [
            textCell("a", { colSpan: 2, rowSpan: 2 }),
            { blocks: [] },
            textCell("b"),
          ],
        },
        { cells: [{ blocks: [] }, { blocks: [] }, textCell("c")] },
        { cells: [textCell("d"), textCell("e"), textCell("f")] },
      ],
    };
    const rows = cellsOfRows(table);
    expect(rows.map((row) => row.length)).toEqual([2, 1, 3]);
    expect(rows[0]![0]!.colSpan).toBe(2);
    expect(rows[0]![0]!.rowSpan).toBe(2);
    expect(rows[1]![0]!.textContent).toBe("c");
  });

  it("renders every entry of an unmerged table as a td", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [10, 10],
      rows: [{ cells: [textCell("a"), textCell("b")] }],
    };
    expect(cellsOfRows(table).map((row) => row.length)).toEqual([2]);
  });
});

describe("buildListForest", () => {
  it("builds a flat forest from items that all share level 0", () => {
    const forest = buildListForest([
      paragraph({ list: { numId: "bullet:1", level: 0 } }),
      paragraph({ list: { numId: "bullet:1", level: 0 } }),
    ]);
    expect(forest).toHaveLength(2);
    expect(forest[0]?.children).toHaveLength(0);
  });

  it("nests an item under the most recent shallower item, and pops back on a same-or-shallower sibling", () => {
    const forest = buildListForest([
      paragraph({
        runs: [{ text: "a" }],
        list: { numId: "bullet:1", level: 0 },
      }),
      paragraph({
        runs: [{ text: "a.1" }],
        list: { numId: "bullet:1", level: 1 },
      }),
      paragraph({
        runs: [{ text: "b" }],
        list: { numId: "bullet:1", level: 0 },
      }),
    ]);
    expect(forest).toHaveLength(2);
    expect(forest[0]?.children).toHaveLength(1);
    expect(forest[0]?.children[0]?.runs[0]?.text).toBe("a.1");
    expect(forest[1]?.children).toHaveLength(0);
  });

  it("treats an item with no list membership at all as level 0", () => {
    const forest = buildListForest([paragraph()]);
    expect(forest).toHaveLength(1);
  });

  it("marks an item ordered only when its numId starts with the 'ordered:' prefix", () => {
    const forest = buildListForest([
      paragraph({ list: { numId: "ordered:1", level: 0 } }),
    ]);
    expect(forest[0]?.ordered).toBe(true);
  });

  it("marks an item unordered when its numId starts with 'bullet:'", () => {
    const forest = buildListForest([
      paragraph({ list: { numId: "bullet:1", level: 0 } }),
    ]);
    expect(forest[0]?.ordered).toBe(false);
  });

  it("marks an item unordered when it carries no numId at all", () => {
    const forest = buildListForest([paragraph({ list: { level: 0 } })]);
    expect(forest[0]?.ordered).toBe(false);
  });
});

describe("collectBlockGroups", () => {
  it("collects consecutive list-membership paragraphs into one listGroup", () => {
    const a = paragraph({ list: { numId: "bullet:1", level: 0 } });
    const b = paragraph({ list: { numId: "bullet:1", level: 0 } });
    const groups = collectBlockGroups([a, b]);
    expect(groups).toEqual([{ kind: "listGroup", items: [a, b] }]);
  });

  it("keeps a non-list block as its own group, not merged into a listGroup", () => {
    const plain = paragraph();
    const groups = collectBlockGroups([plain]);
    expect(groups).toEqual([plain]);
  });

  it("flushes a pending list group before a following non-list block", () => {
    const item = paragraph({ list: { numId: "bullet:1", level: 0 } });
    const plain = paragraph({ runs: [{ text: "after" }] });
    const groups = collectBlockGroups([item, plain]);
    expect(groups).toEqual([{ kind: "listGroup", items: [item] }, plain]);
  });

  it("flushes a trailing pending list group at the end of the input with no following block", () => {
    const item = paragraph({ list: { numId: "bullet:1", level: 0 } });
    const groups = collectBlockGroups([item]);
    expect(groups).toEqual([{ kind: "listGroup", items: [item] }]);
  });

  it("returns an empty array for no blocks at all", () => {
    expect(collectBlockGroups([])).toEqual([]);
  });
});
