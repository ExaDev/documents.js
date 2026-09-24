import { describe, expect, it } from "vitest";
import { ContentDocumentSchema } from "document-schema.js";
import type {
  ContentBlock,
  ContentParagraph,
  ContentTable,
} from "document-schema.js";
import { RtfDiagnosticCodes } from "./diagnostics";
import { readRtfContent } from "./read";
import { HEADER, blocksOf, paragraphsOf } from "./test-support/read-fixtures";
import { bytes } from "./test-support/bytes";

describe("fields and destinations", () => {
  it("reads a HYPERLINK field's target onto the runs of its own \\fldrslt", () => {
    const runs =
      paragraphsOf(
        `${HEADER}\\pard Visit {\\field{\\*\\fldinst{HYPERLINK "https://example.com/"}}{\\fldrslt{\\cf2\\ul example}}} now.\\par}`,
      )[0]?.runs ?? [];
    const linked = runs.find((run) => run.hyperlink !== undefined);
    expect(linked?.text).toBe("example");
    expect(linked?.hyperlink).toBe("https://example.com/");
    expect(runs.map((run) => run.text).join("")).toBe("Visit example now.");
  });

  it("reads a HYPERLINK field's \\\\l switch as an in-document fragment", () => {
    const runs =
      paragraphsOf(
        `${HEADER}\\pard {\\field{\\*\\fldinst{HYPERLINK \\\\l "section2"}}{\\fldrslt jump}}\\par}`,
      )[0]?.runs ?? [];
    expect(runs[0]?.hyperlink).toBe("#section2");
  });

  // Regression guard: formFieldControlType (constructs.ts) must anchor on the instruction's own leading token, not merely find FORMTEXT/FORMCHECKBOX/FORMDROPDOWN anywhere in the string — an unanchored match would fire on the identical word sitting inside an unrelated field's own switch argument, here a HYPERLINK target that happens to end in "FORMTEXT".
  it("does not mistake a HYPERLINK target containing the word FORMTEXT for a form field", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst{HYPERLINK "http://example.com/FORMTEXT"}}{\\fldrslt here}}\\par}`,
    )[0];
    expect(paragraph?.constructs ?? []).toEqual([]);
    const linked = paragraph?.runs.find((run) => run.hyperlink !== undefined);
    expect(linked?.hyperlink).toBe("http://example.com/FORMTEXT");
  });

  // Regression guard: an ordinary field (no FORMTEXT/FORMCHECKBOX/FORMDROPDOWN instruction) must not fragment the runs around it. Every run of text here — before the field, its own \fldrslt, and after it — carries identical (default) formatting, so a reader that coalesces same-key text into one run produces exactly one run; one that force-flushes at every \field boundary regardless of whether it is a genuine form field produces three.
  it("does not fragment identically-formatted text around an ordinary PAGE field into extra runs", () => {
    const runs =
      paragraphsOf(
        `${HEADER}\\pard Page {\\field{\\*\\fldinst PAGE}{\\fldrslt 1}} of many.\\par}`,
      )[0]?.runs ?? [];
    expect(runs.map((run) => run.text).join("")).toBe("Page 1 of many.");
    expect(runs).toHaveLength(1);
  });

  it("discards an unrecognised ignorable destination whole and says so", () => {
    const { diagnostics, document } = readRtfContent(
      bytes(`${HEADER}\\pard kept{\\*\\someunknowndest discarded}\\par}`),
    );
    const section =
      document.kind === "wordprocessing" ? document.sections[0] : undefined;
    const paragraph = section?.blocks[0];
    expect(
      paragraph?.kind === "paragraph"
        ? paragraph.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("kept");
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.UNKNOWN_DESTINATION_SKIPPED,
      ),
    ).toBe(true);
  });

  it("reports the exact UNKNOWN_DESTINATION_SKIPPED message text, naming the destination", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard{\\*\\notarealdestination stray}kept\\par}`),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.UNKNOWN_DESTINATION_SKIPPED,
    );
    expect(found?.message).toBe(
      "the ignorable destination \\notarealdestination is not recognised and its content is discarded, as the specification requires",
    );
  });

  it("drops a footnote's body, which the flat ContentDocument has no definitions table to hold, and says so", () => {
    const source = `${HEADER}\\pard Body{\\super\\chftn}{\\footnote\\pard\\plain\\chftn The note.}.\\par}`;
    const runs = paragraphsOf(source)[0]?.runs ?? [];
    expect(runs.map((run) => run.text).join("")).toBe("Body.");
    const found = readRtfContent(bytes(source)).diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.CONTENT_DESTINATION_SKIPPED,
    );
    expect(found?.message).toBe(
      "the \\footnote destination's content is discarded: no ContentDocument position carries it",
    );
  });

  it("reports a discarded header or footer, which has no ContentSection field to land in", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}{\\header\\pard Page header\\par}\\pard Body.\\par}`),
    );
    expect(
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.CONTENT_DESTINATION_SKIPPED,
      ),
    ).toHaveLength(1);
  });

  it("does not report a header table as a discarded content destination", () => {
    const { diagnostics } = readRtfContent(bytes(`${HEADER}\\pard x\\par}`));
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.CONTENT_DESTINATION_SKIPPED,
      ),
    ).toBe(false);
  });

  it("stays silent about a legacy destination that duplicates what it already read", () => {
    // {\*\pn ...} is Word 6/95 paragraph numbering, superseded by the \lsN/\ilvlN this reader takes, and a real Word document carries one per numbered paragraph — reporting it would bury the drops that matter.
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\pntext 1.\\tab}{\\*\\pn\\pnlvlbody\\pnstart1\\pndec}Item\\par}`,
      ),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.CONTENT_DESTINATION_SKIPPED,
      ),
    ).toBe(false);
  });

  it("reads on past an unbalanced closing brace and reports it", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard text\\par}}`),
    );
    expect(
      diagnostics.some(
        (diagnostic) => diagnostic.code === RtfDiagnosticCodes.UNBALANCED_GROUP,
      ),
    ).toBe(true);
  });
});

// RTF 1.9.1, "Bookmarks": <bookstart> is `'{\*' \bkmkstart (\bkmkcolfN? & \bkmkcollN?) #PCDATA '}'` and <bookend> is `'{\*' \bkmkend #PCDATA '}'`, so the bookmark's name is the destination's own text and "the bookmark start and end are matched with the bookmark tag".
describe("bookmarks", () => {
  it("reads a mid-paragraph bookmark as a run-level anchor extent over the runs it brackets", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard before {\\*\\bkmkstart paradigm}marked{\\*\\bkmkend paradigm} after\\par}`,
    )[0];
    const extent = paragraph?.constructs?.[0];
    expect(extent?.descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "paradigm",
    });
    expect(
      paragraph?.runs
        .slice(extent?.startRun ?? 0, extent?.endRun ?? 0)
        .map((run) => run.text)
        .join(""),
    ).toBe("marked");
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe(
      "before marked after",
    );
  });

  it("trims a bookmark's own name, since it is stated as ordinary #PCDATA rather than a delimiter-stripped control-word parameter", () => {
    // The lone space right after \bkmkstart itself is consumed as the control word's own terminating delimiter (RTF's own rule for a bare, unparameterised control word), but a SECOND space before the name — or one before the group's own closing brace — is ordinary #PCDATA and becomes part of bookmark.name verbatim unless explicitly trimmed.
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\*\\bkmkstart  padded }marked{\\*\\bkmkend padded}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      name: "padded",
    });
  });

  it("keeps a bookmark's own plain-text name intact when it opens nested inside a \\*\\objdata destination", () => {
    // \*\bkmkstart is a real, known destination (not \*\objdata's own "skip" siblings \*\objalias/\*\objsect), so it opens a genuine child group here rather than being jumped over — and that child inherits state.objectData BY REFERENCE from its \*\objdata parent, same as any other descendant, even though its own destination is "bookmarkStart", not "objectData". A text token routed by destination alone (never checking THIS group's own state.objectData against the group it actually belongs to) would fold the bookmark's own name into the object's hex payload instead of the bookmark, leaving the name empty.
    const paragraph = paragraphsOf(
      `${HEADER}\\pard{\\object\\objemb{\\*\\objdata{\\*\\bkmkstart marker}x{\\*\\bkmkend marker}00}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      name: "marker",
    });
  });

  it("keeps a bookmark's own \\'hh-escaped name intact when it opens nested inside a \\*\\objdata destination", () => {
    // The hex-escape counterpart of the fixture above: \'6d\'61\'72\'6b\'65\'72 spells "marker" one \'hh token at a time, each of which must still reach the bookmark's own name through pendingBytes/emitText rather than being diverted into the object's raw byte buffer by a destination check that never verifies THIS group is actually the \*\objdata one it inherited objectData from.
    const paragraph = paragraphsOf(
      `${HEADER}\\pard{\\object\\objemb{\\*\\objdata{\\*\\bkmkstart \\'6d\\'61\\'72\\'6b\\'65\\'72}x{\\*\\bkmkend marker}00}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      name: "marker",
    });
  });

  it("reads a bookmark with no text between its halves as a point anchor", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard here{\\*\\bkmkstart spot}{\\*\\bkmkend spot} and on\\par}`,
    )[0];
    const extent = paragraph?.constructs?.[0];
    expect(extent?.startRun).toBe(extent?.endRun);
    expect(extent?.descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "spot",
    });
  });

  it("reads a bookmark spanning several paragraphs as a constructStart/constructEnd block pair", () => {
    const blocks = blocksOf(
      `${HEADER}\\pard{\\*\\bkmkstart span}One\\par\\pard Two{\\*\\bkmkend span}\\par}`,
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
    ]);
    const start = blocks[0];
    expect(
      start?.kind === "constructStart" ? start.descriptor : undefined,
    ).toEqual({ kind: "anchor", anchorType: "bookmark", name: "span" });
  });

  it("drops the later of two disjoint bookmarks that share a paragraph boundary, rather than reconstructing them as overlapping", () => {
    // A's own \bkmkend and B's own \bkmkstart both land in the second paragraph of the same table cell — the shape ExaDev/documents.js#1040 names: block-granularity cannot express "A ends immediately before this paragraph's own remainder, which is B's" as two separate extents, since the paragraph is this reader's finest addressable unit. The two source ranges never actually overlap (A: "one"/"two", B: "three"/"four"), but a naive block-extent reconstruction would otherwise splice B nested inside A and silently reassign B's own trailing paragraph to A.
    const { document, diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\trowd\\trleft0\\cellx4320\\pard\\intbl{\\*\\bkmkstart A}one\\par\\pard\\intbl two{\\*\\bkmkend A}{\\*\\bkmkstart B}three\\par\\pard\\intbl{\\*\\bkmkend B}four\\cell\\row\\pard x\\par}`,
      ),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    const table = document.sections[0]?.blocks.find(
      (block): block is ContentTable => block.kind === "table",
    );
    const cellBlocks = table?.rows[0]?.cells[0]?.blocks ?? [];
    expect(cellBlocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
      "paragraph",
    ]);
    const start = cellBlocks[0];
    expect(
      start?.kind === "constructStart" ? start.descriptor : undefined,
    ).toEqual({ kind: "anchor", anchorType: "bookmark", name: "A" });
    // B's own text still reads correctly — only its own bookmark construct is dropped, not its content.
    const paragraphs = cellBlocks.filter(
      (block): block is ContentParagraph => block.kind === "paragraph",
    );
    expect(paragraphs.map((p) => p.runs.map((r) => r.text).join(""))).toEqual([
      "one",
      "twothree",
      "four",
    ]);
    // Adjacent runs, split apart only because startBookmark/endBookmark each flush the pending run at the marker's own position — not two genuinely different formatting spans.
    expect(paragraphs[1]?.runs).toHaveLength(2);
    const crossed = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.BLOCK_CONSTRUCT_EXTENTS_CROSSED,
    );
    expect(crossed?.message).toBe(
      "a 'anchor' construct's own block extent crosses an already-open one instead of nesting inside or sitting disjoint from it — both bookmarks likely closed and opened within the same paragraph, which this reader cannot express as two separate extents, so this one is dropped",
    );
  });

  it("quarantines \\bkmkcolfN/\\bkmkcollN as rtf residue, which no ContentDocument field carries", () => {
    // The spec's own example: "{\*\bkmkstart\bkmkcolf2\bkmkcoll5 Table1} places the bookmark 'Table1' in columns 2 through 5 of a table."
    const paragraph = paragraphsOf(
      `${HEADER}\\pard{\\*\\bkmkstart\\bkmkcolf2\\bkmkcoll5 Table1}x{\\*\\bkmkend Table1}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor.source).toEqual({
      format: "rtf",
      xml: "\\bkmkcolf2\\bkmkcoll5",
    });
  });

  it("pairs the halves by name however they are ordered, and reports one that never closes", () => {
    const { document, diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard x{\\*\\bkmkstart never}y\\par}`),
    );
    const paragraph =
      document.kind === "wordprocessing"
        ? document.sections[0]?.blocks[0]
        : undefined;
    expect(
      paragraph?.kind === "paragraph" ? paragraph.constructs : undefined,
    ).toBeUndefined();
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      RtfDiagnosticCodes.BOOKMARK_UNPAIRED,
    );
  });

  it("produces a document its own schema still accepts, markers and extents included", () => {
    const { document } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\*\\bkmkstart a}One\\par\\pard Two{\\*\\bkmkend a}\\par}`,
      ),
    );
    expect(ContentDocumentSchema.safeParse(document).success).toBe(true);
  });
});

// RTF 1.9.1, "Character Revision Mark Properties": <chrev> is `\revised? \revauthN? \revdttmN? \crauthN? \crdateN? \deleted? \revauthdelN? \revdttmdelN? \mvf? \mvt? \mvauthN? \mvdateN?`, and every one of them is a character property — so a tracked change is a run-scoped extent, never a block marker.
describe("revision marks", () => {
  // "\*\revtbl — This group consists of subgroups that each identify the author of a revision in the document, as in {Author1;}."
  const REVTBL = "{\\*\\revtbl{Unknown;}{A. Reviewer;}{B. Editor;}}";
  // 1 January 2024, 09:30, packed into the DTTM bit field the spec tabulates: minute 30, hour 9, day 1, month 1, year 2024-1900 = 124.
  const DTTM_2024_01_01_0930 =
    30 | (9 << 6) | (1 << 11) | (1 << 16) | (124 << 20);

  it("reads \\revised as an insertion whose author resolves through the revision table", () => {
    const paragraph = paragraphsOf(
      `${HEADER}${REVTBL}\\pard kept \\revised\\revauth1\\revdttm${String(DTTM_2024_01_01_0930)} added\\revised0  more\\par}`,
    )[0];
    const extent = paragraph?.constructs?.[0];
    expect(extent?.descriptor).toEqual({
      kind: "provenance",
      change: "insertion",
      author: "A. Reviewer",
      dateIso: "2024-01-01T09:30:00",
    });
    expect(
      paragraph?.runs
        .slice(extent?.startRun ?? 0, extent?.endRun ?? 0)
        .map((run) => run.text)
        .join(""),
      // The single space after \revdttmN is that control word's own delimiter, not text, so the inserted run begins at 'added'.
    ).toBe("added");
  });

  it("carries deleted text rather than dropping it, which is the whole point of the provenance kind", () => {
    const paragraph = paragraphsOf(
      `${HEADER}${REVTBL}\\pard kept \\deleted\\revauthdel2 gone\\deleted0  kept\\par}`,
    )[0];
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe(
      "kept gone kept",
    );
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "provenance",
      change: "deletion",
      author: "B. Editor",
    });
  });

  it("reads \\mvf and \\mvt as the move pair", () => {
    const first = paragraphsOf(
      `${HEADER}${REVTBL}\\pard \\mvf\\mvauth1 moved out\\par}`,
    )[0];
    const second = paragraphsOf(
      `${HEADER}${REVTBL}\\pard \\mvt\\mvauth1 moved in\\par}`,
    )[0];
    expect(first?.constructs?.[0]?.descriptor).toMatchObject({
      kind: "provenance",
      change: "moveFrom",
    });
    expect(second?.constructs?.[0]?.descriptor).toMatchObject({
      kind: "provenance",
      change: "moveTo",
    });
  });

  it("reads \\crauthN as a format change, the one revision with no flag of its own", () => {
    const paragraph = paragraphsOf(
      `${HEADER}${REVTBL}\\pard \\crauth2\\crdate${String(DTTM_2024_01_01_0930)}\\b restyled\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      kind: "provenance",
      change: "formatChange",
      author: "B. Editor",
    });
  });

  it("carries one extent per change kind when a run is both inserted and format-changed", () => {
    const paragraph = paragraphsOf(
      `${HEADER}${REVTBL}\\pard \\revised\\revauth1\\crauth2 both\\par}`,
    )[0];
    expect(
      paragraph?.constructs?.map((extent) =>
        extent.descriptor.kind === "provenance"
          ? extent.descriptor.change
          : undefined,
      ),
    ).toEqual(["insertion", "formatChange"]);
  });

  it("coalesces adjacent runs carrying the same revision into one extent", () => {
    const paragraph = paragraphsOf(
      `${HEADER}${REVTBL}\\pard \\revised\\revauth1 one\\b two\\b0 three\\par}`,
    )[0];
    expect(paragraph?.runs).toHaveLength(3);
    expect(paragraph?.constructs).toHaveLength(1);
    expect(paragraph?.constructs?.[0]).toMatchObject({
      startRun: 0,
      endRun: 3,
    });
  });

  it("omits the author when the index names no revision table entry, rather than inventing one", () => {
    const paragraph = paragraphsOf(
      `${HEADER}${REVTBL}\\pard \\revised\\revauth9 orphan\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "provenance",
      change: "insertion",
    });
  });

  it("omits the date for a zero \\revdttmN, which records no time rather than the year 1900", () => {
    const paragraph = paragraphsOf(
      `${HEADER}${REVTBL}\\pard \\revised\\revauth1\\revdttm0 undated\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "provenance",
      change: "insertion",
      author: "A. Reviewer",
    });
  });

  it("scopes a revision to its group, as every other character property is scoped", () => {
    const paragraph = paragraphsOf(
      `${HEADER}${REVTBL}\\pard plain {\\revised\\revauth1 inserted} plain again\\par}`,
    )[0];
    const extent = paragraph?.constructs?.[0];
    expect(
      paragraph?.runs
        .slice(extent?.startRun ?? 0, extent?.endRun ?? 0)
        .map((run) => run.text)
        .join(""),
    ).toBe("inserted");
  });
});

describe("block-scoped construct extent ordering", () => {
  it("returns the block list itself, not undefined, when there are genuinely no extents to splice at all", () => {
    // No bookmark anywhere in this document, so sectionBlockExtents is empty and insertConstructMarkers' own fast path is what actually produces the section's blocks — an emptied fast path would hand endSection undefined instead of the real block list.
    const blocks = blocksOf(`${HEADER}\\pard one\\par\\pard two\\par}`);
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "one", sizePt: 12 }] },
      { kind: "paragraph", runs: [{ text: "two", sizePt: 12 }] },
    ]);
  });

  function anchorNameOf(block: ContentBlock | undefined): string | undefined {
    return block?.kind === "constructStart" &&
      block.descriptor.kind === "anchor"
      ? block.descriptor.name
      : undefined;
  }

  it("nests a shorter extent inside a longer one that opens at the identical start index", () => {
    // "outer" and "inner" both start in the first paragraph — tied startIndex — but "outer" spans one paragraph further before its own \bkmkend, so at that tie the longer extent must sort first (open outermost).
    const blocks = blocksOf(
      `${HEADER}\\pard{\\*\\bkmkstart outer}{\\*\\bkmkstart inner}One\\par\\pard Two{\\*\\bkmkend inner}\\par\\pard Three{\\*\\bkmkend outer}\\par}`,
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
      "paragraph",
      "constructEnd",
    ]);
    expect(anchorNameOf(blocks[0])).toBe("outer");
    expect(anchorNameOf(blocks[1])).toBe("inner");
  });

  it("keeps two disjoint extents in their own start order, earlier-starting first, when their spans do not tie", () => {
    // "first" and "second" open at genuinely different, non-tied start indices — the sort's own first comparator clause (by startIndex) is what this fixture exercises, distinct from the tied-start case above.
    const blocks = blocksOf(
      `${HEADER}\\pard{\\*\\bkmkstart first}One\\par\\pard Two{\\*\\bkmkend first}\\par\\pard{\\*\\bkmkstart second}Three\\par\\pard Four{\\*\\bkmkend second}\\par}`,
    );
    const starts = blocks.filter((block) => block.kind === "constructStart");
    expect(starts.map((block) => anchorNameOf(block))).toEqual([
      "first",
      "second",
    ]);
  });

  it("keeps a shorter extent nested inside a longer one that shares its exact end index, rather than dropping it as crossing", () => {
    // "inner" starts strictly after "outer" but closes at the SAME index "outer" does — true nesting with a shared endpoint, not a crossing pair. If the crossing check's own end-side comparison read "greater than or equal to" instead of strictly "greater than", this exact tie would be misread as a cross and "inner" would be dropped.
    const blocks = blocksOf(
      `${HEADER}\\pard{\\*\\bkmkstart outer}Zero\\par\\pard{\\*\\bkmkstart inner}One\\par\\pard Two\\par\\pard Three{\\*\\bkmkend outer}{\\*\\bkmkend inner}\\par}`,
    );
    const starts = blocks.filter((block) => block.kind === "constructStart");
    expect(starts.map((block) => anchorNameOf(block))).toEqual([
      "outer",
      "inner",
    ]);
    expect(
      blocks.filter((block) => block.kind === "constructEnd"),
    ).toHaveLength(2);
  });

  it("still sorts an inner extent's later start ahead of an outer one's earlier start when the inner extent closes — and so is pushed into the pending list — first", () => {
    // "outer" opens before "inner" does but closes after it, so "inner" is the one whose \bkmkend is seen first and is therefore the one flushClosingBookmarks pushes into sectionBlockExtents first — the pre-sort array order here is [inner, outer], the REVERSE of correct start order. If the sort's own first comparator clause summed the two startIndex values instead of subtracting them, the comparator would return the same (wrong-signed) result regardless of which extent it was asked about first — since addition is commutative — and never trigger the swap this out-of-order push requires, leaving "inner" sorted ahead of "outer". dropCrossingExtents would then see "outer" arrive after "inner" already claimed the first slot and misread the true nesting as a cross, dropping "outer" entirely.
    const blocks = blocksOf(
      `${HEADER}\\pard{\\*\\bkmkstart outer}Zero\\par\\pard{\\*\\bkmkstart inner}One\\par\\pard{\\*\\bkmkend inner}Two\\par\\pard{\\*\\bkmkend outer}Three\\par}`,
    );
    const starts = blocks.filter((block) => block.kind === "constructStart");
    expect(starts.map((block) => anchorNameOf(block))).toEqual([
      "outer",
      "inner",
    ]);
    expect(
      blocks.filter((block) => block.kind === "constructEnd"),
    ).toHaveLength(2);
  });
});

describe("bookmark bookkeeping", () => {
  it("never routes a nested destination's own text into the enclosing bookmark's own name, even one sharing state.bookmark by reference", () => {
    // \listtext is a real, known destination ("listText", not "body", not "fieldInstruction", not any of the formField* destinations already checked above) that can genuinely nest inside a \*\bkmkstart group while inheriting state.bookmark by reference — the same shape the \*\ud-inside-\*\fldinst fixture elsewhere in this file exercises for state.field. A check keyed on state.bookmark's own definedness alone, without also requiring THIS group's own destination to genuinely be bookmarkStart/bookmarkEnd, would append "stray" straight into the bookmark's own name instead of silently discarding it (the trailing comment on this whole if-chain: "listText" ... discard).
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\*\\bkmkstart{\\listtext stray}name}marked{\\*\\bkmkend name}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      name: "name",
    });
  });

  it("silently drops a bookmark start whose own name is empty, never opening an extent for it", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard before {\\*\\bkmkstart}marked{\\*\\bkmkend}after\\par}`,
    )[0];
    expect(paragraph?.constructs ?? []).toEqual([]);
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe(
      "before markedafter",
    );
  });

  it("reports the exact \\bkmkend-with-no-\\bkmkstart diagnostic message, naming the orphaned bookmark", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard x{\\*\\bkmkend orphan}\\par}`),
    );
    const found = diagnostics.find(
      (diagnostic) => diagnostic.code === RtfDiagnosticCodes.BOOKMARK_UNPAIRED,
    );
    expect(found?.message).toBe(
      "a \\bkmkend named 'orphan' has no matching \\bkmkstart, so no anchor construct is produced for it",
    );
  });

  it("reports the exact table-cell-boundary-straddling diagnostic message, naming the bookmark", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\trowd\\trleft0\\cellx4320\\pard\\intbl{\\*\\bkmkstart straddler}one\\par\\pard\\intbl two\\cell\\row\\pard{\\*\\bkmkend straddler}after\\par}`,
      ),
    );
    const found = diagnostics.find(
      (diagnostic) => diagnostic.code === RtfDiagnosticCodes.BOOKMARK_UNPAIRED,
    );
    expect(found?.message).toBe(
      "the bookmark 'straddler' spans a table cell boundary; a construct extent cannot straddle two block lists, so no anchor construct is produced for it",
    );
  });

  it("resolves a bookmark's own \\bkmkcolfN/\\bkmkcollN range only when at least one of the pair is stated", () => {
    // Naming only \bkmkcolf without \bkmkcoll (or vice versa) is spec-legal ("These controls are used within the \*\bkmkstart destination"), and must still produce a source-residue clause — neither field being stated at all is the only case with no clause.
    const first = paragraphsOf(
      `${HEADER}\\pard{\\*\\bkmkstart\\bkmkcolf3 First}x{\\*\\bkmkend First}\\par}`,
    )[0];
    expect(first?.constructs?.[0]?.descriptor.source).toEqual({
      format: "rtf",
      xml: "\\bkmkcolf3",
    });
    const second = paragraphsOf(
      `${HEADER}\\pard{\\*\\bkmkstart\\bkmkcoll7 Second}x{\\*\\bkmkend Second}\\par}`,
    )[0];
    expect(second?.constructs?.[0]?.descriptor.source).toEqual({
      format: "rtf",
      xml: "\\bkmkcoll7",
    });
    const neither = paragraphsOf(
      `${HEADER}\\pard{\\*\\bkmkstart Plain}x{\\*\\bkmkend Plain}\\par}`,
    )[0];
    expect(neither?.constructs?.[0]?.descriptor.source).toBeUndefined();
  });

  it("actually removes a resolved bookmark from the open set, so a same-named start opened afterwards is not confused with the first", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\*\\bkmkstart dup}first{\\*\\bkmkend dup} between {\\*\\bkmkstart dup}second{\\*\\bkmkend dup}\\par}`,
    )[0];
    expect(paragraph?.constructs).toHaveLength(2);
    const [firstExtent, secondExtent] = paragraph?.constructs ?? [];
    expect(firstExtent?.startRun).not.toBe(secondExtent?.startRun);
  });

  it("genuinely deletes a resolved bookmark from the open set, so a second \\bkmkend for the same name reports it as unpaired rather than resolving twice", () => {
    // If endBookmark's own delete call were a no-op, 'dup' would still be sitting in openBookmarks when the second bkmkend arrives: it would be silently (and wrongly) treated as still open instead of triggering the bkmkend-with-no-bkmkstart diagnostic here, AND it would still be open at the document's own end, triggering reportUnclosedBookmarks' own "has no matching \\bkmkend" diagnostic instead — a DIFFERENT diagnostic that also names 'dup' and would, wrongly, still leave the naive count-only assertion this replaced at exactly one match, masking the missing delete entirely. Asserting the exact message (not just a length-one count of anything mentioning 'dup') is what actually distinguishes the two.
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard {\\*\\bkmkstart dup}one{\\*\\bkmkend dup}{\\*\\bkmkend dup}\\par}`,
      ),
    );
    const unpaired = diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.BOOKMARK_UNPAIRED &&
        diagnostic.message.includes("dup"),
    );
    expect(unpaired).toHaveLength(1);
    expect(unpaired[0]?.message).toBe(
      "a \\bkmkend named 'dup' has no matching \\bkmkstart, so no anchor construct is produced for it",
    );
  });
});
