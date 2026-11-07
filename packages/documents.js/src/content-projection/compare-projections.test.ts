import { describe, expect, it } from "vitest";
import {
  cell,
  docx,
  paragraph,
  row,
  xlsx,
  type DocxSpec,
} from "../test-support/content-projection";
import { compareProjections } from "./compare-projections";
import { projectDocxContent } from "./project-docx";
import { projectXlsxContent } from "./project-xlsx";

const project = async (spec: DocxSpec) =>
  projectDocxContent(docx(spec), { memoryBudgetBytes: 2 ** 30 });

const sheetProjection = async () =>
  projectXlsxContent(
    xlsx({
      sheets: [{ name: "S", rows: row(1, [cell({ r: "A1", v: "1" })]) }],
    }),
    { memoryBudgetBytes: 2 ** 30 },
  );

const PNG_A = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
const PNG_B = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2]);

const ORIGINAL: DocxSpec = {
  body: `${paragraph("first words")}${paragraph("second words")}`,
  header: paragraph("running header"),
};

// A writer that is not idempotent: every pass appends one empty paragraph, as a real writer's regenerated output can grow.
const growing = (spec: DocxSpec): DocxSpec => ({
  ...spec,
  body: `${spec.body}<w:p/>`,
});
// A writer that loses a paragraph of the body on every pass.
const shrinking = (spec: DocxSpec): DocxSpec => ({
  ...spec,
  body: spec.body.replace(/<w:p><w:r><w:t>[^<]*<\/w:t><\/w:r><\/w:p>/, ""),
});

async function compare(
  original: DocxSpec,
  rewrite: DocxSpec,
  control?: DocxSpec,
) {
  return compareProjections(
    await project(original),
    await project(rewrite),
    control === undefined ? undefined : await project(control),
  );
}

describe("compareProjections without a control", () => {
  it("is equivalent for equal projections", async () => {
    const comparison = await compare(ORIGINAL, ORIGINAL);
    expect(comparison.verdict).toBe("equivalent");
    expect(comparison.controlApplied).toBe(false);
  });

  it("calls every shortfall a loss and every surplus a writer addition", async () => {
    const lost = await compare(ORIGINAL, shrinking(ORIGINAL));
    expect(lost.findings.every((f) => f.class === "loss")).toBe(true);
    expect(lost.verdict).toBe("loss");
    const added = await compare(ORIGINAL, growing(ORIGINAL));
    expect(added.findings).toEqual([
      { area: "census", subject: "body:p", count: 1, class: "writer-addition" },
    ]);
    expect(added.verdict).toBe("writer-differences");
  });
});

describe("compareProjections with the gen2 control", () => {
  it("separates a growing writer's noise from loss: surplus where the control still changes is asymmetry", async () => {
    const rewrite = growing(ORIGINAL);
    const comparison = await compare(ORIGINAL, rewrite, growing(rewrite));
    expect(comparison.findings).toEqual([
      {
        area: "census",
        subject: "body:p",
        count: 1,
        class: "writer-asymmetry",
      },
    ]);
    expect(comparison.verdict).toBe("writer-differences");
    expect(comparison.controlApplied).toBe(true);
  });

  it("keeps a deterministic surplus a writer addition when the control agrees with the rewrite", async () => {
    const rewrite = growing(ORIGINAL);
    const comparison = await compare(ORIGINAL, rewrite, rewrite);
    expect(comparison.findings).toEqual([
      { area: "census", subject: "body:p", count: 1, class: "writer-addition" },
    ]);
  });

  it("still reports a real loss elsewhere when the writer is noisy", async () => {
    const rewrite = { ...growing(ORIGINAL), header: "" };
    const comparison = await compare(ORIGINAL, rewrite, growing(rewrite));
    expect(comparison.verdict).toBe("loss");
    expect(comparison.findings).toContainEqual({
      area: "census",
      subject: "body:p",
      count: 1,
      class: "writer-asymmetry",
    });
    expect(comparison.findings).toContainEqual({
      area: "units",
      subject: "headers-footers",
      count: 2,
      class: "loss",
    });
  });

  it("calls a shortfall a loss when rewriting the rewrite loses nothing more", async () => {
    const rewrite = shrinking(ORIGINAL);
    const comparison = await compare(ORIGINAL, rewrite, rewrite);
    expect(comparison.verdict).toBe("loss");
  });

  it("calls a shortfall unstable when rewriting the rewrite loses content in the same place", async () => {
    const rewrite = shrinking(ORIGINAL);
    const comparison = await compare(ORIGINAL, rewrite, {
      ...rewrite,
      body: "",
    });
    expect(comparison.findings.some((f) => f.class === "unstable")).toBe(true);
    expect(comparison.findings.some((f) => f.class === "loss")).toBe(false);
    expect(comparison.verdict).toBe("unstable");
  });

  it("rejects a control of another format", async () => {
    const original = await project(ORIGINAL);
    const sheet = await sheetProjection();
    expect(() => compareProjections(original, original, sheet)).toThrow(
      /control/,
    );
  });
});

describe("compareProjections media", () => {
  it("calls the same kind of medium with different bytes re-encoded, not lost", async () => {
    const comparison = await compare(
      { ...ORIGINAL, media: { "a.png": PNG_A } },
      { ...ORIGINAL, media: { "a.png": PNG_B } },
    );
    expect(comparison.media).toEqual({
      original: 1,
      missing: 0,
      reencoded: 1,
      extra: 0,
    });
    expect(comparison.findings).toEqual([
      {
        area: "media",
        subject: "reencoded",
        count: 1,
        class: "reencoded-media",
      },
    ]);
    expect(comparison.verdict).toBe("writer-differences");
  });

  it("counts a medium that appears with nothing to pair against as extra, and one that vanishes as missing", async () => {
    expect(
      (await compare({ ...ORIGINAL, media: { "a.png": PNG_A } }, ORIGINAL))
        .media,
    ).toMatchObject({ missing: 1, extra: 0 });
    expect(
      (await compare(ORIGINAL, { ...ORIGINAL, media: { "a.png": PNG_A } }))
        .media,
    ).toMatchObject({ missing: 0, extra: 1 });
  });

  it("pairs only within a kind", async () => {
    const withImage = { ...ORIGINAL, media: { "a.png": PNG_A } };
    const withEmbedding = {
      ...ORIGINAL,
      extraParts: [{ name: "word/embeddings/o.bin", content: PNG_A }],
    };
    expect((await compare(withImage, withEmbedding)).media).toMatchObject({
      missing: 1,
      reencoded: 0,
      extra: 1,
    });
  });
});

describe("compareProjections refusals", () => {
  it("refuses projections of different formats", async () => {
    const original = await project(ORIGINAL);
    const sheet = await sheetProjection();
    expect(() => compareProjections(original, sheet)).toThrow(/cannot compare/);
  });
});
