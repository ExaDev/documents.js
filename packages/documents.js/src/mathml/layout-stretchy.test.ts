import { describe, expect, it } from "vitest";
import { loadMathFont } from "pdf-codec";
import { layoutFormula } from "./layout";
import { operatorProperties } from "./operators";
import type {
  MathAssembledGlyphs,
  MathFontMetrics,
  MathGlyphRun,
} from "document-schema.js";
import type { MathMlElement, MathMlNode } from "./nodes";
const SIZE_PT = 12;
function metrics() {
  return loadMathFont().metricsAt(SIZE_PT);
}
const BLACK = { r: 0, g: 0, b: 0 };

function el(
  tag: string,
  children: MathMlNode[] = [],
  attributes: readonly { readonly name: string; readonly value: string }[] = [],
): MathMlElement {
  return { type: "element", tag, attributes, children };
}
function text(value: string): MathMlNode {
  return { type: "text", value };
}
function mi(name: string): MathMlElement {
  return el("mi", [text(name)]);
}
function mn(value: string): MathMlElement {
  return el("mn", [text(value)]);
}
function mo(value: string): MathMlElement {
  return el("mo", [text(value)]);
}
function glyphRuns(
  items: readonly { readonly kind: string }[],
): MathGlyphRun[] {
  return items.filter((i): i is MathGlyphRun => i.kind === "glyphs");
}
function assembled(
  items: readonly { readonly kind: string }[],
): MathAssembledGlyphs[] {
  return items.filter(
    (i): i is MathAssembledGlyphs => i.kind === "assembled-glyphs",
  );
}

// A one-element fraction, tall enough that a fence around it selects a larger construction — the same "make the content tall" trick nestedFraction uses, kept small so the tests that only need SOME stretching stay fast.
function fraction123(): MathMlElement {
  return el("mfrac", [mn("1"), mn("2")]);
}

// An mtd cell wrapping arbitrary content, and an mtr of digit cells, for the table tests outside the mtable describe's own scope.
function layoutRoot(
  root: MathMlElement,
  font: MathFontMetrics = metrics(),
): MathBoxLike {
  return layoutFormula([root], {
    metrics: font,
    sizePt: SIZE_PT,
    color: BLACK,
  }).box;
}

// The same layout at the size a first-level script renders at (scriptPercentScaleDown of the base size) — a construct nested inside a sub/superscript or an over/under script must be measured at its own reduced size, not the formula's root size.
function layoutAtScriptSize(root: MathMlElement): MathBoxLike {
  return layoutFormula([root], {
    metrics: metrics(),
    sizePt: metrics().scriptPercentScaleDown * SIZE_PT,
    color: BLACK,
  }).box;
}

// The box shape returned by layoutFormula, named locally so the geometry sections below can take measured sub-layouts as parameters without importing the schema's own MathBox as a value-level symbol.
interface MathBoxLike {
  readonly widthPt: number;
  readonly heightPt: number;
  readonly ascentPt: number;
  readonly descentPt: number;
  readonly items: readonly { readonly kind: string }[];
}

describe("layoutFormula: stretchy fences", () => {
  const font = loadMathFont().font;
  const LEFT_PAREN_PIECES = [0x239d, 0x239c, 0x239b]; // lower hook, extension, upper hook — bottom to top
  const RIGHT_PAREN_PIECES = [0x239e, 0x239f, 0x23a0]; // upper hook, extension, lower hook (Unicode names the right-hand pieces top-first)
  const LEFT_BRACKET_PIECES = [0x23a3, 0x23a2, 0x23a1]; // LEFT SQUARE BRACKET LOWER CORNER / EXTENSION / UPPER CORNER

  function fenced(
    inner: MathMlElement,
    open = "(",
    close = ")",
  ): MathMlElement {
    return el("mrow", [mo(open), inner, mo(close)]);
  }
  // A fraction whose numerator is itself a fraction, nested `depth` times — the tallest thing this test can build out of ordinary MathML, and the only way to push a fence past the largest pre-built variant the font offers (3821 design units, 45.85pt at 12pt) into a genuine part assembly.
  function nestedFraction(depth: number): MathMlElement {
    let numerator: MathMlElement = mn("1");
    for (let i = 0; i < depth; i++) {
      numerator = el("mfrac", [numerator, mn("2")]);
    }
    return numerator;
  }
  function layout(root: MathMlElement) {
    return layoutFormula([root], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
  }

  it("leaves an ordinary inline fence as a text glyph run, since the base glyph already covers its content", () => {
    const box = layout(fenced(mi("x")));
    // Nothing to assemble: 'x' is well inside the base parenthesis, so the operator keeps its real Unicode text — which is what keeps a plain (x) extracting as "(x)" from the resulting PDF.
    expect(assembled(box.items)).toHaveLength(0);
    expect(glyphRuns(box.items).map((run) => run.text)).toContain("(");
    expect(glyphRuns(box.items).map((run) => run.text)).toContain(")");
  });

  it("selects a larger pre-built variant glyph for a fence around a single fraction", () => {
    const box = layout(fenced(nestedFraction(1)));
    const items = assembled(box.items);
    expect(items).toHaveLength(2);
    // One glyph each: a pre-built variant, not an assembly — a single-level fraction is well within the sizes STIX Two Math draws by hand.
    expect(items.map((item) => item.placements.length)).toEqual([1, 1]);
    expect(items.map((item) => item.text)).toEqual(["(", ")"]);
    // A genuinely different glyph from the base parenthesis, and from each other (the font draws left and right separately).
    const drawn = items.map((item) => item.placements[0]!.glyphId);
    expect(drawn[0]).not.toBe(font.glyphId(0x28));
    expect(drawn[1]).not.toBe(font.glyphId(0x29));
    expect(drawn[0]).not.toBe(drawn[1]);
  });

  it("assembles a fence from the font's own real parts once no pre-built variant is large enough", () => {
    const box = layout(fenced(nestedFraction(4)));
    const [open, close] = assembled(box.items);
    expect(open).toBeDefined();
    expect(close).toBeDefined();

    // Bottom hook, one or more extension pieces, top hook — identified by the Unicode code points of the pieces themselves, so this checks the engine picked the real parenthesis parts in the real bottom-to-top order the font lists them in.
    const openGlyphs = open!.placements.map((placement) => placement.glyphId);
    expect(openGlyphs.length).toBeGreaterThan(2);
    expect(openGlyphs[0]).toBe(font.glyphId(LEFT_PAREN_PIECES[0]!));
    expect(openGlyphs[openGlyphs.length - 1]).toBe(
      font.glyphId(LEFT_PAREN_PIECES[2]!),
    );
    expect(new Set(openGlyphs.slice(1, -1))).toEqual(
      new Set([font.glyphId(LEFT_PAREN_PIECES[1]!)]),
    );
    expect(close!.placements.map((p) => p.glyphId)[0]).toBe(
      font.glyphId(RIGHT_PAREN_PIECES[2]!),
    );
    expect(close!.placements.map((p) => p.glyphId).at(-1)).toBe(
      font.glyphId(RIGHT_PAREN_PIECES[0]!),
    );

    // Parts are laid down bottom to top, so in the box's own y-down space each successive placement sits strictly HIGHER (smaller yPt) than the one before it, and they all share one x.
    const ys = open!.placements.map((placement) => placement.yPt);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]!).toBeLessThan(ys[i - 1]!);
    }
    expect(
      new Set(open!.placements.map((placement) => placement.xPt)).size,
    ).toBe(1);
  });

  it("assembles a square bracket from its own square-bracket parts, not the parenthesis ones", () => {
    const box = layout(fenced(nestedFraction(4), "[", "]"));
    const [open] = assembled(box.items);
    const glyphs = open!.placements.map((placement) => placement.glyphId);
    expect(glyphs[0]).toBe(font.glyphId(LEFT_BRACKET_PIECES[0]!));
    expect(glyphs.at(-1)).toBe(font.glyphId(LEFT_BRACKET_PIECES[2]!));
    expect(new Set(glyphs.slice(1, -1))).toEqual(
      new Set([font.glyphId(LEFT_BRACKET_PIECES[1]!)]),
    );
  });

  it("sizes the assembly to the actual content height, adding parts as the content grows", () => {
    const partCounts = [4, 6, 8].map(
      (depth) =>
        assembled(layout(fenced(nestedFraction(depth))).items)[0]!.placements
          .length,
    );
    for (let i = 1; i < partCounts.length; i++) {
      expect(partCounts[i]!).toBeGreaterThan(partCounts[i - 1]!);
    }
  });

  it("makes the fence at least as tall as the content it wraps, and no shorter than the base glyph was", () => {
    const inner = nestedFraction(4);
    const contentBox = layout(inner);
    const fencedBox = layout(fenced(inner));
    expect(fencedBox.ascentPt).toBeGreaterThanOrEqual(contentBox.ascentPt);
    expect(fencedBox.descentPt).toBeGreaterThanOrEqual(contentBox.descentPt);
    // The whole row is now as tall as the fence rather than as tall as the fraction, since a symmetric fence overshoots whichever side of the axis is shorter.
    expect(fencedBox.heightPt).toBeGreaterThan(contentBox.heightPt);
  });

  it("centres a stretched fence on the maths axis rather than on the text baseline", () => {
    // A symmetric fence's own ascent and descent are (axis + h/2) and (h/2 - axis), so their difference is twice the axis height whatever h turns out to be — and because a symmetric fence always covers the content on both sides of the axis, the whole fenced row inherits that same difference. A baseline-aligned fence would instead show almost all of its height as ascent, so this is a real discriminator, not a tautology.
    //
    // The residual tolerance is one font design unit (0.012pt at 12pt): a construction's own measured INK is a design unit or two shorter than the nominal advance the assembly model reaches its target with, so the fence can end up a hair shorter than the content's own descent on one side, which the row's own max() then keeps.
    const oneDesignUnitPt = SIZE_PT / loadMathFont().font.descriptor.unitsPerEm;
    for (const depth of [1, 4, 6]) {
      const box = layout(fenced(nestedFraction(depth)));
      expect(assembled(box.items)).toHaveLength(2);
      expect(
        Math.abs(box.ascentPt - box.descentPt - 2 * metrics().axisHeightPt),
      ).toBeLessThanOrEqual(oneDesignUnitPt);
      // Not merely baseline-aligned: a tall fence genuinely descends well below the baseline.
      expect(box.descentPt).toBeGreaterThan(metrics().axisHeightPt);
    }
  });

  it("sizes every stretchy fence in a row to the row's own content, never to each other", () => {
    // The target is the maximum extent of the row's NON-stretchy children, so adding more fences around the same fraction cannot change any of them: the outer parenthesis assembles identically whether it is alone or wrapped around three further fences. Sizing to each other would make each successive fence grow.
    const inner = nestedFraction(4);
    const alone = assembled(layout(fenced(inner)).items);
    const nested = assembled(
      layout(el("mrow", [mo("("), mo("["), inner, mo("]"), mo(")")])).items,
    );
    expect(nested).toHaveLength(4);
    // Compared on glyph ID and vertical placement: only xPt legitimately differs, since the extra inner fences push the closing one further right along the row.
    const vertical = (item: MathAssembledGlyphs) =>
      item.placements.map((placement) => ({
        glyphId: placement.glyphId,
        yPt: placement.yPt,
      }));
    expect(vertical(nested[0]!)).toEqual(vertical(alone[0]!));
    expect(vertical(nested.at(-1)!)).toEqual(vertical(alone[1]!));
    // The mirrored halves of one pair are the same construction drawn from the font's own left- and right-hand pieces, so they span identically even though every glyph ID differs.
    const span = (item: MathAssembledGlyphs) =>
      Math.abs(item.placements[0]!.yPt - item.placements.at(-1)!.yPt);
    expect(span(alone[1]!)).toBeCloseTo(span(alone[0]!), 9);
    expect(alone[1]!.placements.map((p) => p.glyphId)).not.toEqual(
      alone[0]!.placements.map((p) => p.glyphId),
    );
  });

  it('honours an explicit stretchy="false" on the operator', () => {
    const inner = nestedFraction(4);
    const stretchyOff = el("mrow", [
      el("mo", [text("(")], [{ name: "stretchy", value: "false" }]),
      inner,
      mo(")"),
    ]);
    const items = assembled(
      layoutFormula([stretchyOff], {
        metrics: metrics(),
        sizePt: SIZE_PT,
        color: BLACK,
      }).box.items,
    );
    expect(items).toHaveLength(1); // only the closing fence stretched
    expect(items[0]!.text).toBe(")");
  });

  it("never stretches a big operator, whose display size comes from largeop rather than from its row", () => {
    // STIX Two Math does declare vertical MathVariants for the summation sign, so this only holds because the operator dictionary correctly reports it as non-stretchy (see operators.ts's own bigOperatorMovable note).
    const box = layout(el("mrow", [mo("∑"), nestedFraction(4)]));
    expect(assembled(box.items)).toHaveLength(0);
  });

  it("leaves a stretchy operator alone when there is nothing else in the row to stretch to", () => {
    const box = layout(el("mrow", [mo("("), mo(")")]));
    expect(assembled(box.items)).toHaveLength(0);
    expect(glyphRuns(box.items).map((run) => run.text)).toEqual(["(", ")"]);
  });
});

// Horizontal stretchy-glyph assembly for an over/under-brace (U+23DE/U+23DF) spanning its own munder/mover/munderover base — stretchOperator/stretchedBox's horizontal-axis sibling, stretchHorizontalOperator/horizontallyStretchedBox, exercised via layoutUnderOverChild.
//
// The over/under script of a munder/mover is laid out in scriptContext (a reduced sizePt, scriptPercentScaleDown of the outer size — see layoutUnderOverElement), so the base/variant/assembly breakpoints below are NOT the same target widths that would trigger each outcome for a bare mo at the outer sizePt: the font's own base-glyph advance and every pre-built variant size are all measured at that SAME reduced size, which this suite's own breakpoint probing (against the real embedded font, not guessed) confirmed shifts every threshold narrower. `wideBase(charCount)` mirrors nestedFraction's own "make a real MathML construct wide/tall enough to force a stretch" trick, but growing WIDTH via a flat mrow of single-character mi's rather than height via nested fractions.
describe("layoutFormula: horizontal stretchy over/under-brace", () => {
  const OVER = "⏞"; // U+23DE TOP CURLY BRACKET
  const UNDER = "⏟"; // U+23DF BOTTOM CURLY BRACKET

  // A flat row of `charCount` single-character mi's — width grows roughly linearly with charCount, with no ceiling the way a fixed-glyph base would have, letting this reach clean base/variant/assembly breakpoints purely by choosing charCount.
  function wideBase(charCount: number): MathMlElement {
    const letters = "xyzabcuvwpqrstklmn";
    const children: MathMlElement[] = [];
    for (let i = 0; i < charCount; i++) {
      children.push(mi(letters[i % letters.length]!));
    }
    return el("mrow", children);
  }
  function over(base: MathMlElement, operator: string = OVER): MathMlElement {
    return el("mover", [base, mo(operator)]);
  }
  function under(base: MathMlElement, operator: string = UNDER): MathMlElement {
    return el("munder", [base, mo(operator)]);
  }
  function layout(root: MathMlElement) {
    return layoutFormula([root], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
  }

  it("leaves the brace as an ordinary unstretched glyph run over a narrow base", () => {
    // A single narrow mi (empirically ~3.29pt wide at SIZE_PT, well under the ~5.3pt base-glyph advance the font reports for this brace at the over-script's own reduced sizePt) leaves nothing for the font to stretch to.
    const { box, diagnostics } = layoutFormula([over(mi("i"))], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(diagnostics).toEqual([]);
    expect(assembled(box.items)).toHaveLength(0);
    expect(glyphRuns(box.items).map((run) => run.text)).toContain(OVER);
  });

  it("selects a larger pre-built horizontal variant for a moderately wide base", () => {
    // wideBase(2) (empirically measured, real font): the brace's own font-reported stretch kind is 'variant' here, one pre-built glyph rather than a genuine multi-part assembly.
    const box = layout(over(wideBase(2)));
    const items = assembled(box.items);
    expect(items).toHaveLength(1);
    expect(items[0]!.placements).toHaveLength(1);
    expect(items[0]!.text).toBe(OVER);
  });

  it("assembles the brace from real multi-part construction once the base is wide enough", () => {
    // wideBase(5) already crosses into 'assembly' (empirically confirmed against the real font — the pre-built variants top out well before this width), giving several placements sharing one y and strictly increasing x, the first at x=0.
    const box = layout(over(wideBase(5)));
    const [item] = assembled(box.items);
    expect(item).toBeDefined();
    expect(item!.placements.length).toBeGreaterThan(1);

    const ys = new Set(item!.placements.map((p) => p.yPt));
    expect(ys.size).toBe(1); // every part of a horizontal assembly shares one baseline y

    expect(item!.placements[0]!.xPt).toBeCloseTo(0, 6);
    const xs = item!.placements.map((p) => p.xPt);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
    }
  });

  it("grows the assembly part count as the base widens further", () => {
    // Empirically confirmed strictly increasing part counts against the real font at these widths: 5, then 11, then 23.
    const counts = [5, 10, 20].map(
      (n) => assembled(layout(over(wideBase(n))).items)[0]!.placements.length,
    );
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!).toBeGreaterThan(counts[i - 1]!);
    }
  });

  it("gives the brace a small, shallow vertical footprint regardless of how far it stretches", () => {
    // horizontallyStretchedBox's own ascentPt/descentPt come directly from the construction's real, unclamped ink — which stays a small, roughly constant vertical extent (a handful of points) however wide the assembly grows, since only the WIDTH axis is being stretched. Recovered indirectly: layoutUnderOver's own ascentPt is base.ascentPt + stackGapMinPt + over.heightPt, so subtracting the bare base's own ascent and the font's own stackGapMinPt from the combined box's ascent recovers the brace's own heightPt without any internal export.
    const gapPt = metrics().stackGapMinPt;
    for (const n of [1, 5, 10, 20, 30]) {
      const base = wideBase(n);
      const baseAscentPt = layout(base).ascentPt;
      const combinedAscentPt = layout(over(base)).ascentPt;
      const braceHeightPt = combinedAscentPt - baseAscentPt - gapPt;
      expect(braceHeightPt).toBeGreaterThan(0);
      expect(braceHeightPt).toBeLessThan(SIZE_PT / 2); // "small" relative to the formula's own font size, not merely finite
    }
  });

  it("mirrors the over-brace on the opposite side of the base, with the opposite ink-sign convention", () => {
    // Verified empirically against the real font rather than assumed: the over-brace's own ink sits almost entirely ABOVE its natural drawing origin (a positive ascent, a NEGATIVE descent), while the under-brace's sits almost entirely BELOW its own origin (a negative ascent, a positive descent) — genuinely opposite fields, not a mirrored pair of the same sign.
    const overResult = metrics().stretch(
      OVER.codePointAt(0)!,
      "horizontal",
      40,
      SIZE_PT,
    )!;
    const underResult = metrics().stretch(
      UNDER.codePointAt(0)!,
      "horizontal",
      40,
      SIZE_PT,
    )!;
    expect(overResult).toBeDefined();
    expect(underResult).toBeDefined();

    expect(overResult.inkAscentPt).toBeGreaterThan(0);
    expect(overResult.inkDescentPt).toBeLessThan(0);

    expect(underResult.inkAscentPt).toBeLessThan(0);
    expect(underResult.inkDescentPt).toBeGreaterThan(0);

    // And the corresponding munder/mover boxes place the brace on the correct side: an overscript run sits above the base's own baseline, an underscript run below it.
    const overRun = glyphRuns(layout(over(mi("i"))).items).find(
      (r) => r.text === OVER,
    )!;
    const baseRunOver = glyphRuns(layout(over(mi("i"))).items).find(
      (r) => r.text.codePointAt(0) === 0x1d456,
    )!; // MATHEMATICAL ITALIC SMALL I
    expect(overRun.yPt).toBeLessThan(baseRunOver.yPt);

    const underRun = glyphRuns(layout(under(mi("i"))).items).find(
      (r) => r.text === UNDER,
    )!;
    const baseRunUnder = glyphRuns(layout(under(mi("i"))).items).find(
      (r) => r.text.codePointAt(0) === 0x1d456,
    )!;
    expect(underRun.yPt).toBeGreaterThan(baseRunUnder.yPt);
  });

  it("munderover stretches an over-brace and an under-brace independently, both reaching close to the same target width", () => {
    const base = wideBase(10);
    const construct = el("munderover", [base, mo(UNDER), mo(OVER)]);
    const { box, diagnostics } = layoutFormula([construct], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(diagnostics).toEqual([]);
    const items = assembled(box.items);
    const overItem = items.find((item) => item.text === OVER);
    const underItem = items.find((item) => item.text === UNDER);
    expect(overItem).toBeDefined();
    expect(underItem).toBeDefined();
    expect(overItem!.placements.length).toBeGreaterThan(1);
    // Both scripts stretch to the identical target (the base's own width), independently — no shared/synchronised sizing between munderover's two scripts is needed for them to land on the same part count.
    expect(underItem!.placements.length).toBe(overItem!.placements.length);
    const overSpanPt = overItem!.placements.at(-1)!.xPt;
    const underSpanPt = underItem!.placements.at(-1)!.xPt;
    expect(overSpanPt).toBeCloseTo(underSpanPt, 1);
  });

  it('honours an explicit stretchy="false" override on the brace operator', () => {
    // wideBase(20) is comfortably within assembly range for an unconstrained brace (see the part-count-growth test above), so this proves the override actually suppresses real stretching rather than merely landing below some threshold by coincidence.
    const construct = el("mover", [
      wideBase(20),
      el("mo", [text(OVER)], [{ name: "stretchy", value: "false" }]),
    ]);
    const box = layoutFormula([construct], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
    expect(assembled(box.items)).toHaveLength(0);
    expect(glyphRuns(box.items).map((run) => run.text)).toContain(OVER);
  });

  it("leaves the brace unstretched over a genuinely empty base", () => {
    const construct = over(el("mrow", []));
    const box = layoutFormula([construct], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
    expect(assembled(box.items)).toHaveLength(0);
    expect(glyphRuns(box.items).map((run) => run.text)).toContain(OVER);
  });

  it("composes with a nested vertical stretchy fence in its own base, proving the two stretch mechanisms do not interfere", () => {
    // A vertical fence around the same wideBase(10) that already forces horizontal assembly on its own (see the part-count-growth test) — both mechanisms must fire together: the parenthesis pair stretches vertically to the row's own content height, and the over-brace stretches horizontally to the whole base's own width, in the same layout pass.
    const base = wideBase(10);
    const fencedBase = el("mrow", [mo("("), base, mo(")")]);
    const { box, diagnostics } = layoutFormula([over(fencedBase)], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(diagnostics).toEqual([]);
    const items = assembled(box.items);
    expect(items).toHaveLength(3); // '(', ')', and the over-brace, all genuinely stretched
    const texts = items.map((item) => item.text).sort();
    expect(texts).toEqual([")", "(", OVER].sort());
    for (const item of items) {
      expect(item.placements.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("layoutFormula: operator spacing and row gaps", () => {
  it("gives the row's own first child no leading gap: a lone operator's width is exactly its glyph advance", () => {
    // '+' carries a non-zero lspace in the operator dictionary, so this pins that lspace contributes nothing BEFORE the first child — there is nothing to its left to space against.
    const box = layoutRoot(mo("+"));
    expect(box.widthPt).toBeCloseTo(
      metrics().glyph("+".codePointAt(0)!, SIZE_PT)!.advanceWidthPt,
      6,
    );
  });

  it("adds exactly the operator's own lspace before it when the operator follows a token", () => {
    const m = metrics();
    const plusAdvancePt = m.glyph("+".codePointAt(0)!, SIZE_PT)!.advanceWidthPt;
    const xWidthPt = layoutRoot(mi("x")).widthPt;
    const lspacePt = operatorProperties("+").lspaceEm * SIZE_PT;
    expect(layoutRoot(el("mrow", [mi("x"), mo("+")])).widthPt).toBeCloseTo(
      xWidthPt + plusAdvancePt + lspacePt,
      6,
    );
  });

  it("adds exactly the operator's own rspace after it when a token follows the operator", () => {
    const m = metrics();
    const plusAdvancePt = m.glyph("+".codePointAt(0)!, SIZE_PT)!.advanceWidthPt;
    const xWidthPt = layoutRoot(mi("x")).widthPt;
    const rspacePt = operatorProperties("+").rspaceEm * SIZE_PT;
    expect(layoutRoot(el("mrow", [mo("+"), mi("x")])).widthPt).toBeCloseTo(
      plusAdvancePt + rspacePt + xWidthPt,
      6,
    );
  });

  it("applies lspace and rspace independently on either side of one operator between two tokens", () => {
    const m = metrics();
    const plusAdvancePt = m.glyph("+".codePointAt(0)!, SIZE_PT)!.advanceWidthPt;
    const xWidthPt = layoutRoot(mi("x")).widthPt;
    const yWidthPt = layoutRoot(mi("y")).widthPt;
    const spacing = operatorProperties("+");
    expect(
      layoutRoot(el("mrow", [mi("x"), mo("+"), mi("y")])).widthPt,
    ).toBeCloseTo(
      xWidthPt +
        plusAdvancePt +
        yWidthPt +
        (spacing.lspaceEm + spacing.rspaceEm) * SIZE_PT,
      6,
    );
  });

  it("a non-operator element contributes no spacing of its own between two tokens", () => {
    const xWidthPt = layoutRoot(mi("x")).widthPt;
    const yWidthPt = layoutRoot(mi("y")).widthPt;
    expect(
      layoutRoot(el("mrow", [mi("x"), el("mrow", []), mi("y")])).widthPt,
    ).toBeCloseTo(xWidthPt + yWidthPt, 6);
  });

  it("trims padded operator text before both rendering it and resolving its dictionary entry", () => {
    // A producer writing <mo> + </mo> with whitespace must get the dictionary's '+' spacing and a run holding exactly "+", exactly as the unpadded spelling does.
    const padded = el("mo", [text(" + ")]);
    const unpaddedWidthPt = layoutRoot(
      el("mrow", [mi("x"), mo("+"), mi("y")]),
    ).widthPt;
    expect(
      layoutRoot(el("mrow", [mi("x"), padded, mi("y")])).widthPt,
    ).toBeCloseTo(unpaddedWidthPt, 6);
    const [run] = glyphRuns(layoutRoot(padded).items);
    expect(run!.text).toBe("+");
  });

  it("a padded stretchy fence still stretches, and its assembled text is the trimmed operator", () => {
    const paddedRow = el("mrow", [
      el("mo", [text(" ( ")]),
      fraction123(),
      el("mo", [text(" ) ")]),
    ]);
    const items = assembled(layoutRoot(paddedRow).items);
    expect(items.map((item) => item.text).sort()).toEqual(["(", ")"]);
  });
});

describe("layoutFormula: which operators stretch", () => {
  it("an mi whose content is a fence character is a token, not an operator, and never stretches", () => {
    // isStretchyOperator gates on the element's own name, not on its text: an <mi>(</mi> next to tall content stays a plain run even though "(" is stretchy in the operator dictionary.
    const row = el("mrow", [mi("("), fraction123()]);
    const box = layoutRoot(row);
    expect(assembled(box.items)).toHaveLength(0);
    expect(glyphRuns(box.items).map((run) => run.text)).toContain("(");
  });

  it("a row consisting only of stretchy operators stretches none of them, even against a font that always offers a construction", () => {
    // The stretch target is the row's NON-stretchy children, of which this row has none — so no fence may grow, however willing the font is. The synthetic metrics port guarantees willingness, so the assertion cannot pass by the real font's coincidental inability to build a small construction.
    const alwaysStretch: MathFontMetrics = {
      ...metrics(),
      stretch: (codePoint, _axis, targetSizePt) => ({
        kind: "variant",
        sizePt: targetSizePt,
        advanceWidthPt: 4,
        inkAscentPt: targetSizePt / 2,
        inkDescentPt: targetSizePt / 2,
        placements: [{ glyphId: codePoint, offsetPt: 0 }],
      }),
    };
    const box = layoutRoot(el("mrow", [mo("("), mo(")")]), alwaysStretch);
    expect(assembled(box.items)).toHaveLength(0);
    expect(glyphRuns(box.items).map((run) => run.text)).toEqual(["(", ")"]);
  });

  it("a mixed row stretches exactly its stretchy operators and leaves the token untouched", () => {
    const alwaysStretch: MathFontMetrics = {
      ...metrics(),
      stretch: (codePoint, axis, targetSizePt) => ({
        kind: "variant",
        sizePt: targetSizePt,
        advanceWidthPt: 4,
        inkAscentPt: targetSizePt / 2,
        inkDescentPt: targetSizePt / 2,
        placements: [{ glyphId: codePoint, offsetPt: 0 }],
      }),
    };
    const items = assembled(
      layoutRoot(el("mrow", [mo("("), mi("x"), mo(")")]), alwaysStretch).items,
    );
    expect(items.map((item) => item.text).sort()).toEqual(["(", ")"]);
  });
});

describe("layoutFormula: display style and script scaling", () => {
  // The OpenType MATH fraction shifts, restated from the metrics port rather than imported from layout.ts: shift = max(font shift for the style, axis + rule/2 + gap + content extent).
  function expectedNumeratorShiftUpPt(
    m: MathFontMetrics,
    ruleThicknessPt: number,
    numeratorDescentPt: number,
    display: boolean,
  ): number {
    return Math.max(
      display
        ? m.fractionNumeratorDisplayShiftUpPt
        : m.fractionNumeratorShiftUpPt,
      m.axisHeightPt +
        ruleThicknessPt / 2 +
        m.fractionNumeratorGapMinPt +
        numeratorDescentPt,
    );
  }

  it("root level is display style: a fraction's numerator uses the font's display shift", () => {
    const m = metrics();
    const numeratorBox = layoutRoot(mi("a"));
    const shiftUpPt = expectedNumeratorShiftUpPt(
      m,
      m.fractionRuleThicknessPt,
      numeratorBox.descentPt,
      true,
    );
    expect(layoutRoot(el("mfrac", [mi("a"), mi("b")])).ascentPt).toBeCloseTo(
      shiftUpPt + numeratorBox.ascentPt,
      6,
    );
  });

  it('mstyle displaystyle="false" switches nested constructs out of display style', () => {
    const m = metrics();
    const numeratorBox = layoutRoot(mi("a"));
    const shiftUpPt = expectedNumeratorShiftUpPt(
      m,
      m.fractionRuleThicknessPt,
      numeratorBox.descentPt,
      false,
    );
    const styled = el(
      "mstyle",
      [el("mfrac", [mi("a"), mi("b")])],
      [{ name: "displaystyle", value: "false" }],
    );
    expect(layoutRoot(styled).ascentPt).toBeCloseTo(
      shiftUpPt + numeratorBox.ascentPt,
      6,
    );
  });

  it('mstyle displaystyle="true" restores display style inside an already non-display context', () => {
    // A fraction's own children are non-display; an mstyle around the inner fraction must win that back. Both variants are asserted absolutely against the measured inner boxes (each measured standalone under an mstyle forcing its own style), because the outer fraction's own shift term also reacts to the inner box's descent.
    const m = metrics();
    const numeratorWith = layoutRoot(
      el(
        "mstyle",
        [el("mfrac", [mi("a"), mi("b")])],
        [{ name: "displaystyle", value: "true" }],
      ),
    );
    const numeratorWithout = layoutRoot(
      el(
        "mstyle",
        [el("mfrac", [mi("a"), mi("b")])],
        [{ name: "displaystyle", value: "false" }],
      ),
    );
    // The outer fraction sits at root level, so its own shift uses the display term.
    const outerShift = (numerator: MathBoxLike) =>
      Math.max(
        m.fractionNumeratorDisplayShiftUpPt,
        m.axisHeightPt +
          m.fractionRuleThicknessPt / 2 +
          m.fractionNumeratorGapMinPt +
          numerator.descentPt,
      );
    const withRestore = el("mfrac", [
      el(
        "mstyle",
        [el("mfrac", [mi("a"), mi("b")])],
        [{ name: "displaystyle", value: "true" }],
      ),
      mi("b"),
    ]);
    const withoutRestore = el("mfrac", [
      el("mfrac", [mi("a"), mi("b")]),
      mi("b"),
    ]);
    expect(layoutRoot(withRestore).ascentPt).toBeCloseTo(
      outerShift(numeratorWith) + numeratorWith.ascentPt,
      6,
    );
    expect(layoutRoot(withoutRestore).ascentPt).toBeCloseTo(
      outerShift(numeratorWithout) + numeratorWithout.ascentPt,
      6,
    );
  });

  it("an unrecognised displaystyle value changes nothing: the inherited style stands", () => {
    const plain = layoutRoot(el("mfrac", [mi("a"), mi("b")])).ascentPt;
    const bogus = layoutRoot(
      el(
        "mstyle",
        [el("mfrac", [mi("a"), mi("b")])],
        [{ name: "displaystyle", value: "perhaps" }],
      ),
    ).ascentPt;
    expect(bogus).toBeCloseTo(plain, 6);
  });

  it("a root-level movablelimits operator stacks its limit under the base in display style", () => {
    // Display style renders \sum_{0} as a genuine under-script centred under the sign. The under script itself renders at script size, so its width is measured at that size; a sub/sup placement would instead put the limit flush after the sign's full advance.
    const sumWidthPt = layoutRoot(mo("∑")).widthPt;
    const zeroWidthPt = layoutAtScriptSize(mn("0")).widthPt;
    const box = layoutRoot(el("munder", [mo("∑"), mn("0")]));
    const zeroRun = glyphRuns(box.items).find((run) => run.text === "0")!;
    expect(zeroRun.xPt).toBeCloseTo((sumWidthPt - zeroWidthPt) / 2, 6);
  });

  it("scripts render at scriptPercentScaleDown of the base size, and script-script size at the second level", () => {
    const m = metrics();
    const sub = glyphRuns(
      layoutRoot(el("msub", [mi("x"), mn("1")])).items,
    ).find((run) => run.text === "1")!;
    expect(sub.sizePt).toBeCloseTo(m.scriptPercentScaleDown * SIZE_PT, 6);

    // mroot's degree is two script levels deep.
    const degree = glyphRuns(
      layoutRoot(el("mroot", [mi("x"), mn("3")])).items,
    ).find((run) => run.text === "3")!;
    expect(degree.sizePt).toBeCloseTo(
      m.scriptPercentScaleDown * m.scriptScriptPercentScaleDown * SIZE_PT,
      6,
    );

    // A script nested inside a script of its own reaches the second level the same way.
    const nested = glyphRuns(
      layoutRoot(el("msub", [mi("x"), el("msub", [mi("y"), mn("1")])])).items,
    ).find((run) => run.text === "1")!;
    expect(nested.sizePt).toBeCloseTo(
      m.scriptPercentScaleDown * m.scriptScriptPercentScaleDown * SIZE_PT,
      6,
    );
  });

  it("a script context is not display style: a movablelimits munder inside a subscript renders its limit as a plain subscript", () => {
    // Inside the subscript, the ∑'s own munder takes the non-display branch (limit as subscript, horizontally after the sign) rather than stacking. The whole munder renders at the script's reduced size, so the sign's advance is measured at that size too.
    const box = layoutRoot(
      el("msub", [mi("x"), el("munder", [mo("∑"), mn("0")])]),
    );
    const runs = glyphRuns(box.items);
    const sumRun = runs.find((run) => run.text === "∑")!;
    const limitRun = runs.find((run) => run.text === "0")!;
    const sumWidthPt = layoutAtScriptSize(mo("∑")).widthPt;
    expect(limitRun.xPt).toBeCloseTo(
      sumRun.xPt + sumWidthPt, // after the full sign advance, not centred under it
      3,
    );
  });
});
