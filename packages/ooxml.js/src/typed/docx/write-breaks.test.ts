import { describe, expect, it } from "vitest";
import type {
  ConstructDescriptor,
  ContentBlock,
  ContentSection,
} from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { attr, childrenWithTag, elementsWithTag, rootElement } from "../util";
import { buildDocxPackageFromContent } from "./write";
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
function emptyBodySection(): ContentSection {
  return {
    pageSize: { widthPt: 612, heightPt: 792 },
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
    blocks: [],
  };
}

describe("buildDocxPackageFromContent: page-break materialisation and lifted-image placement", () => {
  function bodyOf(written: Package): XmlElement {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined
        ? undefined
        : childrenWithTag(documentRoot, "w:body")[0];
    if (body === undefined) {
      throw new Error("expected body");
    }
    return body;
  }

  function elementChildren(node: XmlElement): XmlElement[] {
    return node.children.filter(
      (child): child is XmlElement => child.type === "element",
    );
  }

  function image(): ContentBlock {
    return {
      kind: "image",
      format: "png",
      base64: TINY_PNG_BASE64,
      widthPt: 10,
      heightPt: 10,
    };
  }

  it("materialises a pending page break before a leading image as one break paragraph carrying the drawing", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [{ kind: "pageBreak" }, image()],
        },
      ],
    });
    const body = bodyOf(written);
    const paragraphs = elementChildren(body).filter(
      (child) => child.tag === "w:p",
    );
    expect(paragraphs).toHaveLength(1);
    const pPr = childrenWithTag(paragraphs[0]!, "w:pPr")[0];
    expect(
      pPr === undefined ? [] : childrenWithTag(pPr, "w:pageBreakBefore"),
    ).toHaveLength(1);
    const runs = childrenWithTag(paragraphs[0]!, "w:r");
    expect(runs).toHaveLength(1);
    expect(
      runs[0] === undefined ? [] : elementsWithTag([runs[0]], "w:drawing"),
    ).toHaveLength(1);
  });

  it("keeps a page break at the very end of the flow as a trailing break paragraph", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "paragraph", runs: [{ text: "last text" }] },
            { kind: "pageBreak" },
          ],
        },
      ],
    });
    const paragraphs = elementChildren(bodyOf(written)).filter(
      (child) => child.tag === "w:p",
    );
    expect(paragraphs).toHaveLength(2);
    const pPr = childrenWithTag(paragraphs[1]!, "w:pPr")[0];
    expect(
      pPr === undefined ? [] : childrenWithTag(pPr, "w:pageBreakBefore"),
    ).toHaveLength(1);
    expect(childrenWithTag(paragraphs[1]!, "w:r")).toEqual([]);
  });

  it("places a leading image in a paragraph of its own", () => {
    const written = buildDocxPackageFromContent({
      sections: [{ ...emptyBodySection(), blocks: [image()] }],
    });
    const paragraphs = elementChildren(bodyOf(written)).filter(
      (child) => child.tag === "w:p",
    );
    expect(paragraphs).toHaveLength(1);
    expect(childrenWithTag(paragraphs[0]!, "w:r")).toHaveLength(1);
    expect(elementsWithTag([paragraphs[0]!], "w:drawing")).toHaveLength(1);
  });

  it("returns lifted images to their paragraph's trailing empty runs in order, rather than fresh ones", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "head" }, { text: "" }, { text: "" }],
            },
            image(),
            image(),
          ],
        },
      ],
    });
    const paragraphs = elementChildren(bodyOf(written)).filter(
      (child) => child.tag === "w:p",
    );
    expect(paragraphs).toHaveLength(1);
    const runs = childrenWithTag(paragraphs[0]!, "w:r");
    // Both drawings ride inside the two trailing empty runs themselves, so no fourth run appears: the fixture's own runs array above has exactly three entries ("head" plus the two trailing empty runs).
    const FIXTURE_RUN_COUNT = 3;
    expect(runs).toHaveLength(FIXTURE_RUN_COUNT);
    expect(elementsWithTag([runs[1]!], "w:drawing")).toHaveLength(1);
    expect(elementsWithTag([runs[2]!], "w:drawing")).toHaveLength(1);
  });

  it("does not reuse a trailing run that carries text for a lifted image", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "paragraph", runs: [{ text: "full text" }] },
            image(),
          ],
        },
      ],
    });
    const paragraphs = elementChildren(bodyOf(written)).filter(
      (child) => child.tag === "w:p",
    );
    const runs = childrenWithTag(paragraphs[0]!, "w:r");
    expect(runs).toHaveLength(2);
    expect(elementsWithTag([runs[0]!], "w:t")).toHaveLength(1);
    expect(elementsWithTag([runs[1]!], "w:drawing")).toHaveLength(1);
  });

  it("does not reuse a trailing empty run that sits inside an external hyperlink", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [
                { text: "lead" },
                { text: "", hyperlink: "https://example.com/target" },
              ],
            },
            image(),
          ],
        },
      ],
    });
    const paragraphs = elementChildren(bodyOf(written)).filter(
      (child) => child.tag === "w:p",
    );
    const hyperlinks = childrenWithTag(paragraphs[0]!, "w:hyperlink");
    expect(hyperlinks).toHaveLength(1);
    // The drawing must not land inside the hyperlink's own wrapped run.
    expect(elementsWithTag([hyperlinks[0]!], "w:drawing")).toHaveLength(0);
    const runs = childrenWithTag(paragraphs[0]!, "w:r");
    expect(elementsWithTag([runs[runs.length - 1]!], "w:drawing")).toHaveLength(
      1,
    );
  });

  it("keeps trailing-run reuse aligned when bookmark markers interleave the runs", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "a" }, { text: "" }],
              constructs: [
                {
                  descriptor: {
                    kind: "anchor",
                    anchorType: "bookmark",
                    name: "Mark",
                  },
                  startRun: 0,
                  endRun: 2,
                },
              ],
            },
            image(),
          ],
        },
      ],
    });
    const paragraphs = elementChildren(bodyOf(written)).filter(
      (child) => child.tag === "w:p",
    );
    const runs = childrenWithTag(paragraphs[0]!, "w:r");
    expect(runs).toHaveLength(2);
    expect(elementsWithTag([runs[1]!], "w:drawing")).toHaveLength(1);
  });
});

describe("buildDocxPackageFromContent: run content, styles part, note parts, and control property XML", () => {
  function bodyParagraph(written: Package): XmlElement {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined
        ? undefined
        : childrenWithTag(documentRoot, "w:body")[0];
    const paragraph =
      body === undefined
        ? undefined
        : body.children.find(
            (child): child is XmlElement =>
              child.type === "element" && child.tag === "w:p",
          );
    if (paragraph === undefined) {
      throw new Error("expected a body paragraph");
    }
    return paragraph;
  }

  function firstRun(paragraph: XmlElement): XmlElement {
    const run = childrenWithTag(paragraph, "w:r")[0];
    if (run === undefined) {
      throw new Error("expected a run");
    }
    return run;
  }

  it("splits a run's text into w:t, w:tab, and w:br children exactly, each w:t preserving space", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [{ kind: "paragraph", runs: [{ text: "a\tb\nc" }] }],
        },
      ],
    });
    const run = firstRun(bodyParagraph(written));
    const summary = run.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => ({
        tag: child.tag,
        space: attr(child, "xml:space"),
        text: child.children
          .map((grandChild) =>
            grandChild.type === "text" ? grandChild.value : "",
          )
          .join(""),
      }));
    expect(summary).toEqual([
      { tag: "w:t", space: "preserve", text: "a" },
      { tag: "w:tab", space: undefined, text: "" },
      { tag: "w:t", space: "preserve", text: "b" },
      { tag: "w:br", space: undefined, text: "" },
      { tag: "w:t", space: "preserve", text: "c" },
    ]);
  });

  it("writes an empty-text run as one empty space-preserving w:t", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [{ kind: "paragraph", runs: [{ text: "" }] }],
        },
      ],
    });
    const run = firstRun(bodyParagraph(written));
    const textElement = childrenWithTag(run, "w:t")[0];
    expect(textElement).toBeDefined();
    expect(
      textElement === undefined ? undefined : attr(textElement, "xml:space"),
    ).toBe("preserve");
    expect(textElement?.children).toEqual([]);
  });

  it("writes one styles.xml w:style entry per referenced id, excluding Normal itself, with the basedOn scaffolding", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "paragraph", styleId: "Normal", runs: [{ text: "plain" }] },
            {
              kind: "paragraph",
              styleId: "Heading1",
              runs: [{ text: "head" }],
            },
          ],
        },
      ],
    });
    const stylesRoot = rootElement(written.parts["word/styles.xml"]);
    if (stylesRoot === undefined) {
      throw new Error("expected styles part");
    }
    expect(stylesRoot.tag).toBe("w:styles");
    expect(attr(stylesRoot, "xmlns:w")).toBe(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    );
    const styles = elementsWithTag([stylesRoot], "w:style");
    // The fixed Normal/DefaultParagraphFont scaffolding plus exactly one referenced entry — referencing Normal itself adds nothing.
    expect(styles.map((style) => attr(style, "w:styleId"))).toEqual([
      "Normal",
      "DefaultParagraphFont",
      "Heading1",
    ]);
    const heading = styles[2]!;
    expect(attr(heading, "w:type")).toBe("paragraph");
    expect(
      elementsWithTag([heading], "w:name").map((n) => attr(n, "w:val")),
    ).toEqual(["Heading1"]);
    expect(
      elementsWithTag([heading], "w:basedOn").map((n) => attr(n, "w:val")),
    ).toEqual(["Normal"]);
  });

  it("writes the comments part's root, one comment per entry, and mints a second id past the highest explicit one", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [{ kind: "paragraph", runs: [{ text: "body" }] }],
        },
      ],
      comments: [
        { id: "5", author: "First", text: "explicit five" },
        { id: "9", author: "Second", text: "explicit nine" },
        { author: "Third", text: "minted" },
        { author: "Fourth", text: "minted again" },
      ],
    });
    const commentsRoot = rootElement(written.parts["word/comments.xml"]);
    if (commentsRoot === undefined) {
      throw new Error("expected comments part");
    }
    expect(commentsRoot.tag).toBe("w:comments");
    expect(attr(commentsRoot, "xmlns:w")).toBe(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    );
    const entries = elementsWithTag([commentsRoot], "w:comment");
    expect(entries.map((entry) => attr(entry, "w:id"))).toEqual([
      "5",
      "9",
      "10",
      "11",
    ]);
    expect(
      entries.map((entry) =>
        elementsWithTag([entry], "w:t").map((t) =>
          t.children.map((c) => (c.type === "text" ? c.value : "")).join(""),
        ),
      ),
    ).toEqual([
      ["explicit five"],
      ["explicit nine"],
      ["minted"],
      ["minted again"],
    ]);
  });

  it("writes the endnotes part under its own root tag, keeping a note's non-normal type attribute", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [{ kind: "paragraph", runs: [{ text: "body" }] }],
        },
      ],
      endnotes: [
        { id: "2", type: "continuationNotice", text: "continues" },
        { text: "minted endnote" },
      ],
    });
    const notesRoot = rootElement(written.parts["word/endnotes.xml"]);
    if (notesRoot === undefined) {
      throw new Error("expected endnotes part");
    }
    expect(notesRoot.tag).toBe("w:endnotes");
    expect(attr(notesRoot, "xmlns:w")).toBe(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    );
    const entries = elementsWithTag([notesRoot], "w:endnote");
    // Word's own separator/continuationSeparator boilerplate carries ids -1 and 0 ahead of the real notes.
    expect(entries.map((entry) => attr(entry, "w:id"))).toEqual([
      "-1",
      "0",
      "2",
      "3",
    ]);
    expect(attr(entries[2]!, "w:type")).toBe("continuationNotice");
    expect(attr(entries[3]!, "w:type")).toBeUndefined();
  });

  it("spells a drop-down control's list w:dropDownList and a check-box's unchecked state w14:val 0", () => {
    const control = (descriptor: ConstructDescriptor): ContentBlock[] => [
      { kind: "constructStart", descriptor },
      { kind: "paragraph", runs: [{ text: "inside" }] },
      { kind: "constructEnd" },
    ];
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            ...control({
              kind: "contentControl",
              controlType: "dropDown",
              options: ["first choice", "second choice"],
            }),
            ...control({
              kind: "contentControl",
              controlType: "checkbox",
              checked: false,
            }),
          ],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const sdtPrs = elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:sdtPr",
    );
    expect(sdtPrs).toHaveLength(2);
    const dropDown = childrenWithTag(sdtPrs[0]!, "w:dropDownList")[0];
    expect(dropDown).toBeDefined();
    expect(
      dropDown === undefined
        ? []
        : elementsWithTag([dropDown], "w:listItem").map((item) => [
            attr(item, "w:displayText"),
            attr(item, "w:value"),
          ]),
    ).toEqual([
      ["first choice", "first choice"],
      ["second choice", "second choice"],
    ]);
    const checked = elementsWithTag([sdtPrs[1]!], "w14:checked")[0];
    expect(checked === undefined ? undefined : attr(checked, "w14:val")).toBe(
      "0",
    );
  });

  it("keeps a plainText control's own w:text element rather than the richText fallback", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { kind: "contentControl", controlType: "plainText" },
            },
            { kind: "paragraph", runs: [{ text: "typed" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const sdtPrs = elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:sdtPr",
    );
    expect(sdtPrs).toHaveLength(1);
    expect(
      sdtPrs[0]!.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toContain("w:text");
  });
});
