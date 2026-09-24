import { describe, expect, it } from "vitest";
import { RtfDiagnosticCodes } from "./diagnostics";
import { writeRtfContent } from "./write";
import { wordprocessing, write } from "./test-support/wordprocessing-document";

describe("construct-boundary and bookmark diagnostics", () => {
  it("reports rather than silently dropping a construct boundary marker RTF cannot spell", () => {
    const diagnostics: { code: string; message: string }[] = [];
    writeRtfContent(
      // A footnote anchor rather than a bookmark: a bookmark now has a real {\*\bkmkstart ...} spelling, while a footnote's body would need the note destination this package does not place.
      wordprocessing([
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType: "footnote", name: "1" },
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
          "a anchor construct is dropped: RTF has no spelling for a 'footnote' anchor, whose body would need the note or annotation destination this reader does not place",
      },
    ]);
  });

  it("reports why a block-scoped provenance marker has no spelling, distinct from the run-level <chrev> path", () => {
    const diagnostics: { code: string; message: string }[] = [];
    writeRtfContent(
      wordprocessing([
        {
          kind: "constructStart",
          descriptor: { kind: "provenance", change: "insertion" },
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
          "a provenance construct is dropped: RTF has no block-scoped revision mark: its <chrev> production is a character property, so a tracked change reaches RTF only as a run-level extent",
      },
    ]);
  });

  it("reports why a block-scoped field marker has no spelling", () => {
    const diagnostics: { code: string; message: string }[] = [];
    writeRtfContent(
      wordprocessing([
        {
          kind: "constructStart",
          descriptor: { kind: "field", instruction: "PAGE" },
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
          "a field construct is dropped: RTF has no block-scoped field: a field is a character-stream construct, written from a run's own hyperlink rather than from a block marker",
      },
    ]);
  });

  it("reports why a block-scoped link marker has no spelling", () => {
    const diagnostics: { code: string; message: string }[] = [];
    writeRtfContent(
      wordprocessing([
        {
          kind: "constructStart",
          descriptor: {
            kind: "link",
            target: { kind: "external", uri: "https://example.com" },
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
          "a link construct is dropped: RTF has no block-scoped link; an external target rides ContentRun.hyperlink instead",
      },
    ]);
  });

  it("falls back to a generic gap description for a construct kind describeConstructGap has no specific case for", () => {
    const diagnostics: { code: string; message: string }[] = [];
    writeRtfContent(
      wordprocessing([
        {
          kind: "constructStart",
          descriptor: { kind: "division" },
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
          "a division construct is dropped: RTF has no equivalent construct",
      },
    ]);
  });

  it("keeps an outer bookmark's own close matched to its own open, across a nested dropped construct's open/close pair", () => {
    // openConstruct pushes a placeholder (undefined) for a dropped, non-bookmark construct precisely so closeConstruct's later pop() still finds the RIGHT entry — the enclosing bookmark's own name, not the placeholder's construct's — when the two are nested rather than siblings. Without that placeholder, the footnote's own close would pop the outer bookmark's name early (writing its {\*\bkmkend} right after "A"), and the outer bookmark's real close would then find the stack already empty and write nothing at all.
    const out = write(
      wordprocessing([
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "outer" },
        },
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType: "footnote", name: "1" },
        },
        { kind: "paragraph", runs: [{ text: "A" }] },
        { kind: "constructEnd" },
        { kind: "paragraph", runs: [{ text: "B" }] },
        { kind: "constructEnd" },
      ]),
    );
    expect(out).toContain("{\\*\\bkmkend outer}");
    expect(out.indexOf("{\\*\\bkmkend outer}")).toBeGreaterThan(
      out.indexOf("B"),
    );
  });
});
