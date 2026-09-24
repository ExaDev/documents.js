import { describe, expect, it } from "vitest";
import { HEADER, blocksOf, paragraphsOf } from "./test-support/read-fixtures";

describe("character formatting", () => {
  it("splits runs where a toggle control word changes, and turns each off at its 0 parameter", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard plain \\b bold\\b0  again\\par}`)[0]
        ?.runs ?? [];
    expect(runs.map((run) => run.text)).toEqual(["plain ", "bold", " again"]);
    expect(runs[1]?.bold).toBe(true);
    expect(runs[0]?.bold).toBeUndefined();
    expect(runs[2]?.bold).toBeUndefined();
  });

  it("restores the outer group's formatting when a group closes, as the spec's inheritance rule requires", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard before {\\i inside} after\\par}`)[0]
        ?.runs ?? [];
    expect(runs.map((run) => run.text)).toEqual([
      "before ",
      "inside",
      " after",
    ]);
    expect(runs[1]?.italic).toBe(true);
    expect(runs[2]?.italic).toBeUndefined();
  });

  it("reads every underline variant as the one boolean ContentRun carries, and \\ulnone as off", () => {
    const runs =
      paragraphsOf(
        `${HEADER}\\pard \\ul one\\ulnone  two\\uldash three\\ulnone\\par}`,
      )[0]?.runs ?? [];
    expect(runs[0]?.underline).toBe(true);
    expect(runs[1]?.underline).toBeUndefined();
    expect(runs[2]?.underline).toBe(true);
  });

  it("converts \\fsN from half-points to points and resolves \\fN through the font table", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\f1\\fs36 Arial eighteen\\par}`)[0]
        ?.runs ?? [];
    expect(runs[0]?.fontFamily).toBe("Arial");
    expect(runs[0]?.sizePt).toBe(18);
  });

  it("resolves \\cfN through the colour table into a 0..1 Color", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\cf2 red text\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.color).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("drops hidden text, which \\v marks and no ContentRun field expresses", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard shown \\v hidden\\v0  shown again\\par}`)[0]
        ?.runs ?? [];
    expect(runs.map((run) => run.text).join("")).toBe("shown  shown again");
  });

  it("reads \\strike as the strike field", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\strike struck\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.strike).toBe(true);
  });

  it("reads \\super and \\sub onto verticalAlign, as their own runs beside baseline text", () => {
    // The shape LibreOffice's own filter writes for the standard positions: a braced on-word around the raised text.
    const runs =
      paragraphsOf(`${HEADER}\\pard x{\\super 2} and H{\\sub 2}O\\par}`)[0]
        ?.runs ?? [];
    expect(runs.map((run) => run.text)).toEqual(["x", "2", " and H", "2", "O"]);
    expect(runs.map((run) => run.verticalAlign)).toEqual([
      undefined,
      "superscript",
      undefined,
      "subscript",
      undefined,
    ]);
  });

  it("reads \\upN and \\dnN by the sign of their half-point offset, with zero restoring the baseline", () => {
    // "\upN Move up N half-points (default is 6)" — bare means the default raise, a negative moves down into the other family (\dn-3 raises by the mirror argument), and zero is no move at all. The doubled spaces after a parameterised word are the delimiter space plus a real text space, the same convention the \b0 fixture above uses.
    const runs =
      paragraphsOf(
        `${HEADER}\\pard \\up raised\\up0  base\\dn3  lowered\\dn-3  raised again\\dn0  base again\\par}`,
      )[0]?.runs ?? [];
    expect(runs.map((run) => run.text)).toEqual([
      "raised",
      " base",
      " lowered",
      " raised again",
      " base again",
    ]);
    expect(runs.map((run) => run.verticalAlign)).toEqual([
      "superscript",
      undefined,
      "subscript",
      "superscript",
      undefined,
    ]);
  });

  it("reads \\nosupersub as the off-spelling for both families", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\super up\\nosupersub  base\\par}`)[0]
        ?.runs ?? [];
    // Asserted as its own length first: if \nosupersub failed to clear verticalAlign, "up" and "base" would carry the identical character state and coalesce into one run, making runs[1] undefined and the verticalAlign assertion below vacuously pass regardless of what actually happened.
    expect(runs).toHaveLength(2);
    expect(runs[0]?.verticalAlign).toBe("superscript");
    expect(runs[1]?.verticalAlign).toBeUndefined();
  });

  it("turns verticalAlign off at the group boundary and at \\plain, like every other character property", () => {
    const runs =
      paragraphsOf(
        `${HEADER}\\pard before {\\super inside} after\\plain \\super gone\\plain  back\\par}`,
      )[0]?.runs ?? [];
    expect(runs.map((run) => run.verticalAlign)).toEqual([
      undefined,
      "superscript",
      undefined,
      "superscript",
      undefined,
    ]);
  });

  it("reads \\rtlch and \\ltrch onto ContentRun.direction, with the last-stated of the pair winning", () => {
    // The middle two groups spell the pair the way a real producer does, the run's real direction last (\rtlch\ltrch for an LTR run, \ltrch\rtlch for an RTL one), and each closing brace restores the enclosing state — so the text between groups is unstated again.
    const runs =
      paragraphsOf(
        `${HEADER}\\pard plain {\\rtlch rtl}{\\rtlch\\ltrch ltr} and {\\ltrch\\rtlch rtl again}{\\ltrch ltr}\\par`,
      )[0]?.runs ?? [];
    expect(runs.map((run) => run.text)).toEqual([
      "plain ",
      "rtl",
      "ltr",
      " and ",
      "rtl again",
      "ltr",
    ]);
    expect(runs.map((run) => run.direction)).toEqual([
      undefined,
      "rtl",
      "ltr",
      undefined,
      "rtl",
      "ltr",
    ]);
  });
});

describe("text, escapes, and Unicode", () => {
  it("merges text either side of an inert skipped destination into one run, not two", () => {
    // \b turns bold on with nothing yet accumulated under it, {\footnote ...} is a "skip" destination whose own close never re-enters the token loop as a groupEnd, and \b0 turns bold back off before any real text has appeared under the bold key at all — so the run key is genuinely unchanged (still the pre-\b key) by the time "B" arrives, and flushBytes' own pendingBytes.length===0 guard is what keeps a spurious empty flush from resetting the run accumulator at the \b/\b0 boundary in between. Without that guard, "A" and "B" would flush into two separate same-key runs instead of merging into one.
    const runs =
      paragraphsOf(`${HEADER}\\pard A\\b{\\footnote ignored}\\b0 B\\par}`)[0]
        ?.runs ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0]?.text).toBe("AB");
  });

  it("decodes \\'hh through the document's own code page", () => {
    // 0xE9 is e-acute in cp1252.
    const runs = paragraphsOf(`${HEADER}\\pard caf\\'e9\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.text).toBe("café");
  });

  it("decodes \\'hh through the run's own font code page when that font declares one", () => {
    const source =
      "{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\froman\\fcharset0 Times;}{\\f1\\fswiss\\fcharset204 Arial Cyr;}}" +
      "\\pard \\f1\\'c0\\par}";
    // 0xC0 is CYRILLIC CAPITAL LETTER A in cp1251, which \fcharset204 names.
    expect(paragraphsOf(source)[0]?.runs[0]?.text).toBe("А");
  });

  it("reads \\uN and skips the one ANSI fallback character \\uc1 implies", () => {
    // The spec's own example: "Lab\u915GValue" is "LabGValue" with the Greek capital gamma.
    const runs =
      paragraphsOf(`${HEADER}\\pard\\uc1 Lab\\u915 GValue\\par}`)[0]?.runs ??
      [];
    expect(runs.map((run) => run.text).join("")).toBe("LabΓValue");
  });

  it("skips the number of fallback characters the innermost \\ucN states, not a fixed one", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard\\uc3 a\\u915 ???b\\par}`)[0]?.runs ?? [];
    expect(runs.map((run) => run.text).join("")).toBe("aΓb");
  });

  it("restores the enclosing \\ucN when a group closes, which the spec requires be stacked", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard\\uc1 {\\uc0\\u915 }\\u916 ?end\\par}`)[0]
        ?.runs ?? [];
    expect(runs.map((run) => run.text).join("")).toBe("ΓΔend");
  });

  it("expresses a Unicode value above U+7FFF as the negative number the spec prescribes", () => {
    // "the character code U+F020 is given by \u-4064".
    const runs =
      paragraphsOf(`${HEADER}\\pard\\uc1 \\u-4064 ?\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.text).toBe("");
  });

  it("ends a fallback skip at a brace rather than eating past it", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard\\uc5 {\\u915 }kept\\par}`)[0]?.runs ?? [];
    expect(runs.map((run) => run.text).join("")).toBe("Γkept");
  });

  it("reads the special-character control words and symbols as their own text", () => {
    const runs =
      paragraphsOf(
        `${HEADER}\\pard a\\tab b\\emdash c\\~d\\lquote e\\{f\\}g\\\\h\\par}`,
      )[0]?.runs ?? [];
    expect(runs.map((run) => run.text).join("")).toBe("a\tb—c d‘e{f}g\\h");
  });

  it("reads \\line as a line break inside the run rather than a new paragraph", () => {
    const paragraphs = paragraphsOf(`${HEADER}\\pard first\\line second\\par}`);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs.map((run) => run.text).join("")).toBe(
      "first\nsecond",
    );
  });

  it("takes the \\ud half of a {\\upr ...} pair and discards the ANSI half", () => {
    const runs =
      paragraphsOf(
        `${HEADER}\\pard{\\upr{ansi only}{\\*\\ud{\\uc0\\u915 unicode}}}\\par}`,
      )[0]?.runs ?? [];
    expect(runs.map((run) => run.text).join("")).toBe("Γunicode");
  });
});

describe("paragraph formatting", () => {
  it("reads alignment, indents and spacing, converting twips to points", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard\\qc\\li720\\fi-360\\sb240\\sa120 centred\\par}`,
    )[0];
    expect(paragraph?.alignment).toBe("center");
    expect(paragraph?.indentLeftPt).toBe(36);
    expect(paragraph?.indentFirstLinePt).toBe(-18);
    expect(paragraph?.spacingBeforePt).toBe(12);
    expect(paragraph?.spacingAfterPt).toBe(6);
  });

  it("reads \\slN with \\slmult1 as a multiple of single line height", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard\\sl360\\slmult1 one and a half\\par}`,
    )[0];
    expect(paragraph?.lineSpacing).toBe(1.5);
  });

  it("leaves lineSpacing absent for the exact/at-least form \\slmult0 names, which is not a multiple", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard\\sl360\\slmult0 exact\\par}`,
    )[0];
    expect(paragraph?.lineSpacing).toBeUndefined();
  });

  it("resets paragraph properties at \\pard", () => {
    const paragraphs = paragraphsOf(
      `${HEADER}\\pard\\qr right\\par\\pard plain\\par}`,
    );
    expect(paragraphs[0]?.alignment).toBe("right");
    expect(paragraphs[1]?.alignment).toBeUndefined();
  });

  it("reads \\rtlpar and \\ltrpar onto ContentParagraph.direction, carrying the state across \\par and clearing it at \\pard", () => {
    // Paragraph properties persist from one paragraph to the next until \pard or a group close resets them, the same rule alignment already follows above.
    const paragraphs = paragraphsOf(
      `${HEADER}\\pard\\rtlpar first\\par second\\par\\ltrpar third\\par\\pard fourth\\par}`,
    );
    expect(paragraphs.map((paragraph) => paragraph.direction)).toEqual([
      "rtl",
      "rtl",
      "ltr",
      undefined,
    ]);
  });

  it("reads \\pagebb as pageBreakBefore and \\page as its own pageBreak block", () => {
    expect(
      paragraphsOf(`${HEADER}\\pard\\pagebb x\\par}`)[0]?.pageBreakBefore,
    ).toBe(true);
    expect(
      blocksOf(`${HEADER}\\pard a\\par\\page\\pard b\\par}`).map(
        (block) => block.kind,
      ),
    ).toEqual(["paragraph", "pageBreak", "paragraph"]);
  });

  it("produces an empty paragraph for a bare \\par, which is real content in a wordprocessing document", () => {
    expect(
      paragraphsOf(`${HEADER}\\pard a\\par\\par\\pard b\\par}`),
    ).toHaveLength(3);
  });

  it("derives headingLevel and styleId from a \\sN that names a built-in heading style", () => {
    const source =
      "{\\rtf1\\ansi{\\stylesheet{\\s0 Normal;}{\\s1\\sbasedon0\\snext0 heading 1;}}" +
      "\\pard\\s1 A Heading\\par\\pard\\s0 Body.\\par}";
    const paragraphs = paragraphsOf(source);
    expect(paragraphs[0]?.headingLevel).toBe(1);
    expect(paragraphs[0]?.styleId).toBe("heading 1");
    expect(paragraphs[1]?.headingLevel).toBeUndefined();
  });

  it("prefers the paragraph's own \\outlinelevelN over its style's heading level", () => {
    const source =
      "{\\rtf1\\ansi{\\stylesheet{\\s1\\snext0 heading 1;}}\\pard\\s1\\outlinelevel2 Deeper\\par}";
    expect(paragraphsOf(source)[0]?.headingLevel).toBe(3);
  });
});

describe("unicode fallback skip", () => {
  it("stops a \\uc fallback skip early at a group boundary rather than reading into the group", () => {
    // \uc5 with only one text byte before a nested group: the spec's own scope-delimiter rule ends the skippable run at the brace, so "inside" must still be read as real content rather than swallowed as fallback.
    const runs =
      paragraphsOf(`${HEADER}\\pard \\uc5\\u9731 x{inside}\\par}`)[0]?.runs ??
      [];
    expect(runs.map((run) => run.text).join("")).toContain("inside");
  });

  it("counts a control word or symbol inside the fallback region as exactly one skipped character", () => {
    // \uc1 skips one "character" — here a \'hh escape, which the spec's own rule counts as a single character even though it is itself a control word, not a literal byte. If the escape were NOT consumed as the fallback, the decoded e-acute would leak into the visible text alongside the real Unicode character.
    const runs =
      paragraphsOf(`${HEADER}\\pard \\uc1\\u9731 \\'e9after\\par}`)[0]?.runs ??
      [];
    const text = runs.map((run) => run.text).join("");
    expect(text).not.toContain("é");
    expect(text).toContain("after");
  });

  it("consumes a fallback text run exactly its own length and resumes reading real text immediately after it", () => {
    // \uc3 with a three-byte fallback run ("abc") that is its OWN complete text token — ended by \b0, a genuine token boundary, rather than continuing into "real" within the same token — so the skip count exactly exhausts it. The reader must advance past the whole token and reset its own byte offset there, not stop one byte short of it (which would leak a trailing byte of "abc" into the visible text).
    const runs =
      paragraphsOf(`${HEADER}\\pard \\uc3\\u9731 abc\\b0 real\\par}`)[0]
        ?.runs ?? [];
    const text = runs.map((run) => run.text).join("");
    expect(text).not.toContain("abc");
    expect(text).toContain("real");
  });

  it("counts a two-byte text run as fully consumed only once its own last byte is reached, then genuinely skips the control word right after it", () => {
    // \uc3 with a two-byte fallback ("ab", its own complete token) plus \i (a control word, "considered a single character" per the spec) makes exactly 3 — the skip must fully exhaust "ab" AND advance past \i, so \i's own formatting effect never reaches "real". A reader that stopped one byte short of "ab" (leaving its own token index unmoved) would leave \i unskipped, letting it toggle italics on for real.
    const runs =
      paragraphsOf(`${HEADER}\\pard \\uc3\\u9731 ab\\i real\\par}`)[0]?.runs ??
      [];
    const text = runs.map((run) => run.text).join("");
    expect(text).toBe("☃real");
    expect(runs.some((run) => run.italic === true)).toBe(false);
  });

  it("leaves a text token's own trailing bytes visible when the fallback count is smaller than the whole token", () => {
    // \uc2 skips only the first two bytes of the SEVEN-byte token "abcreal" — the reader must resume from that exact byte offset within the SAME token, not skip the whole token or stop reading it altogether.
    const runs =
      paragraphsOf(`${HEADER}\\pard \\uc2\\u9731 abcreal\\par}`)[0]?.runs ?? [];
    const text = runs.map((run) => run.text).join("");
    expect(text).toBe("☃creal");
  });
});

describe("\\uN surrogate arithmetic", () => {
  it("converts a negative \\uN parameter into its true code point by adding 65536, not subtracting it", () => {
    // A code point above 32767 is written as its own negative twin ("convert F020 to decimal (61472) and subtract 65536" gives -4064), so reading it back requires the inverse: -4064 + 65536 = 61472 = U+F020, a Private Use Area character.
    const runs =
      paragraphsOf(`${HEADER}\\pard \\u-4064 x\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.text.codePointAt(0)).toBe(0xf020);
  });

  it("emits no character at all for a bare \\u with no numeric parameter", () => {
    // A malformed \u with no digits after it has code === undefined; the code branch that calls emitText must be skipped entirely rather than calling String.fromCharCode(undefined), which coerces to U+0000 (NaN's own ToUint16 result) and would silently insert a stray NUL character into the run. skipUnicodeFallback still runs unconditionally either way, consuming the one ANSI fallback character \uN's own grammar always requires — so "b" here is the fallback, never part of the emitted text, regardless of code's own definedness.
    const runs = paragraphsOf(`${HEADER}\\pard a\\u b\\par}`)[0]?.runs ?? [];
    expect(runs.map((run) => run.text).join("")).toBe("a");
  });
});

describe("run identity", () => {
  it("keeps two adjacent runs with different real colours separate, not folded by a flattened key", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\cf1 black\\cf2 red\\par}`)[0]?.runs ?? [];
    expect(runs.map((run) => run.text)).toEqual(["black", "red"]);
    expect(runs[0]?.color).toEqual({ r: 0, g: 0, b: 0 });
    expect(runs[1]?.color).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("keeps two adjacent runs with different fonts separate", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\f0 times\\f1 arial\\par}`)[0]?.runs ?? [];
    expect(runs.map((run) => run.text)).toEqual(["times", "arial"]);
    expect(runs[0]?.fontFamily).toBe("Times New Roman");
    expect(runs[1]?.fontFamily).toBe("Arial");
  });

  it("reads a HYPERLINK field carrying both a quoted target and an \\l anchor as target#anchor", () => {
    const runs =
      paragraphsOf(
        `${HEADER}\\pard {\\field{\\*\\fldinst{HYPERLINK "https://example.com/page" \\\\l "part2"}}{\\fldrslt jump}}\\par}`,
      )[0]?.runs ?? [];
    expect(runs[0]?.hyperlink).toBe("https://example.com/page#part2");
  });
});

describe("run field derivation", () => {
  it("treats an empty resolved font name the same as no font at all: no fontFamily field", () => {
    const source =
      "{\\rtf1\\ansi\\ansicpg1252\\deff0" +
      "{\\fonttbl{\\f0 ;}}{\\colortbl;}" +
      "\\pard\\f0 x\\par}";
    const runs = paragraphsOf(source)[0]?.runs ?? [];
    expect(runs[0]?.fontFamily).toBeUndefined();
  });
});

describe("paragraph geometry derivation", () => {
  it("does not restate a style name onto styleId when the header names an empty style entry", () => {
    const source =
      "{\\rtf1\\ansi\\ansicpg1252\\deff0" +
      "{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}}" +
      "{\\colortbl;}" +
      "{\\stylesheet{\\s1 ;}}" +
      "\\pard\\s1 x\\par}";
    const paragraph = paragraphsOf(source)[0];
    expect(paragraph?.styleId).toBeUndefined();
  });

  it("omits headingLevel when a paragraph names no style and states no \\outlinelevel of its own", () => {
    const paragraph = paragraphsOf(`${HEADER}\\pard plain\\par}`)[0];
    expect(paragraph?.headingLevel).toBeUndefined();
  });

  it("treats \\sl0 (automatic spacing) the same as no \\sl at all: no lineSpacing field", () => {
    const paragraph = paragraphsOf(`${HEADER}\\pard\\sl0\\slmult1 x\\par}`)[0];
    expect(paragraph?.lineSpacing).toBeUndefined();
  });

  it("carries no lineSpacing field when \\sl is stated without \\slmult1, since the default is not left with a leftover default value", () => {
    const paragraph = paragraphsOf(`${HEADER}\\pard\\sl240 x\\par}`)[0];
    expect(paragraph?.lineSpacing).toBeUndefined();
  });

  it("reads \\ls0 (no list override) as no list field at all, matching an absent \\ls", () => {
    const paragraph = paragraphsOf(`${HEADER}\\pard\\ls0 x\\par}`)[0];
    expect(paragraph?.list).toBeUndefined();
  });
});

describe("run and paragraph accumulation", () => {
  it("gives each closed paragraph its own distinct serial identity", () => {
    // A bookmark opened in the second paragraph and closed in the third must resolve to a block-scoped extent (its own start and end genuinely differ), which only holds if each closed paragraph actually gets a serial distinct from every other one — a serial that collided across paragraphs would make the second paragraph's own identity indistinguishable from the first's.
    const blocks = blocksOf(
      `${HEADER}\\pard One\\par\\pard{\\*\\bkmkstart s}Two\\par\\pard Three{\\*\\bkmkend s}\\par}`,
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
    ]);
  });

  it("sorts a paragraph's own run-scoped constructs by start position, earliest first", () => {
    const paragraph = paragraphsOf(
      `${HEADER}{\\*\\revtbl{Unknown;}{A. Reviewer;}}\\pard kept \\revised\\revauth1 second\\revised0  middle \\deleted\\revauthdel1 first-in-source\\deleted0  end\\par}`,
    )[0];
    // Two disjoint provenance extents on the same paragraph: the insertion opens AFTER the deletion in source order here is irrelevant — what matters is the extents come back ordered by their own startRun, not source-declaration order, matching document-schema.js's own well-formedness expectation for RunConstructExtent[].
    const starts = (paragraph?.constructs ?? []).map(
      (extent) => extent.startRun,
    );
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(paragraph?.constructs).toHaveLength(2);
  });

  it("still tie-breaks two run-scoped constructs sharing a startRun by endRun, ascending, when a bookmark extent (pushed first, regardless of its own numeric range) shares its start with a shorter coalesced revision extent (pushed second)", () => {
    // Both 'B' (a bookmark) and the revision mark on 'hi' start at run 0, but pendingRunConstructs entries are always spread into the pre-sort array BEFORE coalesceRunConstructs' own output, regardless of which one's numeric range is actually smaller — so the pre-sort array here is [B(start=0,end=2), revision(start=0,end=1)], tied on the first comparator clause and wrong on the second. A second comparator clause that summed the two endRun values instead of subtracting them would return the same non-discriminating result regardless of argument order (both terms tied at zero on the first clause), never triggering the swap this reversed-by-numeric-value push order requires.
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\*\\bkmkstart B}\\revised\\revauth1 hi\\revised0  more{\\*\\bkmkend B}\\par}`,
    )[0];
    const extents = paragraph?.constructs ?? [];
    expect(extents).toHaveLength(2);
    expect(extents[0]?.descriptor.kind).toBe("provenance");
    expect(extents[0]?.endRun).toBe(1);
    expect(extents[1]?.descriptor.kind).toBe("anchor");
    expect(extents[1]?.endRun).toBe(2);
  });

  it("still sorts a nested bookmark pair into start order when the inner one's own endBookmark call — and so its own push into pendingRunConstructs — happens before the outer one's", () => {
    // 'inner' opens after 'outer' (startRun 1, not 0) but closes first, so ITS OWN pendingRunConstructs.push happens before 'outer's — the pre-sort array here is [inner(start=1), outer(start=0)], the reverse of correct start order, exactly mirroring the block-extent sort's own out-of-push-order case above. A sort comparator that summed instead of subtracted the two startRun values (or one whose "||" read "&&") would return the same, non-discriminating result regardless of which extent it was asked about first, and never trigger the swap this reversed push order requires.
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\*\\bkmkstart outer}one {\\*\\bkmkstart inner}two{\\*\\bkmkend inner} three{\\*\\bkmkend outer}\\par}`,
    )[0];
    const names = (paragraph?.constructs ?? []).map((extent) =>
      extent.descriptor.kind === "anchor" ? extent.descriptor.name : undefined,
    );
    expect(names).toEqual(["outer", "inner"]);
  });

  it("resolves a bookmark's own block index to the paragraph it actually opened in, not to whichever later paragraph happens to close while it is still open", () => {
    // "far" opens in "One" and stays open across two further paragraphs before its own \bkmkend. A guard that kept re-resolving blockIndex on every subsequent paragraph close (rather than only once, at "far"'s own opening paragraph) would leave it pointing at "Three" instead.
    const blocks = blocksOf(
      `${HEADER}\\pard{\\*\\bkmkstart far}One\\par\\pard Two\\par\\pard Three\\par\\pard Four{\\*\\bkmkend far}\\par}`,
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "constructEnd",
    ]);
  });
});
