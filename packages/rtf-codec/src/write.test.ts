import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentParagraph,
  ContentSection,
} from "document-schema.js";
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

  it("separates a paragraph's own properties from its first run's text with a literal space", () => {
    // A default paragraph (no heading/alignment/direction/list) has empty paragraphProperties output, so \pard\plain is followed directly by the mandatory separating space and then the run text -- with nothing between \plain and the space to obscure whether the space survived.
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "hi" }] }]),
    );
    expect(out).toContain("\\pard\\plain {hi}");
  });

  it("writes no \\colortbl/\\stylesheet/\\*\\listtable/\\*\\revtbl/\\info at all for a document using none of them", () => {
    // Each of these five destinations is genuinely optional -- unlike \fonttbl, which always carries at least the default font -- and each has its own guard against writing an empty destination for nothing. \info's own guard (fields.length > 0) is the only one gating a group built from four independently-optional sub-fields rather than a single table, so an empty document with no metadata at all is the fixture that proves the whole group, not just one field, is skipped.
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "x" }] }]),
    );
    expect(out).not.toContain("\\colortbl");
    expect(out).not.toContain("\\stylesheet");
    expect(out).not.toContain("\\listtable");
    expect(out).not.toContain("\\revtbl");
    expect(out).not.toContain("\\info");
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

  it("writes a carriage return as \\line too, the same as a line feed", () => {
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "a\rb" }] }]),
    );
    expect(out).toContain("a\\line b");
  });

  it("passes the printable-ASCII boundary characters through unescaped", () => {
    // 0x20 (space) and 0x7E (~) are the first and last bytes the >= 0x20 && < 0x7f range admits -- both must pass through literally, not fall into the \\uN escape path.
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "a b~c" }] }]),
    );
    expect(out).toContain("a b~c");
    expect(out).not.toContain("\\u32");
    expect(out).not.toContain("\\u126");
  });

  it("escapes a control character below the printable-ASCII range's own lower bound as \\uN", () => {
    // 0x01 is not one of the specially-cased \t/\n/\r control characters, so it reaches the >= 0x20 check directly -- it must not pass through raw.
    const out = write(
      wordprocessing([
        { kind: "paragraph", runs: [{ text: `a${String.fromCharCode(1)}b` }] },
      ]),
    );
    expect(out).toContain("\\u1 ?");
  });

  it("escapes 0x7F (DEL), one past the printable-ASCII range's own upper bound, as \\uN", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: `a${String.fromCharCode(0x7f)}b` }],
        },
      ]),
    );
    expect(out).toContain("\\u127 ?");
  });

  it("writes 0x7FFF, the last positive code unit, as a positive \\uN parameter", () => {
    // The spec's own signed-negative rule is stated as "greater than 32767" -- 0x7FFF (32767) itself is the boundary value that must NOT flip to negative.
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: String.fromCharCode(0x7f_ff) }],
        },
      ]),
    );
    expect(out).toContain("\\u32767 ?");
    expect(out).not.toContain("\\u-32767");
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

  it("re-uses an already-recorded colour's own index rather than minting a duplicate table entry", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [
            { text: "r1", color: { r: 1, g: 0, b: 0 } },
            { text: "b", color: { r: 0, g: 0, b: 1 } },
            { text: "r2", color: { r: 1, g: 0, b: 0 } },
          ],
        },
      ]),
    );
    // Exactly two colours -- red first (\cf1), blue second (\cf2) -- not three, which a re-recorded 'red' bumped to a fresh, too-high index would produce.
    expect(out).toContain(
      "{\\colortbl;\\red255\\green0\\blue0;\\red0\\green0\\blue255;}",
    );
    expect(out).not.toContain("\\cf3");
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

  it("writes heading-level style entries in ascending level order, not first-encountered order", () => {
    // headingStyles is keyed by level itself (unlike fonts/colors/lists, whose Map key order already tracks index order by construction), so a document that meets level 3 before level 1 needs a real sort to write them back out in level order.
    const out = write(
      wordprocessing([
        { kind: "paragraph", runs: [{ text: "Three" }], headingLevel: 3 },
        { kind: "paragraph", runs: [{ text: "One" }], headingLevel: 1 },
      ]),
    );
    expect(out.indexOf("heading 1;")).toBeLessThan(out.indexOf("heading 3;"));
  });

  it("writes an {\\info ...} group from the document's own metadata", () => {
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "x" }] }], {
        title: "A Title",
        author: "An Author",
        subject: "A Subject",
        keywords: ["one", "two"],
      }),
    );
    expect(out).toContain("{\\title A Title}");
    expect(out).toContain("{\\author An Author}");
    expect(out).toContain("{\\subject A Subject}");
    // Joined with "; ", not "" -- otherwise "onetwo" would be indistinguishable from a single keyword.
    expect(out).toContain("{\\keywords one; two}");
  });

  it("omits \\keywords entirely for an empty keywords array, unlike a genuinely populated one", () => {
    // keywords !== undefined alone would let [] through; the writer also requires .length > 0, since an empty list carries no keyword to record.
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "x" }] }], {
        keywords: [],
      }),
    );
    expect(out).not.toContain("\\keywords");
    expect(out).not.toContain("\\info");
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
    // \listhybrid requires exactly nine levels, each indented one step further than the last (LIST_LEVEL_INDENT_TWIPS * (level + 1)) -- the first at one step, the ninth at nine.
    expect(out.match(/\\listlevel/g)).toHaveLength(9);
    expect(out).toContain(`\\li${String(720 * 1)}\\lin${String(720 * 1)}`);
    expect(out).toContain(`\\li${String(720 * 9)}\\lin${String(720 * 9)}`);
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

  it("writes verticalAlign as the \\super/\\sub on-spellings", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [
            { text: "x" },
            { text: "2", verticalAlign: "superscript" },
            { text: " and H" },
            { text: "2", verticalAlign: "subscript" },
            { text: "O" },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\super 2}");
    expect(out).toContain("{\\sub 2}");
  });

  it("writes run direction as \\rtlch/\\ltrch and paragraph direction as \\rtlpar/\\ltrpar", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          direction: "rtl",
          runs: [
            { text: "a", direction: "rtl", sizePt: 12 },
            { text: "b", direction: "ltr", sizePt: 12 },
          ],
        },
        { kind: "paragraph", direction: "ltr", runs: [{ text: "c" }] },
        { kind: "paragraph", runs: [{ text: "d" }] },
      ]),
    );
    expect(out).toContain("\\rtlpar");
    expect(out).toContain("{\\rtlch a}");
    expect(out).toContain("{\\ltrch b}");
    expect(out).toContain("\\ltrpar");
  });

  it("writes metadata.direction as the \\rtldoc/\\ltrdoc document property beside the geometry", () => {
    const rtl = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "x" }] }], {
        direction: "rtl",
      }),
    );
    expect(rtl).toContain("\\rtldoc");
    // \ltrdoc is the spec's own default, written only because the field explicitly states it -- never restated for an absent direction.
    const unstated = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "x" }] }]),
    );
    expect(unstated).not.toContain("\\rtldoc");
    expect(unstated).not.toContain("\\ltrdoc");
  });

  it("writes an explicitly-stated metadata.direction: 'ltr' as \\ltrdoc", () => {
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "x" }] }], {
        direction: "ltr",
      }),
    );
    expect(out).toContain("\\ltrdoc");
    expect(out).not.toContain("\\rtldoc");
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

  // An empty string carries no distinguishable on-state export name to preserve, so it is treated the same as no recorded value at all -- matching this function's one consistent empty-string rule across every value-shaped field (`alias`, `tag`, a plainText `value`, and now this), rather than firing the diagnostic sink for a value with nothing in it.
  it("writes no diagnostic for a checkbox whose value is an empty string, treating it the same as no recorded value", () => {
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
                  value: "",
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
    expect(out).toContain("\\ffres1");
    expect(out).toContain("\\ffdefres1");
    expect(codes).not.toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
    expectBalancedBraces(out);
  });

  // The identical silent-drop shape a checkbox's own dropped `value` had, but for a field the checkbox controlType has no concept of at all: `options` is the dropDown/comboBox choice list.
  it("reports a checkbox's options list through the diagnostic sink, rather than dropping it silently", () => {
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
                  options: ["Hello", "Guten Tag"],
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

  // Regression guard: an empty `options` array carries nothing that was actually dropped, so it must read as "never recorded" -- matching this function's own established rule for every other value-shaped field (an empty `value` fires no diagnostic either) -- rather than firing the same diagnostic the test above correctly fires for a genuinely non-empty stray options list.
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
      { sink: (diagnostic) => codes.push(diagnostic.code) },
    );
    expect(codes).not.toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
  });

  // A plainText field carrying `checked`/`options` -- fields that name concepts a text field simply does not have -- is the same sibling gap in a third shape.
  it("reports a plainText field's checked state and options list through the diagnostic sink, rather than dropping either silently", () => {
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
          sink: (diagnostic) =>
            diagnostics.push({
              code: diagnostic.code,
              message: diagnostic.message,
            }),
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

  // Regression guard, plainText side of the identical empty-options fix as the checkbox test above: a stray `checked` is still real dropped data (one diagnostic), but an empty `options` array is not (no second diagnostic) -- unlike the non-empty case above, which correctly reports both.
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
      { sink: (diagnostic) => codes.push(diagnostic.code) },
    );
    expect(
      codes.filter(
        (code) => code === RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      ),
    ).toHaveLength(1);
  });

  // The identical sibling gap in a fourth shape: `checked` is the checkbox/radio boolean, and a dropDown has no concept of it either -- the checkbox branch reports a stray `options`, the plainText branch reports a stray `checked` and `options`, and this closes the one remaining combination this function's own sink-reporting rule covers.
  it("reports a dropDown field's checked state through the diagnostic sink, rather than dropping it silently", () => {
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
          sink: (diagnostic) =>
            diagnostics.push({
              code: diagnostic.code,
              message: diagnostic.message,
            }),
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
    expect(out).toContain("\\ffhaslistbox1");
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
    expect(out).toContain("\\ffhaslistbox1");
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
    // The regression this guards: an earlier version of this writer's `indexOf` returning -1 for an unmatched value was indistinguishable from -1 for "no value recorded at all", so it minted \ffdefres0 either way -- silently picking "Hello" for a document that actually recorded "Bonjour". Neither \ffres nor \ffdefres should exist at all for this shape.
    expect(out).not.toContain("\\ffdefres");
    expect(out).not.toContain("\\ffres");
    expectBalancedBraces(out);
  });

  // An empty string that matches none of `options` (as here, where the list is ["Hello", "Guten Tag"]) is treated as "no selection was ever recorded" rather than as a genuine mismatch to report -- firing the unmatched-value diagnostic for it would be indistinguishable from a real mismatch like "Bonjour" above, which is a materially different fact to report. This is decided by `indexOf` returning -1, exactly like any other non-matching value, NOT by a blanket "empty string means no value" rule: see the sibling test directly below, where `options` genuinely contains the empty string and value:'' is therefore a real, matched selection.
  it("mints neither \\ffres nor \\ffdefres, and reports no diagnostic, for a dropDown whose value is an empty string that matches none of its options", () => {
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
                  value: "",
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
    expect(out).toContain("\\ffhaslistbox1");
    expect(out).not.toContain("\\ffdefres");
    expect(out).not.toContain("\\ffres");
    expect(codes).not.toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
    expectBalancedBraces(out);
  });

  // The regression this guards: an earlier version of this writer folded `descriptor.value.length === 0` into the same branch as `descriptor.value === undefined`, which discarded this selection entirely -- neither \ffres nor \ffdefres, with no diagnostic -- even though the empty string names a real, indexable option here (index 0). This codec's own reader can produce exactly this descriptor shape from real RTF bytes (a genuine PHPRtfLite-style dropdown whose current selection is a blank list entry), so a read-then-write round trip of a document this package itself emits must not silently lose the selection.
  it("mints \\ffdefres0\\ffres0 for a dropDown whose value is an empty string that matches a real empty-string option", () => {
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
                  options: ["", "Hello"],
                  value: "",
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
    const diagnostics: { code: string; message: string }[] = [];
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
        {
          sink: (diagnostic) =>
            diagnostics.push({
              code: diagnostic.code,
              message: diagnostic.message,
            }),
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

  // A selection that names an option past the 25-entry cutoff is unrepresentable for two independent reasons at once -- the cap and the (now-truncated-away) match -- and both fire their own diagnostic rather than one silently masking the other. The second diagnostic's message must name the REAL reason (the option was truncated away) rather than claim the value never matched any option at all, since it did match one before the cap removed it.
  it("reports both the cap and the now-unmatched selection when a dropDown's chosen value sits past the 25-entry cutoff, naming truncation as the reason rather than a false mismatch", () => {
    const messages: string[] = [];
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
    const diagnostics: { code: string; message: string }[] = [];
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
        {
          sink: (diagnostic) =>
            diagnostics.push({
              code: diagnostic.code,
              message: diagnostic.message,
            }),
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

  // An empty string carries no distinguishable default text to preserve, so it is treated the same as no recorded value at all -- matching this function's own existing convention for an empty `alias`/`tag` (see "writes no \ffownhelp/\ffhelptext at all when a contentControl has no alias" above), rather than minting an empty {\*\ffdeftext} destination and firing the diagnostic sink for a value with nothing in it.
  it("writes no \\ffdeftext at all for a plainText contentControl whose value is an empty string, treating it the same as no recorded value", () => {
    const diagnostics: { code: string }[] = [];
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
                  value: "",
                },
                startRun: 0,
                endRun: 1,
              },
            ],
          },
        ]),
        { sink: (diagnostic) => diagnostics.push({ code: diagnostic.code }) },
      ),
    );
    expect(out).not.toContain("\\ffdeftext");
    expect(diagnostics).toEqual([]);
    expectBalancedBraces(out);
  });

  // \ffownhelp1 is one of this writer's own numeric-flag members and {\*\ffhelptext ...} one of its destination-string members; this writer's own chosen order (see write.ts's formFieldPayload top comment -- not an RTF grammar production, since the Form Fields table has none) puts every flag before every destination string, including {\*\ffname ...}, itself the first destination-string member, which lands between them here.
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

  // Every numeric-flag member, in this writer's own chosen order (\fftype, \ffownhelp, \ffprot, \ffhaslistbox, \ffdefres/\ffres -- see write.ts's formFieldPayload top comment for why this is a writer convention, not an RTF grammar production, since RTF's own Form Fields table has none), before every destination-string member (\ffname, \ffhelptext, the \ffl entries). A dropDown descriptor exercising every field this writer mints at once, so a regression that reorders any flag member relative to another, interleaves the two groups, or reorders \ffname after \ffhelptext among the destination strings, fails this single assertion against the actual emitted bytes -- not merely against a comment claiming the order, which is exactly the gap an earlier round of this writer left open (the code appended \ffprot/\ffownhelp after \ffhaslistbox/\ffdefres/\ffres despite this same comment already describing the chosen order).
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

  // Regression guard: constructs.ts's own formFieldContentControl trims \ffname/\ffhelptext before gating on them (`name.trim().length > 0`), so a whitespace-only alias/tag reads back as absent on this codec's own reader. Before this fix, the writer gated on the untrimmed `.length > 0` instead, so a whitespace-only alias/tag still minted a real \ffownhelp1/{\*\ffhelptext} or {\*\ffname} destination -- content the reader would then drop on the way back in, an asymmetric round trip.
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
    // The exact payload, not just the absence of specific control words: with no lock, no alias, no tag, and no controlType-specific field, formFieldPayload's own return is the \fftype fragment alone -- pinning this catches any of its other now-unused fragments (ffNameString, ffDefTextString, ffHelpTextString) starting from a stray non-empty initial value instead of "".
    expect(out).toContain("{\\*\\formfield{\\fftype0}}");
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
                  controlType: "richText",
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
    // The dropped extent is run-scoped -- it never reaches openConstruct/closeConstruct's own block-scoped handling at all -- so the message must lead with the reason that is actually true of it (no \*\formfield spelling for this controlType), not describeConstructGap's block-scoped wording, which answers why a genuinely block-scoped construct has nothing to open in the first place.
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a contentControl construct is dropped: RTF has no \\*\\formfield spelling for a 'richText' controlType -- only plainText/checkbox/dropDown form fields mint one",
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

  // Regression guard: two contentControl extents that CROSS (neither nests inside or around the other) have no valid brace sequence in RTF at all -- verified by execution before this fix existed: {startRun:0,endRun:2} and {startRun:1,endRun:3} on three runs produced output where the first extent's own closing braces closed the second field's groups and vice versa, brace-balanced overall but mis-nested throughout. The correct behaviour is to keep the earlier-starting extent intact, drop the one that crosses it (reporting why), and never let run 'c' -- outside both extents' own union -- end up trapped inside either field's \fldrslt.
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
        sink: (diagnostic) =>
          diagnostics.push({
            code: diagnostic.code,
            message: diagnostic.message,
          }),
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

  // Exercises selectNestableFormFields' own sort, stack-popping boundary, and crossing check together: A(0,3) and B(0,2) share a startRun, so only the tie-break (wider first) puts A ahead of B; C(2,4) starts exactly where B ends (the pop boundary is inclusive: B must be popped, not merely still-open) and then genuinely crosses A, since C ends past A's own close. Fed in shuffled order (C, B, A) -- neither the sort's own reordering nor its tie-break is a no-op against this input, unlike an already-startRun-sorted fixture.
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

  // The exact endRun boundary at the other end of the crossing check: an extent that ends at precisely the same run as an already-open one is nested (sharing a closing boundary), not crossing it -- extent.endRun > top.endRun must stay strict.
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

  // The non-crossing counterpart to the two tests above: one contentControl extent properly NESTED inside another (not merely overlapping) is a shape RTF's own bracket structure handles natively, so both must still be written -- this pins that selectNestableFormFields's crossing check does not also reject legitimate nesting.
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

  it("mints a font table entry for a run's own font family inside a table cell, not only at the top block level", () => {
    // The table-collecting pass's own cell-block loop (noteBlock recursing into cell.blocks) must reach a cell's runs, distinct from the body-writing pass that clearly already does (writeCellBlocks below has its own coverage) -- a table with no font this survey pass ever saw would still write \fN references the font table itself never minted.
    const out = write(
      wordprocessing([
        {
          kind: "table",
          columnWidthsPt: [72],
          rows: [
            {
              cells: [
                {
                  blocks: [
                    {
                      kind: "paragraph",
                      runs: [{ text: "A", fontFamily: "Consolas" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(out).toContain("Consolas;");
  });

  it("writes a row's direction as the \\rtlrow/\\ltrrow <rowwrite> member inside its own \\trowd", () => {
    const out = write(
      wordprocessing([
        {
          kind: "table",
          columnWidthsPt: [72],
          rows: [
            {
              direction: "rtl",
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }] },
              ],
            },
            {
              direction: "ltr",
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }] },
              ],
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\trowd\\trgaph108\\trleft0\\rtlrow");
    expect(out).toContain("\\trowd\\trgaph108\\trleft0\\ltrrow");
    // An unstated row direction writes no <rowwrite> member at all rather than restating the \ltrrow default.
    const plain = write(
      wordprocessing([
        {
          kind: "table",
          columnWidthsPt: [72],
          rows: [
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }] },
              ],
            },
          ],
        },
      ]),
    );
    expect(plain).toContain("\\trowd\\trgaph108\\trleft0\\cellx");
  });

  it("writes cell verticalAlign as the \\clvertalc/\\clvertalb <cellalign> member, never restating the \\clvertalt default", () => {
    const out = write(
      wordprocessing([
        {
          kind: "table",
          columnWidthsPt: [72, 72],
          rows: [
            {
              cells: [
                {
                  verticalAlign: "center",
                  blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
                },
                {
                  verticalAlign: "bottom",
                  blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\clvertalc\\cellx");
    expect(out).toContain("\\clvertalb\\cellx");
    // 'top' and absent both mean the spec's own default, so neither restates \clvertalt.
    expect(out).not.toContain("\\clvertalt");
    const topStated = write(
      wordprocessing([
        {
          kind: "table",
          columnWidthsPt: [72],
          rows: [
            {
              cells: [
                {
                  verticalAlign: "top",
                  blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(topStated).not.toContain("\\clvertalt");
  });

  // writeCellBlocks writes a cell's own content as \intbl <pict>/<obj>/paragraph groups -- image and embeddedObject blocks borrow the identical \pard\plain\intbl shell a paragraph gets (see the "round trip" describe block below for both), since read.ts's own reader already proves that shape round-trips. A table or pageBreak block placed directly in a cell has no such shell to borrow -- a nested table needs its own \itapN row grammar this writer does not build, and a mid-row \page would \pard-reset the row's own \intbl state -- so those two kinds are still dropped rather than embedded, reported through CONSTRUCT_UNREPRESENTED rather than filtered out with no diagnostic at all.
  it("reports rather than silently dropping a page break placed directly in a table cell", () => {
    const codes: string[] = [];
    const out = text(
      writeRtfContent(
        wordprocessing([
          {
            kind: "table",
            columnWidthsPt: [72],
            rows: [
              {
                cells: [
                  {
                    blocks: [{ kind: "pageBreak" }],
                  },
                ],
              },
            ],
          },
        ]),
        { sink: (diagnostic) => codes.push(diagnostic.code) },
      ),
    );
    expect(codes).toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
    expect(out).not.toContain("\\page");
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

  it("writes an embedded object as a real [MS-CFB] compound file inside \\object's \\objdata", () => {
    const out = write(
      wordprocessing([
        {
          kind: "embeddedObject",
          objectKind: "spreadsheet",
          frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
          document: { kind: "spreadsheet", metadata: {}, sheets: [] },
        },
      ]),
    );
    expect(out).toContain("{\\object\\objemb\\objw2000\\objh1000");
    expect(out).toContain("{\\*\\objclass spreadsheet}");
    expect(out).toContain("{\\*\\objdata");
    // The [MS-CFB] magic bytes (D0 CF 11 E0 A1 B1 1A E1) -- proof the \objdata payload is a genuine compound file, not a placeholder or an opaque blob.
    expect(out).toContain("d0cf11e0a1b11ae1");
    expect(out).toContain("{\\result{\\pard\\plain");
  });

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
        sink: (diagnostic) =>
          diagnostics.push({
            code: diagnostic.code,
            message: diagnostic.message,
          }),
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
        sink: (diagnostic) =>
          diagnostics.push({
            code: diagnostic.code,
            message: diagnostic.message,
          }),
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
        sink: (diagnostic) =>
          diagnostics.push({
            code: diagnostic.code,
            message: diagnostic.message,
          }),
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
        sink: (diagnostic) =>
          diagnostics.push({
            code: diagnostic.code,
            message: diagnostic.message,
          }),
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
        sink: (diagnostic) =>
          diagnostics.push({
            code: diagnostic.code,
            message: diagnostic.message,
          }),
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
    // openConstruct pushes a placeholder (undefined) for a dropped, non-bookmark construct precisely so closeConstruct's later pop() still finds the RIGHT entry -- the enclosing bookmark's own name, not the placeholder's construct's -- when the two are nested rather than siblings. Without that placeholder, the footnote's own close would pop the outer bookmark's name early (writing its {\*\bkmkend} right after "A"), and the outer bookmark's real close would then find the stack already empty and write nothing at all.
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

describe("round trip through this package's own reader", () => {
  function roundTrip(document: ContentDocument): ContentDocument {
    return readRtfContent(writeRtfContent(document)).document;
  }

  it("preserves verticalAlign through the \\super/\\sub on-spellings", () => {
    // sizePt stated explicitly because the written form always states font size (RTF has no sizeless run), so the read-back carries it.
    const document = wordprocessing([
      {
        kind: "paragraph",
        runs: [
          { text: "x", sizePt: 12 },
          { text: "2", verticalAlign: "superscript", sizePt: 12 },
          { text: " and H", sizePt: 12 },
          { text: "2", verticalAlign: "subscript", sizePt: 12 },
          { text: "O", sizePt: 12 },
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

  it("preserves direction at all four scopes RTF states it", () => {
    // sizePt stated explicitly on the runs because the written form always states font size, so the read-back carries it.
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: { direction: "rtl" },
      sections: [
        {
          ...LETTER_SECTION,
          blocks: [
            {
              kind: "paragraph",
              direction: "rtl",
              runs: [
                { text: "a", direction: "rtl", sizePt: 12 },
                { text: "b", direction: "ltr", sizePt: 12 },
              ],
            },
            {
              kind: "table",
              columnWidthsPt: [72],
              rows: [
                {
                  direction: "rtl",
                  cells: [
                    {
                      blocks: [
                        {
                          kind: "paragraph",
                          runs: [{ text: "A", sizePt: 12 }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const back = roundTrip(document);
    if (back.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    expect(back.metadata.direction).toBe("rtl");
    const blocks = back.sections[0]?.blocks ?? [];
    const paragraph = blocks[0]?.kind === "paragraph" ? blocks[0] : undefined;
    expect(paragraph?.direction).toBe("rtl");
    expect(paragraph?.runs.map((run) => run.direction)).toEqual(["rtl", "ltr"]);
    const table = blocks[1]?.kind === "table" ? blocks[1] : undefined;
    expect(table?.rows[0]?.direction).toBe("rtl");
  });

  it("preserves cell verticalAlign, with an explicit 'top' collapsing into the absence that already means it", () => {
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          ...LETTER_SECTION,
          blocks: [
            {
              kind: "table",
              columnWidthsPt: [72, 72, 72],
              rows: [
                {
                  cells: [
                    {
                      verticalAlign: "center",
                      blocks: [
                        {
                          kind: "paragraph",
                          runs: [{ text: "A", sizePt: 12 }],
                        },
                      ],
                    },
                    {
                      verticalAlign: "bottom",
                      blocks: [
                        {
                          kind: "paragraph",
                          runs: [{ text: "B", sizePt: 12 }],
                        },
                      ],
                    },
                    {
                      verticalAlign: "top",
                      blocks: [
                        {
                          kind: "paragraph",
                          runs: [{ text: "C", sizePt: 12 }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const back = roundTrip(document);
    const blocks =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks : undefined;
    const table = blocks?.[0]?.kind === "table" ? blocks[0] : undefined;
    expect(table?.rows[0]?.cells.map((cell) => cell.verticalAlign)).toEqual([
      "center",
      "bottom",
      undefined,
    ]);
  });

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

  it("writes no stray {\\*\\bkmkend ...} for a constructEnd with no matching constructStart at all", () => {
    // openConstructs starts empty, so popping it here must yield undefined, not a phantom leftover entry -- a malformed input no real ContentDocument produces (flatten.ts guarantees balanced pairs), but the writer's own stack discipline should still degrade to nothing rather than a fabricated bookmark-end name.
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
        sink: (diagnostic) =>
          diagnostics.push({
            code: diagnostic.code,
            message: diagnostic.message,
          }),
      },
    );
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a contentControl construct is dropped: RTF has no block-scoped structured-document-tag equivalent -- a run-scoped plainText/checkbox/dropDown form field mints its own \\*\\formfield instead; any other controlType (richText, comboBox, date, and the rest) has no \\*\\formfield spelling at all",
      },
    ]);
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

  it("excludes the run exactly at a provenance extent's own endRun, which is exclusive", () => {
    // Each covered run is written inside its own group with its own freshly-computed \revised (there is no shared \revised0 "off" spelling), so the run exactly at endRun getting the flag too would show up as one extra occurrence, not a missing "off" marker.
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "before " }, { text: "inside " }, { text: "after" }],
          constructs: [
            {
              descriptor: {
                kind: "provenance",
                change: "insertion",
                author: "R",
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ]),
    );
    expect(out.match(/\\revised(?!0)/g)).toHaveLength(1);
  });

  it("does not treat a non-provenance construct extent as a revision mark", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "a" }, { text: "b" }],
          constructs: [
            {
              descriptor: { kind: "anchor", anchorType: "bookmark", name: "x" },
              startRun: 0,
              endRun: 2,
            },
          ],
        },
      ]),
    );
    expect(out).not.toContain("\\revised");
    expect(out).not.toContain("\\deleted");
  });

  it("still writes a real {\\*\\bkmkstart ...} for a bookmark alongside an unrelated construct, rather than misreading the bookmark as a contentControl extent", () => {
    // isContentControlExtent gates selectNestableFormFields' own input -- a bookmark wrongly let through would be handed to formFieldOpenGroup, which has no controlType field to read on an AnchorDescriptor at all.
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "a" }, { text: "b" }],
          constructs: [
            {
              descriptor: { kind: "anchor", anchorType: "bookmark", name: "x" },
              startRun: 0,
              endRun: 2,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\bkmkstart x}");
    expect(out).not.toContain("\\field");
    expectBalancedBraces(out);
  });

  it("mints a \\*\\revtbl entry for a block-scoped provenance marker's own author too, not only a run-level extent's", () => {
    // noteBlock's own constructStart case (a block-level marker, distinct from a paragraph's run-level constructs array) must reach noteDescriptor on its own path.
    const out = write(
      wordprocessing([
        {
          kind: "constructStart",
          descriptor: {
            kind: "provenance",
            change: "insertion",
            author: "Block Author",
          },
        },
        { kind: "paragraph", runs: [{ text: "x" }] },
        { kind: "constructEnd" },
      ]),
    );
    expect(out).toContain("{\\*\\revtbl");
    expect(out).toContain("Block Author;");
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
                background: { kind: "solid", color: { r: 1, g: 1, b: 0 } },
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

    const beyond = write(
      wordprocessing([
        {
          kind: "table",
          columnWidthsPt: [72],
          rows: [
            { cells: [{ blocks: [], rowSpan: 2 }] },
            { cells: [{ blocks: [] }] },
            { cells: [{ blocks: [] }] },
          ],
        },
      ]),
    );
    // rowSpan: 2 covers exactly one row below the anchor (row 1), never a second (row 2) -- \clvmrg must appear exactly twice, both from row 1's own doubled \trowd (each row's own definition is written both before and after its cells), never a third time from row 2.
    expect(beyond.match(/\\clvmrg/g)).toHaveLength(2);

    const back = roundTrip(document);
    const table = (
      back.kind === "wordprocessing" ? back.sections[0]?.blocks : []
    )?.find((block) => block.kind === "table");
    const anchor =
      table?.kind === "table" ? table.rows[0]?.cells[0] : undefined;
    expect(anchor?.rowSpan).toBe(2);
    expect(anchor?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 1, b: 0 },
    });
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

  // ExaDev/documents.js#1024: a 'pattern' cell fill now writes its own genuine two-colour \clcbpatN/\clcfpatN/\clshdngN, not just resolveCellFillColor's single representative colour collapsed into \clcbpatN alone.
  it("round-trips a 'pattern' cell fill through \\clcbpatN/\\clcfpatN/\\clshdngN", () => {
    const document = wordprocessing([
      {
        kind: "table",
        columnWidthsPt: [72],
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
                background: {
                  kind: "pattern",
                  patternType: "percent25",
                  foregroundColor: { r: 1, g: 0, b: 0 },
                  backgroundColor: { r: 0, g: 0, b: 1 },
                },
              },
            ],
          },
        ],
      },
    ]);
    const out = write(document);
    expect(out).toContain("\\clcbpat");
    expect(out).toContain("\\clcfpat");
    expect(out).toContain("\\clshdng2500");

    const back = roundTrip(document);
    const table = (
      back.kind === "wordprocessing" ? back.sections[0]?.blocks : []
    )?.find((block) => block.kind === "table");
    const cell = table?.kind === "table" ? table.rows[0]?.cells[0] : undefined;
    expect(cell?.background).toEqual({
      kind: "pattern",
      patternType: "percent25",
      foregroundColor: { r: 1, g: 0, b: 0 },
      backgroundColor: { r: 0, g: 0, b: 1 },
    });
  });

  it("throws when asked to write a cell fill pattern RTF's own flat shading percentage cannot state", () => {
    const document = wordprocessing([
      {
        kind: "table",
        columnWidthsPt: [72],
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
                background: {
                  kind: "pattern",
                  patternType: "horizontalStripe",
                },
              },
            ],
          },
        ],
      },
    ]);
    expect(() => write(document)).toThrow(/horizontalStripe/);
  });

  // constructStart/constructEnd are not a nested destination the way embeddedObject/image/table/pageBreak are: they are the same zero-width bookmark bracket writeBlock already splices into the top-level flow, and read.ts's own cellBlockExtents/insertConstructMarkers (src/read.ts) already reconstructs the pair back out of a cell's own block list. This proves the write side can produce it, not just that the reader tolerates it.
  it("round-trips a block-scoped bookmark bracketing whole paragraphs inside a table cell", () => {
    const document = wordprocessing([
      {
        kind: "table",
        columnWidthsPt: [72],
        rows: [
          {
            cells: [
              {
                blocks: [
                  {
                    kind: "constructStart",
                    descriptor: {
                      kind: "anchor",
                      anchorType: "bookmark",
                      name: "cellspan",
                    },
                  },
                  { kind: "paragraph", runs: [{ text: "One" }] },
                  { kind: "paragraph", runs: [{ text: "Two" }] },
                  { kind: "constructEnd" },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const codes: string[] = [];
    const out = text(
      writeRtfContent(document, {
        sink: (diagnostic) => codes.push(diagnostic.code),
      }),
    );
    expect(codes).not.toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
    expect(out).toContain("{\\*\\bkmkstart cellspan}");
    expect(out).toContain("{\\*\\bkmkend cellspan}");

    const back = roundTrip(document);
    const table = (
      back.kind === "wordprocessing" ? back.sections[0]?.blocks : []
    )?.find((block) => block.kind === "table");
    const cellBlocks =
      table?.kind === "table" ? table.rows[0]?.cells[0]?.blocks : undefined;
    expect(cellBlocks?.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
    ]);
  });

  // A marker at index 0 (the case above) can never expose a bug in flushing the PRECEDING paragraph's deferred \par, since there is no preceding paragraph. This cell instead opens the bookmark strictly between the first and second of three paragraphs, so the deferred \par writeCellBlocks owes paragraph one must be flushed before the marker rather than after it -- getting this wrong widens the bookmark to cover paragraph one as well once read back.
  it("round-trips a block-scoped bookmark that starts between two cell paragraphs, not at the cell's start", () => {
    const document = wordprocessing([
      {
        kind: "table",
        columnWidthsPt: [72],
        rows: [
          {
            cells: [
              {
                blocks: [
                  { kind: "paragraph", runs: [{ text: "One" }] },
                  {
                    kind: "constructStart",
                    descriptor: {
                      kind: "anchor",
                      anchorType: "bookmark",
                      name: "midcell",
                    },
                  },
                  { kind: "paragraph", runs: [{ text: "Two" }] },
                  { kind: "paragraph", runs: [{ text: "Three" }] },
                  { kind: "constructEnd" },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const back = roundTrip(document);
    const table = (
      back.kind === "wordprocessing" ? back.sections[0]?.blocks : []
    )?.find((block) => block.kind === "table");
    const cellBlocks =
      table?.kind === "table" ? table.rows[0]?.cells[0]?.blocks : undefined;
    expect(cellBlocks?.map((block) => block.kind)).toEqual([
      "paragraph",
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
    ]);
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
    // Document-level geometry (\paperwN family), stated once from the first section: 612pt/792pt/72pt margins at 20 twips/pt.
    expect(out).toContain(
      "\\paperw12240\\paperh15840\\margl1440\\margr1440\\margt1440\\margb1440",
    );
    // The second section's own geometry, in full, on the section-scoped \pgwsxnN family: 792pt/612pt/36pt margins.
    expect(out).toContain(
      "\\sectd\\pgwsxn15840\\pghsxn12240\\marglsxn720\\margrsxn720\\margtsxn720\\margbsxn720",
    );
    // The document-level geometry is stated once, in the header, from the first section -- not restated per section.
    expect(out.match(/\\paperw/g)).toHaveLength(1);
  });

  it("writes each section-break kind's own \\sbk* word, and no \\sbk* at all for the two kinds that need none", () => {
    // "nextPage" is RTF's own default section start and "column" isn't a break kind ContentSection.breakType even carries -- both spellings the SECTION_BREAK_CONTROL_WORDS map genuinely omits, distinct from an undefined breakType only in that .get() is actually called and itself returns undefined, rather than the lookup being skipped outright.
    const withBreak = (
      breakType: ContentSection["breakType"],
    ): ContentDocument => ({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        { ...LETTER_SECTION, blocks: [{ kind: "paragraph", runs: [] }] },
        {
          ...LETTER_SECTION,
          breakType,
          blocks: [{ kind: "paragraph", runs: [] }],
        },
      ],
    });
    expect(write(withBreak("continuous"))).toContain(
      "\\sectd\\sbknone\\pgwsxn",
    );
    expect(write(withBreak("evenPage"))).toContain("\\sectd\\sbkeven\\pgwsxn");
    expect(write(withBreak("oddPage"))).toContain("\\sectd\\sbkodd\\pgwsxn");
    expect(write(withBreak("nextPage"))).toContain("\\sectd\\pgwsxn");
    expect(write(withBreak(undefined))).toContain("\\sectd\\pgwsxn");
  });

  it("preserves an embedded object's kind, frame, and nested document through a real OLE compound file", () => {
    const embedded: ContentDocument = {
      kind: "spreadsheet",
      metadata: { title: "Embedded sheet" },
      sheets: [],
    };
    const back = roundTrip(
      wordprocessing([
        {
          kind: "embeddedObject",
          objectKind: "spreadsheet",
          frame: { xPt: 1, yPt: 2, widthPt: 100, heightPt: 50 },
          document: embedded,
        },
      ]),
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    expect(block?.kind).toBe("embeddedObject");
    if (block?.kind !== "embeddedObject")
      throw new Error("expected an embeddedObject block");
    expect(block.objectKind).toBe("spreadsheet");
    expect(block.frame).toEqual({ xPt: 1, yPt: 2, widthPt: 100, heightPt: 50 });
    expect(block.document).toEqual(embedded);
  });

  // Regression test: writeCellBlocks once dropped an image placed directly in a table cell's own block list outright (it wrote \intbl paragraphs only), so a \pict read out of a cell round-tripped to nothing. writeImagePict now gives the \pict destination the same \intbl variant a cell paragraph gets, and this proves it survives a full write-then-read cycle positioned correctly between the cell's own surrounding text.
  it("preserves an image placed directly inside a table cell, alongside the cell's own surrounding text", () => {
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const back = roundTrip(
      wordprocessing([
        {
          kind: "table",
          columnWidthsPt: [72],
          rows: [
            {
              cells: [
                {
                  blocks: [
                    { kind: "paragraph", runs: [{ text: "before" }] },
                    {
                      kind: "image",
                      format: "png",
                      base64,
                      widthPt: 72,
                      heightPt: 36,
                    },
                    { kind: "paragraph", runs: [{ text: "after" }] },
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
    const cellBlocks =
      table?.kind === "table" ? table.rows[0]?.cells[0]?.blocks : undefined;
    expect(cellBlocks?.map((block) => block.kind)).toEqual([
      "paragraph",
      "image",
      "paragraph",
    ]);
    const image = cellBlocks?.find((block) => block.kind === "image");
    expect(image?.kind === "image" ? image.format : undefined).toBe("png");
    const cellText = (cellBlocks ?? [])
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text));
    expect(cellText).toEqual(["before", "after"]);
  });

  // The identical regression as the image case above, for the PR's own headline construct: writeCellBlocks once dropped an \object placed directly in a table cell too, discarding a decoded embedded object entirely on write. writeEmbeddedObjectBlock's own \intbl variant fixes it the same way.
  it("preserves an embedded object placed directly inside a table cell, alongside the cell's own surrounding text", () => {
    const embedded: ContentDocument = {
      kind: "spreadsheet",
      metadata: { title: "Embedded sheet" },
      sheets: [],
    };
    const back = roundTrip(
      wordprocessing([
        {
          kind: "table",
          columnWidthsPt: [72],
          rows: [
            {
              cells: [
                {
                  blocks: [
                    { kind: "paragraph", runs: [{ text: "before" }] },
                    {
                      kind: "embeddedObject",
                      objectKind: "spreadsheet",
                      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
                      document: embedded,
                    },
                    { kind: "paragraph", runs: [{ text: "after" }] },
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
    const cellBlocks =
      table?.kind === "table" ? table.rows[0]?.cells[0]?.blocks : undefined;
    expect(cellBlocks?.map((block) => block.kind)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
    const object = cellBlocks?.find((block) => block.kind === "embeddedObject");
    expect(
      object?.kind === "embeddedObject" ? object.objectKind : undefined,
    ).toBe("spreadsheet");
    const cellText = (cellBlocks ?? [])
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text));
    expect(cellText).toEqual(["before", "after"]);
  });
});
