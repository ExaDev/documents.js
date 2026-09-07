/// <reference lib="dom" />
// tsconfig.node.json (which typechecks every *.test.ts(x)) deliberately omits the DOM lib -- nothing under it needed real DOM types before this file, the first React-component-level test in this package. This file genuinely does (a real jsdom mount via react-dom/client, per the MathMlView note below), so it opts in per-file via this triple-slash reference rather than widening the shared tsconfig's lib for every node-context file it also covers (vite.config.ts, e2e/**).
import type {
  ContentBlock,
  ContentEmbeddedObjectBlock,
  ContentParagraph,
} from "documents.js";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderBlocksNeutral } from "./contentBlocks";

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

// MathMlView populates its container imperatively in a useEffect (real browser DOM APIs, createElementNS included), so a real mount via react-dom/client is required -- renderToStaticMarkup never runs effects and would see only the empty container div every block renders into.
function renderBlocks(blocks: readonly ContentBlock[]): string {
  act(() => {
    root.render(<>{renderBlocksNeutral(blocks)}</>);
  });
  return container.innerHTML;
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
});
