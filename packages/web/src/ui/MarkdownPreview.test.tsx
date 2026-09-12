import type {
  ContentBlock,
  ContentDocument,
  ContentParagraph,
} from "documents.js";
import { afterEach, describe, expect, it } from "vitest";

import { mountWithMantine } from "../test/mountComponent";
import { MarkdownPreview, type MarkdownPreviewProps } from "./MarkdownPreview";

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

function renderPreview(props: MarkdownPreviewProps): string {
  const mounted = mountWithMantine(<MarkdownPreview {...props} />);
  unmount = mounted.unmount;
  return mounted.container.innerHTML;
}

function paragraph(
  overrides: Partial<ContentParagraph> = {},
): ContentParagraph {
  return { kind: "paragraph", runs: [{ text: "hello" }], ...overrides };
}

function wordprocessingDocument(
  blocks: readonly ContentBlock[],
): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [
      {
        pageSize: { widthPt: 595, heightPt: 842 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [...blocks],
      },
    ],
  };
}

describe("MarkdownPreview", () => {
  it("always renders the label and format badge", () => {
    const html = renderPreview({ label: "Doc A", format: "markdown" });
    expect(html).toContain("Doc A");
    expect(html).toContain("markdown");
  });

  it("shows a loading overlay when loading", () => {
    const html = renderPreview({
      label: "L",
      format: "markdown",
      loading: true,
    });
    expect(html).toContain("mantine-LoadingOverlay-root");
  });

  it("shows the unavailable message when an error is present", () => {
    const html = renderPreview({
      label: "L",
      format: "markdown",
      content: wordprocessingDocument([paragraph()]),
      error: new Error("boom"),
    });
    expect(html).toContain("Preview unavailable for this format.");
  });

  it("shows the not-yet-available message when there is no content at all", () => {
    const html = renderPreview({ label: "L", format: "markdown" });
    expect(html).toContain("No preview yet.");
  });

  it("renders nothing for the content area when the content is not a wordprocessing document", () => {
    const html = renderPreview({
      label: "L",
      format: "markdown",
      content: { kind: "formula", metadata: {}, formula: { mathml: [] } },
    });
    expect(html).not.toContain("No preview yet.");
    expect(html).not.toContain("Preview unavailable");
  });

  it.each([
    ["heading-1", "h1"],
    ["heading-2", "h2"],
    ["heading-3", "h3"],
    ["heading-4", "h4"],
    ["heading-5", "h5"],
    ["heading-6", "h6"],
  ] as const)(
    "renders a %s paragraph as a real <%s> element",
    (styleId, tag) => {
      const html = renderPreview({
        label: "L",
        format: "markdown",
        content: wordprocessingDocument([
          paragraph({ styleId, runs: [{ text: "Heading text" }] }),
        ]),
      });
      expect(html).toContain(`<${tag} `);
      expect(html).toContain("Heading text");
    },
  );

  it("renders a quote paragraph as a blockquote", () => {
    const html = renderPreview({
      label: "L",
      format: "markdown",
      content: wordprocessingDocument([
        paragraph({ styleId: "quote", runs: [{ text: "quoted text" }] }),
      ]),
    });
    expect(html).toContain("<blockquote");
    expect(html).toContain("quoted text");
  });

  it("renders a code-block paragraph as pre>code with the runs' concatenated text", () => {
    const html = renderPreview({
      label: "L",
      format: "markdown",
      content: wordprocessingDocument([
        paragraph({
          styleId: "code-block",
          runs: [{ text: "const " }, { text: "x = 1;" }],
        }),
      ]),
    });
    expect(html).toContain("<pre");
    expect(html).toContain("<code>const x = 1;</code>");
  });

  it("renders a horizontal-rule paragraph as an hr", () => {
    const html = renderPreview({
      label: "L",
      format: "markdown",
      content: wordprocessingDocument([
        paragraph({ styleId: "horizontal-rule", runs: [] }),
      ]),
    });
    expect(html).toContain("<hr");
  });

  it("renders a plain paragraph (no recognised styleId) as a <p>", () => {
    const html = renderPreview({
      label: "L",
      format: "markdown",
      content: wordprocessingDocument([
        paragraph({ styleId: undefined, runs: [{ text: "plain text" }] }),
      ]),
    });
    expect(html).toContain("<p");
    expect(html).toContain("plain text");
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("<blockquote");
  });

  it("renders an image block via the shared image renderer", () => {
    const html = renderPreview({
      label: "L",
      format: "markdown",
      content: wordprocessingDocument([
        {
          kind: "image",
          format: "png",
          base64: "",
          widthPt: 10,
          heightPt: 10,
        },
      ]),
    });
    expect(html).toContain("<img");
  });

  it("renders a table block via the shared table renderer, recursing back through the markdown block pipeline for cell content", () => {
    const html = renderPreview({
      label: "L",
      format: "markdown",
      content: wordprocessingDocument([
        {
          kind: "table",
          columnWidthsPt: [200],
          rows: [
            {
              cells: [
                {
                  blocks: [
                    paragraph({
                      styleId: "quote",
                      runs: [{ text: "cell quote" }],
                    }),
                  ],
                },
              ],
            },
          ],
        },
      ]),
    });
    expect(html).toContain("<table");
    expect(html).toContain("<blockquote");
    expect(html).toContain("cell quote");
  });

  it("renders a run of ordered list-membership paragraphs as one <ol>", () => {
    const html = renderPreview({
      label: "L",
      format: "markdown",
      content: wordprocessingDocument([
        paragraph({
          runs: [{ text: "first" }],
          list: { numId: "ordered:md1", level: 0 },
        }),
        paragraph({
          runs: [{ text: "second" }],
          list: { numId: "ordered:md1", level: 0 },
        }),
      ]),
    });
    expect(html).toContain("<ol");
    expect(html).not.toContain("<ul");
    expect(html).toContain("first");
    expect(html).toContain("second");
  });

  it("renders a run of bullet list-membership paragraphs as one <ul>", () => {
    const html = renderPreview({
      label: "L",
      format: "markdown",
      content: wordprocessingDocument([
        paragraph({
          runs: [{ text: "a" }],
          list: { numId: "bullet:md1", level: 0 },
        }),
      ]),
    });
    expect(html).toContain("<ul");
    expect(html).not.toContain("<ol");
  });

  it("splits adjacent bullet and ordered runs into two separate list elements at the same level", () => {
    const html = renderPreview({
      label: "L",
      format: "markdown",
      content: wordprocessingDocument([
        paragraph({
          runs: [{ text: "bullet item" }],
          list: { numId: "bullet:md1", level: 0 },
        }),
        paragraph({
          runs: [{ text: "ordered item" }],
          list: { numId: "ordered:md2", level: 0 },
        }),
      ]),
    });
    const ulAt = html.indexOf("<ul");
    const olAt = html.indexOf("<ol");
    expect(ulAt).toBeGreaterThan(-1);
    expect(olAt).toBeGreaterThan(-1);
    expect(ulAt).toBeLessThan(olAt);
  });

  it("nests a deeper-level item as a child list inside its parent item", () => {
    const html = renderPreview({
      label: "L",
      format: "markdown",
      content: wordprocessingDocument([
        paragraph({
          runs: [{ text: "parent" }],
          list: { numId: "bullet:md1", level: 0 },
        }),
        paragraph({
          runs: [{ text: "child" }],
          list: { numId: "bullet:md1", level: 1 },
        }),
      ]),
    });
    // The nested list must appear inside the parent <li>, not as a sibling <ul> at the top level.
    const parentLiStart = html.indexOf("<li");
    const nestedUlStart = html.indexOf("<ul", parentLiStart + 1);
    const parentLiEnd = html.indexOf("</li>");
    expect(nestedUlStart).toBeGreaterThan(-1);
    expect(nestedUlStart).toBeLessThan(parentLiEnd);
  });

  it("stops a list group at a non-list paragraph and resumes a fresh group after it", () => {
    const html = renderPreview({
      label: "L",
      format: "markdown",
      content: wordprocessingDocument([
        paragraph({
          runs: [{ text: "item one" }],
          list: { numId: "bullet:md1", level: 0 },
        }),
        paragraph({
          styleId: undefined,
          runs: [{ text: "interrupting text" }],
        }),
        paragraph({
          runs: [{ text: "item two" }],
          list: { numId: "bullet:md1", level: 0 },
        }),
      ]),
    });
    const matches = [...html.matchAll(/<ul/g)];
    expect(matches.length).toBe(2);
  });
});
