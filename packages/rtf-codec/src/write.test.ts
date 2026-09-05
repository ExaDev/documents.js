import { describe, expect, it } from "vitest";
import type { ContentDocument, ContentSection } from "document-schema.js";
import {
  RtfDiagnosticCodes,
  RtfUnsupportedDocumentKindError,
} from "./diagnostics";
import { readRtfContent } from "./read";
import { text } from "./test-support/bytes";
import { expectBalancedBraces } from "./test-support/brace-balance";
import { writeRtfContent } from "./write";

const LETTER_SECTION: Omit<ContentSection, "blocks"> = {
  pageSize: { widthPt: 612, heightPt: 792 },
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
};

function wordprocessing(
  blocks: ContentSection["blocks"],
  metadata: ContentDocument["metadata"] = {},
): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata,
    sections: [{ ...LETTER_SECTION, blocks }],
  };
}

function write(document: ContentDocument): string {
  return text(writeRtfContent(document));
}

describe("output shape", () => {
  it("opens with the {\\rtf1 the <File> production requires and closes its own group", () => {
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "x" }] }]),
    );
    expect(out.startsWith("{\\rtf1\\ansi")).toBe(true);
    expect(out.endsWith("}")).toBe(true);
    expectBalancedBraces(out);
  });

  it("emits pure 7-bit ASCII whatever the input contained", () => {
    const out = writeRtfContent(
      wordprocessing([
        { kind: "paragraph", runs: [{ text: "naïve — Ω — 日本語" }] },
      ]),
    );
    expect(out.every((byte) => byte < 0x80)).toBe(true);
  });

  it("refuses a document kind RTF cannot express at all", () => {
    expect(() =>
      writeRtfContent({
        kind: "presentation",
        metadata: {},
        slides: [],
      }),
    ).toThrow(RtfUnsupportedDocumentKindError);
  });

  it("is deterministic: the same document produces byte-identical output", () => {
    const document = wordprocessing([
      { kind: "paragraph", runs: [{ text: "a", bold: true }, { text: "b" }] },
    ]);
    expect(write(document)).toBe(write(document));
  });
});

describe("escaping", () => {
  it("escapes RTF's own three reserved characters", () => {
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "a{b}c\\d" }] }]),
    );
    expect(out).toContain("a\\{b\\}c\\\\d");
  });

  it("writes a non-ASCII character as \\uN with a one-character ANSI fallback", () => {
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "Γ" }] }]),
    );
    expect(out).toContain("\\u915 ?");
    expect(out).toContain("\\uc1");
  });

  it("writes an astral character as its two UTF-16 code units, the second as a negative parameter", () => {
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "𝄞" }] }]),
    );
    // U+1D11E is the surrogate pair D834 DD1E, each expressed as the signed 16-bit value the spec prescribes for a code above 32767.
    expect(out).toContain("\\u-10188 ?\\u-8930 ?");
  });

  it("writes a tab and a line break as their own control words rather than raw bytes", () => {
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "a\tb\nc" }] }]),
    );
    expect(out).toContain("a\\tab b\\line c");
  });
});

describe("header tables", () => {
  it("mints a font table entry per distinct family and references it by index", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [
            { text: "a", fontFamily: "Arial" },
            { text: "b", fontFamily: "Courier New" },
          ],
        },
      ]),
    );
    expect(out).toContain("\\f1\\fnil\\fcharset0 Arial;");
    expect(out).toContain("\\f2\\fnil\\fcharset0 Courier New;");
  });

  it("mints a colour table whose index 0 is the auto colour the leading semicolon states", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "red", color: { r: 1, g: 0, b: 0 } }],
        },
      ]),
    );
    expect(out).toContain("{\\colortbl;\\red255\\green0\\blue0;}");
    expect(out).toContain("\\cf1");
  });

  it("mints a style sheet entry per heading level, with the 0-based \\outlinelevelN the spec states", () => {
    const out = write(
      wordprocessing([
        { kind: "paragraph", runs: [{ text: "Title" }], headingLevel: 1 },
      ]),
    );
    expect(out).toContain("\\outlinelevel0 heading 1;");
    expect(out).toContain("\\s1\\outlinelevel0");
  });

  it("writes an {\\info ...} group from the document's own metadata", () => {
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "x" }] }], {
        title: "A Title",
        author: "An Author",
      }),
    );
    expect(out).toContain("{\\title A Title}");
    expect(out).toContain("{\\author An Author}");
  });

  it("mints both list tables and references the override by \\lsN", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "item" }],
          list: { numId: "rtf1:bullet", level: 0 },
        },
      ]),
    );
    expect(out).toContain("{\\*\\listtable");
    expect(out).toContain("\\levelnfc23");
    expect(out).toContain("{\\*\\listoverridetable");
    expect(out).toContain("\\ls1\\ilvl0");
  });

  it("mints an arabic level for an ordered numId", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "item" }],
          list: { numId: "rtf3:ordered@5", level: 0 },
        },
      ]),
    );
    expect(out).toContain("\\levelnfc0");
    expect(out).toContain("\\levelstartat5");
  });
});

describe("body constructs", () => {
  it("writes paragraph properties in twips", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          alignment: "center",
          indentLeftPt: 36,
          spacingBeforePt: 12,
          lineSpacing: 1.5,
        },
      ]),
    );
    expect(out).toContain("\\qc");
    expect(out).toContain("\\li720");
    expect(out).toContain("\\sb240");
    expect(out).toContain("\\sl360\\slmult1");
  });

  it("writes a hyperlink run as the HYPERLINK field production", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "here", hyperlink: "https://example.com/" }],
        },
      ]),
    );
    expect(out).toContain(
      '{\\field{\\*\\fldinst{HYPERLINK "https://example.com/"}}{\\fldrslt{',
    );
    expectBalancedBraces(out);
  });

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
    // \fftype1 is RTF 1.5's own "Form field type: ... 1 Check box" -- without it, the minted \*\formfield data says "text field" while the sibling \*\fldinst says FORMCHECKBOX.
    expect(out).toContain("\\fftype1");
    // \ffres, not just \ffdefres, is what a real Word reader reads back as the checkbox's own current state -- its absence reads as unchecked regardless of what \ffdefres says, so a checked box this writer minted without it opens unchecked in Word.
    expect(out).toContain("\\ffres1");
    expect(out).toContain("\\ffdefres1");
    expect(out).toContain("{\\*\\ffname Check1}");
    expect(out.indexOf("before")).toBeLessThan(out.indexOf("FORMCHECKBOX"));
    expect(out.indexOf("FORMCHECKBOX")).toBeLessThan(out.indexOf("after"));
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

  // The identical reachability path as the plainText \ffdeftext handling above (documents.js's own PDF AcroForm-to-contentControl reconstruction), but for a checkbox: pdf-codec's own valueFields spreads the widget's /V export-value name (e.g. 'Yes') onto `value` alongside the boolean `checked` it derives from that same /V. RTF's \ffres/\ffdefres are a bare 0/1/25 state with no room for a named export value at all -- unlike plainText's `value` (which the writer CAN mint, into \ffdeftext) or a dropDown's `value` (which sometimes matches a real \ffl entry), a checkbox's `value` has no RTF spelling whatsoever, so this is unconditional data loss whenever it is present. This regression-guards against the sibling gap this writer once had: silently dropping it with no diagnostic, from the same reachability path its plainText \ffdeftext fix was specifically written to address.
  it("reports a checkbox's on-state value through the diagnostic sink, rather than dropping it silently", () => {
    const diagnostics: { code: string; message: string }[] = [];
    const out = text(
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
          sink: (diagnostic) =>
            diagnostics.push({
              code: diagnostic.code,
              message: diagnostic.message,
            }),
        },
      ),
    );
    // The checked state itself still writes normally -- only the named export value has nowhere to go.
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
    const out = text(
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
        { sink: (diagnostic) => codes.push(diagnostic.code) },
      ),
    );
    expect(codes).not.toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
    expectBalancedBraces(out);
  });

  // The identical silent-drop shape a checkbox's own dropped `value` had, but for a field the checkbox controlType has no concept of at all: `options` is the dropDown/comboBox choice list.
  it("reports a checkbox's options list through the diagnostic sink, rather than dropping it silently", () => {
    const codes: string[] = [];
    const out = text(
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
        { sink: (diagnostic) => codes.push(diagnostic.code) },
      ),
    );
    expect(out).not.toContain("\\ffl");
    expect(codes).toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
    expectBalancedBraces(out);
  });

  // A plainText field carrying `checked`/`options` -- fields that name concepts a text field simply does not have -- is the same sibling gap in a third shape.
  it("reports a plainText field's checked state and options list through the diagnostic sink, rather than dropping either silently", () => {
    const diagnostics: string[] = [];
    const out = text(
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
        { sink: (diagnostic) => diagnostics.push(diagnostic.code) },
      ),
    );
    expect(out).not.toContain("\\ffl");
    expect(
      diagnostics.filter(
        (code) => code === RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      ),
    ).toHaveLength(2);
    expectBalancedBraces(out);
  });

  // The identical sibling gap in a fourth shape: `checked` is the checkbox/radio boolean, and a dropDown has no concept of it either -- the checkbox branch reports a stray `options`, the plainText branch reports a stray `checked` and `options`, and this closes the one remaining combination this function's own sink-reporting rule covers.
  it("reports a dropDown field's checked state through the diagnostic sink, rather than dropping it silently", () => {
    const codes: string[] = [];
    const out = text(
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
        { sink: (diagnostic) => codes.push(diagnostic.code) },
      ),
    );
    expect(out).toContain("{\\*\\ffl Hello}");
    expect(codes).toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
    expectBalancedBraces(out);
  });

  it("writes no diagnostic for a dropDown with no recorded `checked`", () => {
    const codes: string[] = [];
    const out = text(
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
        { sink: (diagnostic) => codes.push(diagnostic.code) },
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

  // [MS-DOC] 2.9.79 FFDataBits.fHasListBox MUST be 1 when iType is iTypeDrop; [MS-DOC] 2.9.78 FFData.wDef "MUST exist if and only if" iType is iTypeChck or iTypeDrop is a real MS-DOC production rule this codec deliberately does not always satisfy here: a dropdown with options but no recorded selection has no genuine default to report, and a real producer would spell that as \ffres25 (FFDataBits' own undefined-selection sentinel) plus a genuine \ffdefres0 rather than omitting both -- but this writer's own reader deliberately falls \ffres25 through to \ffdefres (to recover a real checkbox's meaningful reset default instead of reading it as unchecked), so emitting that exact pair here would read back as "option 0 is selected" rather than "nothing is selected"; omitting both instead round-trips cleanly through this reader's own hand-edited read.test.ts fixture ("leaves a FORMDROPDOWN's value unset when neither \ffres nor \ffdefres is present at all"), at the cost of not matching the form a real producer would write for the same case.
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
    expect(out).toContain("\\ffhaslistbox");
    expect(out).not.toContain("\\ffdefres");
    expect(out).not.toContain("\\ffres");
    expectBalancedBraces(out);
  });

  // [MS-DOC] 2.9.79 FFDataBits.fHasListBox "MUST be 1 if iType is iTypeDrop (2)" with no carve-out for a dropdown that happens to carry no options -- a real, common shape this ecosystem's own docx/odf readers can produce (ExaDev/documents.js#1016). An earlier version of this writer gated \ffhaslistbox behind `options !== undefined`, so a dropDown with no options minted \fftype2 alone: a fftype naming a list field with no \*\formfield data backing that claim at all.
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
    expect(out).toContain("\\ffhaslistbox");
    // FFData.wDef "MUST be less than the number of items in the dropdown list box" -- with zero items there is no valid index, so this writer mints none at all rather than an invalid \ffdefres0.
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
    expect(out).toContain("\\ffhaslistbox");
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
    expect(out).toContain("\\ffhaslistbox");
    // The regression this guards: an earlier version of this writer's `indexOf` returning -1 for an unmatched value was indistinguishable from -1 for "no value recorded at all", so it minted \ffdefres0 either way -- silently picking "Hello" for a document that actually recorded "Bonjour". Neither \ffres nor \ffdefres should exist at all for this shape.
    expect(out).not.toContain("\\ffdefres");
    expect(out).not.toContain("\\ffres");
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
      { sink: (diagnostic) => codes.push(diagnostic.code) },
    );
    expect(codes).toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
  });

  // A dropDown with no options recorded at all is a distinct shape from one whose options exist but don't contain `value`: `options` itself is undefined here, so `value` names none of a list that does not exist either. This should degrade identically to the unmatched-value case above -- the sink still fires, since a recorded value with nowhere to write it is data loss regardless of whether the option list is empty, absent, or merely missing the one entry that was picked.
  it("reports a dropDown's value through the diagnostic sink when no options list exists at all to match it against", () => {
    const codes: string[] = [];
    const out = text(
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
        { sink: (diagnostic) => codes.push(diagnostic.code) },
      ),
    );
    expect(codes).toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
    expect(out).not.toContain("\\ffdefres");
    expect(out).not.toContain("\\ffres");
    expectBalancedBraces(out);
  });

  // [MS-DOC] 2.9.78 FFData.hsttbDropList "MUST NOT exceed 25" entries -- not an arbitrary limit, since FFDataBits' own iRes field reserves index 25 as its "undefined selection" sentinel (FORM_FIELD_RESULT_UNDEFINED in constructs.ts). A 26th option would sit exactly where a real Word/DOC consumer expects "no selection".
  it("truncates a dropDown's options at the MS-DOC 25-entry cap and reports it through the diagnostic sink", () => {
    const codes: string[] = [];
    const options = Array.from(
      { length: 30 },
      (_, index) => `Option ${String(index)}`,
    );
    const out = text(
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
        { sink: (diagnostic) => codes.push(diagnostic.code) },
      ),
    );
    expect(codes).toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
    expect(out).toContain("{\\*\\ffl Option 0}");
    expect(out).toContain("{\\*\\ffl Option 24}");
    expect(out).not.toContain("{\\*\\ffl Option 25}");
    expectBalancedBraces(out);
  });

  // A selection that names an option past the 25-entry cutoff is unrepresentable for two independent reasons at once -- the cap and the (now-truncated-away) match -- and both fire their own diagnostic rather than one silently masking the other.
  it("reports both the cap and the now-unmatched selection when a dropDown's chosen value sits past the 25-entry cutoff", () => {
    const codes: string[] = [];
    const options = Array.from(
      { length: 30 },
      (_, index) => `Option ${String(index)}`,
    );
    const out = text(
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
        { sink: (diagnostic) => codes.push(diagnostic.code) },
      ),
    );
    expect(
      codes.filter(
        (code) => code === RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      ),
    ).toHaveLength(2);
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

  // [MS-DOC] 2.9.78 FFData.xstzTextDef via RTF's own \ffdeftext -- the real, reachable case this exists for: documents.js's own PDF AcroForm-to-contentControl reconstruction hands a plainText control exactly this {controlType:'plainText', value, ...} shape for a real /V string.
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

  // `value` names the field's CURRENT scalar value and \ffdeftext names its DEFAULT/reset text -- a genuinely different fact this codec's own reader never restores back onto `value` (see "writes a plainText contentControl's value into \ffdeftext but does not read it back as `value`" in the "round trip through this package's own reader" describe block below), so writing `value` into \ffdeftext is reported through the diagnostic sink for consistency with every other cross-field mis-slot this function reports, even though the string itself is written rather than dropped.
  it("reports a plainText contentControl's value through the diagnostic sink when it is written into \\ffdeftext", () => {
    const codes: string[] = [];
    const out = text(
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
        { sink: (diagnostic) => codes.push(diagnostic.code) },
      ),
    );
    expect(out).toContain("{\\*\\ffdeftext Jane Doe}");
    expect(codes).toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
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

  // \ffownhelp1 is a <formparams> member and {\*\ffhelptext ...} a <formstrings> one, so RTF 1.9.1's own "Form Fields" grammar (`<formfield> '{\*' \formfield '{' <formparams> <formstrings> '}}'`) puts every formparams control word before every formstrings one -- including {\*\ffname ...}, itself <formstrings>'s own first member, which lands between them here.
  it("writes a contentControl's alias as \\ffownhelp1 (formparams) and {\\*\\ffhelptext ...} (formstrings), with formparams entirely before formstrings", () => {
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

  // Every <formparams> member (\fftype, \ffhaslistbox, \ffdefres/\ffres, \ffprot, \ffownhelp) before every <formstrings> member (\ffname, \ffhelptext, the \ffl entries), matching RTF 1.9.1's own "Form Fields" grammar production exactly -- a dropDown descriptor exercising every field this writer mints at once, so a regression that interleaves the two groups (or reorders \ffname after \ffhelptext within formstrings) fails this single assertion.
  it("orders a dropDown's full \\*\\formfield payload as every formparams member, then every formstrings member, matching RTF's own grammar production", () => {
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
      "\\fftype2\\ffhaslistbox\\ffdefres1\\ffres1\\ffprot1\\ffownhelp1{\\*\\ffname Drop1}{\\*\\ffhelptext Pick one}{\\*\\ffl Hello}{\\*\\ffl Guten Tag}",
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

  // Explicit \ffprot1, never a bare \ffprot: \ffprotN is a Value control word (RTF 1.9.1's own control-word-type table), not a Toggle word like \b/\i, so its bare form defaults to 0/off rather than "on" -- writing the explicit N form costs one character and matches every real fixture read.test.ts carries for this bit family (PHPRtfLite always writes the explicit form for the sibling \ffres/\ffdefres bits).
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

  // Unlike a 'content'/'both' lock, a 'container' lock writes NOTHING for \ffprot at all -- it leaves the field's own value editable, so there is no "other half" of \ffprot still written the way there is for 'both'; the whole lock is dropped, reported through one diagnostic naming that. Asserting the message's actual text, not just its code, is deliberate: a message-content regression (e.g. the 'container'/'both' branches accidentally swapping their wording, or degrading to one generic sentence describing both) would pass a code-only assertion silently, exactly the kind of accuracy bug this construct's own comment history has repeatedly had.
  it("writes no \\ffprot at all for a 'container'-locked contentControl, and reports the whole lock as dropped, naming why", () => {
    const diagnostics: { code: string; message: string }[] = [];
    const out = text(
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
          sink: (diagnostic) =>
            diagnostics.push({
              code: diagnostic.code,
              message: diagnostic.message,
            }),
        },
      ),
    );
    expect(out).not.toContain("\\ffprot");
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a contentControl's 'container' lock protects the control from removal, which RTF's \\ffprot ([MS-DOC] 2.9.79 FFDataBits.fProt) cannot express at all -- it names only whether the field's own value can be changed, and a 'container' lock leaves that value editable, so nothing is written for it and the whole lock is dropped, not merely half of it",
      },
    ]);
    expectBalancedBraces(out);
  });

  it("writes the explicit \\ffprot1 for a 'both'-locked contentControl and still reports the removal-protection half as dropped, naming why", () => {
    const diagnostics: { code: string; message: string }[] = [];
    const out = text(
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
          sink: (diagnostic) =>
            diagnostics.push({
              code: diagnostic.code,
              message: diagnostic.message,
            }),
        },
      ),
    );
    expect(out).toContain("\\ffprot1");
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a contentControl's 'both' lock also protects the control from removal, which RTF's \\ffprot ([MS-DOC] 2.9.79 FFDataBits.fProt) cannot express -- \\ffprot1 above already carries the content-protection half of 'both', so only the container-removal half is dropped here",
      },
    ]);
    expectBalancedBraces(out);
  });

  it("reports a contentControl controlType RTF's own form-field vocabulary does not cover, rather than minting nothing silently -- and mints no unbalanced braces for it", () => {
    const codes: string[] = [];
    const out = text(
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
        { sink: (diagnostic) => codes.push(diagnostic.code) },
      ),
    );
    expect(codes).toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
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

  // Regression for a round-2 fix that only patched the symptom for a controlType FORM_FIELD_SPEC does not cover, without making the writer structurally incapable of leaving a field group unmatched for every other malformed-looking range. writeFormFieldBoundaries is only ever called for positions 0..paragraph.runs.length, so an extent whose own endRun exceeds that range never reaches a position where its close would fire from that method alone -- only the drain step in writeParagraph closes it.
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

  // Regression for a real defect the round-2 brace-balance fix introduced: an extent with startRun > endRun let the close loop run at its endRun position before the open loop ever reached its startRun, so `opened.has(extent)` read false there and the close was (correctly, at that position) skipped -- but nothing revisited that endRun once the open finally happened later, leaving the open half unmatched for the rest of the document.
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

  it("writes a table as \\trowd/\\cellxN row definitions with \\cell and \\row marks", () => {
    const out = write(
      wordprocessing([
        {
          kind: "table",
          columnWidthsPt: [72, 144],
          rows: [
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }] },
                { blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }] },
              ],
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\trowd\\trgaph108\\trleft0\\cellx1440\\cellx4320");
    expect(out).toContain("\\intbl");
    expect(out).toContain("\\cell");
    expect(out).toContain("\\row");
    expectBalancedBraces(out);
  });

  it("writes a page break as \\page", () => {
    expect(write(wordprocessing([{ kind: "pageBreak" }]))).toContain("\\page");
  });

  it("writes an image as a hex-payload \\pict inside the \\*\\shppict wrapper", () => {
    // A one-pixel PNG.
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const out = write(
      wordprocessing([
        {
          kind: "image",
          format: "png",
          base64,
          widthPt: 72,
          heightPt: 36,
        },
      ]),
    );
    expect(out).toContain(
      "{\\*\\shppict{\\pict\\pngblip\\picwgoal1440\\pichgoal720",
    );
    expect(out).toContain("89504e470d0a1a0a");
  });

  it("reports rather than silently dropping a construct boundary marker RTF cannot spell", () => {
    const codes: string[] = [];
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
      { sink: (diagnostic) => codes.push(diagnostic.code) },
    );
    expect(codes).toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
  });
});

describe("round trip through this package's own reader", () => {
  function roundTrip(document: ContentDocument): ContentDocument {
    return readRtfContent(writeRtfContent(document)).document;
  }

  it("preserves paragraph text and character formatting", () => {
    const document = wordprocessing([
      {
        kind: "paragraph",
        runs: [
          { text: "plain ", sizePt: 12 },
          { text: "bold", bold: true, sizePt: 12 },
          { text: " and ", sizePt: 12 },
          { text: "italic", italic: true, sizePt: 12 },
        ],
      },
    ]);
    const back = roundTrip(document);
    const section =
      back.kind === "wordprocessing" ? back.sections[0] : undefined;
    const paragraph = section?.blocks[0];
    expect(paragraph?.kind === "paragraph" ? paragraph.runs : []).toEqual(
      document.kind === "wordprocessing"
        ? document.sections[0]?.blocks[0]?.kind === "paragraph"
          ? document.sections[0].blocks[0].runs
          : []
        : [],
    );
  });

  it("preserves non-ASCII text through the \\uN escape", () => {
    const back = roundTrip(
      wordprocessing([
        { kind: "paragraph", runs: [{ text: "naïve Ω 日本語", sizePt: 12 }] },
      ]),
    );
    const section =
      back.kind === "wordprocessing" ? back.sections[0] : undefined;
    const paragraph = section?.blocks[0];
    expect(
      paragraph?.kind === "paragraph"
        ? paragraph.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("naïve Ω 日本語");
  });

  it("preserves a heading's level and a list's marker type", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Head", sizePt: 12 }],
          headingLevel: 2,
        },
        {
          kind: "paragraph",
          runs: [{ text: "Item", sizePt: 12 }],
          list: { numId: "rtf1:bullet", level: 0 },
        },
      ]),
    );
    const blocks =
      back.kind === "wordprocessing" ? (back.sections[0]?.blocks ?? []) : [];
    const heading = blocks[0];
    const item = blocks[1];
    expect(
      heading?.kind === "paragraph" ? heading.headingLevel : undefined,
    ).toBe(2);
    expect(item?.kind === "paragraph" ? item.list : undefined).toEqual({
      numId: "rtf1:bullet",
      level: 0,
    });
  });

  it("preserves a table's shape and cell text", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "table",
          columnWidthsPt: [72, 144],
          rows: [
            {
              cells: [
                {
                  blocks: [
                    { kind: "paragraph", runs: [{ text: "A", sizePt: 12 }] },
                  ],
                },
                {
                  blocks: [
                    { kind: "paragraph", runs: [{ text: "B", sizePt: 12 }] },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );
    const blocks =
      back.kind === "wordprocessing" ? (back.sections[0]?.blocks ?? []) : [];
    const table = blocks.find((block) => block.kind === "table");
    expect(table?.kind === "table" ? table.columnWidthsPt : undefined).toEqual([
      72, 144,
    ]);
    expect(
      table?.kind === "table" ? table.rows[0]?.cells.length : undefined,
    ).toBe(2);
  });

  it("preserves a hyperlink's target", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [
            {
              text: "link",
              hyperlink: "https://example.com/a?b=1",
              sizePt: 12,
            },
          ],
        },
      ]),
    );
    const blocks =
      back.kind === "wordprocessing" ? (back.sections[0]?.blocks ?? []) : [];
    const paragraph = blocks[0];
    expect(
      paragraph?.kind === "paragraph"
        ? paragraph.runs.find((run) => run.hyperlink !== undefined)?.hyperlink
        : undefined,
    ).toBe("https://example.com/a?b=1");
  });

  it("preserves the section's page geometry and the document's metadata", () => {
    const back = roundTrip(
      wordprocessing(
        [{ kind: "paragraph", runs: [{ text: "x", sizePt: 12 }] }],
        {
          title: "T",
          author: "A",
        },
      ),
    );
    expect(back.metadata).toEqual({ title: "T", author: "A" });
    const section =
      back.kind === "wordprocessing" ? back.sections[0] : undefined;
    expect(section?.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
    expect(section?.margins).toEqual(LETTER_SECTION.margins);
  });

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
    const codes: string[] = [];
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
      { sink: (diagnostic) => codes.push(diagnostic.code) },
    );
    expect(codes).toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
  });

  it("round-trips a checkbox contentControl's checked state and tag back onto the same point extent", () => {
    const back = roundTrip(
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
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    const extent = paragraph?.constructs?.[0];
    expect(extent?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "checkbox",
      checked: true,
      tag: "Check1",
    });
    expect(extent?.startRun).toBe(extent?.endRun);
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe(
      "before  after",
    );
  });

  // A dropDown minted with no recorded selection round-trips with no `value` at all, not a fabricated first-entry default: this writer mints neither \ffres nor \ffdefres for exactly this case (see "writes \ffhaslistbox for a dropDown with options but no recorded selection" above), and the reader leaves `value` unset when it finds neither control word (see read.test.ts's "leaves a FORMDROPDOWN's value unset..."). This is the genuine stable fixed point -- writing this descriptor again reproduces byte-identical output, with nothing to drift.
  it("round-trips a dropDown contentControl's options back onto the runs it wraps, with no fabricated default selection", () => {
    const back = roundTrip(
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
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    const extent = paragraph?.constructs?.[0];
    expect(extent?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "dropDown",
      options: ["Hello", "Guten Tag"],
    });
    expect(
      paragraph?.runs
        .slice(extent?.startRun ?? 0, extent?.endRun ?? 0)
        .map((run) => run.text)
        .join(""),
    ).toBe("Guten Tag");
  });

  // The round-trip stability fix this round exists for: an unmatched value must stay unmatched across repeated write/read cycles, never drifting onto a fabricated match. Before this fix, writing an unmatched value correctly minted no \ffres/\ffdefres (signalling loss), but reading that back gave `value: undefined` -- indistinguishable from "no value was ever set" -- so a SECOND write hit the other branch and minted \ffdefres0, silently turning "value was Bonjour, now lost" into "value is now definitely Hello".
  it("keeps a dropDown's unmatched value unmatched across two full write-read cycles, rather than drifting onto a fabricated match on the second pass", () => {
    const original = wordprocessing([
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
    ]);
    const firstPassBytes = writeRtfContent(original);
    const firstPassDocument = readRtfContent(firstPassBytes).document;
    const secondPassBytes = writeRtfContent(firstPassDocument);
    const secondPassDocument = readRtfContent(secondPassBytes).document;

    const descriptorOf = (document: ContentDocument) => {
      const block =
        document.kind === "wordprocessing"
          ? document.sections[0]?.blocks[0]
          : undefined;
      const paragraph = block?.kind === "paragraph" ? block : undefined;
      return paragraph?.constructs?.[0]?.descriptor;
    };

    // Neither pass may recover "Bonjour" (it was never a valid option) nor drift onto "Hello" (the entry-0 fabrication this round's fix removes).
    expect(descriptorOf(firstPassDocument)).toEqual({
      kind: "contentControl",
      controlType: "dropDown",
      options: ["Hello", "Guten Tag"],
    });
    expect(descriptorOf(secondPassDocument)).toEqual(
      descriptorOf(firstPassDocument),
    );
    // The bytes themselves are the strongest form of this assertion: a true fixed point produces byte-identical RTF on the second pass, not merely an equal descriptor.
    expect(text(secondPassBytes)).toBe(text(firstPassBytes));
  });

  it("round-trips a dropDown contentControl's selected value back onto the same options", () => {
    const back = roundTrip(
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
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "dropDown",
      options: ["Hello", "Guten Tag"],
      value: "Guten Tag",
    });
  });

  it("round-trips a plainText contentControl's tag and its wrapped text", () => {
    const back = roundTrip(
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
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    const extent = paragraph?.constructs?.[0];
    expect(extent?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      tag: "Text1",
    });
    expect(
      paragraph?.runs
        .slice(extent?.startRun ?? 0, extent?.endRun ?? 0)
        .map((run) => run.text)
        .join(""),
    ).toBe("Lorem ipsum.");
  });

  // Deliberately NOT a round trip, despite the writer minting {\*\ffdeftext ...} from `value` (see "writes a plainText contentControl's value as {\*\ffdeftext ...}" above): `\ffdeftext` names the field's DEFAULT/reset text, and this reader never promotes it onto `value`, which document-schema.js defines as the control's CURRENT value -- for a text field, that current value is the wrapped-run text, which this document never set. Writing `value` here is a one-directional degradation, the mirror image of the writer's own documented 'both'->'content' lock degradation: real, useful on the way out (documents.js's own PDF AcroForm-to-contentControl reconstruction genuinely produces this shape), but not something a generic reader of the resulting RTF should read back as the field's current content.
  it("writes a plainText contentControl's value into \\ffdeftext but does not read it back as `value`, since \\ffdeftext names the field's default text, not its current one", () => {
    const back = roundTrip(
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
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      tag: "Text1",
    });
  });

  it("round-trips a plainText contentControl's alias and lock alongside its tag", () => {
    const back = roundTrip(
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
                lock: "content",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      tag: "Text1",
      alias: "Client name",
      lock: "content",
    });
  });

  // 'both' has no RTF spelling of its own -- \ffprot is a single bit -- so this is the writer's own documented, one-directional degradation: a 'both' lock survives the round trip as 'content', the half RTF can actually state.
  it("round-trips a 'both'-locked contentControl's lock down to 'content', the half RTF's \\ffprot can actually state", () => {
    const back = roundTrip(
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
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      lock: "content",
    });
  });

  it("writes a run-level provenance extent as the <chrev> character properties, minting a \\*\\revtbl for its author", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "kept " }, { text: "added" }],
          constructs: [
            {
              descriptor: {
                kind: "provenance",
                change: "insertion",
                author: "A. Reviewer",
                dateIso: "2024-01-01T09:30:00",
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\revtbl");
    expect(out).toContain("A. Reviewer;");
    expect(out).toContain("\\revised");
    // 30 | (9 << 6) | (1 << 11) | (1 << 16) | (124 << 20) -- the DTTM bit field the spec tabulates.
    const dttm = 30 | (9 << 6) | (1 << 11) | (1 << 16) | (124 << 20);
    expect(out).toContain(`\\revdttm${String(dttm)}`);
  });

  it("round-trips every provenance change kind back onto the same runs", () => {
    for (const change of [
      "insertion",
      "deletion",
      "moveFrom",
      "moveTo",
      "formatChange",
    ] as const) {
      const back = roundTrip(
        wordprocessing([
          {
            kind: "paragraph",
            runs: [{ text: "a" }, { text: "b" }],
            constructs: [
              {
                descriptor: { kind: "provenance", change, author: "R" },
                startRun: 1,
                endRun: 2,
              },
            ],
          },
        ]),
      );
      const block =
        back.kind === "wordprocessing"
          ? back.sections[0]?.blocks[0]
          : undefined;
      const paragraph = block?.kind === "paragraph" ? block : undefined;
      expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
        kind: "provenance",
        change,
        author: "R",
      });
      expect(
        paragraph?.runs
          .slice(
            paragraph.constructs?.[0]?.startRun ?? 0,
            paragraph.constructs?.[0]?.endRun ?? 0,
          )
          .map((run) => run.text)
          .join(""),
      ).toBe("b");
    }
  });

  it("round-trips a deletion's own text, which the provenance kind exists to carry", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "kept " }, { text: "gone" }],
          constructs: [
            {
              descriptor: {
                kind: "provenance",
                change: "deletion",
                author: "R",
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
    expect(
      block?.kind === "paragraph"
        ? block.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("kept gone");
  });

  it("omits \\revdttmN entirely for a dateIso it cannot pack, rather than writing a zero one", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          constructs: [
            {
              descriptor: {
                kind: "provenance",
                change: "insertion",
                dateIso: "not a date",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\revised");
    expect(out).not.toContain("\\revdttm");
  });

  it("round-trips a cell's borders, background, and both merge directions", () => {
    const document = wordprocessing([
      {
        kind: "table",
        columnWidthsPt: [72, 72, 72],
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
                rowSpan: 2,
                background: { r: 1, g: 1, b: 0 },
                borders: {
                  top: { color: { r: 1, g: 0, b: 0 }, widthPt: 1.5 },
                  bottom: {
                    color: { r: 0, g: 0, b: 1 },
                    widthPt: 0.75,
                    style: "dashed",
                  },
                },
              },
              // colSpan 2 means this one cell occupies the second and third grid columns, so the row has two cells across three columns -- the covered column has no cell of its own, exactly as a gridSpan'd w:tc does not.
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }],
                colSpan: 2,
              },
            ],
          },
          {
            cells: [
              { blocks: [] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "C" }] }] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "D" }] }] },
            ],
          },
        ],
      },
    ]);
    const out = write(document);
    expect(out).toContain("\\clvmgf");
    expect(out).toContain("\\clvmrg");
    expect(out).toContain("\\clmgf");
    expect(out).toContain("\\clmrg");
    expect(out).toContain("\\clbrdrt\\brdrs\\brdrw30");
    expect(out).toContain("\\clbrdrb\\brdrdash\\brdrw15");
    expect(out).toContain("\\clcbpat");

    const back = roundTrip(document);
    const table = (
      back.kind === "wordprocessing" ? back.sections[0]?.blocks : []
    )?.find((block) => block.kind === "table");
    const anchor =
      table?.kind === "table" ? table.rows[0]?.cells[0] : undefined;
    expect(anchor?.rowSpan).toBe(2);
    expect(anchor?.background).toEqual({ r: 1, g: 1, b: 0 });
    expect(anchor?.borders?.top).toEqual({
      color: { r: 1, g: 0, b: 0 },
      widthPt: 1.5,
    });
    expect(anchor?.borders?.bottom).toEqual({
      color: { r: 0, g: 0, b: 1 },
      widthPt: 0.75,
      style: "dashed",
    });
    expect(
      table?.kind === "table" ? table.rows[0]?.cells[1]?.colSpan : undefined,
    ).toBe(2);
  });

  it("round-trips several sections, each keeping its own geometry and break kind", () => {
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          ...LETTER_SECTION,
          blocks: [{ kind: "paragraph", runs: [{ text: "Portrait" }] }],
        },
        {
          pageSize: { widthPt: 792, heightPt: 612 },
          margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
          breakType: "oddPage",
          blocks: [{ kind: "paragraph", runs: [{ text: "Landscape" }] }],
        },
      ],
    };
    const back = roundTrip(document);
    const sections = back.kind === "wordprocessing" ? back.sections : [];
    expect(sections).toHaveLength(2);
    expect(sections[0]?.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
    expect(sections[1]?.pageSize).toEqual({ widthPt: 792, heightPt: 612 });
    expect(sections[1]?.margins.leftPt).toBe(36);
    expect(sections[1]?.breakType).toBe("oddPage");
  });

  it("states each section's geometry with the section-scoped \\pgwsxnN family, not the document-level \\paperwN", () => {
    const out = write({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          ...LETTER_SECTION,
          blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
        },
        {
          pageSize: { widthPt: 792, heightPt: 612 },
          margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
          blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }],
        },
      ],
    });
    expect(out).toContain("\\pgwsxn15840\\pghsxn12240");
    expect(out).toContain("\\marglsxn720");
    // The document-level geometry is stated once, in the header, from the first section -- not restated per section.
    expect(out.match(/\\paperw/g)).toHaveLength(1);
  });
});
