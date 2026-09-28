import { bytesToBase64, encodePng } from "byte-codec";
import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentRun } from "document-schema.js";
import { reconstructWordprocessing } from "./reconstruct";
import type {
  LayoutAnnotation,
  LayoutDocument,
  LayoutFormField,
  LayoutImageAsset,
  LayoutItem,
  LayoutPage,
  LayoutText,
} from "pdf-codec";

// The PDF-side construct surfacing (#721): link reconciliation (external URI links onto ContentRun.hyperlink where the rect matches recovered runs, else a block-scoped link construct; internal links as link constructs with the internal-target union), hidden-layer content no longer extracting as visible, and annotation/form constructs. These are the reconstruct halves of the issue's rows; the package-table halves (destinations, outline, attachments, layers, residue) are stamped by the composition executor and tested beside it.

const BLACK = { r: 0, g: 0, b: 0 };

function text(overrides: {
  text: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  sizePt?: number;
  layer?: string;
}): LayoutText {
  return {
    kind: "text",
    text: overrides.text,
    xPt: overrides.xPt,
    yPt: overrides.yPt,
    font: { family: "Helvetica", weight: "normal", style: "normal" },
    sizePt: overrides.sizePt ?? 12,
    color: BLACK,
    widthPt: overrides.widthPt,
    ...(overrides.layer !== undefined ? { layer: overrides.layer } : {}),
  };
}

function page(
  widthPt: number,
  heightPt: number,
  items: LayoutItem[],
  annotations?: LayoutAnnotation[],
): LayoutPage {
  return {
    widthPt,
    heightPt,
    items,
    ...(annotations !== undefined ? { annotations } : {}),
  };
}

function docFrom(
  pages: LayoutPage[],
  extra: {
    layers?: { name: string; visible: boolean }[];
    form?: LayoutFormField[];
  } = {},
): LayoutDocument {
  return {
    formatVersion: 1,
    metadata: {},
    pages,
    images: { img1: tinyPngAsset() },
    ...(extra.layers !== undefined ? { layers: extra.layers } : {}),
    ...(extra.form !== undefined ? { form: extra.form } : {}),
  };
}

function tinyPngAsset(): LayoutImageAsset {
  const bytes = encodePng({
    width: 2,
    height: 2,
    channels: 3,
    data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
  });
  return {
    format: "png",
    base64: bytesToBase64(bytes),
    widthPx: 2,
    heightPx: 2,
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

function runs(doc: ReturnType<typeof reconstructWordprocessing>): ContentRun[] {
  return blocks(doc).flatMap((b) => (b.kind === "paragraph" ? b.runs : []));
}

describe("reconstructWordprocessing: link reconciliation (#721)", () => {
  it("sets ContentRun.hyperlink on the runs an external link rect covers", () => {
    const doc = reconstructWordprocessing(
      docFrom([
        page(612, 792, [
          text({ text: "Visit ", xPt: 50, yPt: 700, widthPt: 30 }),
          text({ text: "example.com", xPt: 80, yPt: 700, widthPt: 70 }),
          text({ text: " today", xPt: 150, yPt: 700, widthPt: 36 }),
          {
            kind: "link",
            uri: "https://example.com",
            xPt: 80,
            yPt: 688,
            widthPt: 70,
            heightPt: 14,
          },
        ]),
      ]),
    );
    const hyperlinkRuns = runs(doc).filter((r) => r.hyperlink !== undefined);
    expect(hyperlinkRuns).toHaveLength(1);
    expect(hyperlinkRuns[0]).toMatchObject({
      text: "example.com",
      hyperlink: "https://example.com",
    });
  });

  it("wraps the best-matching block in a link construct pair when no run matches an external link", () => {
    const doc = reconstructWordprocessing(
      docFrom([
        page(612, 792, [
          text({ text: "Heading", xPt: 50, yPt: 700, widthPt: 60, sizePt: 18 }),
          {
            kind: "image",
            imageId: "img1",
            xPt: 40,
            yPt: 600,
            widthPt: 100,
            heightPt: 60,
          },
          {
            kind: "link",
            uri: "https://images.example",
            xPt: 40,
            yPt: 600,
            widthPt: 100,
            heightPt: 60,
          },
        ]),
      ]),
    );
    const list = blocks(doc);
    const start = list.findIndex((b) => b.kind === "constructStart");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(list[start]).toMatchObject({
      kind: "constructStart",
      descriptor: {
        kind: "link",
        target: { kind: "external", uri: "https://images.example" },
      },
    });
    expect(list[start + 1]?.kind).toBe("image");
    expect(list[start + 2]?.kind).toBe("constructEnd");
  });

  it("emits an internal-target link construct naming the destinations-table entry", () => {
    const doc = reconstructWordprocessing(
      docFrom([
        page(612, 792, [
          text({ text: "Jump to section", xPt: 50, yPt: 700, widthPt: 90 }),
          {
            kind: "internalLink",
            destination: "section-two",
            xPt: 50,
            yPt: 688,
            widthPt: 90,
            heightPt: 14,
          },
        ]),
      ]),
    );
    const list = blocks(doc);
    const start = list.findIndex((b) => b.kind === "constructStart");
    expect(list[start]).toMatchObject({
      kind: "constructStart",
      descriptor: {
        kind: "link",
        target: { kind: "internal", anchor: "section-two" },
      },
    });
    expect(list[start + 1]?.kind).toBe("paragraph");
    expect(list[start + 2]?.kind).toBe("constructEnd");
  });

  it("wraps the block with the LARGER overlap when a link rect intersects two candidate blocks by different amounts", () => {
    // The existing "no run matches" test above has only one candidate block (an image the link rect covers exactly), so it never exercises intersectionArea comparing two real, non-zero, unequal overlaps against each other; wrapBestBlock's own "best" only means anything once there is a genuine choice to make. An internalLink, not an external one, since reconcileLinks only ever checks run-level overlap for an external link, never for an internalLink, so this reaches wrapBestBlock/intersectionArea directly regardless of how the rect also happens to cover either line's own run frame.
    const doc = reconstructWordprocessing(
      docFrom([
        page(612, 792, [
          text({
            text: "Upper line, barely clipped",
            xPt: 50,
            yPt: 700,
            widthPt: 120,
          }),
          text({
            text: "Lower line, fully covered",
            xPt: 50,
            yPt: 600,
            widthPt: 120,
          }),
          {
            kind: "internalLink",
            destination: "target-anchor",
            xPt: 40,
            yPt: 590,
            widthPt: 150,
            heightPt: 115,
          },
        ]),
      ]),
    );
    const list = blocks(doc);
    const paras = list.filter((b) => b.kind === "paragraph");
    expect(paras).toHaveLength(2);
    const start = list.findIndex((b) => b.kind === "constructStart");
    expect(list[start + 1]).toBe(paras[1]);
  });

  it("carries the link annotation's own title through to the construct descriptor", () => {
    const doc = reconstructWordprocessing(
      docFrom([
        page(612, 792, [
          text({ text: "Heading", xPt: 50, yPt: 700, widthPt: 60, sizePt: 18 }),
          {
            kind: "link",
            uri: "https://images.example",
            title: "An example image",
            xPt: 400,
            yPt: 100,
            widthPt: 100,
            heightPt: 60,
          },
        ]),
      ]),
    );
    const list = blocks(doc);
    const start = list.findIndex((b) => b.kind === "constructStart");
    expect(list[start]).toMatchObject({
      kind: "constructStart",
      descriptor: {
        kind: "link",
        target: { kind: "external", uri: "https://images.example" },
        title: "An example image",
      },
    });
  });
});

describe("reconstructWordprocessing: optional content visibility (#721)", () => {
  it("drops items in a layer the default configuration hides", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page(612, 792, [
            text({ text: "Visible", xPt: 50, yPt: 700, widthPt: 40 }),
            text({
              text: "Hidden",
              xPt: 50,
              yPt: 680,
              widthPt: 40,
              layer: "Background",
            }),
          ]),
        ],
        { layers: [{ name: "Background", visible: false }] },
      ),
    );
    const texts = runs(doc)
      .map((r) => r.text)
      .join(" ");
    expect(texts).toContain("Visible");
    expect(texts).not.toContain("Hidden");
  });

  it("keeps items in a layer with no visibility entry (the honest default: unstated means shown)", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page(612, 792, [
            text({
              text: "Kept",
              xPt: 50,
              yPt: 700,
              widthPt: 40,
              layer: "Unknown",
            }),
          ]),
        ],
        { layers: [{ name: "Background", visible: false }] },
      ),
    );
    expect(
      runs(doc)
        .map((r) => r.text)
        .join(" "),
    ).toContain("Kept");
  });
});

type ConstructStartBlock = Extract<ContentBlock, { kind: "constructStart" }>;

function isConstructStart(block: ContentBlock): block is ConstructStartBlock {
  return block.kind === "constructStart";
}

function startBlocks(list: readonly ContentBlock[]): ConstructStartBlock[] {
  return list.filter(isConstructStart);
}

describe("reconstructWordprocessing: annotation and form constructs (#721)", () => {
  it("emits a point anchor(comment) construct for a sticky note, naming its definitions entry deterministically", () => {
    const doc = reconstructWordprocessing(
      docFrom([
        page(
          612,
          792,
          [text({ text: "Body", xPt: 50, yPt: 700, widthPt: 40 })],
          [
            {
              subtype: "Text",
              xPt: 500,
              yPt: 740,
              widthPt: 16,
              heightPt: 16,
              contents: "A note",
              author: "Reviewer",
            },
          ],
        ),
      ]),
    );
    const list = blocks(doc);
    const start = list.findIndex((b) => b.kind === "constructStart");
    expect(list[start]).toMatchObject({
      kind: "constructStart",
      descriptor: {
        kind: "anchor",
        anchorType: "comment",
        name: "pdf-annot-0-0",
        definition: "pdf-annot-0-0",
      },
    });
    expect(list[start + 1]?.kind).toBe("constructEnd");
  });

  it("emits a contentControl construct around a form field's best-matching block", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page(612, 792, [
            text({ text: "Jane Doe", xPt: 50, yPt: 700, widthPt: 60 }),
          ]),
        ],
        {
          form: [
            {
              name: "fullname",
              fieldType: "text",
              value: "Jane Doe",
              alias: "Full name",
              readOnly: true,
              widgets: [
                { pageIndex: 0, xPt: 45, yPt: 688, widthPt: 70, heightPt: 16 },
              ],
              children: [],
            },
          ],
        },
      ),
    );
    const list = blocks(doc);
    const start = list.findIndex((b) => b.kind === "constructStart");
    expect(list[start]).toMatchObject({
      kind: "constructStart",
      descriptor: {
        kind: "contentControl",
        controlType: "plainText",
        tag: "fullname",
        value: "Jane Doe",
        alias: "Full name",
        lock: "content",
      },
    });
    expect(list[start + 1]?.kind).toBe("paragraph");
    expect(list[start + 2]?.kind).toBe("constructEnd");
  });

  it("emits nothing for signature fields — certification is residue, not a control", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page(612, 792, [
            text({ text: "Body", xPt: 50, yPt: 700, widthPt: 40 }),
          ]),
        ],
        {
          form: [
            {
              name: "sig",
              fieldType: "signature",
              widgets: [
                { pageIndex: 0, xPt: 40, yPt: 688, widthPt: 80, heightPt: 20 },
              ],
              children: [],
            },
          ],
        },
      ),
    );
    expect(blocks(doc).every((b) => b.kind !== "constructStart")).toBe(true);
  });
  it("carries a link item's own title onto the link construct, external and internal alike", () => {
    const doc = reconstructWordprocessing(
      docFrom([
        page(612, 792, [
          // An image, so the external link finds no run to adopt and takes the block-scoped path where the item's own title travels.
          {
            kind: "image",
            imageId: "img1",
            xPt: 40,
            yPt: 600,
            widthPt: 100,
            heightPt: 60,
          },
          {
            kind: "link",
            uri: "https://example.com/",
            title: "Example",
            xPt: 40,
            yPt: 600,
            widthPt: 100,
            heightPt: 60,
          },
          text({ text: "Jump", xPt: 50, yPt: 740, widthPt: 40 }),
          {
            kind: "internalLink",
            destination: "section-two",
            title: "Section Two",
            xPt: 50,
            yPt: 728,
            widthPt: 40,
            heightPt: 14,
          },
        ]),
      ]),
    );
    const descriptors = startBlocks(blocks(doc)).map((b) => b.descriptor);
    expect(descriptors).toEqual([
      {
        kind: "link",
        target: { kind: "internal", anchor: "section-two" },
        title: "Section Two",
      },
      {
        kind: "link",
        target: { kind: "external", uri: "https://example.com/" },
        title: "Example",
      },
    ]);
    // A link with no title carries no title key at all, not an empty one.
    const plain = reconstructWordprocessing(
      docFrom([
        page(612, 792, [
          {
            kind: "image",
            imageId: "img1",
            xPt: 40,
            yPt: 600,
            widthPt: 100,
            heightPt: 60,
          },
          {
            kind: "link",
            uri: "https://example.com/",
            xPt: 40,
            yPt: 600,
            widthPt: 100,
            heightPt: 60,
          },
        ]),
      ]),
    );
    const [plainStart] = startBlocks(blocks(plain));
    expect(plainStart?.descriptor.kind).toBe("link");
    expect(plainStart && "title" in plainStart.descriptor).toBe(false);
  });

  it("wraps the FIRST of two blocks whose overlap with the rect ties", () => {
    // The rect covers an equal 12pt slice of both paragraphs' frames, so the strict greater-than keeps the first block the best match.
    // Two images as the candidate blocks (no runs for the link to adopt), each fully covered for the same 24pt slice.
    const doc = reconstructWordprocessing(
      docFrom([
        page(612, 792, [
          {
            kind: "image",
            imageId: "img1",
            xPt: 40,
            yPt: 688,
            widthPt: 100,
            heightPt: 24,
          },
          {
            kind: "image",
            imageId: "img1",
            xPt: 40,
            yPt: 640,
            widthPt: 100,
            heightPt: 24,
          },
          {
            kind: "link",
            uri: "https://example.com/",
            xPt: 40,
            yPt: 640,
            widthPt: 100,
            heightPt: 72,
          },
        ]),
      ]),
    );
    const list = blocks(doc);
    const start = list.findIndex((b) => b.kind === "constructStart");
    // The upper image is the first best match, so it is the one wrapped; the lower image follows the pair. The wrapped block's own frame names which image it is: the upper one's yPt is 688.
    expect(list[start + 1]?.kind).toBe("image");
    const wrapped = list[start + 1];
    const wrappedFrame =
      wrapped?.kind === "image" ? wrapped.frames?.[0] : undefined;
    expect(wrappedFrame?.yPt).toBe(688);
    expect(list[start + 2]?.kind).toBe("constructEnd");
    expect(list[start + 3]?.kind).toBe("image");
  });

  it("appends a point pair at the end of the page's blocks when nothing matches, even with several blocks present", () => {
    const doc = reconstructWordprocessing(
      docFrom([
        page(
          612,
          792,
          [
            text({ text: "Upper", xPt: 50, yPt: 700, widthPt: 60 }),
            text({ text: "Lower", xPt: 50, yPt: 640, widthPt: 60 }),
          ],
          [
            {
              subtype: "Text",
              xPt: 500,
              yPt: 60,
              widthPt: 16,
              heightPt: 16,
              contents: "A note",
              author: "Reviewer",
              source: { format: "pdf", xml: "<Sticky/>" },
            },
          ],
        ),
      ]),
    );
    const list = blocks(doc);
    expect(list[list.length - 2]?.kind).toBe("constructStart");
    expect(list[list.length - 1]?.kind).toBe("constructEnd");
    expect(list[list.length - 3]?.kind).toBe("paragraph");
    const anchor = list[list.length - 2];
    const anchorStart =
      anchor !== undefined && isConstructStart(anchor) ? anchor : undefined;
    expect(anchorStart).toBeDefined();
    // A note carrying source residue names that residue on the anchor descriptor.
    expect(anchorStart?.descriptor).toMatchObject({
      kind: "anchor",
      anchorType: "comment",
      source: { format: "pdf", xml: "<Sticky/>" },
    });
  });
});

describe("reconstructWordprocessing: form field control types (#721)", () => {
  interface FieldCase {
    readonly fieldType: Exclude<
      "button" | "combobox" | "listbox" | "checkbox",
      never
    >;
    readonly controlType: string;
    readonly extra?: Record<string, unknown>;
  }
  const cases: readonly FieldCase[] = [
    { fieldType: "button", controlType: "button" },
    {
      fieldType: "combobox",
      controlType: "comboBox",
      extra: { options: ["a", "b"] },
    },
    {
      fieldType: "listbox",
      controlType: "dropDown",
      extra: { options: ["one", "two"] },
    },
    {
      fieldType: "checkbox",
      controlType: "checkbox",
      extra: { checked: true },
    },
  ];
  for (const { fieldType, controlType, extra } of cases) {
    it(`maps a ${fieldType} field to its ${controlType} control`, () => {
      const doc = reconstructWordprocessing(
        docFrom(
          [
            page(612, 792, [
              text({ text: "Pick", xPt: 50, yPt: 700, widthPt: 40 }),
            ]),
          ],
          {
            form: [
              {
                name: `f-${fieldType}`,
                fieldType,
                widgets: [
                  {
                    pageIndex: 0,
                    xPt: 45,
                    yPt: 688,
                    widthPt: 50,
                    heightPt: 16,
                  },
                ],
                children: [],
                ...(extra ?? {}),
              },
            ],
          },
        ),
      );
      const list = blocks(doc);
      const start = list.findIndex((b) => b.kind === "constructStart");
      expect(list[start]).toMatchObject({
        kind: "constructStart",
        descriptor: {
          kind: "contentControl",
          controlType,
          tag: `f-${fieldType}`,
          ...(extra ?? {}),
        },
      });
      expect(list[start + 1]?.kind).toBe("paragraph");
      expect(list[start + 2]?.kind).toBe("constructEnd");
    });
  }

  it("a minimal checkbox field carries only the control type and tag, with no value, checked, or options keys", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page(612, 792, [
            text({ text: "Agree", xPt: 50, yPt: 700, widthPt: 50 }),
          ]),
        ],
        {
          form: [
            {
              name: "agree",
              fieldType: "checkbox",
              widgets: [
                { pageIndex: 0, xPt: 45, yPt: 688, widthPt: 60, heightPt: 16 },
              ],
              children: [],
            },
          ],
        },
      ),
    );
    const list = blocks(doc);
    const [start] = startBlocks(list);
    expect(start?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "checkbox",
      tag: "agree",
    });
  });

  it("visits a group's children while emitting nothing for the group itself", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page(612, 792, [
            text({ text: "Agree", xPt: 50, yPt: 700, widthPt: 50 }),
          ]),
        ],
        {
          form: [
            {
              name: "group",
              fieldType: "group",
              widgets: [],
              children: [
                {
                  name: "inner",
                  fieldType: "checkbox",
                  checked: false,
                  widgets: [
                    {
                      pageIndex: 0,
                      xPt: 45,
                      yPt: 688,
                      widthPt: 60,
                      heightPt: 16,
                    },
                  ],
                  children: [],
                },
              ],
            },
          ],
        },
      ),
    );
    const list = blocks(doc);
    const start = list.findIndex((b) => b.kind === "constructStart");
    expect(list[start]).toMatchObject({
      descriptor: {
        kind: "contentControl",
        controlType: "checkbox",
        tag: "inner",
        checked: false,
      },
    });
  });

  it("emits nothing for a widget whose page is not the page being built", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page(612, 792, [
            text({ text: "Body", xPt: 50, yPt: 700, widthPt: 40 }),
          ]),
        ],
        {
          form: [
            {
              name: "elsewhere",
              fieldType: "text",
              widgets: [
                { pageIndex: 1, xPt: 45, yPt: 688, widthPt: 50, heightPt: 16 },
              ],
              children: [],
            },
          ],
        },
      ),
    );
    expect(blocks(doc).every((b) => b.kind !== "constructStart")).toBe(true);
  });
});
