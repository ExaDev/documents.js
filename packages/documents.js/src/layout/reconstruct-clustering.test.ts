import { describe, expect, it } from "vitest";
import type { ContentParagraph } from "document-schema.js";
import { reconstructWordprocessing } from "./reconstruct";
import type {
  LayoutDocument,
  LayoutImage,
  LayoutImageAsset,
  LayoutItem,
  LayoutPage,
  LayoutText,
} from "pdf-codec";

function text(overrides: {
  text: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  sizePt?: number;
  family?: string;
  bold?: boolean;
}): LayoutText {
  return {
    kind: "text",
    text: overrides.text,
    xPt: overrides.xPt,
    yPt: overrides.yPt,
    font: {
      family: overrides.family ?? "Helvetica",
      weight: overrides.bold === true ? "bold" : "normal",
      style: "normal",
    },
    sizePt: overrides.sizePt ?? 12,
    color: { r: 0, g: 0, b: 0 },
    widthPt: overrides.widthPt,
  };
}

function image(overrides: {
  imageId: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  rotationDeg?: number;
}): LayoutImage {
  return { kind: "image", ...overrides };
}

// The generic-path shape a stroke can still arrive in when it misses pdf-codec's own LayoutLine shape pattern (several segments in one subpath, or a subpath that is also filled), and the shape every stroke arrived in before that pattern existed. detectGridLattice accepts it alongside a genuine LayoutLine so a hand-built LayoutDocument, an older recorded one, and a freshly round-tripped one all detect identically — which the "built from stroked LayoutPath items" test below is what actually pins.
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

function paragraphs(
  doc: ReturnType<typeof reconstructWordprocessing>,
): ContentParagraph[] {
  if (doc.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing document");
  }
  return doc.sections.flatMap((s) =>
    s.blocks.filter((b): b is ContentParagraph => b.kind === "paragraph"),
  );
}

describe("reconstructWordprocessing: fuzzy redraw collapsing (ExaDev/documents.js#1066)", () => {
  it("collapses a sentence redrawn with different Tj-fragment boundaries down to one clean copy, even though no individual fragment matches another exactly", () => {
    const pg = page(612, 792, [
      // Redraw 1 (kept): "Access"+"control"+"policies", split at the word boundaries.
      text({ text: "Access", xPt: 50, yPt: 700, widthPt: 36 }),
      text({ text: "control", xPt: 86, yPt: 700, widthPt: 42 }),
      text({ text: "policies", xPt: 128, yPt: 700, widthPt: 48 }),
      // Redraw 2 (dropped): the identical sentence, but split at different points and drifted slightly in x — the shape a different kerning pass through the same content stream produces. No fragment here shares an exact position or exact text with any fragment above, so neither dropDuplicatePaints nor dropOverlappingRepeatsWithinLine would ever collapse this pair.
      text({ text: "Acce", xPt: 50.3, yPt: 700, widthPt: 24 }),
      text({ text: "sscontrolpo", xPt: 74.3, yPt: 700, widthPt: 66 }),
      text({ text: "licies", xPt: 140.3, yPt: 700, widthPt: 36 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text).join("")).toBe(
      "Accesscontrolpolicies",
    );
  });

  it("collapses a redraw that differs from the kept occurrence by a little wording drift, not just fragment boundaries (regression: novus-power/hive#1543 — source editions merged into the corpus PDF disagree by a character where the same sentence is redrawn)", () => {
    const pg = page(612, 792, [
      text({
        text: "Access control policies remain effective for compliance",
        xPt: 50,
        yPt: 700,
        widthPt: 300,
      }),
      text({
        text: "Access control policies remains effective for compliance",
        xPt: 52,
        yPt: 700,
        widthPt: 304,
      }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual([
      "Access control policies remain effective for compliance",
    ]);
  });

  it("leaves genuinely distinct prose on a nearby line untouched while still collapsing the redraw on its own line (an editorial amendment sentence physically adjacent to a redrawn passage must survive intact)", () => {
    const pg = page(612, 792, [
      text({ text: "Access", xPt: 50, yPt: 700, widthPt: 36 }),
      text({ text: "control", xPt: 86, yPt: 700, widthPt: 42 }),
      text({ text: "policies", xPt: 128, yPt: 700, widthPt: 48 }),
      text({ text: "Acce", xPt: 50.3, yPt: 700, widthPt: 24 }),
      text({ text: "sscontrolpo", xPt: 74.3, yPt: 700, widthPt: 66 }),
      text({ text: "licies", xPt: 140.3, yPt: 700, widthPt: 36 }),
      text({
        text: "Replace the content of this subclause by new text",
        xPt: 50,
        yPt: 686,
        widthPt: 260,
      }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    const allText = paras.flatMap((p) => p.runs.map((r) => r.text));
    expect(allText.join("")).toBe(
      "Accesscontrolpolicies Replace the content of this subclause by new text",
    );
  });

  it("never collapses two genuinely different sentences that happen to share a baseline and restart in x, even though the second starts well behind where the first ends", () => {
    const pg = page(612, 792, [
      text({
        text: "The annual compliance review covers every operational site",
        xPt: 50,
        yPt: 700,
        widthPt: 300,
      }),
      text({
        text: "Replace the content of this subclause including the table by new text",
        xPt: 54,
        yPt: 700,
        widthPt: 360,
      }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual([
      "The annual compliance review covers every operational site",
      "Replace the content of this subclause including the table by new text",
    ]);
  });

  it("never touches a short redraw-like restart below the sentence-length floor, leaving it for dropOverlappingRepeatsWithinLine's own exact-match rule to decide", () => {
    const pg = page(612, 792, [
      text({ text: "NP", xPt: 50, yPt: 700, widthPt: 12 }),
      text({ text: "NP", xPt: 50.5, yPt: 700, widthPt: 12 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual(["NP"]);
  });

  it("still recognises a redraw whose text is split into many single-character fragments as the same sentence a differently-fragmented copy already carries, proving pass text is joined with no separator between fragments", () => {
    const word = "Accesscontrolpolicies";
    const pg = page(612, 792, [
      text({ text: "Access", xPt: 50, yPt: 700, widthPt: 36 }),
      text({ text: "control", xPt: 86, yPt: 700, widthPt: 42 }),
      text({ text: "policies", xPt: 128, yPt: 700, widthPt: 48 }),
      // The identical sentence redrawn as one single-character fragment per letter, restarting near the same left margin — genuinely the same content, just tokenised far more finely than the kept copy above.
      ...Array.from(word).map((ch, i) =>
        text({ text: ch, xPt: 50.2 + i, yPt: 700, widthPt: 1 }),
      ),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text).join("")).toBe(
      "Accesscontrolpolicies",
    );
  });

  it("recognises a redraw that differs from the kept copy by exactly one substituted character in the middle, not just at the very end", () => {
    const pg = page(612, 792, [
      text({ text: "AACCGECCCIAC", xPt: 50, yPt: 700, widthPt: 100 }),
      // A restart well behind the kept copy's own reach, one character different (position 8: C -> D) from an otherwise identical 12-character redraw.
      text({ text: "AACCGECDCIAC", xPt: 52, yPt: 700, widthPt: 100 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text).join("")).toBe("AACCGECCCIAC");
  });

  it("keeps a pass's own reached extent at its high-water mark rather than shrinking it when a later item's own reach is smaller, so a redraw starting just behind that mark is still recognised", () => {
    const pg = page(612, 792, [
      text({
        text: "Access control policies",
        xPt: 50,
        yPt: 700,
        widthPt: 100,
      }),
      // A short, narrow filler that reaches less far than item 1 already did — must never pull the pass's own tracked reach backwards.
      text({ text: " ", xPt: 148, yPt: 700, widthPt: 1 }),
      // Positioned just behind item 1's own 150pt reach (147.5, within the 2pt rewind tolerance of 148) — a genuine redraw restart, not a continuation of the current pass.
      text({
        text: "Access control policied",
        xPt: 147.5,
        yPt: 700,
        widthPt: 100,
      }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    const allText = paras.flatMap((p) => p.runs.map((r) => r.text)).join("");
    expect(allText).not.toContain("policied");
  });

  it("measures redraw similarity as a fraction of the longer pass's own text, not the shorter, so a short kept copy is never treated as an unrecognisable redraw purely because a genuine longer redraw padded a little extra onto it", () => {
    const pg = page(612, 792, [
      text({ text: "AACCGECCCIAC", xPt: 50, yPt: 700, widthPt: 100 }),
      // The identical 12 characters plus 6 extra tacked on — still comfortably similar measured against its own (longer) length, but would read as barely half-similar if measured against the shorter kept copy instead.
      text({ text: "AACCGECCCIACXXXXXX", xPt: 52, yPt: 700, widthPt: 150 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text).join("")).toBe("AACCGECCCIAC");
  });

  it("never treats a baseline's first pass as a candidate redraw source once its own text falls short of the sentence-length floor, even when a later pass on the same baseline is long and would otherwise look similar enough", () => {
    const pg = page(612, 792, [
      text({ text: "Hi there", xPt: 50, yPt: 700, widthPt: 60 }),
      text({ text: "Hi there!!!!", xPt: 52, yPt: 700, widthPt: 90 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual(["Hi there", "Hi there!!!!"]);
  });

  it("never drops a candidate pass whose own text falls short of the sentence-length floor, even when it reads as similar enough to a long first pass", () => {
    const pg = page(612, 792, [
      text({ text: "Hi there!!!!", xPt: 50, yPt: 700, widthPt: 90 }),
      text({ text: "Hi there!!!", xPt: 52, yPt: 700, widthPt: 80 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual([
      "Hi there!!!!",
      "Hi there!!!",
    ]);
  });

  it("never drops a second pass whose own text merely reads as similar, when its own position never actually overlaps the first pass's own page-space at all", () => {
    const pg = page(612, 792, [
      text({
        text: "Access control policies",
        xPt: 50,
        yPt: 700,
        widthPt: 100,
      }),
      // Positioned well to the left of item 1 entirely (10-35), triggering splitIntoPasses' own restart detection (10 is far behind item 1's own 150pt reach) without ever spatially overlapping it — coincidentally similar text, genuinely distinct content.
      text({ text: "Access control policied", xPt: 10, yPt: 700, widthPt: 25 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    const allText = paras.flatMap((p) => p.runs.map((r) => r.text)).join("");
    expect(allText).toContain("policied");
  });

  it("never treats two passes as overlapping when one starts exactly where the other ends — touching, not overlapping, on either edge of the comparison", () => {
    const pg = page(612, 792, [
      text({
        text: "Access control policies",
        xPt: 100,
        yPt: 700,
        widthPt: 100,
      }),
      // Restarts well behind item 1's own reach (its own end, 100, lands exactly on item 1's own start) — touching item 1's own left edge precisely, not overlapping it.
      text({ text: "Access control policied", xPt: 50, yPt: 700, widthPt: 50 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    const allText = paras.flatMap((p) => p.runs.map((r) => r.text)).join("");
    expect(allText).toContain("policied");
  });

  it("never treats a third pass as overlapping the first once its own start lands exactly on the first pass's own end, touching rather than overlapping on that edge", () => {
    const pg = page(612, 792, [
      text({
        text: "Access control policies",
        xPt: 100,
        yPt: 700,
        widthPt: 100,
      }),
      // A short, unrelated filler pass with a wide reach — long enough to make item 3 below rewind against IT rather than against item 1, and too short itself to ever be considered as a redraw candidate.
      text({ text: ".", xPt: 10, yPt: 700, widthPt: 300 }),
      // Starts exactly at item 1's own end (200) — touching its right edge precisely, not overlapping it.
      text({
        text: "Access control policied",
        xPt: 200,
        yPt: 700,
        widthPt: 100,
      }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    const allText = paras.flatMap((p) => p.runs.map((r) => r.text)).join("");
    expect(allText).toContain("policied");
  });

  it("drops a redraw whose similarity lands exactly on the recognition threshold, not just strictly above it", () => {
    const pg = page(612, 792, [
      text({ text: "AAAAAAAAAAAAAAA", xPt: 50, yPt: 700, widthPt: 100 }),
      // 6 of 15 characters differ (a similarity of exactly 0.6, the threshold itself), restarting well behind item 1's own reach.
      text({ text: "BBBBBBAAAAAAAAA", xPt: 52, yPt: 700, widthPt: 100 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text).join("")).toBe("AAAAAAAAAAAAAAA");
  });
});

describe("reconstructWordprocessing: images and page structure", () => {
  it("interleaves an image block by vertical position among paragraphs", () => {
    const pg = page(612, 792, [
      text({ text: "Above", xPt: 50, yPt: 700, widthPt: 40 }),
      image({ imageId: "img1", xPt: 50, yPt: 600, widthPt: 100, heightPt: 50 }),
      text({ text: "Below", xPt: 50, yPt: 500, widthPt: 40 }),
    ]);
    const doc = reconstructWordprocessing(
      docFrom([pg], {
        img1: { format: "png", base64: "AAAA", widthPx: 10, heightPx: 5 },
      }),
    );
    if (doc.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing");
    }
    const kinds = doc.sections[0]!.blocks.map((b) => b.kind);
    expect(kinds).toEqual(["paragraph", "image", "paragraph"]);
  });

  it("merges consecutive same-size pages into one section with a page break, and starts a new section for a differently-sized page", () => {
    const doc = reconstructWordprocessing(
      docFrom([
        page(612, 792, [
          text({ text: "Page one", xPt: 50, yPt: 700, widthPt: 60 }),
        ]),
        page(612, 792, [
          text({ text: "Page two", xPt: 50, yPt: 700, widthPt: 60 }),
        ]),
        page(300, 300, [
          text({ text: "Page three", xPt: 50, yPt: 200, widthPt: 60 }),
        ]),
      ]),
    );
    if (doc.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing");
    }
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0]!.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
    expect(doc.sections[0]!.blocks.map((b) => b.kind)).toEqual([
      "paragraph",
      "pageBreak",
      "paragraph",
    ]);
    expect(doc.sections[1]!.pageSize).toEqual({ widthPt: 300, heightPt: 300 });
  });

  it("carries document metadata through unchanged", () => {
    const doc = reconstructWordprocessing({
      formatVersion: 1,
      metadata: { title: "My Doc", author: "A. Writer" },
      pages: [page(612, 792, [])],
      images: {},
    });
    expect(doc.metadata).toEqual({ title: "My Doc", author: "A. Writer" });
  });
});
