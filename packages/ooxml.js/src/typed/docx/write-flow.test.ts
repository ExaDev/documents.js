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
function emptyBodySection(): ContentSection {
  return {
    pageSize: { widthPt: 612, heightPt: 792 },
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
    blocks: [],
  };
}

describe("buildDocxPackageFromContent: content-control property edges", () => {
  function sdtProperties(written: Package): XmlElement[] {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    return elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:sdtPr",
    );
  }

  function controlBlocks(descriptor: ConstructDescriptor): ContentBlock[] {
    return [
      { kind: "constructStart", descriptor },
      { kind: "paragraph", runs: [{ text: "inside" }] },
      { kind: "constructEnd" },
    ];
  }

  it("writes the alias, tag, and each lock spelling under their own elements", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            ...controlBlocks({
              kind: "contentControl",
              controlType: "richText",
              alias: "Named",
              tag: "tagged",
              lock: "both",
            }),
          ],
        },
      ],
    });
    const sdtPr = sdtProperties(written)[0]!;
    expect(
      sdtPr.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => [child.tag, attr(child, "w:val")]),
    ).toEqual([
      ["w:alias", "Named"],
      ["w:tag", "tagged"],
      ["w:lock", "sdtContentLocked"],
      ["w:richText", undefined],
    ]);
  });

  it("spells an index control as the table-of-contents docPartObj gallery with its unique marker", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            ...controlBlocks({ kind: "contentControl", controlType: "index" }),
          ],
        },
      ],
    });
    const sdtPr = sdtProperties(written)[0]!;
    const docPartObj = childrenWithTag(sdtPr, "w:docPartObj")[0]!;
    expect(
      elementsWithTag([docPartObj], "w:docPartGallery").map((gallery) =>
        attr(gallery, "w:val"),
      ),
    ).toEqual(["Table of Contents"]);
    expect(childrenWithTag(docPartObj, "w:docPartUnique")).toHaveLength(1);
  });

  it("spells a combo box under its own tag with the same list items a drop-down carries", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            ...controlBlocks({
              kind: "contentControl",
              controlType: "comboBox",
              options: ["alpha", "beta"],
            }),
          ],
        },
      ],
    });
    const sdtPr = sdtProperties(written)[0]!;
    const comboBox = childrenWithTag(sdtPr, "w:comboBox")[0]!;
    expect(comboBox).toBeDefined();
    expect(
      elementsWithTag([comboBox], "w:listItem").map((item) => [
        attr(item, "w:displayText"),
        attr(item, "w:value"),
      ]),
    ).toEqual([
      ["alpha", "alpha"],
      ["beta", "beta"],
    ]);
  });

  it("writes a date control's full date when carried and no attribute when absent", () => {
    const withDate = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            ...controlBlocks({
              kind: "contentControl",
              controlType: "date",
              value: "2026-09-16T09:00:00Z",
            }),
          ],
        },
      ],
    });
    const dateElement = childrenWithTag(
      sdtProperties(withDate)[0]!,
      "w:date",
    )[0]!;
    expect(attr(dateElement, "w:fullDate")).toBe("2026-09-16T09:00:00Z");
    const withoutDate = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            ...controlBlocks({ kind: "contentControl", controlType: "date" }),
          ],
        },
      ],
    });
    const bareDate = childrenWithTag(
      sdtProperties(withoutDate)[0]!,
      "w:date",
    )[0]!;
    expect(bareDate.attributes).toEqual([]);
  });

  it("re-emits a degraded gallery's docPartObj residue in place of the richText element and refuses residue that is not XML", () => {
    const galleryResidue = `<w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj>`;
    const restored = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            ...controlBlocks({
              kind: "contentControl",
              controlType: "richText",
              source: { format: "docx", xml: galleryResidue },
            }),
          ],
        },
      ],
    });
    const sdtPr = sdtProperties(restored)[0]!;
    const docPartObj = childrenWithTag(sdtPr, "w:docPartObj")[0]!;
    expect(
      elementsWithTag([docPartObj], "w:docPartGallery").map((gallery) =>
        attr(gallery, "w:val"),
      ),
    ).toEqual(["Table of Contents"]);

    expect(() =>
      buildDocxPackageFromContent({
        sections: [
          {
            ...emptyBodySection(),
            blocks: [
              ...controlBlocks({
                kind: "contentControl",
                controlType: "richText",
                source: { format: "docx", xml: "not xml <" },
              }),
            ],
          },
        ],
      }),
    ).toThrow(/carries docx residue that does not parse as XML: not xml </);
  });

  it("keeps the semantic type element for residue that is not a restorable gallery shape", () => {
    const build = (xml: string) =>
      buildDocxPackageFromContent({
        sections: [
          {
            ...emptyBodySection(),
            blocks: [
              ...controlBlocks({
                kind: "contentControl",
                controlType: "richText",
                source: { format: "docx", xml },
              }),
            ],
          },
        ],
      });
    // Two top-level nodes: not the single element a restoration requires.
    const twoNodes = build("<w:docPartObj/><w:docPartObj/>");
    expect(
      sdtProperties(twoNodes)[0]!
        .children.filter(
          (child): child is XmlElement => child.type === "element",
        )
        .map((child) => child.tag),
    ).toEqual(["w:richText"]);
    // One element of the wrong tag: same fallback.
    const wrongTag = build("<w:alias/>");
    expect(
      sdtProperties(wrongTag)[0]!
        .children.filter(
          (child): child is XmlElement => child.type === "element",
        )
        .map((child) => child.tag),
    ).toEqual(["w:richText"]);
  });

  it("ignores docx residue on a control that is not richText, since the gate is the mint condition", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            ...controlBlocks({
              kind: "contentControl",
              controlType: "plainText",
              source: {
                format: "docx",
                xml: '<w:docPartObj><w:docPartGallery w:val="Table of Contents"/></w:docPartObj>',
              },
            }),
          ],
        },
      ],
    });
    expect(
      sdtProperties(written)[0]!
        .children.filter(
          (child): child is XmlElement => child.type === "element",
        )
        .map((child) => child.tag),
    ).toEqual(["w:text"]);
  });
});

describe("buildDocxPackageFromContent: flow assembly and section breaks", () => {
  function bodyElements(written: Package): { tag: string; summary: string }[] {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined
        ? undefined
        : childrenWithTag(documentRoot, "w:body")[0];
    if (body === undefined) {
      throw new Error("expected body");
    }
    return body.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => {
        if (child.tag === "w:p") {
          const pPr = childrenWithTag(child, "w:pPr")[0];
          const breakBefore =
            pPr !== undefined &&
            childrenWithTag(pPr, "w:pageBreakBefore").length > 0;
          const hasSectPr =
            pPr !== undefined && childrenWithTag(pPr, "w:sectPr").length > 0;
          const runCount = childrenWithTag(child, "w:r").length;
          const objectCount = elementsWithTag([child], "w:object").length;
          const drawingCount = elementsWithTag([child], "w:drawing").length;
          return {
            tag: "w:p",
            summary: `p${breakBefore ? "+break" : ""}${hasSectPr ? "+sectPr" : ""}:r${runCount}:o${objectCount}:d${drawingCount}`,
          };
        }
        return { tag: child.tag, summary: "" };
      });
  }

  it("clears the pending page break once the table before the next paragraph has carried it", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "pageBreak" },
            {
              kind: "table",
              rows: [{ cells: [{ blocks: [] }] }],
              columns: [{ widthPt: 100 }],
            },
            { kind: "paragraph", runs: [{ text: "after" }] },
          ],
        },
      ],
    });
    expect(bodyElements(written)).toEqual([
      { tag: "w:p", summary: "p+break:r0:o0:d0" },
      { tag: "w:tbl", summary: "" },
      { tag: "w:p", summary: "p:r1:o0:d0" },
      { tag: "w:sectPr", summary: "" },
    ]);
  });

  it("materialises a pending break before an embedded object, then places the object inside that break paragraph", () => {
    const nested: Extract<
      ContentBlock,
      { kind: "embeddedObject" }
    >["document"] = {
      kind: "wordprocessing",
      metadata: {},
      sections: [],
    };
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "pageBreak" },
            {
              kind: "embeddedObject",
              objectKind: "wordprocessing",
              document: nested,
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 60 },
            },
          ],
        },
      ],
    });
    expect(bodyElements(written)).toEqual([
      { tag: "w:p", summary: "p+break:r1:o1:d0" },
      { tag: "w:sectPr", summary: "" },
    ]);
  });

  it("appends an embedded object with no trailing empty run to its preceding paragraph, and one with no paragraph at all to a fresh paragraph", () => {
    const nested = (
      text: string,
    ): Extract<ContentBlock, { kind: "embeddedObject" }>["document"] => ({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [{ kind: "paragraph", runs: [{ text }] }],
        },
      ],
    });
    const object = (
      text: string,
    ): Extract<ContentBlock, { kind: "embeddedObject" }> => ({
      kind: "embeddedObject",
      objectKind: "wordprocessing",
      document: nested(text),
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 60 },
    });
    const attached = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "paragraph", runs: [{ text: "host" }] },
            object("first"),
          ],
        },
      ],
    });
    expect(bodyElements(attached)).toEqual([
      { tag: "w:p", summary: "p:r2:o1:d0" },
      { tag: "w:sectPr", summary: "" },
    ]);
    const fresh = buildDocxPackageFromContent({
      sections: [{ ...emptyBodySection(), blocks: [object("second")] }],
    });
    expect(bodyElements(fresh)).toEqual([
      { tag: "w:p", summary: "p:r1:o1:d0" },
      { tag: "w:sectPr", summary: "" },
    ]);
  });

  it("collects a paragraph styleId referenced only inside a table cell into the styles part", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "table",
              rows: [
                {
                  cells: [
                    {
                      blocks: [
                        {
                          kind: "paragraph",
                          styleId: "CellStyle",
                          runs: [{ text: "cell" }],
                        },
                      ],
                    },
                  ],
                },
              ],
              columns: [{ widthPt: 100 }],
            },
          ],
        },
      ],
    });
    const stylesRoot = rootElement(written.parts["word/styles.xml"]);
    expect(
      stylesRoot === undefined
        ? []
        : elementsWithTag([stylesRoot], "w:style").map((style) =>
            attr(style, "w:styleId"),
          ),
    ).toEqual(["Normal", "DefaultParagraphFont", "CellStyle"]);
  });

  it("writes a block-scoped comment extent as the same-id range pair around its paragraphs", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { kind: "anchor", anchorType: "comment", name: "7" },
            },
            { kind: "paragraph", runs: [{ text: "commented" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined ? [] : childrenWithTag(documentRoot, "w:body");
    const bodyChildren =
      body[0] === undefined
        ? []
        : body[0].children.filter(
            (child): child is XmlElement => child.type === "element",
          );
    expect(bodyChildren.map((child) => child.tag)).toEqual([
      "w:commentRangeStart",
      "w:p",
      "w:commentRangeEnd",
      "w:sectPr",
    ]);
    expect(attr(bodyChildren[0]!, "w:id")).toBe("7");
    const rangeEnd = bodyChildren.find(
      (child) => child.tag === "w:commentRangeEnd",
    )!;
    expect(attr(rangeEnd, "w:id")).toBe("7");
  });

  it("places a field's characters inside the sdt-wrapped paragraph its extent contains", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { kind: "field", instruction: "f" },
            },
            {
              kind: "constructStart",
              descriptor: { kind: "contentControl", controlType: "richText" },
            },
            { kind: "paragraph", runs: [{ text: "inner" }] },
            { kind: "constructEnd" },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined
        ? undefined
        : childrenWithTag(documentRoot, "w:body")[0];
    const sdt =
      body === undefined ? undefined : childrenWithTag(body, "w:sdt")[0];
    if (sdt === undefined) {
      throw new Error("expected an sdt");
    }
    const paragraph = elementsWithTag([sdt], "w:p")[0]!;
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
      "fld:begin",
      "instr",
      "fld:separate",
      "run",
      "fld:end",
    ]);
  });

  it("wraps a field extent with no paragraph in its own minted opening and closing paragraphs", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { kind: "field", instruction: "empty" },
            },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const described = bodyElements(written);
    expect(described).toEqual([
      { tag: "w:p", summary: "p:r3:o0:d0" },
      { tag: "w:p", summary: "p:r1:o0:d0" },
      { tag: "w:sectPr", summary: "" },
    ]);
  });

  it("keeps a section break's fldChar-free paragraph choice away from a trailing table's cell paragraphs", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            { kind: "paragraph", runs: [{ text: "last of section one" }] },
            {
              kind: "table",
              rows: [{ cells: [{ blocks: [] }] }],
              columns: [{ widthPt: 100 }],
            },
          ],
        },
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [{ kind: "paragraph", runs: [{ text: "section two" }] }],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined
        ? undefined
        : childrenWithTag(documentRoot, "w:body")[0];
    if (body === undefined) {
      throw new Error("expected body");
    }
    // The first section's sectPr rides the paragraph before the table, never a cell's paragraph inside it; the final section's sectPr is a direct body child.
    const table = childrenWithTag(body, "w:tbl")[0]!;
    expect(elementsWithTag([table], "w:sectPr")).toEqual([]);
    const paragraphs = body.children.filter(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "w:p",
    );
    const firstParagraphPPr = childrenWithTag(paragraphs[0]!, "w:pPr")[0]!;
    expect(childrenWithTag(firstParagraphPPr, "w:sectPr")).toHaveLength(1);
    const directSectPr = childrenWithTag(body, "w:sectPr");
    expect(directSectPr).toHaveLength(1);
  });

  it("appends the section break into a closing paragraph's existing properties and mints a pPr for one carrying none", () => {
    const styledSection = (
      paragraphBlock: ContentBlock,
    ): ReturnType<typeof buildDocxPackageFromContent> extends never
      ? never
      : Package => {
      return buildDocxPackageFromContent({
        sections: [
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
            blocks: [paragraphBlock],
          },
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
            blocks: [{ kind: "paragraph", runs: [{ text: "tail" }] }],
          },
        ],
      });
    };
    const styled = styledSection({
      kind: "paragraph",
      styleId: "Tail",
      runs: [{ text: "closing" }],
    });
    const styledRoot = rootElement(styled.parts["word/document.xml"]);
    const styledBody =
      styledRoot === undefined
        ? undefined
        : childrenWithTag(styledRoot, "w:body")[0];
    const styledParagraph =
      styledBody === undefined
        ? undefined
        : styledBody.children.find(
            (child): child is XmlElement =>
              child.type === "element" && child.tag === "w:p",
          );
    if (styledParagraph === undefined) {
      throw new Error("expected a paragraph");
    }
    const styledPPr = childrenWithTag(styledParagraph, "w:pPr")[0]!;
    expect(
      styledPPr.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["w:pStyle", "w:sectPr"]);

    const plain = styledSection({
      kind: "paragraph",
      runs: [{ text: "closing" }],
    });
    const plainRoot = rootElement(plain.parts["word/document.xml"]);
    const plainBody =
      plainRoot === undefined
        ? undefined
        : childrenWithTag(plainRoot, "w:body")[0];
    const plainParagraph =
      plainBody === undefined
        ? undefined
        : plainBody.children.find(
            (child): child is XmlElement =>
              child.type === "element" && child.tag === "w:p",
          );
    if (plainParagraph === undefined) {
      throw new Error("expected a paragraph");
    }
    const plainPPr = childrenWithTag(plainParagraph, "w:pPr")[0]!;
    expect(
      plainPPr.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["w:sectPr"]);
  });

  it("gives a mid-document section with no paragraph of its own an empty paragraph carrying the break", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "table",
              rows: [{ cells: [{ blocks: [] }] }],
              columns: [{ widthPt: 100 }],
            },
          ],
        },
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [{ kind: "paragraph", runs: [{ text: "after" }] }],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined
        ? undefined
        : childrenWithTag(documentRoot, "w:body")[0];
    if (body === undefined) {
      throw new Error("expected body");
    }
    const children = body.children.filter(
      (child): child is XmlElement => child.type === "element",
    );
    expect(children.map((child) => child.tag)).toEqual([
      "w:tbl",
      "w:p",
      "w:p",
      "w:sectPr",
    ]);
    const empty = children[1]!;
    expect(childrenWithTag(empty, "w:r")).toHaveLength(0);
    const pPr = childrenWithTag(empty, "w:pPr")[0]!;
    expect(childrenWithTag(pPr, "w:sectPr")).toHaveLength(1);
  });
});
