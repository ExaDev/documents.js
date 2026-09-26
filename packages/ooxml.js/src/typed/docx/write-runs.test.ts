import { describe, expect, it } from "vitest";
import type { ContentSection } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { attr, childrenWithTag, elementsWithTag, rootElement } from "../util";
import { buildDocxPackageFromContent } from "./write";
function emptyBodySection(): ContentSection {
  return {
    pageSize: { widthPt: 612, heightPt: 792 },
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
    blocks: [],
  };
}

describe("buildDocxPackageFromContent: run and paragraph property XML exactness", () => {
  function singleParagraph(written: Package): XmlElement {
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

  function runProperties(
    written: Package,
  ): { tag: string; val: string | undefined }[] {
    const paragraph = singleParagraph(written);
    const run = childrenWithTag(paragraph, "w:r")[0];
    if (run === undefined) {
      throw new Error("expected a run");
    }
    const rPr = childrenWithTag(run, "w:rPr")[0];
    if (rPr === undefined) {
      throw new Error("expected run properties");
    }
    return rPr.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => ({ tag: child.tag, val: attr(child, "w:val") }));
  }

  function paragraphProperties(
    written: Package,
  ): { tag: string; attrs: Record<string, string> }[] {
    const paragraph = singleParagraph(written);
    const pPr = childrenWithTag(paragraph, "w:pPr")[0];
    if (pPr === undefined) {
      throw new Error("expected paragraph properties");
    }
    return pPr.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => ({
        tag: child.tag,
        attrs: Object.fromEntries(
          child.attributes.map((attribute) => [
            attribute.name,
            attribute.value,
          ]),
        ),
      }));
  }

  it("spells every resolved run toggle with its own on/off w:val, including the explicit off spellings", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [
                {
                  text: "styled",
                  bold: true,
                  italic: false,
                  strike: true,
                  underline: true,
                  direction: "rtl",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(runProperties(written)).toEqual([
      { tag: "w:b", val: "1" },
      { tag: "w:i", val: "0" },
      { tag: "w:strike", val: "1" },
      { tag: "w:u", val: "single" },
      { tag: "w:rtl", val: "1" },
    ]);
  });

  it("spells a resolved left-to-right run's direction with the rtl off spelling and an absent underline as none", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "plain", underline: false, direction: "ltr" }],
            },
          ],
        },
      ],
    });
    expect(runProperties(written)).toEqual([
      { tag: "w:u", val: "none" },
      { tag: "w:rtl", val: "0" },
    ]);
  });

  it("writes a positive first-line indent as w:firstLine, a negative one as the signed inverse w:hanging, and zero as firstLine zero", () => {
    const build = (indentFirstLinePt: number) =>
      buildDocxPackageFromContent({
        sections: [
          {
            ...emptyBodySection(),
            blocks: [
              {
                kind: "paragraph",
                runs: [{ text: "indented" }],
                indentFirstLinePt,
              },
            ],
          },
        ],
      });
    // 24pt converts to 480 twips at 20 twips per point (ECMA-376's own twip definition); the negative case below reuses the same magnitude to prove the sign flips which tag is emitted, not the value.
    const INDENT_FIRST_LINE_PT = 24;
    const positive = paragraphProperties(build(INDENT_FIRST_LINE_PT));
    expect(positive.find((child) => child.tag === "w:ind")?.attrs).toEqual({
      "w:firstLine": "480",
    });
    const negative = paragraphProperties(build(-INDENT_FIRST_LINE_PT));
    expect(negative.find((child) => child.tag === "w:ind")?.attrs).toEqual({
      "w:hanging": "480",
    });
    const zero = paragraphProperties(build(0));
    expect(zero.find((child) => child.tag === "w:ind")?.attrs).toEqual({
      "w:firstLine": "0",
    });
  });

  it("spells a paragraph's line spacing with the auto rule and its direction with the bidi on/off spelling", () => {
    const rtl = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: " rtl" }],
              lineSpacing: 1.5,
              direction: "rtl",
            },
          ],
        },
      ],
    });
    expect(paragraphProperties(rtl)).toEqual([
      { tag: "w:bidi", attrs: { "w:val": "1" } },
      { tag: "w:spacing", attrs: { "w:line": "360", "w:lineRule": "auto" } },
    ]);
    const ltr = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "ltr" }],
              lineSpacing: 2,
              direction: "ltr",
            },
          ],
        },
      ],
    });
    expect(paragraphProperties(ltr)).toEqual([
      { tag: "w:bidi", attrs: { "w:val": "0" } },
      { tag: "w:spacing", attrs: { "w:line": "480", "w:lineRule": "auto" } },
    ]);
  });
});

describe("buildDocxPackageFromContent: run-level construct marker XML exactness", () => {
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

  function childTags(paragraph: XmlElement): string[] {
    return paragraph.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => child.tag);
  }

  it("mints increasing bookmark ids across two point bookmarks in one paragraph", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "marked" }],
              constructs: [
                {
                  descriptor: {
                    kind: "anchor",
                    anchorType: "bookmark",
                    name: "one",
                  },
                  startRun: 0,
                  endRun: 0,
                },
                {
                  descriptor: {
                    kind: "anchor",
                    anchorType: "bookmark",
                    name: "two",
                  },
                  startRun: 0,
                  endRun: 0,
                },
              ],
            },
          ],
        },
      ],
    });
    const paragraph = bodyParagraph(written);
    expect(childTags(paragraph)).toEqual([
      "w:bookmarkStart",
      "w:bookmarkEnd",
      "w:bookmarkStart",
      "w:bookmarkEnd",
      "w:r",
    ]);
    const ids = paragraph.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => attr(child, "w:id"))
      .filter((id): id is string => id !== undefined);
    expect(ids).toEqual(["1", "1", "2", "2"]);
    const names = paragraph.children
      .filter(
        (child): child is XmlElement =>
          child.type === "element" && child.tag === "w:bookmarkStart",
      )
      .map((child) => attr(child, "w:name"));
    expect(names).toEqual(["one", "two"]);
    // A point bookmark mutates nothing about the run it sits at: the run keeps exactly its own text child.
    const run = childrenWithTag(paragraph, "w:r")[0]!;
    expect(
      run.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["w:t"]);
  });

  it("writes a run-level field's characters with the begin/instruction/separate group at its opening boundary and the typed end at its closing boundary", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "result" }, { text: "after" }],
              constructs: [
                {
                  descriptor: { kind: "field", instruction: " PAGE " },
                  startRun: 0,
                  endRun: 1,
                },
              ],
            },
          ],
        },
      ],
    });
    const paragraph = bodyParagraph(written);
    expect(childTags(paragraph)).toEqual([
      "w:r",
      "w:r",
      "w:r",
      "w:r",
      "w:r",
      "w:r",
    ]);
    const fldChars = elementsWithTag([paragraph], "w:fldChar").map((run) =>
      attr(run, "w:fldCharType"),
    );
    expect(fldChars).toEqual(["begin", "separate", "end"]);
    const instr = elementsWithTag([paragraph], "w:instrText")[0]!;
    expect(attr(instr, "xml:space")).toBe("preserve");
    expect(
      instr.children
        .map((child) => (child.type === "text" ? child.value : ""))
        .join(""),
    ).toBe(" PAGE ");
  });

  it("writes a point field's four characters as one adjacent group before the run at its own position", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "first" }, { text: "second" }],
              constructs: [
                {
                  descriptor: { kind: "field", instruction: "x" },
                  startRun: 1,
                  endRun: 1,
                },
              ],
            },
          ],
        },
      ],
    });
    const paragraph = bodyParagraph(written);
    // The four characters all precede the second run, begin to end in order.
    const described = paragraph.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => {
        if (child.tag !== "w:r") {
          return child.tag;
        }
        const fldChar = childrenWithTag(child, "w:fldChar")[0];
        if (fldChar !== undefined) {
          return `fld:${attr(fldChar, "w:fldCharType")}`;
        }
        if (childrenWithTag(child, "w:instrText").length > 0) {
          return "instr";
        }
        return "run";
      });
    expect(described).toEqual([
      "run",
      "fld:begin",
      "instr",
      "fld:separate",
      "fld:end",
      "run",
    ]);
  });

  it("injects a note reference mark into the run at its own index and refuses one that names no run", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "before" }, { text: "" }],
              constructs: [
                {
                  descriptor: {
                    kind: "anchor",
                    anchorType: "footnote",
                    name: "3",
                  },
                  startRun: 1,
                  endRun: 1,
                },
              ],
            },
          ],
        },
      ],
    });
    const paragraph = bodyParagraph(written);
    const secondRun = childrenWithTag(paragraph, "w:r")[1]!;
    expect(
      secondRun.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["w:t", "w:footnoteReference"]);
    const reference = childrenWithTag(secondRun, "w:footnoteReference")[0]!;
    expect(attr(reference, "w:id")).toBe("3");
    expect(() =>
      buildDocxPackageFromContent({
        sections: [
          {
            ...emptyBodySection(),
            blocks: [
              {
                kind: "paragraph",
                runs: [{ text: "only" }],
                constructs: [
                  {
                    descriptor: {
                      kind: "anchor",
                      anchorType: "comment",
                      name: "9",
                    },
                    startRun: 1,
                    endRun: 1,
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow(
      /a comment reference at run index 1 of a paragraph does not name a real run/,
    );
  });

  it("writes a comment extent's halves with the comments.xml id verbatim", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "a" }, { text: "b" }],
              constructs: [
                {
                  descriptor: {
                    kind: "anchor",
                    anchorType: "comment",
                    name: "4",
                  },
                  startRun: 0,
                  endRun: 2,
                },
              ],
            },
          ],
        },
      ],
    });
    const paragraph = bodyParagraph(written);
    expect(childTags(paragraph)).toEqual([
      "w:commentRangeStart",
      "w:r",
      "w:r",
      "w:commentRangeEnd",
    ]);
    expect(
      attr(childrenWithTag(paragraph, "w:commentRangeStart")[0]!, "w:id"),
    ).toBe("4");
    expect(
      attr(childrenWithTag(paragraph, "w:commentRangeEnd")[0]!, "w:id"),
    ).toBe("4");
  });
});
