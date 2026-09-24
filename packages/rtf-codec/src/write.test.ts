import { describe, expect, it } from "vitest";
import { RtfUnsupportedDocumentKindError } from "./diagnostics";
import { expectBalancedBraces } from "./test-support/brace-balance";
import { writeRtfContent } from "./write";
import { wordprocessing, write } from "./test-support/wordprocessing-document";

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
    // A default paragraph (no heading/alignment/direction/list) has empty paragraphProperties output, so \pard\plain is followed directly by the mandatory separating space and then the run text — with nothing between \plain and the space to obscure whether the space survived.
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "hi" }] }]),
    );
    expect(out).toContain("\\pard\\plain {hi}");
  });

  it("writes no \\colortbl/\\stylesheet/\\*\\listtable/\\*\\revtbl/\\info at all for a document using none of them", () => {
    // Each of these five destinations is genuinely optional — unlike \fonttbl, which always carries at least the default font — and each has its own guard against writing an empty destination for nothing. \info's own guard (fields.length > 0) is the only one gating a group built from four independently-optional sub-fields rather than a single table, so an empty document with no metadata at all is the fixture that proves the whole group, not just one field, is skipped.
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
    // 0x20 (space) and 0x7E (~) are the first and last bytes the >= 0x20 && < 0x7f range admits — both must pass through literally, not fall into the \\uN escape path.
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "a b~c" }] }]),
    );
    expect(out).toContain("a b~c");
    expect(out).not.toContain("\\u32");
    expect(out).not.toContain("\\u126");
  });

  it("escapes a control character below the printable-ASCII range's own lower bound as \\uN", () => {
    // 0x01 is not one of the specially-cased \t/\n/\r control characters, so it reaches the >= 0x20 check directly — it must not pass through raw.
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
    // The spec's own signed-negative rule is stated as "greater than 32767" — 0x7FFF (32767) itself is the boundary value that must NOT flip to negative.
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
    // Exactly two colours — red first (\cf1), blue second (\cf2) — not three, which a re-recorded 'red' bumped to a fresh, too-high index would produce.
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
    // Joined with "; ", not "" — otherwise "onetwo" would be indistinguishable from a single keyword.
    expect(out).toContain("{\\keywords one; two}");
    // The four fields joined with "" between them, not any separator — checked as one contiguous run, since each field's own substring above would still be found even with a real separator wrongly inserted between them.
    expect(out).toContain(
      "{\\info{\\title A Title}{\\author An Author}{\\subject A Subject}{\\keywords one; two}}",
    );
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
    // \listhybrid requires exactly nine levels, each indented one step further than the last (LIST_LEVEL_INDENT_TWIPS * (level + 1)) — the first at one step, the ninth at nine.
    expect(out.match(/\\listlevel/g)).toHaveLength(9);
    expect(out).toContain(`\\li${String(720 * 1)}\\lin${String(720 * 1)}`);
    expect(out).toContain(`\\li${String(720 * 9)}\\lin${String(720 * 9)}`);
    // A bullet level's own \levelnumbers is empty — there is no decimal counter to place a placeholder byte for.
    expect(out).toContain("{\\levelnumbers;}");
    expect(out).not.toContain("\\levelnumbers\\'01");
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
    // An ordered level's own \levelnumbers carries the \'01 placeholder byte naming where the level's own decimal counter is inserted — RTF 1.9.1's own <levelnumbers> production.
    expect(out).toContain("{\\levelnumbers\\'01;}");
  });
});
