import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentParagraph,
  ContentRun,
} from "document-schema.js";
import type {
  LayoutDocument,
  LayoutImageAsset,
  LayoutItem,
  LayoutPage,
  LayoutText,
} from "pdf-codec";
import { reconstructWordprocessing } from "./reconstruct";

// The companion to reconstruct.test.ts's grouping pins: the section-pagination arithmetic, the page-size grouping disjunction, the vector-claim filter, the block-intersection guard, and the hyperlink frame matching, each pinned at the exact boundary its guard states.

function text(overrides: {
  text: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  sizePt?: number;
}): LayoutText {
  return {
    kind: "text",
    text: overrides.text,
    xPt: overrides.xPt,
    yPt: overrides.yPt,
    font: { family: "Helvetica", weight: "normal", style: "normal" },
    sizePt: overrides.sizePt ?? 12,
    color: { r: 0, g: 0, b: 0 },
    widthPt: overrides.widthPt,
  };
}

function page(
  widthPt: number,
  heightPt: number,
  items: LayoutItem[],
): LayoutPage {
  return { widthPt, heightPt, items };
}

function docFrom(
  pages: LayoutPage[],
  images: Record<string, LayoutImageAsset> = {},
): LayoutDocument {
  return { formatVersion: 1, metadata: {}, pages, images };
}

function sections(doc: ReturnType<typeof reconstructWordprocessing>) {
  if (doc.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing document");
  }
  return doc.sections;
}

function paragraphsWithFrames(
  doc: ReturnType<typeof reconstructWordprocessing>,
) {
  return sections(doc).flatMap((section) =>
    section.blocks
      .filter((b): b is ContentParagraph => b.kind === "paragraph")
      .map((p) => ({ section, paragraph: p })),
  );
}

describe("reconstructWordprocessing: section pagination arithmetic", () => {
  it("stamps absolute page indices across a section boundary", () => {
    const doc = reconstructWordprocessing(
      docFrom([
        page(612, 792, [
          text({ text: "First", xPt: 50, yPt: 700, widthPt: 30 }),
        ]),
        page(612, 792, [
          text({ text: "Second", xPt: 50, yPt: 700, widthPt: 40 }),
        ]),
        page(400, 400, [
          text({ text: "Third", xPt: 50, yPt: 300, widthPt: 30 }),
        ]),
      ]),
    );
    expect(sections(doc)).toHaveLength(2);
    const entries = paragraphsWithFrames(doc);
    expect(
      entries.map((e) => e.paragraph.runs.map((r) => r.text).join("")),
    ).toEqual(["First", "Second", "Third"]);
    // The third paragraph sits on absolute page 3 (index 2), not at index 0 within its own section.
    expect(entries[2]!.paragraph.runs[0]!.frames?.[0]?.pageIndex).toBe(2);
    expect(entries[2]!.section.pageSize).toEqual({
      widthPt: 400,
      heightPt: 400,
    });
  });

  it("splits sections on a height change alone, keeping same-width pages together", () => {
    const doc = reconstructWordprocessing(
      docFrom([
        page(612, 792, [text({ text: "A", xPt: 50, yPt: 700, widthPt: 10 })]),
        page(612, 400, [text({ text: "B", xPt: 50, yPt: 300, widthPt: 10 })]),
      ]),
    );
    expect(sections(doc)).toHaveLength(2);
  });

  it("produces no sections at all for a document with no pages", () => {
    const doc = reconstructWordprocessing(docFrom([]));
    expect(sections(doc)).toHaveLength(0);
  });
});

describe("reconstructWordprocessing: block-intersection geometry", () => {
  function recoveredRuns(doc: ReturnType<typeof reconstructWordprocessing>) {
    const runs: ContentRun[] = [];
    for (const section of sections(doc)) {
      for (const block of section.blocks) {
        if (block.kind === "paragraph") {
          runs.push(...block.runs);
        }
      }
    }
    return runs;
  }

  it("prefers the block the annotation overlaps on BOTH axes over a wider horizontal-only overlap", () => {
    // Upper block at y 700: the link rect overlaps it both-axes with a small area. Lower block at y 300: the same rect overlaps it horizontally with a large width but zero vertical overlap.
    const doc = reconstructWordprocessing(
      docFrom([
        page(612, 792, [
          text({ text: "Upper", xPt: 100, yPt: 700, widthPt: 100 }),
          text({ text: "Lower", xPt: 100, yPt: 300, widthPt: 300 }),
          {
            kind: "internalLink",
            destination: "target",
            xPt: 110,
            yPt: 690,
            widthPt: 80,
            heightPt: 10,
          },
        ]),
      ]),
    );
    const list = sections(doc)[0]!.blocks;
    const startIdx = list.findIndex((b) => b.kind === "constructStart");
    expect(startIdx).toBeGreaterThanOrEqual(0);
    const wrapped = list[startIdx + 1];
    expect(
      wrapped?.kind === "paragraph" && wrapped.runs.map((r) => r.text).join(""),
    ).toBe("Upper");
  });

  it("a run with several frames takes its hyperlink when ANY one frame intersects the link rect", () => {
    // Two frames on one page: the first sits far from the link rect, the second exactly under it. Only a frame-ANY match sets the hyperlink; a frame-ALL match would see the distant frame fail and leave the run unlinked.
    const multiFrame = {
      ...text({ text: "Jump", xPt: 50, yPt: 700, widthPt: 40 }),
      frames: [
        { pageIndex: 0, xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
        { pageIndex: 0, xPt: 40, yPt: 690, widthPt: 60, heightPt: 14 },
      ],
    } as LayoutText;
    const doc = reconstructWordprocessing(
      docFrom([
        page(612, 792, [
          multiFrame,
          {
            kind: "link",
            uri: "https://example.com/",
            xPt: 40,
            yPt: 690,
            widthPt: 60,
            heightPt: 14,
          },
        ]),
      ]),
    );
    const hyperlinked = recoveredRuns(doc).filter(
      (r) => r.hyperlink !== undefined,
    );
    expect(hyperlinked.map((r) => r.text)).toEqual(["Jump"]);
    expect(hyperlinked[0]?.hyperlink).toBe("https://example.com/");
  });
});

describe("reconstructWordprocessing: form-field constructs on the emitted side", () => {
  type FormFieldType =
    | "text"
    | "checkbox"
    | "button"
    | "group"
    | "radio"
    | "listbox"
    | "combobox"
    | "signature";

  interface FormFieldSpec {
    readonly name: string;
    readonly fieldType: FormFieldType;
    readonly extra?: Record<string, unknown>;
  }

  function formDoc(field: FormFieldSpec) {
    return reconstructWordprocessing({
      formatVersion: 1,
      metadata: {},
      images: {},
      pages: [
        page(612, 792, [
          text({ text: "Body", xPt: 50, yPt: 700, widthPt: 30 }),
        ]),
      ],
      form: [
        {
          name: field.name,
          fieldType: field.fieldType,
          widgets: [
            { pageIndex: 0, xPt: 45, yPt: 688, widthPt: 50, heightPt: 16 },
          ],
          children: [],
          ...(field.extra ?? {}),
        },
      ],
    });
  }

  it("emits nothing for a group field or a signature field, while a text field wraps its block", () => {
    for (const fieldType of ["group", "signature"] as const) {
      const doc = formDoc({ name: `f-${fieldType}`, fieldType });
      expect(
        sections(doc)[0]!.blocks.filter((b) => b.kind === "constructStart"),
        fieldType,
      ).toHaveLength(0);
    }
    const doc = formDoc({ name: "plain", fieldType: "text" });
    expect(
      sections(doc)[0]!.blocks.filter((b) => b.kind === "constructStart"),
    ).toHaveLength(1);
  });

  it("a minimal radio field carries only the control type and tag", () => {
    const doc = formDoc({ name: "choice", fieldType: "radio" });
    const start = sections(doc)[0]!.blocks.find(
      (b): b is Extract<ContentBlock, { kind: "constructStart" }> =>
        b.kind === "constructStart",
    );
    expect(start?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "checkbox",
      tag: "choice",
    });
  });

  it("a field with only a value carries the value and nothing else optional", () => {
    const doc = formDoc({
      name: "dated",
      fieldType: "text",
      extra: { value: "2024-05-06" },
    });
    const start = sections(doc)[0]!.blocks.find(
      (b): b is Extract<ContentBlock, { kind: "constructStart" }> =>
        b.kind === "constructStart",
    );
    expect(start?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      tag: "dated",
      value: "2024-05-06",
    });
  });
});
