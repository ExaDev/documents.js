import { describe, expect, it } from "vitest";
import { RtfDiagnosticCodes } from "./diagnostics";
import { asciiText } from "./test-support/bytes";
import { expectBalancedBraces } from "./test-support/brace-balance";
import { writeRtfContent } from "./write";
import { wordprocessing, write } from "./test-support/wordprocessing-document";

describe("plainText form fields, and shared form-field payload structure across all three field types", () => {
  it("writes a plainText contentControl wrapping its runs in \\fldrslt", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Lorem ipsum." }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Text1",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    // \fftype0 is RTF 1.5's own "Form field type: 0 Text ...".
    expect(out).toContain(
      "FORMTEXT {\\*\\formfield{\\fftype0{\\*\\ffname Text1}}}",
    );
    expect(out).toContain("{\\fldrslt {Lorem ipsum.}}}");
    expectBalancedBraces(out);
  });

  // [MS-DOC] 2.9.78 FFData.xstzTextDef via RTF's own \ffdeftext — the real, reachable case this exists for: documents.js's own PDF AcroForm-to-contentControl reconstruction hands a plainText control exactly this {controlType:'plainText', value, ...} shape for a real /V string.
  it("writes a plainText contentControl's value as {\\*\\ffdeftext ...}", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Lorem ipsum." }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Text1",
                value: "Jane Doe",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\ffdeftext Jane Doe}");
    expectBalancedBraces(out);
  });

  // `value` names the field's CURRENT scalar value and \ffdeftext names its DEFAULT/reset text — a genuinely different fact this codec's own reader never restores back onto `value` (see "writes a plainText contentControl's value into \ffdeftext but does not read it back as `value`" in the "round trip through this package's own reader" describe block below), so writing `value` into \ffdeftext is reported through the diagnostic sink for consistency with every other cross-field mis-slot this function reports, even though the string itself is written rather than dropped.
  it("reports a plainText contentControl's value through the diagnostic sink when it is written into \\ffdeftext", () => {
    const diagnostics: { code: string; message: string }[] = [];
    const out = asciiText(
      writeRtfContent(
        wordprocessing([
          {
            kind: "paragraph",
            runs: [{ text: "Lorem ipsum." }],
            constructs: [
              {
                descriptor: {
                  kind: "contentControl",
                  controlType: "plainText",
                  tag: "Text1",
                  value: "Jane Doe",
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
    expect(out).toContain("{\\*\\ffdeftext Jane Doe}");
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a plainText contentControl's value 'Jane Doe' is written into {\\*\\ffdeftext ...}, FFData.xstzTextDef's default/reset text, not a slot for the field's current value: this codec's own reader does not restore \\ffdeftext back onto `value`, so this does not round-trip",
      },
    ]);
    expectBalancedBraces(out);
  });

  it("writes no \\ffdeftext at all for a plainText contentControl with no recorded value", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Lorem ipsum." }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Text1",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).not.toContain("\\ffdeftext");
    expectBalancedBraces(out);
  });

  // An empty string carries no distinguishable default text to preserve, so it is treated the same as no recorded value at all — matching this function's own existing convention for an empty `alias`/`tag` (see "writes no \ffownhelp/\ffhelptext at all when a contentControl has no alias" above), rather than minting an empty {\*\ffdeftext} destination and firing the diagnostic sink for a value with nothing in it.
  it("writes no \\ffdeftext at all for a plainText contentControl whose value is an empty string, treating it the same as no recorded value", () => {
    const diagnostics: { code: string }[] = [];
    const out = asciiText(
      writeRtfContent(
        wordprocessing([
          {
            kind: "paragraph",
            runs: [{ text: "Lorem ipsum." }],
            constructs: [
              {
                descriptor: {
                  kind: "contentControl",
                  controlType: "plainText",
                  tag: "Text1",
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
            diagnostics.push({ code: diagnostic.code });
          },
        },
      ),
    );
    expect(out).not.toContain("\\ffdeftext");
    expect(diagnostics).toEqual([]);
    expectBalancedBraces(out);
  });

  // \ffownhelp1 is one of this writer's own numeric-flag members and {\*\ffhelptext ...} one of its destination-string members; this writer's own chosen order (see write.ts's formFieldPayload top comment — not an RTF grammar production, since the Form Fields table has none) puts every flag before every destination string, including {\*\ffname ...}, itself the first destination-string member, which lands between them here.
  it("writes a contentControl's alias as \\ffownhelp1 (a flag member) and {\\*\\ffhelptext ...} (a destination-string member), with every flag entirely before every destination string", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Lorem ipsum." }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Text1",
                alias: "Client name",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain(
      "\\ffownhelp1{\\*\\ffname Text1}{\\*\\ffhelptext Client name}",
    );
    expectBalancedBraces(out);
  });

  // Every numeric-flag member, in this writer's own chosen order (\fftype, \ffownhelp, \ffprot, \ffhaslistbox, \ffdefres/\ffres — see write.ts's formFieldPayload top comment for why this is a writer convention, not an RTF grammar production, since RTF's own Form Fields table has none), before every destination-string member (\ffname, \ffhelptext, the \ffl entries). A dropDown descriptor exercising every field this writer mints at once, so a regression that reorders any flag member relative to another, interleaves the two groups, or reorders \ffname after \ffhelptext among the destination strings, fails this single assertion against the actual emitted bytes — not merely against a comment claiming the order, which is exactly the gap an earlier round of this writer left open (the code appended \ffprot/\ffownhelp after \ffhaslistbox/\ffdefres/\ffres despite this same comment already describing the chosen order).
  it("orders a dropDown's full \\*\\formfield payload as every flag member, then every destination-string member", () => {
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
                tag: "Drop1",
                alias: "Pick one",
                lock: "content",
                options: ["Hello", "Guten Tag"],
                value: "Guten Tag",
              },
              startRun: 0,
              endRun: 0,
            },
          ],
        },
      ]),
    );
    expect(out).toContain(
      "\\fftype2\\ffownhelp1\\ffprot1\\ffhaslistbox1\\ffdefres1\\ffres1{\\*\\ffname Drop1}{\\*\\ffhelptext Pick one}{\\*\\ffl Hello}{\\*\\ffl Guten Tag}",
    );
    expectBalancedBraces(out);
  });

  // The identical order assertion as the dropDown case above, but for a checkbox: \fftype, \ffownhelp, \ffprot, then the checkbox's own \ffdefres/\ffres pair (a checkbox has no \ffhaslistbox at all), then the destination strings. Exercised separately because the dropDown-only fixture above cannot catch a regression specific to the checkbox branch's own concatenation.
  it("orders a checkbox's full \\*\\formfield payload as every flag member, then every destination-string member", () => {
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
                tag: "Check1",
                alias: "Agree to terms",
                lock: "content",
                checked: true,
              },
              startRun: 0,
              endRun: 0,
            },
          ],
        },
      ]),
    );
    expect(out).toContain(
      "\\fftype1\\ffownhelp1\\ffprot1\\ffdefres1\\ffres1{\\*\\ffname Check1}{\\*\\ffhelptext Agree to terms}",
    );
    expectBalancedBraces(out);
  });

  // The identical order assertion again, for a plainText field: \fftype, \ffownhelp, \ffprot (plainText's own controlType-specific block contributes no flag member at all), then the destination strings (\ffname, \ffdeftext, \ffhelptext).
  it("orders a plainText's full \\*\\formfield payload as every flag member, then every destination-string member", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Text1",
                alias: "Client name",
                lock: "content",
                value: "Jane Doe",
              },
              startRun: 0,
              endRun: 0,
            },
          ],
        },
      ]),
    );
    expect(out).toContain(
      "\\fftype0\\ffownhelp1\\ffprot1{\\*\\ffname Text1}{\\*\\ffdeftext Jane Doe}{\\*\\ffhelptext Client name}",
    );
    expectBalancedBraces(out);
  });

  it("writes no \\ffownhelp/\\ffhelptext at all when a contentControl has no alias", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Lorem ipsum." }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Text1",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).not.toContain("\\ffownhelp");
    expect(out).not.toContain("\\ffhelptext");
    expectBalancedBraces(out);
  });

  // Regression guard: constructs.ts's own formFieldContentControl trims \ffname/\ffhelptext before gating on them (`name.trim().length > 0`), so a whitespace-only alias/tag reads back as absent on this codec's own reader. Before this fix, the writer gated on the untrimmed `.length > 0` instead, so a whitespace-only alias/tag still minted a real \ffownhelp1/{\*\ffhelptext} or {\*\ffname} destination — content the reader would then drop on the way back in, an asymmetric round trip.
  it("writes no \\ffownhelp/\\ffhelptext or \\ffname at all for a whitespace-only alias/tag", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Lorem ipsum." }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "   ",
                alias: "  ",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).not.toContain("\\ffownhelp");
    expect(out).not.toContain("\\ffhelptext");
    expect(out).not.toContain("\\ffname");
    // The exact payload, not just the absence of specific control words: with no lock, no alias, no tag, and no controlType-specific field, formFieldPayload's own return is the \fftype fragment alone — pinning this catches any of its other now-unused fragments (ffNameString, ffDefTextString, ffHelpTextString) starting from a stray non-empty initial value instead of "".
    expect(out).toContain("{\\*\\formfield{\\fftype0}}");
    expectBalancedBraces(out);
  });

  // Explicit \ffprot1, never a bare \ffprot: \ffprotN is a Value control word (RTF 1.9.1's own control-word-type table), not a Toggle word like \b/\i, so its bare form defaults to 0/off rather than "on" — writing the explicit N form costs one character and matches every real fixture read.test.ts carries for this bit family (PHPRtfLite always writes the explicit form for the sibling \ffres/\ffdefres bits).
  it("writes the explicit \\ffprot1 (never a bare \\ffprot) for a contentControl locked as 'content'", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Lorem ipsum." }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Text1",
                lock: "content",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\ffprot1");
    expect(out).not.toContain("\\ffprot0");
    expectBalancedBraces(out);
  });

  it("writes no \\ffprot at all for a contentControl with no lock", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Lorem ipsum." }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Text1",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).not.toContain("\\ffprot");
    expectBalancedBraces(out);
  });

  // Unlike a 'content'/'both' lock, a 'container' lock writes NOTHING for \ffprot at all — it leaves the field's own value editable, so there is no "other half" of \ffprot still written the way there is for 'both'; the whole lock is dropped, reported through one diagnostic naming that. Asserting the message's actual text, not just its code, is deliberate: a message-content regression (e.g. the 'container'/'both' branches accidentally swapping their wording, or degrading to one generic sentence describing both) would pass a code-only assertion silently, exactly the kind of accuracy bug this construct's own comment history has repeatedly had.
  it("writes no \\ffprot at all for a 'container'-locked contentControl, and reports the whole lock as dropped, naming why", () => {
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
                  lock: "container",
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
    expect(out).not.toContain("\\ffprot");
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a contentControl's 'container' lock protects the control from removal, which RTF's \\ffprot ([MS-DOC] 2.9.79 FFDataBits.fProt) cannot express at all — it names only whether the field's own value can be changed, and a 'container' lock leaves that value editable, so nothing is written for it and the whole lock is dropped, not merely half of it",
      },
    ]);
    expectBalancedBraces(out);
  });

  it("writes the explicit \\ffprot1 for a 'both'-locked contentControl and still reports the removal-protection half as dropped, naming why", () => {
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
                  lock: "both",
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
    expect(out).toContain("\\ffprot1");
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a contentControl's 'both' lock also protects the control from removal, which RTF's \\ffprot ([MS-DOC] 2.9.79 FFDataBits.fProt) cannot express — \\ffprot1 above already carries the content-protection half of 'both', so only the container-removal half is dropped here",
      },
    ]);
    expectBalancedBraces(out);
  });
});
