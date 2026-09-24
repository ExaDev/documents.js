import { describe, expect, it } from "vitest";
import { RtfDiagnosticCodes } from "./diagnostics";
import { writeRtfContent } from "./write";
import { wordprocessing, write } from "./test-support/wordprocessing-document";
import { roundTrip } from "./test-support/round-trip";

describe("round trip: bookmarks and residue passthrough", () => {
  it("writes a run-level bookmark anchor as the {\\*\\bkmkstart}/{\\*\\bkmkend} pair bracketing its runs", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "before " }, { text: "marked" }, { text: " after" }],
          constructs: [
            {
              descriptor: {
                kind: "anchor",
                anchorType: "bookmark",
                name: "paradigm",
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\bkmkstart paradigm}");
    expect(out).toContain("{\\*\\bkmkend paradigm}");
    expect(out.indexOf("{\\*\\bkmkstart paradigm}")).toBeLessThan(
      out.indexOf("marked"),
    );
    expect(out.indexOf("marked")).toBeLessThan(
      out.indexOf("{\\*\\bkmkend paradigm}"),
    );
    // writeRunBoundaries is called once per run position (0..3 here); each half must fire at its own single position, not once per call.
    expect(out.match(/\\bkmkstart/g)).toHaveLength(1);
    expect(out.match(/\\bkmkend/g)).toHaveLength(1);
  });

  it("writes exactly one {\\*\\bkmkstart}/{\\*\\bkmkend} pair, adjacent, for a point bookmark anchor whose start equals its end", () => {
    // A point anchor (startRun === endRun, here at position 1 of a 2-run paragraph, neither the first nor the last position) opens and closes at the identical boundary — entirely from the open loop's own point-anchor branch, never from the close loop above it, since that loop's own startRun !== position guard excludes a position where they are equal.
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "A" }, { text: "B" }],
          constructs: [
            {
              descriptor: { kind: "anchor", anchorType: "bookmark", name: "p" },
              startRun: 1,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out.match(/\\bkmkstart/g)).toHaveLength(1);
    expect(out.match(/\\bkmkend/g)).toHaveLength(1);
    expect(out).toContain("{\\*\\bkmkstart p}{\\*\\bkmkend p}");
    expect(out.indexOf("A")).toBeLessThan(out.indexOf("{\\*\\bkmkstart p}"));
    expect(out.indexOf("{\\*\\bkmkend p}")).toBeLessThan(out.indexOf("B"));
  });

  it("still closes a bookmark whose endRun is the paragraph's own runs.length, the one position only the final writeRunBoundaries call reaches", () => {
    // The loop over paragraph.runs only calls writeRunBoundaries for positions 0..runs.length-1; a dedicated final call at exactly paragraph.runs.length is the only place an extent closing after the last run gets its own {\*\bkmkend} written at all.
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "A" }, { text: "B" }],
          constructs: [
            {
              descriptor: {
                kind: "anchor",
                anchorType: "bookmark",
                name: "whole",
              },
              startRun: 0,
              endRun: 2,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\bkmkend whole}");
    expect(out.indexOf("B")).toBeLessThan(out.indexOf("{\\*\\bkmkend whole}"));
  });

  it("re-emits an rtf residue value's own control words verbatim, which is what the quarantine contract permits", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          constructs: [
            {
              descriptor: {
                kind: "anchor",
                anchorType: "bookmark",
                name: "Table1",
                source: { format: "rtf", xml: "\\bkmkcolf2\\bkmkcoll5" },
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\bkmkstart\\bkmkcolf2\\bkmkcoll5 Table1}");
  });

  it("leaves another format's residue alone rather than pasting it into RTF", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          constructs: [
            {
              descriptor: {
                kind: "anchor",
                anchorType: "bookmark",
                name: "b",
                source: { format: "docx", xml: "<w:bookmarkStart/>" },
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\bkmkstart b}");
    expect(out).not.toContain("w:bookmarkStart");
  });

  it("round-trips a block-scoped bookmark through its constructStart/constructEnd markers", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "span" },
        },
        { kind: "paragraph", runs: [{ text: "One" }] },
        { kind: "paragraph", runs: [{ text: "Two" }] },
        { kind: "constructEnd" },
      ]),
    );
    const blocks =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks : [];
    expect(blocks?.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
    ]);
  });

  it("writes no stray {\\*\\bkmkend ...} for a constructEnd with no matching constructStart at all", () => {
    // openConstructs starts empty, so popping it here must yield undefined, not a phantom leftover entry — a malformed input no real ContentDocument produces (flatten.ts guarantees balanced pairs), but the writer's own stack discipline should still degrade to nothing rather than a fabricated bookmark-end name.
    const out = write(
      wordprocessing([
        { kind: "constructEnd" },
        { kind: "paragraph", runs: [{ text: "x" }] },
      ]),
    );
    expect(out).not.toContain("\\bkmkend");
  });

  it("round-trips a run-level bookmark back onto the same runs", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "a" }, { text: "b" }, { text: "c" }],
          constructs: [
            {
              descriptor: {
                kind: "anchor",
                anchorType: "bookmark",
                name: "mid",
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ]),
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    const extent = paragraph?.constructs?.[0];
    expect(extent?.descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "mid",
    });
    expect(
      paragraph?.runs
        .slice(extent?.startRun ?? 0, extent?.endRun ?? 0)
        .map((run) => run.text)
        .join(""),
    ).toBe("b");
  });

  it("reports a construct kind RTF has no spelling for rather than writing a bookmark for it", () => {
    const diagnostics: { code: string; message: string }[] = [];
    writeRtfContent(
      wordprocessing([
        {
          kind: "constructStart",
          descriptor: {
            kind: "contentControl",
            controlType: "richText",
            tag: "T",
          },
        },
        { kind: "paragraph", runs: [{ text: "x" }] },
        { kind: "constructEnd" },
      ]),
      {
        sink: (diagnostic) => {
          diagnostics.push({
            code: diagnostic.code,
            message: diagnostic.message,
          });
        },
      },
    );
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a contentControl construct is dropped: RTF has no block-scoped structured-document-tag equivalent — a run-scoped plainText/checkbox/dropDown form field mints its own \\*\\formfield instead; any other controlType (richText, comboBox, date, and the rest) has no \\*\\formfield spelling at all",
      },
    ]);
  });
});
