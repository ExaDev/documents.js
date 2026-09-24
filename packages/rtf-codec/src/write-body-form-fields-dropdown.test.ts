import { describe, expect, it } from "vitest";
import { RtfDiagnosticCodes } from "./diagnostics";
import { asciiText } from "./test-support/bytes";
import { expectBalancedBraces } from "./test-support/brace-balance";
import { writeRtfContent } from "./write";
import { wordprocessing, write } from "./test-support/wordprocessing-document";

describe("dropDown form fields", () => {
  it("reports a dropDown field's checked state through the diagnostic sink, rather than dropping it silently", () => {
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
                  controlType: "dropDown",
                  options: ["Hello", "Guten Tag"],
                  checked: true,
                },
                startRun: 0,
                endRun: 0,
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
    expect(out).toContain("{\\*\\ffl Hello}");
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a dropDown contentControl's checked state (true) is dropped: a dropdown has no boolean checked state at all, in RTF or in the harmonised contentControl vocabulary itself",
      },
    ]);
    expectBalancedBraces(out);
  });

  it("writes no diagnostic for a dropDown with no recorded `checked`", () => {
    const codes: string[] = [];
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
                  controlType: "dropDown",
                  options: ["Hello", "Guten Tag"],
                },
                startRun: 0,
                endRun: 0,
              },
            ],
          },
        ]),
        {
          sink: (diagnostic) => {
            codes.push(diagnostic.code);
          },
        },
      ),
    );
    expect(codes).not.toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
    expectBalancedBraces(out);
  });

  it("writes a dropDown contentControl's options as \\*\\ffl entries", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Guten Tag" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "dropDown",
                options: ["Hello", "Guten Tag"],
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\fldinst FORMDROPDOWN {\\*\\formfield{");
    // \fftype2 is RTF 1.5's own "Form field type: ... 2 List".
    expect(out).toContain("\\fftype2");
    expect(out).toContain("{\\*\\ffl Hello}");
    expect(out).toContain("{\\*\\ffl Guten Tag}");
    expectBalancedBraces(out);
  });

  // [MS-DOC] 2.9.79 FFDataBits.fHasListBox MUST be 1 when iType is iTypeDrop; [MS-DOC] 2.9.78 FFData.wDef "MUST exist if and only if" iType is iTypeChck or iTypeDrop is a real MS-DOC production rule this codec deliberately does not always satisfy here: a dropdown with options but no recorded selection has no genuine default to report, and a real producer would spell that as \ffres25 (FFDataBits' own undefined-selection sentinel) plus a genuine \ffdefres0 rather than omitting both — but this writer's own reader deliberately falls \ffres25 through to \ffdefres (to recover a real checkbox's meaningful reset default instead of reading it as unchecked), so emitting that exact pair here would read back as "option 0 is selected" rather than "nothing is selected"; omitting both instead round-trips cleanly through this reader's own hand-edited read-form-fields.test.ts fixture ("leaves a FORMDROPDOWN's value unset when neither \ffres nor \ffdefres is present at all"), at the cost of not matching the form a real producer would write for the same case.
  it("writes \\ffhaslistbox for a dropDown with options but no recorded selection, minting neither \\ffres nor \\ffdefres", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Guten Tag" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "dropDown",
                options: ["Hello", "Guten Tag"],
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\ffhaslistbox1");
    expect(out).not.toContain("\\ffdefres");
    expect(out).not.toContain("\\ffres");
    expectBalancedBraces(out);
  });

  // [MS-DOC] 2.9.79 FFDataBits.fHasListBox "MUST be 1 if iType is iTypeDrop (2)" with no carve-out for a dropdown that happens to carry no options — a real, common shape this ecosystem's own docx/odf readers can produce (ExaDev/documents.js#1016). An earlier version of this writer gated \ffhaslistbox behind `options !== undefined`, so a dropDown with no options minted \fftype2 alone: a fftype naming a list field with no \*\formfield data backing that claim at all.
  it("writes \\ffhaslistbox for a dropDown with no options at all, rather than minting \\fftype2 with no formfield data to back it", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          constructs: [
            {
              descriptor: { kind: "contentControl", controlType: "dropDown" },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\fftype2");
    expect(out).toContain("\\ffhaslistbox1");
    // FFData.wDef "MUST be less than the number of items in the dropdown list box" — with zero items there is no valid index, so this writer mints none at all rather than an invalid \ffdefres0.
    expect(out).not.toContain("\\ffdefres");
    expect(out).not.toContain("\\ffres");
    expectBalancedBraces(out);
  });

  it("writes \\ffhaslistbox for a dropDown with an empty options array, and still mints no \\ffdefres", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "dropDown",
                options: [],
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\fftype2");
    expect(out).toContain("\\ffhaslistbox1");
    // 0 is not less than 0 items, so an empty array is exactly as invalid a target for \ffdefres0 as no array at all.
    expect(out).not.toContain("\\ffdefres");
    expect(out).not.toContain("\\ffres");
    expectBalancedBraces(out);
  });

  it("mints neither \\ffres nor \\ffdefres for a dropDown whose value names none of its own options, rather than silently selecting a different entry", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "dropDown",
                options: ["Hello", "Guten Tag"],
                value: "Bonjour",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\ffhaslistbox1");
    // The regression this guards: an earlier version of this writer's `indexOf` returning -1 for an unmatched value was indistinguishable from -1 for "no value recorded at all", so it minted \ffdefres0 either way — silently picking "Hello" for a document that actually recorded "Bonjour". Neither \ffres nor \ffdefres should exist at all for this shape.
    expect(out).not.toContain("\\ffdefres");
    expect(out).not.toContain("\\ffres");
    expectBalancedBraces(out);
  });

  // An empty string that matches none of `options` (as here, where the list is ["Hello", "Guten Tag"]) is treated as "no selection was ever recorded" rather than as a genuine mismatch to report — firing the unmatched-value diagnostic for it would be indistinguishable from a real mismatch like "Bonjour" above, which is a materially different fact to report. This is decided by `indexOf` returning -1, exactly like any other non-matching value, NOT by a blanket "empty string means no value" rule: see the sibling test directly below, where `options` genuinely contains the empty string and value:'' is therefore a real, matched selection.
  it("mints neither \\ffres nor \\ffdefres, and reports no diagnostic, for a dropDown whose value is an empty string that matches none of its options", () => {
    const codes: string[] = [];
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
                  controlType: "dropDown",
                  options: ["Hello", "Guten Tag"],
                  value: "",
                },
                startRun: 0,
                endRun: 1,
              },
            ],
          },
        ]),
        {
          sink: (diagnostic) => {
            codes.push(diagnostic.code);
          },
        },
      ),
    );
    expect(out).toContain("\\ffhaslistbox1");
    expect(out).not.toContain("\\ffdefres");
    expect(out).not.toContain("\\ffres");
    expect(codes).not.toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
    expectBalancedBraces(out);
  });

  // The regression this guards: an earlier version of this writer folded `descriptor.value.length === 0` into the same branch as `descriptor.value === undefined`, which discarded this selection entirely — neither \ffres nor \ffdefres, with no diagnostic — even though the empty string names a real, indexable option here (index 0). This codec's own reader can produce exactly this descriptor shape from real RTF bytes (a genuine PHPRtfLite-style dropdown whose current selection is a blank list entry), so a read-then-write round trip of a document this package itself emits must not silently lose the selection.
  it("mints \\ffdefres0\\ffres0 for a dropDown whose value is an empty string that matches a real empty-string option", () => {
    const codes: string[] = [];
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
                  controlType: "dropDown",
                  options: ["", "Hello"],
                  value: "",
                },
                startRun: 0,
                endRun: 1,
              },
            ],
          },
        ]),
        {
          sink: (diagnostic) => {
            codes.push(diagnostic.code);
          },
        },
      ),
    );
    expect(out).toContain("\\ffdefres0\\ffres0");
    expect(codes).not.toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
    expectBalancedBraces(out);
  });

  it("reports a dropDown's unmatched value through the diagnostic sink, rather than dropping it silently", () => {
    const codes: string[] = [];
    writeRtfContent(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "dropDown",
                options: ["Hello", "Guten Tag"],
                value: "Bonjour",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
      {
        sink: (diagnostic) => {
          codes.push(diagnostic.code);
        },
      },
    );
    expect(codes).toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
  });

  // A dropDown with no options recorded at all is a distinct shape from one whose options exist but don't contain `value`: `options` itself is undefined here, so `value` names none of a list that does not exist either. This should degrade identically to the unmatched-value case above — the sink still fires, since a recorded value with nowhere to write it is data loss regardless of whether the option list is empty, absent, or merely missing the one entry that was picked.
  it("reports a dropDown's value through the diagnostic sink when no options list exists at all to match it against", () => {
    // allOptions is undefined here, so truncatedAway (allOptions?.includes(...) ?? false) can only ever be false — this is the one shape that pins the ?? fallback's own value, distinct from every other dropDown test, where allOptions is always defined.
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
                  controlType: "dropDown",
                  value: "Bonjour",
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
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a dropDown contentControl's selected value 'Bonjour' is dropped: it does not match any of the field's own options, and \\ffres/\\ffdefres can only name a real index into that list",
      },
    ]);
    expect(out).not.toContain("\\ffdefres");
    expect(out).not.toContain("\\ffres");
    expectBalancedBraces(out);
  });

  // [MS-DOC] 2.9.78 FFData.hsttbDropList "MUST NOT exceed 25" entries — not an arbitrary limit, since FFDataBits' own iRes field reserves index 25 as its "undefined selection" sentinel (FORM_FIELD_RESULT_UNDEFINED in constructs.ts). A 26th option would sit exactly where a real Word/DOC consumer expects "no selection".
  it("truncates a dropDown's options at the MS-DOC 25-entry cap and reports it through the diagnostic sink", () => {
    const diagnostics: { code: string; message: string }[] = [];
    const options = Array.from(
      { length: 30 },
      (_, index) => `Option ${String(index)}`,
    );
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
                  controlType: "dropDown",
                  options,
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
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a dropDown contentControl's 30 options exceed [MS-DOC] 2.9.78 FFData.hsttbDropList's own 25-entry limit; only the first 25 are written",
      },
    ]);
    expect(out).toContain("{\\*\\ffl Option 0}");
    expect(out).toContain("{\\*\\ffl Option 24}");
    expect(out).not.toContain("{\\*\\ffl Option 25}");
    expectBalancedBraces(out);
  });

  it("writes exactly 25 dropDown options untouched, with no truncation diagnostic at the cap's own boundary", () => {
    // allOptions.length > MAX_DROPDOWN_OPTIONS is a strict >: exactly 25 options must NOT truncate or report anything, distinct from 26, which is the smallest input the existing 30-option test cannot tell apart from an off-by-one >= mutant.
    const diagnostics: { code: string; message: string }[] = [];
    const options = Array.from(
      { length: 25 },
      (_, index) => `Option ${String(index)}`,
    );
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
                  controlType: "dropDown",
                  options,
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
    expect(diagnostics).toEqual([]);
    expect(out).toContain("{\\*\\ffl Option 24}");
  });

  // A selection that names an option past the 25-entry cutoff is unrepresentable for two independent reasons at once — the cap and the (now-truncated-away) match — and both fire their own diagnostic rather than one silently masking the other. The second diagnostic's message must name the REAL reason (the option was truncated away) rather than claim the value never matched any option at all, since it did match one before the cap removed it.
  it("reports both the cap and the now-unmatched selection when a dropDown's chosen value sits past the 25-entry cutoff, naming truncation as the reason rather than a false mismatch", () => {
    const messages: string[] = [];
    const options = Array.from(
      { length: 30 },
      (_, index) => `Option ${String(index)}`,
    );
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
                  controlType: "dropDown",
                  options,
                  value: "Option 27",
                },
                startRun: 0,
                endRun: 1,
              },
            ],
          },
        ]),
        {
          sink: (diagnostic) => {
            if (
              diagnostic.code === RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED
            ) {
              messages.push(diagnostic.message);
            }
          },
        },
      ),
    );
    expect(messages).toHaveLength(2);
    expect(messages.some((message) => message.includes("25-entry"))).toBe(true);
    expect(messages.some((message) => message.includes("truncated away"))).toBe(
      true,
    );
    expect(
      messages.some((message) => message.includes("does not match any")),
    ).toBe(false);
    expect(out).not.toContain("\\ffdefres");
    expect(out).not.toContain("\\ffres");
    expectBalancedBraces(out);
  });

  // The genuine mismatch case, distinguished from the truncated-away case above: a value that never matched any option at all (not even before truncation) keeps the original "does not match any" message, since that IS the real reason here.
  it("reports a genuinely unmatched dropDown value as not matching any option, even when the option list is also truncated", () => {
    const messages: string[] = [];
    const options = Array.from(
      { length: 30 },
      (_, index) => `Option ${String(index)}`,
    );
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
                  controlType: "dropDown",
                  options,
                  value: "Not an option at all",
                },
                startRun: 0,
                endRun: 1,
              },
            ],
          },
        ]),
        {
          sink: (diagnostic) => {
            if (
              diagnostic.code === RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED
            ) {
              messages.push(diagnostic.message);
            }
          },
        },
      ),
    );
    expect(
      messages.some((message) => message.includes("does not match any")),
    ).toBe(true);
    expect(messages.some((message) => message.includes("truncated away"))).toBe(
      false,
    );
    expect(out).not.toContain("\\ffdefres");
    expect(out).not.toContain("\\ffres");
    expectBalancedBraces(out);
  });

  it("writes \\ffres as a zero-based index into \\*\\ffl when a dropDown's value names one of its own options", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Guten Tag" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "dropDown",
                options: ["Hello", "Guten Tag"],
                value: "Guten Tag",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\ffres1");
    // \ffdefres mirrors the same selected index, exactly as the checkbox branch mirrors its own single `checked` boolean into both \ffres and \ffdefres.
    expect(out).toContain("\\ffdefres1");
    expectBalancedBraces(out);
  });
});
