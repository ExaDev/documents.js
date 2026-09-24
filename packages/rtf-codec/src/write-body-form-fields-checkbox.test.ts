import { describe, expect, it } from "vitest";
import { RtfDiagnosticCodes } from "./diagnostics";
import { asciiText } from "./test-support/bytes";
import { expectBalancedBraces } from "./test-support/brace-balance";
import { writeRtfContent } from "./write";
import { wordprocessing, write } from "./test-support/wordprocessing-document";

describe("checkbox form fields, and the diagnostic-sink pattern shared with plainText", () => {
  it("writes a checkbox contentControl as a real \\*\\formfield production", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "before " }, { text: " after" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "checkbox",
                checked: true,
                tag: "Check1",
              },
              startRun: 1,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain(
      "{\\field{\\*\\fldinst FORMCHECKBOX {\\*\\formfield{",
    );
    // \fftype1 is RTF 1.5's own "Form field type: ... 1 Check box" — without it, the minted \*\formfield data says "text field" while the sibling \*\fldinst says FORMCHECKBOX.
    expect(out).toContain("\\fftype1");
    // \ffres, not just \ffdefres, is what a real Word reader reads back as the checkbox's own current state — its absence reads as unchecked regardless of what \ffdefres says, so a checked box this writer minted without it opens unchecked in Word.
    expect(out).toContain("\\ffres1");
    expect(out).toContain("\\ffdefres1");
    expect(out).toContain("{\\*\\ffname Check1}");
    expect(out.indexOf("before")).toBeLessThan(out.indexOf("FORMCHECKBOX"));
    expect(out.indexOf("FORMCHECKBOX")).toBeLessThan(out.indexOf("after"));
    expectBalancedBraces(out);
  });

  it("closes a form field's own group at its endRun, not only at the paragraph's final position", () => {
    // startRun 0/endRun 1 in a 2-run paragraph closes at position 1, before the last position (2) writeFormFieldBoundaries is called at — the one shape that exercises the `top = opened[opened.length - 1]` stack-peek popping loop rather than either the point-anchor inline close (startRun === endRun) or the paragraph-end drain backstop, both of which close correctly regardless of which array slot is peeked.
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "field" }, { text: "after" }],
          constructs: [
            {
              descriptor: { kind: "contentControl", controlType: "checkbox" },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    // Checked as "field" immediately followed by its own close, with "after" entirely outside the {\fldrslt ...} destination — not indexOf("}}"), which also matches the unrelated "}}" already inside \*\fldinst/\*\formfield's own closing sequence regardless of where this close actually lands.
    expect(out).toContain("{field}}}{after}");
    expect(out).not.toContain("{field}{after}");
    expectBalancedBraces(out);
  });

  it("writes \\ffres0 for an unchecked checkbox's own current state, not just \\ffdefres0", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "checkbox",
                checked: false,
              },
              startRun: 0,
              endRun: 0,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\ffres0");
    expect(out).toContain("\\ffdefres0");
    expectBalancedBraces(out);
  });

  // The identical reachability path as the plainText \ffdeftext handling above (documents.js's own PDF AcroForm-to-contentControl reconstruction), but for a checkbox: pdf-codec's own valueFields spreads the widget's /V export-value name (e.g. 'Yes') onto `value` alongside the boolean `checked` it derives from that same /V. RTF's \ffres/\ffdefres are a bare 0/1/25 state with no room for a named export value at all — unlike plainText's `value` (which the writer CAN mint, into \ffdeftext) or a dropDown's `value` (which sometimes matches a real \ffl entry), a checkbox's `value` has no RTF spelling whatsoever, so this is unconditional data loss whenever it is present. This regression-guards against the sibling gap this writer once had: silently dropping it with no diagnostic, from the same reachability path its plainText \ffdeftext fix was specifically written to address.
  it("reports a checkbox's on-state value through the diagnostic sink, rather than dropping it silently", () => {
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
                  controlType: "checkbox",
                  checked: true,
                  value: "Yes",
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
    // The checked state itself still writes normally — only the named export value has nowhere to go.
    expect(out).toContain("\\ffres1");
    expect(out).toContain("\\ffdefres1");
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a checkbox contentControl's value 'Yes' (its on-state export name) is dropped: RTF's \\ffres/\\ffdefres can only carry the field's boolean checked state, with no spelling for a named export value at all",
      },
    ]);
    expectBalancedBraces(out);
  });

  it("writes no diagnostic for a checkbox with no recorded value, only `checked`", () => {
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
                  controlType: "checkbox",
                  checked: false,
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

  // An empty string carries no distinguishable on-state export name to preserve, so it is treated the same as no recorded value at all — matching this function's one consistent empty-string rule across every value-shaped field (`alias`, `tag`, a plainText `value`, and now this), rather than firing the diagnostic sink for a value with nothing in it.
  it("writes no diagnostic for a checkbox whose value is an empty string, treating it the same as no recorded value", () => {
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
                  controlType: "checkbox",
                  checked: true,
                  value: "",
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
    expect(out).toContain("\\ffres1");
    expect(out).toContain("\\ffdefres1");
    expect(codes).not.toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
    expectBalancedBraces(out);
  });

  // The identical silent-drop shape a checkbox's own dropped `value` had, but for a field the checkbox controlType has no concept of at all: `options` is the dropDown/comboBox choice list.
  it("reports a checkbox's options list through the diagnostic sink, rather than dropping it silently", () => {
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
                  controlType: "checkbox",
                  checked: true,
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
            diagnostics.push({
              code: diagnostic.code,
              message: diagnostic.message,
            });
          },
        },
      ),
    );
    expect(out).not.toContain("\\ffl");
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a checkbox contentControl's options list (2 entries) is dropped: a checkbox has no choice list at all, in RTF or in the harmonised contentControl vocabulary itself",
      },
    ]);
    expectBalancedBraces(out);
  });

  // Regression guard: an empty `options` array carries nothing that was actually dropped, so it must read as "never recorded" — matching this function's own established rule for every other value-shaped field (an empty `value` fires no diagnostic either) — rather than firing the same diagnostic the test above correctly fires for a genuinely non-empty stray options list.
  it("reports no diagnostic for a checkbox's empty options array", () => {
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
                controlType: "checkbox",
                checked: true,
                options: [],
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
    );
    expect(codes).not.toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
  });

  // A plainText field carrying `checked`/`options` — fields that name concepts a text field simply does not have — is the same sibling gap in a third shape.
  it("reports a plainText field's checked state and options list through the diagnostic sink, rather than dropping either silently", () => {
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
                  controlType: "plainText",
                  checked: true,
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
            diagnostics.push({
              code: diagnostic.code,
              message: diagnostic.message,
            });
          },
        },
      ),
    );
    expect(out).not.toContain("\\ffl");
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a plainText contentControl's checked state (true) is dropped: a text field has no boolean checked state at all, in RTF or in the harmonised contentControl vocabulary itself",
      },
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a plainText contentControl's options list (2 entries) is dropped: a text field has no choice list at all, in RTF or in the harmonised contentControl vocabulary itself",
      },
    ]);
    expectBalancedBraces(out);
  });

  // Regression guard, plainText side of the identical empty-options fix as the checkbox test above: a stray `checked` is still real dropped data (one diagnostic), but an empty `options` array is not (no second diagnostic) — unlike the non-empty case above, which correctly reports both.
  it("reports only the checked-state diagnostic, not an options one, for a plainText field with checked true and an empty options array", () => {
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
                controlType: "plainText",
                checked: true,
                options: [],
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
    );
    expect(
      codes.filter(
        (code) => code === RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      ),
    ).toHaveLength(1);
  });
});
