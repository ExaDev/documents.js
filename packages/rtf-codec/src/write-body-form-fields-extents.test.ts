import { describe, expect, it } from "vitest";
import { RtfDiagnosticCodes } from "./diagnostics";
import { asciiText } from "./test-support/bytes";
import { expectBalancedBraces } from "./test-support/brace-balance";
import { writeRtfContent } from "./write";
import { wordprocessing, write } from "./test-support/wordprocessing-document";

describe("form field extent handling: unsupported control types, balanced braces, and crossing/nested extents", () => {
  it("reports a contentControl controlType RTF's own form-field vocabulary does not cover, rather than minting nothing silently — and mints no unbalanced braces for it", () => {
    const diagnostics: { code: string; message: string }[] = [];
    const out = asciiText(
      writeRtfContent(
        wordprocessing([
          {
            kind: "paragraph",
            runs: [{ text: "x" }],
            constructs: [
              {
                descriptor: {
                  kind: "contentControl",
                  controlType: "richText",
                },
                startRun: 0,
                endRun: 1,
              },
            ],
          },
        ]),
        {
          sink: (diagnostic) => {
            diagnostics.push({
              code: diagnostic.code,
              message: diagnostic.message,
            });
          },
        },
      ),
    );
    // The dropped extent is run-scoped — it never reaches openConstruct/closeConstruct's own block-scoped handling at all — so the message must lead with the reason that is actually true of it (no \*\formfield spelling for this controlType), not describeConstructGap's block-scoped wording, which answers why a genuinely block-scoped construct has nothing to open in the first place.
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a contentControl construct is dropped: RTF has no \\*\\formfield spelling for a 'richText' controlType — only plainText/checkbox/dropDown form fields mint one",
      },
    ]);
    // The regression this guards: an unrepresentable controlType must mint no open half either, or the writer emits the extent's close "}}" unpaired and corrupts the rest of the document's brace balance.
    expectBalancedBraces(out);
  });

  it("mints balanced braces for a paragraph mixing a real form field with an unrepresentable one", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "a" }, { text: "b" }, { text: "c" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "checkbox",
                checked: true,
              },
              startRun: 0,
              endRun: 0,
            },
            {
              descriptor: { kind: "contentControl", controlType: "comboBox" },
              startRun: 1,
              endRun: 2,
            },
            {
              descriptor: {
                kind: "contentControl",
                controlType: "dropDown",
                options: ["x"],
              },
              startRun: 3,
              endRun: 3,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("FORMCHECKBOX");
    expect(out).toContain("FORMDROPDOWN");
    expect(out).not.toContain("COMBOBOX");
    expectBalancedBraces(out);
  });

  // Regression for a round-2 fix that only patched the symptom for a controlType FORM_FIELD_SPEC does not cover, without making the writer structurally incapable of leaving a field group unmatched for every other malformed-looking range. writeFormFieldBoundaries is only ever called for positions 0..paragraph.runs.length, so an extent whose own endRun exceeds that range never reaches a position where its close would fire from that method alone — only the drain step in writeParagraph closes it.
  it("mints a balanced close for a form field extent whose endRun exceeds the paragraph's own runs.length", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "a" }, { text: "b" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "checkbox",
                checked: true,
              },
              startRun: 1,
              endRun: 5,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("FORMCHECKBOX");
    expectBalancedBraces(out);
  });

  // Regression for a real defect the round-2 brace-balance fix introduced: an extent with startRun > endRun let the close loop run at its endRun position before the open loop ever reached its startRun, so `opened.has(extent)` read false there and the close was (correctly, at that position) skipped — but nothing revisited that endRun once the open finally happened later, leaving the open half unmatched for the rest of the document.
  it("mints a balanced close for a form field extent whose startRun is after its own endRun", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "a" }, { text: "b" }, { text: "c" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "checkbox",
                checked: false,
              },
              startRun: 2,
              endRun: 0,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("FORMCHECKBOX");
    expectBalancedBraces(out);
  });

  // Regression guard: two contentControl extents that CROSS (neither nests inside or around the other) have no valid brace sequence in RTF at all — verified by execution before this fix existed: {startRun:0,endRun:2} and {startRun:1,endRun:3} on three runs produced output where the first extent's own closing braces closed the second field's groups and vice versa, brace-balanced overall but mis-nested throughout. The correct behaviour is to keep the earlier-starting extent intact, drop the one that crosses it (reporting why), and never let run 'c' — outside both extents' own union — end up trapped inside either field's \fldrslt.
  it("drops a contentControl extent that crosses another rather than mis-nesting both", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "a" }, { text: "b" }, { text: "c" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "F1",
              },
              startRun: 0,
              endRun: 2,
            },
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "F2",
              },
              startRun: 1,
              endRun: 3,
            },
          ],
        },
      ]),
    );
    expectBalancedBraces(out);
    // F1 alone wraps runs 0 and 1 ('a','b'); F2 never opens at all, so run 'c' sits outside any field rather than trapped inside a mis-closed one.
    expect(out).toContain("{\\*\\ffname F1}");
    expect(out).not.toContain("{\\*\\ffname F2}");
    expect(out.indexOf("{a}")).toBeLessThan(out.indexOf("{b}"));
    expect(out.indexOf("{b}")).toBeLessThan(out.indexOf("}}{c}"));
  });

  it("reports the crossing drop above through the diagnostic sink, naming why", () => {
    const diagnostics: { code: string; message: string }[] = [];
    writeRtfContent(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "a" }, { text: "b" }, { text: "c" }],
          constructs: [
            {
              descriptor: { kind: "contentControl", controlType: "plainText" },
              startRun: 0,
              endRun: 2,
            },
            {
              descriptor: { kind: "contentControl", controlType: "plainText" },
              startRun: 1,
              endRun: 3,
            },
          ],
        },
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
          "a contentControl construct is dropped: it crosses another contentControl extent in the same paragraph (starts before that extent ends but ends after it too), and RTF's \\*\\formfield destination can only nest properly, never cross",
      },
    ]);
  });

  // Exercises selectNestableFormFields' own sort, stack-popping boundary, and crossing check together: A(0,3) and B(0,2) share a startRun, so only the tie-break (wider first) puts A ahead of B; C(2,4) starts exactly where B ends (the pop boundary is inclusive: B must be popped, not merely still-open) and then genuinely crosses A, since C ends past A's own close. Fed in shuffled order (C, B, A) — neither the sort's own reordering nor its tie-break is a no-op against this input, unlike an already-startRun-sorted fixture.
  it("sorts a shuffled run of extents by startRun (tie-broken widest-first) before its stack-based crossing check, popping a closed extent exactly at its own endRun boundary", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "C",
              },
              startRun: 2,
              endRun: 4,
            },
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "B",
              },
              startRun: 0,
              endRun: 2,
            },
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "A",
              },
              startRun: 0,
              endRun: 3,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\ffname A}");
    expect(out).toContain("{\\*\\ffname B}");
    expect(out).not.toContain("{\\*\\ffname C}");
    expectBalancedBraces(out);
  });

  it("pops a stack entry exactly at its own endRun before checking a sibling starting there, not one position late", () => {
    // A(0,4) encloses both B(0,2) and C(2,3). B must be POPPED once C's startRun(2) reaches its own endRun(2) — not merely still sit on the stack — or C's own crossing check would wrongly compare itself against B's endRun(2) instead of A's(4), rejecting a C that is genuinely nested inside A and merely adjacent to (not crossing) B.
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "A",
              },
              startRun: 0,
              endRun: 4,
            },
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "B",
              },
              startRun: 0,
              endRun: 2,
            },
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "C",
              },
              startRun: 2,
              endRun: 3,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\ffname A}");
    expect(out).toContain("{\\*\\ffname B}");
    expect(out).toContain("{\\*\\ffname C}");
    expectBalancedBraces(out);
  });

  // The exact endRun boundary at the other end of the crossing check: an extent that ends at precisely the same run as an already-open one is nested (sharing a closing boundary), not crossing it — extent.endRun > top.endRun must stay strict.
  it("does not treat an extent ending exactly where its enclosing one does as crossing it", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "a" }, { text: "b" }, { text: "c" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Outer",
              },
              startRun: 0,
              endRun: 3,
            },
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Inner",
              },
              startRun: 1,
              endRun: 3,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\ffname Outer}");
    expect(out).toContain("{\\*\\ffname Inner}");
    expectBalancedBraces(out);
  });

  it("closes two nested extents sharing the same endRun in the same pass, not just the innermost one", () => {
    // Outer(0,2) and Inner(1,2) both close at position 2 — writeFormFieldBoundaries' own close loop must pop Inner, then RE-PEEK the stack and find Outer still due at the identical position, closing it too in the same call. A run following position 2 is what actually distinguishes this from the sibling "ending exactly where its enclosing one does" test above, whose own shared endRun (3) is the paragraph's last position — there the paragraph-end drain would close both regardless of whether the re-peek ever ran.
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "a" }, { text: "b" }, { text: "after" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Outer",
              },
              startRun: 0,
              endRun: 2,
            },
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Inner",
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{after}");
    expect(out).not.toContain("{after}}}");
    expect(out).not.toContain("{after}}}}}");
    // Both fields' own close sequences land back to back, immediately before "after" — not with "after" swallowed inside either.
    expect(out.indexOf("{after}")).toBeGreaterThan(
      out.indexOf("{\\*\\ffname Inner}"),
    );
    expectBalancedBraces(out);
  });

  // The non-crossing counterpart to the two tests above: one contentControl extent properly NESTED inside another (not merely overlapping) is a shape RTF's own bracket structure handles natively, so both must still be written — this pins that selectNestableFormFields's crossing check does not also reject legitimate nesting.
  it("keeps both contentControl extents when one is properly nested inside the other, not merely overlapping", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "a" }, { text: "b" }, { text: "c" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Outer",
              },
              startRun: 0,
              endRun: 3,
            },
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Inner",
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\ffname Outer}");
    expect(out).toContain("{\\*\\ffname Inner}");
    expectBalancedBraces(out);
  });
});
