import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentDocument } from "document-schema.js";
import type { XmlElement } from "odf.js";
import { attr } from "ooxml.js";
import { readOdtContent } from "../../odf/odt/read";
import { buildOdtPackage } from "./content";

// The merged-image-paragraph path and the list-building edges of the ODT bridge. The merge is a write-side shape (one paragraph element carrying the draw:frame), so it is asserted on the package's own XML; the list edges are asserted on the round trip, where the reader mints its own list ids.

const SECTION = {
  pageSize: { widthPt: 612, heightPt: 792 },
  margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
};

function wordDoc(blocks: ContentBlock[]): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [{ ...SECTION, blocks }],
  };
}

function image(): ContentBlock {
  return {
    kind: "image",
    format: "png",
    base64: "iVBORw0KGgo",
    widthPt: 30,
    heightPt: 12,
  };
}

function emptyParagraph(
  properties: {
    headingLevel?: number;
    styleId?: string;
    alignment?: "left" | "center" | "right" | "justify";
    list?: { numId: string; level: number };
  } = {},
): ContentBlock {
  return {
    kind: "paragraph",
    runs: [{ text: "" }],
    ...(properties.headingLevel !== undefined
      ? { headingLevel: properties.headingLevel }
      : {}),
    ...(properties.styleId !== undefined
      ? { styleId: properties.styleId }
      : {}),
    ...(properties.alignment !== undefined
      ? { alignment: properties.alignment }
      : {}),
    ...(properties.list !== undefined ? { list: properties.list } : {}),
  };
}

function paragraphElements(
  pkg: ReturnType<typeof buildOdtPackage>,
): XmlElement[] {
  const part = pkg.parts["content.xml"];
  if (part?.kind !== "xml") {
    throw new Error("expected a content part");
  }
  const found: XmlElement[] = [];
  const walk = (element: XmlElement): void => {
    if (element.tag === "text:p" || element.tag === "text:h") {
      found.push(element);
    }
    for (const child of element.children) {
      if (child.type === "element") {
        walk(child);
      }
    }
  };
  for (const node of part.nodes) {
    if (node.type === "element") {
      walk(node);
    }
  }
  return found;
}

function containsFrame(element: XmlElement): boolean {
  return element.children.some(
    (child) => child.type === "element" && child.tag === "draw:frame",
  );
}

describe("buildOdtPackage: merged image paragraphs", () => {
  it("an empty-runs paragraph beside an image merges into one element, a heading element when heading is stated", () => {
    const paragraphs = paragraphElements(
      buildOdtPackage(
        wordDoc([
          emptyParagraph({ headingLevel: 2, alignment: "center" }),
          image(),
        ]),
      ),
    );
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.tag).toBe("text:h");
    expect(containsFrame(paragraphs[0]!)).toBe(true);
  });

  it("a styleId travels when there is no heading, and loses to the heading when there is", () => {
    const styled = paragraphElements(
      buildOdtPackage(
        wordDoc([emptyParagraph({ styleId: "Standard" }), image()]),
      ),
    );
    expect(styled).toHaveLength(1);
    expect(styled[0]?.tag).toBe("text:p");
    expect(attr(styled[0]!, "text:style-name")).toBeDefined();
    expect(containsFrame(styled[0]!)).toBe(true);

    const both = paragraphElements(
      buildOdtPackage(
        wordDoc([
          emptyParagraph({ headingLevel: 1, styleId: "Standard" }),
          image(),
        ]),
      ),
    );
    expect(both).toHaveLength(1);
    expect(both[0]?.tag).toBe("text:h");
    expect(attr(both[0]!, "text:style-name")).not.toBe("Standard");
  });

  it("a list-member paragraph or real text beside an image does not merge", () => {
    const listed = paragraphElements(
      buildOdtPackage(
        wordDoc([emptyParagraph({ list: { numId: "1", level: 0 } }), image()]),
      ),
    );
    expect(listed.filter(containsFrame)).toHaveLength(1);
    expect(listed.length).toBeGreaterThan(1);

    const textual = paragraphElements(
      buildOdtPackage(
        wordDoc([{ kind: "paragraph", runs: [{ text: "real" }] }, image()]),
      ),
    );
    expect(textual.length).toBeGreaterThan(1);
  });
});

describe("buildOdtPackage: list runs from flat content", () => {
  function listParagraph(level: number, text: string): ContentBlock {
    return {
      kind: "paragraph",
      list: { numId: "1", level },
      runs: [{ text }],
    };
  }

  function roundTrip(blocks: ContentBlock[]): readonly ContentBlock[] {
    const recovered = readOdtContent(buildOdtPackage(wordDoc(blocks)));
    if (recovered.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    return recovered.sections.flatMap((s) => [...s.blocks]);
  }

  it("a fresh list starts at level zero regardless of the declared level", () => {
    const blocks = roundTrip([listParagraph(2, "fresh")]);
    const first = blocks[0];
    expect(first).toMatchObject({
      kind: "paragraph",
      list: { level: 0 },
    });
  });

  it("a numId change starts a fresh list with a distinct id", () => {
    const blocks = roundTrip([
      {
        kind: "paragraph",
        list: { numId: "1", level: 0 },
        runs: [{ text: "a" }],
      },
      {
        kind: "paragraph",
        list: { numId: "2", level: 0 },
        runs: [{ text: "b" }],
      },
    ]);
    const ids = blocks.map((b) =>
      b.kind === "paragraph" && b.list !== undefined ? b.list.numId : null,
    );
    expect(ids[0]).toBeDefined();
    expect(ids[1]).toBeDefined();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("nesting goes one level at a time, never skipping an intermediate level", () => {
    const blocks = roundTrip([
      listParagraph(0, "top"),
      listParagraph(2, "deep"),
    ]);
    expect(
      blocks.map((b) =>
        b.kind === "paragraph" && b.list ? b.list.level : null,
      ),
    ).toEqual([0, 1]);
  });
});
