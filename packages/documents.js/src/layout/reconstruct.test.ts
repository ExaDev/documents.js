import { describe, expect, it } from "vitest";
import type { ContentParagraph } from "document-schema.js";
import { reconstructWordprocessing } from "./reconstruct";
import type {
  LayoutDocument,
  LayoutImageAsset,
  LayoutItem,
  LayoutPage,
  LayoutText,
} from "pdf-codec";

const BLACK = { r: 0, g: 0, b: 0 };

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

describe("reconstructWordprocessing: baseline clustering and word gaps", () => {
  it("does not let a large run claim the smaller line above it", () => {
    // A 9pt kicker 12pt above a 30pt title. Taking the tolerance from the larger of the two gives 15pt and merges them; taking it from the smaller gives 4.5pt and cannot (ExaDev/documents.js#1317). Merged, the two sort by x into one sequence whose gap is negative, which reads as one word, so the failure is not two lines in one paragraph but "QuarterlyResults" run together.
    const pg = page(612, 792, [
      text({ text: "Quarterly", xPt: 50, yPt: 700, widthPt: 40, sizePt: 9 }),
      text({ text: "Results", xPt: 50, yPt: 688, widthPt: 110, sizePt: 30 }),
    ]);
    const texts = paragraphs(reconstructWordprocessing(docFrom([pg]))).map(
      (para) => para.runs.map((r) => r.text).join(""),
    );
    expect(texts).toEqual(["Quarterly", "Results"]);
  });

  it("puts no space between runs separated by exactly the word-gap floor", () => {
    // The floor is the point at which a gap stops being float noise from a sub-run split mid-word, so a gap sitting exactly on it is still noise: only a strictly wider one is a space.
    const pg = page(612, 792, [
      text({ text: "hel", xPt: 50, yPt: 700, widthPt: 30 }),
      text({ text: "lo", xPt: 80.5, yPt: 700, widthPt: 20 }),
    ]);
    const paras = paragraphs(reconstructWordprocessing(docFrom([pg])));
    expect(paras[0]?.runs.map((r) => r.text).join("")).toBe("hello");
  });

  it("puts no space between runs whose advance widths were never stated", () => {
    // Three fragments of one word, each starting where the last visually ended. Reading the absent width as zero makes every advance look like a gap, so spaces land inside the word: "Com plete ly" (ExaDev/documents.js#1317).
    const withoutWidth = (content: string, xPt: number): LayoutText => ({
      kind: "text",
      text: content,
      xPt,
      yPt: 700,
      font: { family: "Helvetica", weight: "normal", style: "normal" },
      sizePt: 10,
      color: BLACK,
    });
    const pg = page(612, 792, [
      withoutWidth("Com", 50),
      withoutWidth("plete", 68),
      withoutWidth("ly", 95),
    ]);
    const paras = paragraphs(reconstructWordprocessing(docFrom([pg])));
    expect(paras[0]?.runs.map((r) => r.text).join("")).toBe("Completely");
  });
});

describe("reconstructWordprocessing: paragraph clustering", () => {
  it("joins lines within the modal line spacing into one paragraph, separated by a single space", () => {
    const pg = page(612, 792, [
      text({ text: "First line", xPt: 50, yPt: 700, widthPt: 60 }),
      text({ text: "second line", xPt: 50, yPt: 688, widthPt: 66 }),
      text({ text: "third line", xPt: 50, yPt: 676, widthPt: 60 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    expect(paras).toHaveLength(1);
    expect(paras[0]!.runs.map((r) => r.text).join("")).toBe(
      "First line second line third line",
    );
  });

  it("starts a new paragraph when the vertical gap exceeds 1.25x the modal line spacing", () => {
    const pg = page(612, 792, [
      text({ text: "First line", xPt: 50, yPt: 700, widthPt: 60 }),
      text({ text: "second line", xPt: 50, yPt: 688, widthPt: 66 }),
      text({ text: "third line", xPt: 50, yPt: 676, widthPt: 60 }),
      text({ text: "New paragraph", xPt: 50, yPt: 640, widthPt: 80 }), // gap of 36 vs modal 12
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    expect(paras).toHaveLength(2);
    expect(paras[1]!.runs[0]!.text).toContain("New paragraph");
  });

  it("starts a new paragraph on an indent change even when the vertical gap alone would not trigger one", () => {
    const pg = page(612, 792, [
      text({ text: "Para A", xPt: 50, yPt: 700, widthPt: 40 }),
      text({ text: "continues", xPt: 50, yPt: 690, widthPt: 50 }), // gap 10, matches modal
      text({ text: "Indented", xPt: 100, yPt: 680, widthPt: 50 }), // gap 10 (same as modal), but indented 50pt (>1em)
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    expect(paras).toHaveLength(2);
    expect(paras[1]!.runs[0]!.text).toContain("Indented");
  });

  // ExaDev/documents.js#584: a heading sits tight above its body at ordinary line spacing, so the gap signal alone glues them into one paragraph — the observed "**Part 1 Scope **This is body..." merge. A font-size discontinuity between adjacent lines is a third break signal, the same one the presentation direction's own clusterIntoBlocks already refuses to merge across (its fontSizesClose merge condition).
  it("starts a new paragraph at a font-size discontinuity even when the vertical gap alone would not trigger one", () => {
    const pg = page(612, 792, [
      text({ text: "A Heading", xPt: 50, yPt: 700, widthPt: 80, sizePt: 22 }),
      text({ text: "body one", xPt: 50, yPt: 688, widthPt: 50 }), // gap 12 = modal spacing, same margin — only the size differs
      text({ text: "body two", xPt: 50, yPt: 676, widthPt: 50 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    expect(paras).toHaveLength(2);
    expect(paras[0]!.runs.map((r) => r.text).join("")).toBe("A Heading");
    expect(paras[1]!.runs.map((r) => r.text).join("")).toBe(
      "body one body two",
    );
  });

  it("still merges adjacent lines whose sizes differ only within the close tolerance (superscripts, rounding jitter)", () => {
    const pg = page(612, 792, [
      text({ text: "Same para", xPt: 50, yPt: 700, widthPt: 60, sizePt: 12 }),
      text({ text: "continues", xPt: 50, yPt: 688, widthPt: 50, sizePt: 12.5 }), // within fontSizesClose's 1pt tolerance
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    expect(paras).toHaveLength(1);
  });

  it("never clusters two items onto one baseline once their vertical gap exceeds the tolerance, pinning that tolerance at exactly 0.5em rather than a looser generic default", () => {
    const pg = page(612, 792, [
      // 12pt font, 7pt vertical gap: 0.5em (this module's own tolerance) is 6pt, so 7pt is genuinely a different baseline; a looser ~0.667em default would wrongly admit it (8pt threshold).
      text({ text: "FirstLine", xPt: 50, yPt: 700, widthPt: 60, sizePt: 12 }),
      text({ text: "SecondLine", xPt: 50, yPt: 693, widthPt: 60, sizePt: 12 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    // Two genuinely separate lines within one paragraph join with a single inserted space; onto one (wrongly merged) baseline they would instead sort by x and abut directly with no space, since the items occupy the same x-range.
    expect(para!.runs.map((r) => r.text).join("")).toBe("FirstLine SecondLine");
  });
});

describe("reconstructWordprocessing: heading inference from font size", () => {
  // The layout engine's own heading render sizes (src/layout/shared.ts HEADING_STYLES: 28/22/18/14pt against a 12pt body) are what this inference must invert, so the fixture mirrors them: two distinct sizes above the body, ranked largest-first into Heading1 and Heading2 — exactly what a markdownToPdf of '# Title / ## Section / body' draws.
  it("assigns Heading1/Heading2 by rank of distinct sizes above the modal body size", () => {
    const pg = page(612, 792, [
      text({ text: "The Title", xPt: 50, yPt: 740, widthPt: 90, sizePt: 28 }),
      text({ text: "body line one", xPt: 50, yPt: 700, widthPt: 80 }),
      text({ text: "body line two", xPt: 50, yPt: 688, widthPt: 80 }),
      text({ text: "body line three", xPt: 50, yPt: 676, widthPt: 80 }),
      text({ text: "A Section", xPt: 50, yPt: 640, widthPt: 70, sizePt: 22 }),
      text({ text: "more body", xPt: 50, yPt: 620, widthPt: 60 }),
      text({ text: "even more body", xPt: 50, yPt: 608, widthPt: 70 }),
      text({ text: "still body", xPt: 50, yPt: 596, widthPt: 60 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    expect(paras.map((p) => p.styleId)).toEqual([
      "Heading1",
      undefined,
      "Heading2",
      undefined,
    ]);
    // The canonical headingLevel rides alongside the styleId spelling, matching markdown-codec's own lowerHeading: headingLevel is the only signal decompose groups on and the only one the docx writer turns into w:outlineLvl, so a Heading styleId without it would strand the heading ungrouped and unoutlined downstream.
    expect(paras.map((p) => p.headingLevel)).toEqual([
      1,
      undefined,
      2,
      undefined,
    ]);
  });

  // ExaDev/documents.js#868: a heading-styled paragraph whose only content is whitespace — an editorial spacer in a Word-authored specification, or a decorative leader drawn as a stretched space — carries a real, large font size (a genuine visible Tj, not the empty string convertText already drops before a LayoutText exists) but no text of its own. Classifying it as a heading purely from that font size produced exactly the reported symptom: a bare '#'-'######' marker with nothing after it once markdown-codec's own '#'.repeat(level) + text renders a whitespace-only run.
  it("does not classify a whitespace-only item as a heading, however large its font", () => {
    const pg = page(612, 792, [
      text({ text: "The Title", xPt: 50, yPt: 740, widthPt: 90, sizePt: 28 }),
      text({ text: "body line one", xPt: 50, yPt: 700, widthPt: 80 }),
      // A lone space at a heading-sized font, positioned as its own paragraph far below the body text — the same shape a spacer/leader run takes once clustered.
      text({ text: " ", xPt: 50, yPt: 500, widthPt: 20, sizePt: 22 }),
      text({ text: "trailing body", xPt: 50, yPt: 460, widthPt: 80 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    // The blank paragraph survives (its whitespace run is real content to preserve), just not as a heading.
    expect(paras.map((p) => p.styleId)).toEqual([
      "Heading1",
      undefined,
      undefined,
      undefined,
    ]);
    expect(paras.map((p) => p.headingLevel)).toEqual([
      1,
      undefined,
      undefined,
      undefined,
    ]);
  });

  // A blank item's own font size must not seed a phantom heading bucket either — it would otherwise shift a real heading's rank (a genuine Heading1 misranked to Heading2 because a spacer's own unrelated size claimed rank 1), the census-side counterpart to the per-paragraph check above. Three body lines (matching the "assigns Heading1/Heading2 by rank" fixture above) give the real 12pt body size a genuine majority over any single-occurrence size, so modeOf's own tie-break can't accidentally pick the blank spacer's or the title's size as the body size instead.
  it("excludes a whitespace-only item's font size from the heading-size census entirely", () => {
    const pg = page(612, 792, [
      // A blank spacer at 40pt, well above every real heading size present — if the census counted it, it would claim Heading1 and demote "The Title" to Heading2.
      text({ text: " ", xPt: 50, yPt: 760, widthPt: 20, sizePt: 40 }),
      text({ text: "The Title", xPt: 50, yPt: 740, widthPt: 90, sizePt: 28 }),
      text({ text: "body line one", xPt: 50, yPt: 700, widthPt: 80 }),
      text({ text: "body line two", xPt: 50, yPt: 688, widthPt: 80 }),
      text({ text: "body line three", xPt: 50, yPt: 676, widthPt: 80 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    const title = paras.find((p) => p.runs.some((r) => r.text === "The Title"));
    expect(title?.headingLevel).toBe(1);
  });

  it("leaves body text at the modal size as an ordinary paragraph, however bold", () => {
    const pg = page(612, 792, [
      text({
        text: "Bold but body-sized",
        xPt: 50,
        yPt: 700,
        widthPt: 110,
        bold: true,
      }),
      text({ text: "plain body", xPt: 50, yPt: 688, widthPt: 60 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    expect(paras).toHaveLength(1);
    expect(paras[0]!.styleId).toBeUndefined();
    expect(paras[0]!.runs[0]!.bold).toBe(true);
  });

  it("drops run-level bold on an inferred heading — the heading style carries the weight", () => {
    const pg = page(612, 792, [
      text({
        text: "The Title",
        xPt: 50,
        yPt: 740,
        widthPt: 90,
        sizePt: 28,
        bold: true,
      }),
      text({ text: "body line one", xPt: 50, yPt: 700, widthPt: 80 }),
      text({ text: "body line two", xPt: 50, yPt: 688, widthPt: 80 }),
      text({ text: "body line three", xPt: 50, yPt: 676, widthPt: 80 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [heading] = paragraphs(doc);
    expect(heading!.styleId).toBe("Heading1");
    expect(heading!.runs.every((r) => r.bold !== true)).toBe(true);
    // Dropped means the key is absent, not present-with-undefined — an explicit `bold: undefined` survives 'bold' in run and trips toStrictEqual against a key-absent object, so the dropped run must be shape-identical to a run that was never bold.
    expect(heading!.runs.every((r) => !("bold" in r))).toBe(true);
  });

  it("omits absent bold/italic on plain runs rather than writing them as explicit undefined keys", () => {
    const pg = page(612, 792, [
      text({ text: "Plain run", xPt: 50, yPt: 700, widthPt: 60 }),
      text({ text: "more", xPt: 50, yPt: 688, widthPt: 30 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.every((r) => !("bold" in r) && !("italic" in r))).toBe(
      true,
    );
  });
});

describe("reconstructWordprocessing: runs within a line", () => {
  it("inserts a tab run for a horizontal gap exceeding 2em", () => {
    const pg = page(612, 792, [
      text({ text: "Left", xPt: 50, yPt: 700, widthPt: 20 }),
      text({ text: "Right", xPt: 100, yPt: 700, widthPt: 20 }),
    ]); // gap = 100-70 = 30 > 2*12=24
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual(["Left", "\t", "Right"]);
  });

  it("inserts a plain space, not a tab, for ordinary word spacing", () => {
    const pg = page(612, 792, [
      text({ text: "Left", xPt: 50, yPt: 700, widthPt: 20 }),
      text({ text: "Right", xPt: 75, yPt: 700, widthPt: 20 }),
    ]); // gap = 5, well under the 24pt tab threshold
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual(["Left ", "Right"]);
  });

  it("does not insert anything for a directly-adjacent item with no real gap (e.g. a styling split mid-word)", () => {
    const pg = page(612, 792, [
      text({ text: "un", xPt: 50, yPt: 700, widthPt: 20, bold: true }),
      text({ text: "happy", xPt: 70, yPt: 700, widthPt: 40 }),
    ]); // gap = 0
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual(["un", "happy"]);
  });

  it("carries font, size, weight, and colour through to the run", () => {
    const pg = page(612, 792, [
      text({
        text: "Bold text",
        xPt: 50,
        yPt: 700,
        widthPt: 60,
        sizePt: 24,
        bold: true,
        family: "Times",
      }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs[0]).toMatchObject({
      text: "Bold text",
      bold: true,
      fontFamily: "Times",
      sizePt: 24,
    });
  });
});

describe("reconstructWordprocessing: duplicate-paint collapsing", () => {
  it("collapses an exact duplicate paint of the same text at (nearly) the same position to a single run", () => {
    const pg = page(612, 792, [
      text({ text: "Hello", xPt: 50, yPt: 700, widthPt: 30 }),
      // Float-noise-level repeat of the identical paint — the shape a repeated content-stream operator produces, not a deliberate second location.
      text({ text: "Hello", xPt: 50.001, yPt: 700.0008, widthPt: 30 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual(["Hello"]);
  });

  it("collapses a duplicate paint that differs from the kept occurrence only by a trailing space", () => {
    const pg = page(612, 792, [
      text({ text: "Hello ", xPt: 50, yPt: 700, widthPt: 32 }),
      text({ text: "Hello", xPt: 50, yPt: 700, widthPt: 30 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual(["Hello "]);
  });

  it("keeps two genuinely distinct words that merely sit close together, never merging them as if one were a repeat of the other", () => {
    const pg = page(612, 792, [
      text({ text: "Hello", xPt: 50, yPt: 700, widthPt: 30 }),
      text({ text: "World", xPt: 81, yPt: 700, widthPt: 30 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual(["Hello ", "World"]);
  });

  it("collapses several duplicated sub-word fragments sharing one position down to coherent text (regression: novus-power/hive#1543 — an untagged table region whose duplicated paints previously spliced into scrambled output once several such runs shared a baseline)", () => {
    const pg = page(612, 792, [
      // "co"+"mp" -> "comp", each half independently repainted several times at (almost) the same position — the exact shape the corrupted source produced ("cocococompmpmpmp") before this collapsing existed.
      text({ text: "co", xPt: 50, yPt: 700, widthPt: 10 }),
      text({ text: "co", xPt: 50.001, yPt: 700, widthPt: 10 }),
      text({ text: "co", xPt: 49.999, yPt: 700.002, widthPt: 10 }),
      text({ text: "co", xPt: 50, yPt: 700, widthPt: 10 }),
      text({ text: "mp", xPt: 60, yPt: 700, widthPt: 10 }),
      text({ text: "mp", xPt: 60.001, yPt: 700, widthPt: 10 }),
      text({ text: "mp", xPt: 59.999, yPt: 700.002, widthPt: 10 }),
      text({ text: "mp", xPt: 60, yPt: 700, widthPt: 10 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text).join("")).toBe("comp");
  });

  it("collapses a long run redrawn across a wider span (one paint per underlying table column) once its own width overlaps the next occurrence", () => {
    const pg = page(612, 792, [
      // Width (150) far exceeds the 35pt spacing to the next copy — the two occurrences would visually collide if both were genuinely distinct content, so this is the same repeated-block defect as the exact-position case above, just spread wider.
      text({
        text: "Long repeated phrase",
        xPt: 50,
        yPt: 700,
        widthPt: 150,
      }),
      text({
        text: "Long repeated phrase",
        xPt: 85,
        yPt: 700,
        widthPt: 150,
      }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual(["Long repeated phrase"]);
  });

  it("keeps a short value genuinely repeated across separate, non-overlapping table columns on one line (never collapsed merely for repeating)", () => {
    const pg = page(612, 792, [
      // Each occurrence's own width (10) sits well inside the 35pt gap to the next — no overlap at all, unlike the long-run case above, so this is a real repeated cell value (e.g. a grade table's "Op" column), not a redundant redraw.
      text({ text: "Op", xPt: 50, yPt: 700, widthPt: 10 }),
      text({ text: "Op", xPt: 85, yPt: 700, widthPt: 10 }),
      text({ text: "Op", xPt: 120, yPt: 700, widthPt: 10 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual([
      "Op",
      "\t",
      "Op",
      "\t",
      "Op",
    ]);
  });

  it("drops an exact duplicate paint of a zero-width item at the identical position, a case the overlap-based dedup below can never catch since a zero-width item never overlaps its own repeat", () => {
    const pg = page(612, 792, [
      text({ text: "X", xPt: 50, yPt: 700, widthPt: 0 }),
      text({ text: "X", xPt: 50, yPt: 700, widthPt: 0 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual(["X"]);
  });

  it("keeps two zero-width same-text items whose duplicate-paint position bucket genuinely differs, proving the bucket is measured from real division rather than a coarser scale", () => {
    const pg = page(612, 792, [
      text({ text: "AB", xPt: 50, yPt: 700, widthPt: 3 }),
      // 4pt away: comfortably outside the 0.1pt duplicate-paint bucket, and outside item 1's own 3pt-wide extent, so this is genuinely distinct content, not float noise.
      text({ text: "AB", xPt: 54, yPt: 700, widthPt: 3 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text).join("")).toBe("AB AB");
  });

  it("keeps two zero-width same-text items at the same x but a y position genuinely outside the duplicate-paint bucket, proving the y bucket is measured from real division too", () => {
    const pg = page(612, 792, [
      text({ text: "CD", xPt: 50, yPt: 700, widthPt: 0 }),
      // Same x (so a zero-width item never overlaps its own repeat, keeping the overlap-based dedup below out of this), 4pt away in y — comfortably outside the 0.1pt bucket, and still within baseline tolerance so both land on one clustered line.
      text({ text: "CD", xPt: 50, yPt: 704, widthPt: 0 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual(["CD", "CD"]);
  });

  it("drops a duplicate paint that differs from the kept occurrence only by a trailing space, when the two are far enough apart that the overlap-based dedup below cannot also catch it", () => {
    const pg = page(612, 792, [
      text({ text: "Hello ", xPt: 50, yPt: 700, widthPt: 0 }),
      text({ text: "Hello", xPt: 50, yPt: 700, widthPt: 0 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual(["Hello "]);
  });

  it("drops an overlapping repeat whose own position sits far enough from the kept occurrence that the duplicate-paint position bucket above cannot also catch it", () => {
    const pg = page(612, 792, [
      text({ text: "Hello ", xPt: 50, yPt: 700, widthPt: 30 }),
      // 5pt away (outside the 0.1pt duplicate-paint bucket) but still inside the kept occurrence's own 30pt-wide extent, so only the overlap-based dedup, not the position-bucket one, can catch this.
      text({ text: "Hello", xPt: 55, yPt: 700, widthPt: 30 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual(["Hello "]);
  });

  it("keeps a repeat that starts exactly at the kept occurrence's own right edge, the boundary at which touching stops being overlapping", () => {
    const pg = page(612, 792, [
      text({ text: "Op", xPt: 50, yPt: 700, widthPt: 10 }),
      // Starts at exactly 60 (50 + 10) — touching, not overlapping: a real table never lays out two cells this close unless they are genuinely distinct.
      text({ text: "Op", xPt: 60, yPt: 700, widthPt: 10 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual(["Op", "Op"]);
  });
});
