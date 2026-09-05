import { encodePng } from "byte-codec";
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
import { bytesToBase64 } from "pdf-codec/util/base64";

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

  it("emits nothing for signature fields -- certification is residue, not a control", () => {
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
});
