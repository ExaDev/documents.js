import { describe, expect, it } from "vitest";
import type { ContentImageBlock, ContentParagraph } from "document-schema.js";
import { RtfDiagnosticCodes } from "./diagnostics";
import { bytesToHex } from "./base64";
import { newPendingCell } from "./cell-format";
import { writeEmbeddedObjectData } from "./embedded-object";
import {
  appendToLastListItem,
  closingBookmarkExtent,
  readRtfContent,
  verticalMergeRowSpan,
} from "./read";
import { bookmarkAnchorDescriptor } from "./constructs";
import {
  HEADER,
  blocksOf,
  firstTable,
  paragraphsOf,
  sectionsOf,
} from "./test-support/read-fixtures";
import { bytes } from "./test-support/bytes";

describe("byte runs larger than an argument list", () => {
  // A single paragraph whose text is one uninterrupted byte run far past the argument-count ceiling a spread call has (V8 throws RangeError somewhere around 65k-125k arguments). Bare CR/LF does not break a run — the tokenizer skips those bytes and keeps accumulating — so a real long paragraph reaches this size easily, and nothing smaller than a fixture this size catches it.
  const LONG_RUN_LENGTH = 300_000;

  it("reads a text run far longer than a spread call could carry", () => {
    const long = "a".repeat(LONG_RUN_LENGTH);
    const paragraph = paragraphsOf(`${HEADER}\\pard ${long}\\par}`)[0];
    expect(paragraph?.runs.map((run) => run.text).join("")).toHaveLength(
      LONG_RUN_LENGTH,
    );
  });

  it("reads a picture payload far longer than a spread call could carry", () => {
    // A PNG header followed by enough filler hex to push the payload past the same ceiling; only its size matters here, not its decodability.
    const hex = `89504e470d0a1a0a${"00".repeat(LONG_RUN_LENGTH / 2)}`;
    const image = blocksOf(
      `${HEADER}\\pard{\\pict\\pngblip\\picwgoal720\\pichgoal720 ${hex}}\\par}`,
    ).find((block): block is ContentImageBlock => block.kind === "image");
    expect(image?.base64.startsWith("iVBORw0KGgo")).toBe(true);
  });
});

describe("group-open dispatch", () => {
  it("never initialises picture state for a plain nested group with no \\pict destination of its own", () => {
    // If every group open unconditionally began collecting picture state, an ordinary formatting group's own close would spuriously run buildPicture against an empty PictureState and report UNSUPPORTED_PICTURE_FORMAT for content that was never a picture at all.
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard{\\b bold} plain\\par}`),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
      ),
    ).toBe(false);
  });

  it("never initialises picture state for a RECOGNISED destination other than picture, either", () => {
    // \b above has no recognised destination of its own at all (known === undefined), so it never reaches the `if (known !== undefined) { ... if (kind === "picture") ... }` branch this guards — it exercises a DIFFERENT, earlier guard entirely. \*\bkmkstart IS a known, non-picture destination, so this is the one fixture that actually reaches the kind === "picture" check itself: a `true` in its place would still spuriously initialise picture state here too.
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\*\\bkmkstart name}plain{\\*\\bkmkend name}\\par}`,
      ),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
      ),
    ).toBe(false);
  });

  it("never initialises embedded-object state for a plain nested group with no \\*\\objdata destination of its own", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard{\\b bold} plain\\par}`),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
      ),
    ).toBe(false);
  });

  it("never initialises embedded-object state for a RECOGNISED destination other than objectData, either", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\*\\bkmkstart name}plain{\\*\\bkmkend name}\\par}`,
      ),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
      ),
    ).toBe(false);
  });

  it("never routes a nested destination's own hex escape into the enclosing \\pict's own binary payload", () => {
    // \*\bkmkstart is a real, known destination — a child group nested inside \pict — so state.picture is inherited by reference (unlike destination, which the child correctly switches to "bookmarkStart"). A guard keyed on destination alone, forced true, would misroute the hex escape into the picture's own binary buffer instead of the bookmark's name.
    const PNG_HEX =
      "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
      "01f15c4890000000a49444154789c6300010000050001" +
      "0d0a2db40000000049454e44ae426082";
    const paragraph = paragraphsOf(
      `${HEADER}\\pard{\\pict\\pngblip\\picwgoal720\\pichgoal720{\\*\\bkmkstart\\'41}${PNG_HEX}}{\\*\\bkmkend\\'41}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      name: "A",
    });
  });

  it("never routes a nested destination's own control word into the enclosing \\pict's own control-word handling", () => {
    // A guard keyed on `state.destination === "picture"` alone (picture inherited by reference into every descendant, exactly as the hex-escape test above states) would misroute \bkmkcolf1 into applyPictureControlWord (a no-op for a name it does not recognise) instead of the bookmarkStart-specific handling that actually applies it — silently dropping the column residue rather than quarantining it onto the anchor's own descriptor.
    const paragraph = paragraphsOf(
      `${HEADER}\\pard{\\pict\\pngblip\\picwgoal720\\pichgoal720{\\*\\bkmkstart\\bkmkcolf1 name}}x{\\*\\bkmkend name}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      name: "name",
      source: { xml: "\\bkmkcolf1" },
    });
  });

  it("never routes a nested destination's own control word into the enclosing \\object's own \\objw/\\objh handling", () => {
    // A guard keyed on `state.destination === "object"` alone (object inherited by reference into every descendant, exactly like picture above) would misroute \objw1440 into ContentBuilder's own object-scoped assignment even from a sibling destination that never stated it directly on \object itself — surfacing a size-hint clause in the degrade diagnostic that the source never actually declared there.
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object{\\*\\bkmkstart\\objw1440 name}{\\*\\objdata }}{\\*\\bkmkend name}\\par}`,
      ),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
    );
    expect(found?.message).toBe(
      "an \\object destination's \\objdata carried no payload",
    );
  });

  it("never lets an arbitrary control word inside a bookmarkStart destination masquerade as \\bkmkcoll", () => {
    // A forced-true `name === "bkmkcoll"` check here would set columnLast for ANY control word carrying a numeric parameter that reaches a bookmarkStart destination once name !== "bkmkcolf" — \b1 included — rather than only for a genuine \bkmkcollN. \b1 rather than a bare \b specifically: a bare toggle word's own param is already undefined, indistinguishable from columnLast's own untouched default.
    const paragraph = paragraphsOf(
      `${HEADER}\\pard{\\*\\bkmkstart\\b1 name}x{\\*\\bkmkend name}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "name",
    });
  });

  it("never applies a genuine \\ffprot from a sibling formField-related destination other than \\*\\formfield itself", () => {
    // A forced-true `state.destination === "formField"` check here would apply \ffprot1 even from \*\ffname's own destination, since formField is shared by reference across every sibling — locking content the source never actually locked from \*\formfield's own scope.
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMTEXT  {\\*\\formfield{\\fftype0\\fftypetxt0{\\*\\ffname\\ffprot1 Text1}}}}{\\fldrslt Lorem ipsum.}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      tag: "Text1",
    });
  });

  it("never treats a plain nested group as a bookmark, so its own text is not swallowed as a bookmark name", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard before{\\b bold} after\\par}`)[0]?.runs ??
      [];
    expect(runs.map((run) => run.text).join("")).toContain("bold");
  });

  it("skips a header table's own second occurrence rather than re-reading it as body content", () => {
    // {\fonttbl ...} is already consumed by readRtfHeader; a SECOND, malformed occurrence later in the body must still be recognised as a header destination and skipped whole, not fall through to an unknown-destination diagnostic or leak its own text into the document.
    const { document, diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard{\\fonttbl{\\f9 Bogus;}}kept\\par}`),
    );
    const text0 =
      document.kind === "wordprocessing"
        ? document.sections[0]?.blocks
            .filter(
              (block): block is ContentParagraph => block.kind === "paragraph",
            )
            .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
            .join("")
        : undefined;
    expect(text0).toBe("kept");
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.UNKNOWN_DESTINATION_SKIPPED,
      ),
    ).toBe(false);
  });

  it("reads the \\*\\ud half of a \\upr wrapper and discards the ANSI half beside it", () => {
    const runs =
      paragraphsOf(
        `${HEADER}\\pard {\\upr ansi-fallback{\\*\\ud unicode-real}}\\par}`,
      )[0]?.runs ?? [];
    const text0 = runs.map((run) => run.text).join("");
    expect(text0).toContain("unicode-real");
    expect(text0).not.toContain("ansi-fallback");
  });

  it("discards every plain group nested inside a \\upr wrapper's own ANSI half, not only its direct text", () => {
    const runs =
      paragraphsOf(
        `${HEADER}\\pard {\\upr {\\b ansi in a group}{\\*\\ud kept}}\\par}`,
      )[0]?.runs ?? [];
    const text0 = runs.map((run) => run.text).join("");
    expect(text0).toBe("kept");
  });

  it("never registers a bookmark opened inside a \\upr wrapper's own ANSI half, not just its text", () => {
    // A plain group nested in the ANSI half falls through to state.destination ("unicodeWrapper") if the wrapperChild skip is disabled, and "unicodeWrapper" already silently discards direct TEXT on its own — so the previous fixture's "kept"-only assertion can pass whether the ANSI half is genuinely skipped or merely text-discarded. A recognised, known destination (bkmkstart/bkmkend) tells the two apart: skipped, it is never opened at all and registers no bookmark; merely text-discarded, it is opened, processed, and closed as a real bookmark like any other, regardless of what its own #PCDATA renders as.
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\upr {\\*\\bkmkstart hidden}x{\\*\\bkmkend hidden}{\\*\\ud kept}}\\par}`,
    )[0];
    expect(paragraph?.constructs ?? []).toEqual([]);
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe("kept");
  });

  it("discards a second, duplicate \\result child and reports it", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb{\\result{\\pard\\plain first\\par}}{\\result{\\pard\\plain second\\par}}}\\par}`,
      ),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE &&
          diagnostic.message.includes("more than one \\result"),
      ),
    ).toBe(true);
  });

  it("discards a second, duplicate \\objdata child and decodes only the first", () => {
    const OBJDATA_HEX_LOCAL = bytesToHex(
      writeEmbeddedObjectData({
        objectKind: "spreadsheet",
        document: { kind: "spreadsheet", metadata: {}, sheets: [] },
        frame: { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
      }),
    );
    const { document, diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb{\\*\\objdata ${OBJDATA_HEX_LOCAL}}{\\*\\objdata ${OBJDATA_HEX_LOCAL}}}\\par}`,
      ),
    );
    const objects =
      document.kind === "wordprocessing"
        ? document.sections[0]?.blocks.filter(
            (block) => block.kind === "embeddedObject",
          )
        : undefined;
    expect(objects).toHaveLength(1);
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE &&
          diagnostic.message.includes("more than one \\objdata"),
      ),
    ).toBe(true);
  });
});

describe("unbalanced groups", () => {
  it("reports the exact still-open-at-end-of-input message, counting every group left open (the document's own root included)", () => {
    // HEADER's own root {\rtf1 ... group is never closed by either fixture below — neither ends with the document's own final "}" — so the count always includes it alongside whatever else was left open.
    const { diagnostics } = readRtfContent(bytes(`${HEADER}\\pard{\\b text`));
    const found = diagnostics.find(
      (diagnostic) => diagnostic.code === RtfDiagnosticCodes.UNBALANCED_GROUP,
    );
    expect(found?.message).toBe(
      "2 group(s) were still open at the end of the input; each is treated as closing there",
    );
  });

  it("still flushes and keeps trailing ANSI text that reached input's end with no closing brace or other event to flush it itself", () => {
    // "text" here is the very last thing the tokenizer produced: nothing after it (no control word, no brace, no hex byte) ever triggers flushBytes on its own, so only the main loop's own unconditional trailing flushBytes() call — reached once the token stream itself is exhausted — moves it out of the pending-bytes buffer and into a run finish() can still build a paragraph from. Without that call, "text" is silently dropped: emitText/appendText never runs for it, runs stays empty, and endParagraph's own force=false early return then produces no paragraph at all instead of one holding this trailing text.
    const paragraph = paragraphsOf(`${HEADER}\\pard{\\b text`).at(-1);
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe("text");
  });

  it("counts every still-open group at the end of input, not one fewer or one more", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard{\\b{\\i text`),
    );
    const found = diagnostics.find(
      (diagnostic) => diagnostic.code === RtfDiagnosticCodes.UNBALANCED_GROUP,
    );
    expect(found?.message).toBe(
      "3 group(s) were still open at the end of the input; each is treated as closing there",
    );
  });

  it("reports the exact extra-closing-brace message text", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard text\\par}}`),
    );
    const found = diagnostics.find(
      (diagnostic) => diagnostic.code === RtfDiagnosticCodes.UNBALANCED_GROUP,
    );
    expect(found?.message).toBe(
      "a closing brace appeared with no group open; the extra brace is ignored",
    );
  });
});

describe("character control word edge cases", () => {
  it("ignores a negative \\ucN, keeping the previously stated skip count rather than adopting a negative one", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\uc2\\uc-1\\u9731 XY\\par}`)[0]?.runs ??
      [];
    // \uc-1 must not overwrite the still-valid \uc2 from just before it, so 霱's own fallback still skips exactly 2 characters ("XY"), leaving nothing of the fallback in the visible text.
    expect(runs.map((run) => run.text).join("")).not.toMatch(/[XY]/);
  });

  it("reads \\up with no parameter as the default six-half-point raise, not a no-op", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\up raised\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.verticalAlign).toBe("superscript");
  });

  it("reads a negative \\upN as lowering the text instead of raising it", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\up-3 lowered\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.verticalAlign).toBe("subscript");
  });

  it("reads an explicit positive \\upN as a genuine raise, not just the no-parameter default", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\up6 raised\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.verticalAlign).toBe("superscript");
  });

  it("reads exactly \\outlinelevel8, the spec's own upper bound, as a real heading level rather than clearing it", () => {
    const paragraph = paragraphsOf(`${HEADER}\\pard\\outlinelevel8 x\\par}`)[0];
    expect(paragraph?.headingLevel).toBe(9);
  });

  it("reads \\up0 as restoring the baseline, distinct from both a positive and a negative offset", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\up0 base\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.verticalAlign).toBeUndefined();
  });

  it("reads \\nosupersub as clearing verticalAlign to undefined, the field's own real absent state", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\super up\\nosupersub  base\\par}`)[0]
        ?.runs ?? [];
    // Asserted as its own length first: see the identical comment on "reads \nosupersub as the off-spelling for both families" above.
    expect(runs).toHaveLength(2);
    expect(runs[1]?.verticalAlign).toBeUndefined();
  });

  it("reads \\revdttmdel onto the deleted-half of a run's own revision state", () => {
    const REVTBL = "{\\*\\revtbl{Unknown;}{A. Reviewer;}}";
    const DTTM = 30 | (9 << 6) | (1 << 11) | (1 << 16) | (124 << 20);
    const paragraph = paragraphsOf(
      `${HEADER}${REVTBL}\\pard \\deleted\\revauthdel1\\revdttmdel${String(DTTM)} gone\\deleted0  kept\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      change: "deletion",
      dateIso: "2024-01-01T09:30:00",
    });
  });

  it("reads \\mvdate onto a moved run's own dateIso", () => {
    const REVTBL = "{\\*\\revtbl{Unknown;}{A. Reviewer;}}";
    const DTTM = 30 | (9 << 6) | (1 << 11) | (1 << 16) | (124 << 20);
    const paragraph = paragraphsOf(
      `${HEADER}${REVTBL}\\pard \\mvf\\mvauth1\\mvdate${String(DTTM)} moved\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      dateIso: "2024-01-01T09:30:00",
    });
  });

  it("reads \\crdate onto a format-change run's own dateIso", () => {
    const REVTBL = "{\\*\\revtbl{Unknown;}{A. Reviewer;}}";
    const DTTM = 30 | (9 << 6) | (1 << 11) | (1 << 16) | (124 << 20);
    const paragraph = paragraphsOf(
      `${HEADER}${REVTBL}\\pard \\crauth1\\crdate${String(DTTM)}\\b restyled\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      dateIso: "2024-01-01T09:30:00",
    });
  });

  it("does not read \\ulc (underline colour) as a generic \\ul* underline variant", () => {
    // \ulc takes a colour-index parameter, not a toggle; treating it as an underline word would turn it on and misread its own parameter as a boolean toggle value.
    const runs = paragraphsOf(`${HEADER}\\pard \\ulc2 x\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.underline).toBeUndefined();
  });
});

describe("paragraph control word edge cases", () => {
  it("reads \\outlinelevel9 (above the spec's own 0-8 range) as body text, clearing any level rather than adopting a tenth depth", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard\\outlinelevel0 zero\\par\\pard\\outlinelevel9 nine\\par}`,
    );
    expect(paragraph[0]?.headingLevel).toBe(1);
    expect(paragraph[1]?.headingLevel).toBeUndefined();
  });

  it("reads \\lin as the same left-indent field \\li writes", () => {
    const paragraph = paragraphsOf(`${HEADER}\\pard\\lin720 x\\par}`)[0];
    expect(paragraph?.indentLeftPt).toBe(36);
  });
});

describe("section control word edge cases", () => {
  it("resets section geometry back to the document's own defaults on \\sectd, not leaving a prior section's stated values", () => {
    const sections = sectionsOf(
      "{\\rtf1\\ansi\\paperw12240\\paperh15840\\margl1440\\margr1440\\margt1440\\margb1440" +
        "\\sectd\\pgwsxn15840\\pghsxn12240\\pard A\\par\\sect\\sectd\\pard B\\par}",
    );
    expect(sections[1]?.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
  });

  it("clears the pending break type when \\sbkcol arrives, so no page-level break is mistakenly kept alongside the reported column break", () => {
    const sections = sectionsOf(
      `${HEADER}\\sectd\\sbkpage\\sbkcol\\pard A\\par\\sect\\sectd\\pard B\\par}`,
    );
    expect(sections[0]?.breakType).toBeUndefined();
  });

  it("reports the exact \\sbkcol message text", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\sectd\\pard A\\par\\sect\\sectd\\sbkcol\\pard B\\par}`),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.SECTION_BREAK_UNREPRESENTED,
    );
    expect(found?.message).toBe(
      "\\sbkcol starts the section at a new column; ContentSection.breakType names page-level breaks only, so the break kind is dropped and the section itself is kept",
    );
  });
});

describe("structure control word edge cases", () => {
  it("reads \\trleft onto the row's own left edge, used as the first column boundary", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft720\\cellx1440\\pard\\intbl A\\cell\\row\\pard x\\par}`,
    );
    // 1440 - 720 = 720 twips = 36pt for the one column.
    expect(table.columns.map((c) => c.widthPt)).toEqual([36]);
  });

  it("reports the exact nested-table-flattened message text for \\nestrow, distinct from \\nestcell's own trigger", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\trowd\\trleft0\\cellx1440\\pard\\intbl{\\*\\nesttableprops}\\nestrow x\\cell\\row\\pard y\\par}`,
      ),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.NESTED_TABLE_FLATTENED,
    );
    expect(found?.message).toBe(
      "a nested table's cell/row marks are read as ordinary cell content; the inner table's own structure is not reconstructed",
    );
  });
});

describe("control word dispatch order", () => {
  it("reads \\bkmkcolf/\\bkmkcoll inside a bookmark start, but never lets a stray \\par there actually close a paragraph", () => {
    // \par is a real structural word (builder.endParagraph), not merely a formatting flag, so a broken bookmarkStart guard that let it fall through would be directly observable as an extra paragraph — unlike a stray \b, whose effect is confined to a group's own discarded char state either way.
    const paragraphs = paragraphsOf(
      `${HEADER}\\pard before{\\*\\bkmkstart\\par Named}after{\\*\\bkmkend Named}\\par}`,
    );
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs.map((run) => run.text).join("")).toBe(
      "beforeafter",
    );
    expect(paragraphs[0]?.constructs?.[0]?.descriptor).toMatchObject({
      name: "Named",
    });
  });

  it("never lets a stray \\par inside a \\*\\ffname destination actually close a paragraph", () => {
    // Mirrors the bookmarkStart/bookmarkEnd fixtures above: \*\ffname's own content is a name, not formatted text, so applyControlWord's own formField-family guard must discard \par here too, rather than letting it fall through to builder.endParagraph and split the surrounding text across two real paragraphs.
    const paragraphs = paragraphsOf(
      `${HEADER}\\pard before{\\field{\\*\\fldinst FORMTEXT }{\\*\\formfield{\\fftype0{\\*\\ffname\\par Name}}}}after\\par}`,
    );
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs.map((run) => run.text).join("")).toContain(
      "beforeafter",
    );
  });

  it("never lets a stray \\par inside a bookmark end destination actually close a paragraph", () => {
    const paragraphs = paragraphsOf(
      `${HEADER}\\pard before{\\*\\bkmkstart Word}mid{\\*\\bkmkend\\par Word}after\\par}`,
    );
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs.map((run) => run.text).join("")).toBe(
      "beforemidafter",
    );
    expect(paragraphs[0]?.constructs?.[0]?.descriptor).toMatchObject({
      name: "Word",
    });
  });

  it("reads a cell-definition word (\\clbrdrt) ahead of the identically-prefixed paragraph border reading, whenever a row definition is open", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clbrdrt\\brdrs\\brdrw15\\cellx1440\\pard\\intbl A\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.borders?.top).toBeDefined();
  });
});

describe("internal invariants exercised directly (no legitimate RTF input can reach these)", () => {
  it("closingBookmarkExtent throws when a closing bookmark somehow reaches it with no resolved blockIndex", () => {
    const closing = {
      descriptor: bookmarkAnchorDescriptor("orphan", undefined),
      paragraphSerial: Symbol("paragraph"),
      runIndex: 0,
      inTable: false,
      blockIndex: undefined,
    };
    expect(() => closingBookmarkExtent(closing, 3)).toThrow(
      "internal invariant violated: a closing bookmark reached flushClosingBookmarks with no resolved blockIndex",
    );
  });

  it("closingBookmarkExtent returns the real extent once blockIndex is actually resolved", () => {
    const closing = {
      descriptor: bookmarkAnchorDescriptor("resolved", undefined),
      paragraphSerial: Symbol("paragraph"),
      runIndex: 0,
      inTable: false,
      blockIndex: 2,
    };
    expect(closingBookmarkExtent(closing, 5)).toEqual({
      descriptor: closing.descriptor,
      startIndex: 2,
      endIndex: 5,
    });
  });

  it("appendToLastListItem throws when the list has no entry to append to", () => {
    expect(() => {
      appendToLastListItem({ items: [] }, "text");
    }).toThrow(
      "internal invariant violated: a form field list item's text arrived with no list item entry to append to",
    );
  });

  it("appendToLastListItem appends to the last entry, in place, leaving earlier entries untouched", () => {
    const items = ["first", "second"];
    appendToLastListItem({ items }, " more");
    expect(items).toEqual(["first", "second more"]);
  });

  it("verticalMergeRowSpan counts consecutive vertical-merge continuations forward from rowIndex + 1", () => {
    const continuation = () => ({
      ...newPendingCell(),
      verticalMergeContinuation: true,
    });
    const ordinary = () => ({ ...newPendingCell() });
    const rowsBelow = [
      {
        cells: [],
        definitions: [continuation()],
        direction: undefined,
        isHeader: false,
      },
      {
        cells: [],
        definitions: [continuation()],
        direction: undefined,
        isHeader: false,
      },
      {
        cells: [],
        definitions: [ordinary()],
        direction: undefined,
        isHeader: false,
      },
      {
        cells: [],
        definitions: [continuation()],
        direction: undefined,
        isHeader: false,
      },
    ];
    // The run stops at the first ordinary row, so the continuation after it does not count.
    expect(verticalMergeRowSpan(rowsBelow, 0)).toBe(3);
  });

  it("verticalMergeRowSpan reads the definition at the given grid column of each row", () => {
    const continuation = () => ({
      ...newPendingCell(),
      verticalMergeContinuation: true,
    });
    const ordinary = () => ({ ...newPendingCell() });
    const rowsBelow = [
      {
        cells: [],
        definitions: [ordinary(), continuation()],
        direction: undefined,
        isHeader: false,
      },
    ];
    expect(verticalMergeRowSpan(rowsBelow, 0)).toBe(1);
    expect(verticalMergeRowSpan(rowsBelow, 1)).toBe(2);
    expect(verticalMergeRowSpan(rowsBelow, 2)).toBe(1);
  });
});
describe("lists", () => {
  const LIST_TABLES =
    "{\\*\\listtable" +
    "{\\list\\listtemplateid1\\listsimple{\\listlevel\\levelnfc23\\leveljc0\\levelstartat1{\\leveltext \\'01\\u183 ?;}{\\levelnumbers;}}\\listid101}" +
    "{\\list\\listtemplateid2\\listsimple{\\listlevel\\levelnfc0\\leveljc0\\levelstartat1{\\leveltext \\'02\\'00.;}{\\levelnumbers\\'01;}}\\listid102}" +
    "}{\\*\\listoverridetable{\\listoverride\\listid101\\listoverridecount0\\ls1}{\\listoverride\\listid102\\listoverridecount0\\ls2}}";

  it("reads \\lsN and \\ilvlN into a list membership whose numId records the level's own marker type", () => {
    const paragraph = paragraphsOf(
      `${HEADER}${LIST_TABLES}\\pard\\ls1\\ilvl0{\\listtext\\f2 \\u183 ?}Bulleted item\\par}`,
    )[0];
    expect(paragraph?.list).toEqual({ numId: "rtf1:bullet", level: 0 });
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe(
      "Bulleted item",
    );
  });

  it("records a numbered list's level as ordered", () => {
    const paragraph = paragraphsOf(
      `${HEADER}${LIST_TABLES}\\pard\\ls2\\ilvl0{\\listtext 1.}Numbered item\\par}`,
    )[0];
    expect(paragraph?.list).toEqual({ numId: "rtf2:ordered", level: 0 });
  });

  it("carries the nesting depth \\ilvlN states", () => {
    const paragraph = paragraphsOf(
      `${HEADER}${LIST_TABLES}\\pard\\ls1\\ilvl2 Deep item\\par}`,
    )[0];
    expect(paragraph?.list?.level).toBe(2);
  });

  it("falls back to the list's own level 0 when \\ilvlN names a depth the \\listsimple table never defined", () => {
    // LIST_TABLES's own list 101 (bound to \ls1) is \listsimple, carrying exactly one \listlevel at index 0 — \ilvl2 names a depth with no definition of its own, so the level's numberFormat (bullet, here) must be read from level 0's definition rather than from an undefined level.
    const paragraph = paragraphsOf(
      `${HEADER}${LIST_TABLES}\\pard\\ls1\\ilvl2 Deep item\\par}`,
    )[0];
    expect(paragraph?.list?.numId).toBe("rtf1:bullet");
  });

  it("carries a \\lfolevel start-at override through to the paragraph's own numId", () => {
    // The same \list102 both overrides name, restarted at 5 by \ls3's own \lfolevel while \ls2 leaves it at 1 — so the override table, not the list table, is what tells the two apart.
    const tables =
      "{\\*\\listtable" +
      "{\\list\\listtemplateid2\\listsimple{\\listlevel\\levelnfc0\\leveljc0\\levelstartat1{\\leveltext \\'02\\'00.;}{\\levelnumbers\\'01;}}\\listid102}" +
      "}{\\*\\listoverridetable" +
      "{\\listoverride\\listid102\\listoverridecount0\\ls2}" +
      "{\\listoverride\\listid102\\listoverridecount1{\\lfolevel\\listoverridestartat\\levelstartat5}\\ls3}" +
      "}";
    const paragraphs = paragraphsOf(
      `${HEADER}${tables}\\pard\\ls2\\ilvl0 First\\par\\pard\\ls3\\ilvl0 Restarted\\par}`,
    );
    expect(paragraphs[0]?.list?.numId).toBe("rtf2:ordered");
    expect(paragraphs[1]?.list?.numId).toBe("rtf3:ordered@5");
  });

  it("carries a \\lfolevel format override, so an override can turn a numbered list bulleted", () => {
    const tables =
      "{\\*\\listtable" +
      "{\\list\\listtemplateid2\\listsimple{\\listlevel\\levelnfc0\\leveljc0\\levelstartat1{\\leveltext \\'02\\'00.;}{\\levelnumbers\\'01;}}\\listid102}" +
      "}{\\*\\listoverridetable" +
      "{\\listoverride\\listid102\\listoverridecount1{\\lfolevel\\listoverrideformat1" +
      "{\\listlevel\\levelnfc23\\leveljc0\\levelstartat1{\\leveltext \\'01\\u183 ?;}{\\levelnumbers;}}" +
      "}\\ls1}}";
    const paragraph = paragraphsOf(
      `${HEADER}${tables}\\pard\\ls1\\ilvl0 Item\\par}`,
    )[0];
    expect(paragraph?.list?.numId).toBe("rtf1:bullet");
  });

  it("discards a {\\listtext ...} group, which a numbering-aware reader must ignore", () => {
    const paragraph = paragraphsOf(
      `${HEADER}${LIST_TABLES}\\pard\\ls1\\ilvl0{\\listtext\\f0 \\'b7\\tab}Item\\par}`,
    )[0];
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe("Item");
  });
});
