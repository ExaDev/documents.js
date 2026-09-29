import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentConstructStart } from "document-schema.js";
import type {
  LayoutDocument,
  LayoutFormField,
  LayoutImageAsset,
  LayoutItem,
  LayoutDestination,
  LayoutLayer,
  LayoutPage,
  LayoutStructureElement,
  LayoutText,
} from "pdf-codec";
import { reconstructWordprocessing } from "./reconstruct";

// The claiming edges: which page a block belongs to and which block an annotation-shaped rectangle claims. Sections split exactly where the page size changes, frames carry their own page index however many same-size pages precede them, unclaimed vectors and images become blocks of their own, a widget measures intersection only against the page it sits on, a tie wraps the first block, and a rectangle covering nothing anchors to a point pair at the end. The descriptor pins use toStrictEqual so an absent field (title, value, source) is asserted absent as a key, not merely undefined-valued.

function text(overrides: {
  text: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  layer?: string;
  structure?: string;
}): LayoutText {
  return {
    kind: "text",
    text: overrides.text,
    xPt: overrides.xPt,
    yPt: overrides.yPt,
    font: { family: "Helvetica", weight: "normal", style: "normal" },
    sizePt: 12,
    color: { r: 0, g: 0, b: 0 },
    widthPt: overrides.widthPt,
    ...(overrides.layer !== undefined ? { layer: overrides.layer } : {}),
    ...(overrides.structure !== undefined
      ? { structure: overrides.structure }
      : {}),
  };
}

function page(items: LayoutItem[]): LayoutPage {
  return { widthPt: 612, heightPt: 792, items };
}

interface DocExtras {
  layers?: LayoutLayer[];
  form?: LayoutFormField[];
  structure?: LayoutStructureElement[];
  destinations?: LayoutDestination[];
}

function docFrom(
  pages: LayoutPage[],
  images: Record<string, LayoutImageAsset> = {},
  extra: DocExtras = {},
): LayoutDocument {
  return {
    formatVersion: 1,
    metadata: {},
    pages,
    images,
    ...(extra.layers !== undefined ? { layers: extra.layers } : {}),
    ...(extra.form !== undefined ? { form: extra.form } : {}),
    ...(extra.structure !== undefined ? { structure: extra.structure } : {}),
    ...(extra.destinations !== undefined
      ? { destinations: extra.destinations }
      : {}),
  };
}

function blocks(
  doc: ReturnType<typeof reconstructWordprocessing>,
): ContentBlock[] {
  if (doc.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing document");
  }
  return doc.sections.flatMap((s) => s.blocks);
}

function startsWith(list: readonly ContentBlock[]): ContentConstructStart[] {
  return list.filter(
    (b): b is ContentConstructStart => b.kind === "constructStart",
  );
}

describe("reconstructWordprocessing sections follow the page size", () => {
  it("same-size pages stay one section with a page break between them", () => {
    const doc = reconstructWordprocessing(
      docFrom([
        page([text({ text: "A", xPt: 50, yPt: 700, widthPt: 30 })]),
        page([text({ text: "B", xPt: 50, yPt: 700, widthPt: 30 })]),
      ]),
    );
    expect(doc.kind).toBe("wordprocessing");
    if (doc.kind !== "wordprocessing") {
      throw new Error("unreachable");
    }
    expect(doc.sections).toHaveLength(1);
    expect(blocks(doc).map((b) => b.kind)).toEqual([
      "paragraph",
      "pageBreak",
      "paragraph",
    ]);
  });

  it("a page of a different size starts a new section, and page indices count on within the document", () => {
    const doc = reconstructWordprocessing(
      docFrom([
        page([text({ text: "A", xPt: 50, yPt: 700, widthPt: 30 })]),
        {
          widthPt: 400,
          heightPt: 400,
          items: [text({ text: "B", xPt: 50, yPt: 300, widthPt: 30 })],
        },
      ]),
    );
    expect(doc.kind).toBe("wordprocessing");
    if (doc.kind !== "wordprocessing") {
      throw new Error("unreachable");
    }
    expect(doc.sections).toHaveLength(2);
    const second = doc.sections[1]?.blocks.find((b) => b.kind === "paragraph");
    expect(second).toMatchObject({
      frames: [{ pageIndex: 1, xPt: 50 }],
    });
  });

  it("a block on the second of two same-size pages carries page index 1", () => {
    const doc = reconstructWordprocessing(
      docFrom([
        page([text({ text: "A", xPt: 50, yPt: 700, widthPt: 30 })]),
        page([text({ text: "B", xPt: 50, yPt: 700, widthPt: 30 })]),
      ]),
    );
    const frames = blocks(doc)
      .filter(
        (b): b is Extract<ContentBlock, { kind: "paragraph" }> =>
          b.kind === "paragraph",
      )
      .flatMap((b) => b.frames ?? []);
    expect(frames.map((f) => f.pageIndex)).toEqual([0, 1]);
  });
});

describe("reconstructWordprocessing hidden layers leave ungoverned items alone", () => {
  it("an item carrying no layer at all is kept while the hidden layer's items drop", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page([
            text({ text: "Plain", xPt: 50, yPt: 700, widthPt: 40 }),
            text({
              text: "Gone",
              xPt: 50,
              yPt: 680,
              widthPt: 40,
              layer: "Bg",
            }),
          ]),
        ],
        {},
        { layers: [{ name: "Bg", visible: false }] },
      ),
    );
    const joined = blocks(doc)
      .flatMap((b) => (b.kind === "paragraph" ? b.runs.map((r) => r.text) : []))
      .join(" ");
    expect(joined).toContain("Plain");
    expect(joined).not.toContain("Gone");
  });
});

describe("reconstructWordprocessing recovers vectors and images as their own blocks", () => {
  it("an unclaimed rect becomes an embedded object beside the text, which it does not swallow", () => {
    const doc = reconstructWordprocessing(
      docFrom([
        page([
          text({ text: "Body", xPt: 50, yPt: 700, widthPt: 40 }),
          { kind: "rect", xPt: 40, yPt: 600, widthPt: 100, heightPt: 20 },
        ]),
      ]),
    );
    const list = blocks(doc);
    expect(list.map((b) => b.kind)).toEqual(["paragraph", "embeddedObject"]);
    expect(list[1]).toMatchObject({
      frames: [{ pageIndex: 0, xPt: 0, yPt: 0, widthPt: 612, heightPt: 792 }],
    });
  });

  it("an image inside a tagged section is wrapped by the division pair and carries its own frame", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page([
            {
              kind: "image",
              imageId: "img1",
              xPt: 40,
              yPt: 600,
              widthPt: 100,
              heightPt: 60,
              structure: "p1",
            },
          ]),
        ],
        {
          img1: {
            format: "png",
            widthPx: 2,
            heightPx: 2,
            base64: "iVBORw0KGgo",
          },
        },
        {
          structure: [
            {
              id: "sec1",
              type: "Sect",
              children: [{ id: "p1", type: "P", children: [] }],
            },
          ],
        },
      ),
    );
    const list = blocks(doc);
    expect(list.map((b) => b.kind)).toEqual([
      "constructStart",
      "image",
      "constructEnd",
    ]);
    expect(startsWith(list)[0]?.descriptor).toStrictEqual({
      kind: "division",
    });
    expect(list[1]).toMatchObject({
      frames: [{ pageIndex: 0, xPt: 40, yPt: 600, widthPt: 100, heightPt: 60 }],
    });
  });
});

describe("reconstructWordprocessing widgets claim on their own page only", () => {
  it("a widget on page 1 wraps the page-1 block even when a page-0 block shares its rectangle", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page([text({ text: "A", xPt: 50, yPt: 100, widthPt: 60 })]),
          page([text({ text: "B", xPt: 50, yPt: 100, widthPt: 60 })]),
        ],
        {},
        {
          form: [
            {
              name: "f",
              fieldType: "text",
              widgets: [
                { pageIndex: 1, xPt: 40, yPt: 90, widthPt: 80, heightPt: 20 },
              ],
              children: [],
            },
          ],
        },
      ),
    );
    const list = blocks(doc);
    const start = list.findIndex((b) => b.kind === "constructStart");
    // The pair must sit on page 1's paragraph (after the page break), not on the decoy.
    expect(list[start + 1]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "B" }],
    });
    expect(list[start - 1]?.kind).toBe("pageBreak");
  });

  it("a widget covering nothing anchors to a point pair at the end of the blocks", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page([
            text({ text: "Upper", xPt: 50, yPt: 700, widthPt: 40 }),
            text({ text: "Lower", xPt: 50, yPt: 650, widthPt: 40 }),
          ]),
        ],
        {},
        {
          form: [
            {
              name: "f",
              fieldType: "text",
              widgets: [
                { pageIndex: 0, xPt: 400, yPt: 400, widthPt: 20, heightPt: 20 },
              ],
              children: [],
            },
          ],
        },
      ),
    );
    const list = blocks(doc);
    expect(list.map((b) => b.kind)).toEqual([
      "paragraph",
      "paragraph",
      "constructStart",
      "constructEnd",
    ]);
  });

  it("two blocks intersecting the widget equally: the first wins", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page([
            text({ text: "Upper", xPt: 50, yPt: 700, widthPt: 40 }),
            text({ text: "Lower", xPt: 50, yPt: 650, widthPt: 40 }),
          ]),
        ],
        {},
        {
          form: [
            {
              name: "f",
              fieldType: "text",
              widgets: [
                { pageIndex: 0, xPt: 40, yPt: 640, widthPt: 300, heightPt: 75 },
              ],
              children: [],
            },
          ],
        },
      ),
    );
    const list = blocks(doc);
    const start = list.findIndex((b) => b.kind === "constructStart");
    expect(start).toBe(0);
    expect(list[start + 1]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "Upper" }],
    });
    expect(list[start + 2]?.kind).toBe("constructEnd");
    expect(list[start + 3]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "Lower" }],
    });
  });
});

describe("reconstructWordprocessing construct descriptors carry only the fields the source carried", () => {
  it("an internal link with no title wraps a point pair whose descriptor has no title key", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page([
            {
              kind: "internalLink",
              destination: "sec2",
              xPt: 40,
              yPt: 600,
              widthPt: 100,
              heightPt: 20,
            },
          ]),
        ],
        {},
        {
          destinations: [
            { name: "sec2", pageIndex: 3, target: { kind: "fit" } },
          ],
        },
      ),
    );
    const list = blocks(doc);
    expect(startsWith(list)[0]?.descriptor).toStrictEqual({
      kind: "link",
      target: { kind: "internal", anchor: "sec2" },
    });
  });

  it("a bare text field's control descriptor names exactly kind, control type and tag", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [page([text({ text: "V", xPt: 50, yPt: 700, widthPt: 30 })])],
        {},
        {
          form: [
            {
              name: "bare",
              fieldType: "text",
              widgets: [
                { pageIndex: 0, xPt: 40, yPt: 688, widthPt: 60, heightPt: 20 },
              ],
              children: [],
            },
          ],
        },
      ),
    );
    const start = startsWith(blocks(doc))[0];
    expect(start?.descriptor).toStrictEqual({
      kind: "contentControl",
      controlType: "plainText",
      tag: "bare",
    });
  });

  it("a comment annotation without source residue defines its anchor with no source key", () => {
    const doc = reconstructWordprocessing(
      docFrom([
        {
          widthPt: 612,
          heightPt: 792,
          items: [
            text({ text: "First", xPt: 50, yPt: 700, widthPt: 40 }),
            text({ text: "Second", xPt: 50, yPt: 300, widthPt: 40 }),
          ],
          annotations: [
            {
              subtype: "Text",
              xPt: 300,
              yPt: 400,
              widthPt: 10,
              heightPt: 10,
              contents: "note",
            },
          ],
        },
      ]),
    );
    const list = blocks(doc);
    expect(startsWith(list)[0]?.descriptor).toStrictEqual({
      kind: "anchor",
      anchorType: "comment",
      name: "pdf-annot-0-0",
      definition: "pdf-annot-0-0",
    });
  });
});
