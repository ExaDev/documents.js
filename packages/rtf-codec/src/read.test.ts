import { describe, expect, it } from "vitest";
import { writeCompoundFile, writeOlePackage } from "archive-codec";
import type {
  ContentBlock,
  ContentImageBlock,
  ContentParagraph,
  ContentSection,
  ContentTable,
} from "document-schema.js";
import { ContentDocumentSchema } from "document-schema.js";
import type { ContentEmbeddedObjectBlock } from "document-schema.js";
import {
  RtfDiagnosticCodes,
  RtfInputTooLargeError,
  RtfNestingLimitExceededError,
  RtfNotAnRtfDocumentError,
} from "./diagnostics";
import { bytesToHex, hexToBytes } from "./base64";
import { writeEmbeddedObjectData } from "./embedded-object";
import { readRtf, readRtfContent } from "./read";
import { bytes, text } from "./test-support/bytes";

// Stands in for a hostile producer who writes the identical spec-conformant ObjectHeader/NativeDataSize/NativeData/Presentation envelope writeEmbeddedObjectData produces, but wraps an arbitrary JSON payload inside NativeData's own Package stream instead of a genuine ContentEmbeddedObject -- writeEmbeddedObjectData itself always rebuilds its payload object field-by-field from a real ContentEmbeddedObject, so it cannot be used to smuggle an extra key the way a raw \objdata forged by hand can. Reuses a real envelope's own ObjectHeader and Presentation bytes verbatim (both fixed, independent of the JSON payload) and only replaces NativeData, so the forged bytes are byte-identical to a real \objdata this codec produced except for the one field under test.
function forgeEmbeddedObjectData(payload: unknown): Uint8Array<ArrayBuffer> {
  const base = writeEmbeddedObjectData({
    objectKind: "spreadsheet",
    document: { kind: "spreadsheet", metadata: {}, sheets: [] },
    frame: { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
  });
  const view = new DataView(base.buffer, base.byteOffset, base.byteLength);
  // OLEVersion(4) + FormatID(4) + ClassName "Package" (length-prefix 4 + 8 bytes) + TopicName "" (4) + ItemName "" (4) -- see embedded-object.ts's own writeObjectHeader. Sanity-checked against the real FormatID this writer always emits, rather than assumed blind, so a future change to that layout fails loudly here instead of silently forging a bad envelope.
  const headerLength = 28;
  if (view.getUint32(4, true) !== 0x00000002) {
    throw new Error(
      "forgeEmbeddedObjectData's own ObjectHeader-length assumption no longer matches writeEmbeddedObjectData's output",
    );
  }
  const originalNativeDataSize = view.getUint32(headerLength, true);
  const nativeDataStart = headerLength + 4;
  const presentationBytes = base.subarray(
    nativeDataStart + originalNativeDataSize,
  );
  const packageBytes = writeOlePackage({
    label: "rtf-codec-embedded-object.json",
    sourcePath: "",
    tempPath: "",
    fileBytes: new TextEncoder().encode(JSON.stringify(payload)),
  });
  const nativeData = writeCompoundFile([
    { path: "Package", bytes: packageBytes },
  ]);
  const out = new Uint8Array(
    nativeDataStart + nativeData.length + presentationBytes.length,
  );
  out.set(base.subarray(0, headerLength), 0);
  new DataView(out.buffer).setUint32(headerLength, nativeData.length, true);
  out.set(nativeData, nativeDataStart);
  out.set(presentationBytes, nativeDataStart + nativeData.length);
  return out;
}

// The header prefix every body fixture below shares, so each test states only the construct it is about. It is the shape a real producer emits: version, character set, font table, colour table.
const HEADER =
  "{\\rtf1\\ansi\\ansicpg1252\\deff0" +
  "{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}" +
  "{\\colortbl;\\red0\\green0\\blue0;\\red255\\green0\\blue0;}";

function sectionsOf(source: string): ContentSection[] {
  const { document } = readRtfContent(bytes(source));
  if (document.kind !== "wordprocessing") {
    throw new Error(`expected a wordprocessing document, got ${document.kind}`);
  }
  return document.sections;
}

function blocksOf(source: string): ContentBlock[] {
  return sectionsOf(source).flatMap((section) => section.blocks);
}

function paragraphsOf(source: string): ContentParagraph[] {
  return blocksOf(source).filter(
    (block): block is ContentParagraph => block.kind === "paragraph",
  );
}

function firstTable(source: string): ContentTable {
  const table = blocksOf(source).find(
    (block): block is ContentTable => block.kind === "table",
  );
  if (table === undefined) {
    throw new Error("expected the document to contain a table");
  }
  return table;
}

describe("document shape", () => {
  it("rejects input that does not open with the {\\rtfN the <File> production requires", () => {
    expect(() => readRtfContent(bytes("not rtf at all"))).toThrow(
      RtfNotAnRtfDocumentError,
    );
  });

  it("rejects a document whose very first token is not itself a group-opening brace, even when a later token happens to be a control word named rtf", () => {
    // No leading "{" at all: the first token is the \rtf control word itself, so its own kind is "controlWord", not "groupStart". A second \rtf1 immediately after makes the SECOND and THIRD conditions of assertRtfHeaderPresent's own OR chain both individually false on this input -- the first condition (checking the very first token's kind) is the only one standing between this and being wrongly accepted as well-formed.
    expect(() => readRtfContent(bytes("\\rtf1\\rtf1"))).toThrow(
      RtfNotAnRtfDocumentError,
    );
  });

  it("rejects a properly braced document whose first control word names a destination other than rtf", () => {
    // The brace and the control-word shape are both correct here -- only the control word's own NAME is wrong (\ansi, not \rtf) -- so this is the one fixture that actually exercises assertRtfHeaderPresent's own third OR clause: the first two conditions are both false on this input, leaving the name check alone to reject it.
    expect(() => readRtfContent(bytes("{\\ansi not rtf}"))).toThrow(
      RtfNotAnRtfDocumentError,
    );
  });

  it("produces a wordprocessing ContentDocument its own schema accepts", () => {
    const { document } = readRtfContent(
      bytes(`${HEADER}\\pard\\plain Hello.\\par}`),
    );
    expect(ContentDocumentSchema.safeParse(document).success).toBe(true);
  });

  it("reads the specification's own worked plain-text example", () => {
    const spec =
      "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\froman Tms Rmn;}{\\f1\\fdecor Symbol;}{\\f2\\fswiss Helv;}}" +
      "{\\colortbl;\\red0\\green0\\blue0;\\red0\\green0\\blue255;}" +
      "{\\stylesheet{\\fs20 \\snext0 Normal;}}{\\info{\\author John Doe}}" +
      "\\widoctrl\\ftnbj \\sectd\\linex0\\endnhere \\pard\\plain \\fs20 This is plain text.\\par}";
    const paragraphs = paragraphsOf(spec);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs[0]?.text).toBe("This is plain text.");
    expect(paragraphs[0]?.runs[0]?.sizePt).toBe(10);
  });

  it("carries the page geometry into the section, converted from twips to points", () => {
    const [section] = sectionsOf(
      "{\\rtf1\\ansi\\paperw12240\\paperh15840\\margl1440\\margr1440\\margt1440\\margb1440\\pard x\\par}",
    );
    expect(section?.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
    expect(section?.margins).toEqual({
      topPt: 72,
      rightPt: 72,
      bottomPt: 72,
      leftPt: 72,
    });
  });

  it("carries the {\\info ...} group into document metadata", () => {
    const { document } = readRtfContent(
      bytes(
        "{\\rtf1\\ansi{\\info{\\title Quarterly Report}{\\author A. Writer}}\\pard x\\par}",
      ),
    );
    expect(document.metadata).toEqual({
      title: "Quarterly Report",
      author: "A. Writer",
    });
  });

  it("reads \\rtldoc/\\ltrdoc onto metadata.direction, alongside rather than inside the {\\info ...} group", () => {
    // The document-level pair is a bare document property, not an \info field, and a document stating both spells its real direction last.
    const { document } = readRtfContent(
      bytes("{\\rtf1\\ansi\\rtldoc{\\info{\\title RTL Report}}\\pard x\\par}"),
    );
    expect(document.metadata.direction).toBe("rtl");
    expect(document.metadata.title).toBe("RTL Report");
    const ltrDoc = readRtfContent(
      bytes("{\\rtf1\\ansi\\rtldoc\\ltrdoc\\pard x\\par}"),
    );
    expect(ltrDoc.document.metadata.direction).toBe("ltr");
  });
});

describe("character formatting", () => {
  it("splits runs where a toggle control word changes, and turns each off at its 0 parameter", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard plain \\b bold\\b0  again\\par}`)[0]
        ?.runs ?? [];
    expect(runs.map((run) => run.text)).toEqual(["plain ", "bold", " again"]);
    expect(runs[1]?.bold).toBe(true);
    expect(runs[0]?.bold).toBeUndefined();
    expect(runs[2]?.bold).toBeUndefined();
  });

  it("restores the outer group's formatting when a group closes, as the spec's inheritance rule requires", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard before {\\i inside} after\\par}`)[0]
        ?.runs ?? [];
    expect(runs.map((run) => run.text)).toEqual([
      "before ",
      "inside",
      " after",
    ]);
    expect(runs[1]?.italic).toBe(true);
    expect(runs[2]?.italic).toBeUndefined();
  });

  it("reads every underline variant as the one boolean ContentRun carries, and \\ulnone as off", () => {
    const runs =
      paragraphsOf(
        `${HEADER}\\pard \\ul one\\ulnone  two\\uldash three\\ulnone\\par}`,
      )[0]?.runs ?? [];
    expect(runs[0]?.underline).toBe(true);
    expect(runs[1]?.underline).toBeUndefined();
    expect(runs[2]?.underline).toBe(true);
  });

  it("converts \\fsN from half-points to points and resolves \\fN through the font table", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\f1\\fs36 Arial eighteen\\par}`)[0]
        ?.runs ?? [];
    expect(runs[0]?.fontFamily).toBe("Arial");
    expect(runs[0]?.sizePt).toBe(18);
  });

  it("resolves \\cfN through the colour table into a 0..1 Color", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\cf2 red text\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.color).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("drops hidden text, which \\v marks and no ContentRun field expresses", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard shown \\v hidden\\v0  shown again\\par}`)[0]
        ?.runs ?? [];
    expect(runs.map((run) => run.text).join("")).toBe("shown  shown again");
  });

  it("reads \\strike as the strike field", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\strike struck\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.strike).toBe(true);
  });

  it("reads \\super and \\sub onto verticalAlign, as their own runs beside baseline text", () => {
    // The shape LibreOffice's own filter writes for the standard positions: a braced on-word around the raised text.
    const runs =
      paragraphsOf(`${HEADER}\\pard x{\\super 2} and H{\\sub 2}O\\par}`)[0]
        ?.runs ?? [];
    expect(runs.map((run) => run.text)).toEqual(["x", "2", " and H", "2", "O"]);
    expect(runs.map((run) => run.verticalAlign)).toEqual([
      undefined,
      "superscript",
      undefined,
      "subscript",
      undefined,
    ]);
  });

  it("reads \\upN and \\dnN by the sign of their half-point offset, with zero restoring the baseline", () => {
    // "\upN Move up N half-points (default is 6)" -- bare means the default raise, a negative moves down into the other family (\dn-3 raises by the mirror argument), and zero is no move at all. The doubled spaces after a parameterised word are the delimiter space plus a real text space, the same convention the \b0 fixture above uses.
    const runs =
      paragraphsOf(
        `${HEADER}\\pard \\up raised\\up0  base\\dn3  lowered\\dn-3  raised again\\dn0  base again\\par}`,
      )[0]?.runs ?? [];
    expect(runs.map((run) => run.text)).toEqual([
      "raised",
      " base",
      " lowered",
      " raised again",
      " base again",
    ]);
    expect(runs.map((run) => run.verticalAlign)).toEqual([
      "superscript",
      undefined,
      "subscript",
      "superscript",
      undefined,
    ]);
  });

  it("reads \\nosupersub as the off-spelling for both families", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\super up\\nosupersub  base\\par}`)[0]
        ?.runs ?? [];
    expect(runs[0]?.verticalAlign).toBe("superscript");
    expect(runs[1]?.verticalAlign).toBeUndefined();
  });

  it("turns verticalAlign off at the group boundary and at \\plain, like every other character property", () => {
    const runs =
      paragraphsOf(
        `${HEADER}\\pard before {\\super inside} after\\plain \\super gone\\plain  back\\par}`,
      )[0]?.runs ?? [];
    expect(runs.map((run) => run.verticalAlign)).toEqual([
      undefined,
      "superscript",
      undefined,
      "superscript",
      undefined,
    ]);
  });

  it("reads \\rtlch and \\ltrch onto ContentRun.direction, with the last-stated of the pair winning", () => {
    // The middle two groups spell the pair the way a real producer does, the run's real direction last (\rtlch\ltrch for an LTR run, \ltrch\rtlch for an RTL one), and each closing brace restores the enclosing state -- so the text between groups is unstated again.
    const runs =
      paragraphsOf(
        `${HEADER}\\pard plain {\\rtlch rtl}{\\rtlch\\ltrch ltr} and {\\ltrch\\rtlch rtl again}{\\ltrch ltr}\\par`,
      )[0]?.runs ?? [];
    expect(runs.map((run) => run.text)).toEqual([
      "plain ",
      "rtl",
      "ltr",
      " and ",
      "rtl again",
      "ltr",
    ]);
    expect(runs.map((run) => run.direction)).toEqual([
      undefined,
      "rtl",
      "ltr",
      undefined,
      "rtl",
      "ltr",
    ]);
  });
});

describe("text, escapes, and Unicode", () => {
  it("decodes \\'hh through the document's own code page", () => {
    // 0xE9 is e-acute in cp1252.
    const runs = paragraphsOf(`${HEADER}\\pard caf\\'e9\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.text).toBe("café");
  });

  it("decodes \\'hh through the run's own font code page when that font declares one", () => {
    const source =
      "{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\froman\\fcharset0 Times;}{\\f1\\fswiss\\fcharset204 Arial Cyr;}}" +
      "\\pard \\f1\\'c0\\par}";
    // 0xC0 is CYRILLIC CAPITAL LETTER A in cp1251, which \fcharset204 names.
    expect(paragraphsOf(source)[0]?.runs[0]?.text).toBe("А");
  });

  it("reads \\uN and skips the one ANSI fallback character \\uc1 implies", () => {
    // The spec's own example: "Lab\u915GValue" is "LabGValue" with the Greek capital gamma.
    const runs =
      paragraphsOf(`${HEADER}\\pard\\uc1 Lab\\u915 GValue\\par}`)[0]?.runs ??
      [];
    expect(runs.map((run) => run.text).join("")).toBe("LabΓValue");
  });

  it("skips the number of fallback characters the innermost \\ucN states, not a fixed one", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard\\uc3 a\\u915 ???b\\par}`)[0]?.runs ?? [];
    expect(runs.map((run) => run.text).join("")).toBe("aΓb");
  });

  it("restores the enclosing \\ucN when a group closes, which the spec requires be stacked", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard\\uc1 {\\uc0\\u915 }\\u916 ?end\\par}`)[0]
        ?.runs ?? [];
    expect(runs.map((run) => run.text).join("")).toBe("ΓΔend");
  });

  it("expresses a Unicode value above U+7FFF as the negative number the spec prescribes", () => {
    // "the character code U+F020 is given by \u-4064".
    const runs =
      paragraphsOf(`${HEADER}\\pard\\uc1 \\u-4064 ?\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.text).toBe("");
  });

  it("ends a fallback skip at a brace rather than eating past it", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard\\uc5 {\\u915 }kept\\par}`)[0]?.runs ?? [];
    expect(runs.map((run) => run.text).join("")).toBe("Γkept");
  });

  it("reads the special-character control words and symbols as their own text", () => {
    const runs =
      paragraphsOf(
        `${HEADER}\\pard a\\tab b\\emdash c\\~d\\lquote e\\{f\\}g\\\\h\\par}`,
      )[0]?.runs ?? [];
    expect(runs.map((run) => run.text).join("")).toBe("a\tb—c d‘e{f}g\\h");
  });

  it("reads \\line as a line break inside the run rather than a new paragraph", () => {
    const paragraphs = paragraphsOf(`${HEADER}\\pard first\\line second\\par}`);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs.map((run) => run.text).join("")).toBe(
      "first\nsecond",
    );
  });

  it("takes the \\ud half of a {\\upr ...} pair and discards the ANSI half", () => {
    const runs =
      paragraphsOf(
        `${HEADER}\\pard{\\upr{ansi only}{\\*\\ud{\\uc0\\u915 unicode}}}\\par}`,
      )[0]?.runs ?? [];
    expect(runs.map((run) => run.text).join("")).toBe("Γunicode");
  });
});

describe("paragraph formatting", () => {
  it("reads alignment, indents and spacing, converting twips to points", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard\\qc\\li720\\fi-360\\sb240\\sa120 centred\\par}`,
    )[0];
    expect(paragraph?.alignment).toBe("center");
    expect(paragraph?.indentLeftPt).toBe(36);
    expect(paragraph?.indentFirstLinePt).toBe(-18);
    expect(paragraph?.spacingBeforePt).toBe(12);
    expect(paragraph?.spacingAfterPt).toBe(6);
  });

  it("reads \\slN with \\slmult1 as a multiple of single line height", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard\\sl360\\slmult1 one and a half\\par}`,
    )[0];
    expect(paragraph?.lineSpacing).toBe(1.5);
  });

  it("leaves lineSpacing absent for the exact/at-least form \\slmult0 names, which is not a multiple", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard\\sl360\\slmult0 exact\\par}`,
    )[0];
    expect(paragraph?.lineSpacing).toBeUndefined();
  });

  it("resets paragraph properties at \\pard", () => {
    const paragraphs = paragraphsOf(
      `${HEADER}\\pard\\qr right\\par\\pard plain\\par}`,
    );
    expect(paragraphs[0]?.alignment).toBe("right");
    expect(paragraphs[1]?.alignment).toBeUndefined();
  });

  it("reads \\rtlpar and \\ltrpar onto ContentParagraph.direction, carrying the state across \\par and clearing it at \\pard", () => {
    // Paragraph properties persist from one paragraph to the next until \pard or a group close resets them, the same rule alignment already follows above.
    const paragraphs = paragraphsOf(
      `${HEADER}\\pard\\rtlpar first\\par second\\par\\ltrpar third\\par\\pard fourth\\par}`,
    );
    expect(paragraphs.map((paragraph) => paragraph.direction)).toEqual([
      "rtl",
      "rtl",
      "ltr",
      undefined,
    ]);
  });

  it("reads \\pagebb as pageBreakBefore and \\page as its own pageBreak block", () => {
    expect(
      paragraphsOf(`${HEADER}\\pard\\pagebb x\\par}`)[0]?.pageBreakBefore,
    ).toBe(true);
    expect(
      blocksOf(`${HEADER}\\pard a\\par\\page\\pard b\\par}`).map(
        (block) => block.kind,
      ),
    ).toEqual(["paragraph", "pageBreak", "paragraph"]);
  });

  it("produces an empty paragraph for a bare \\par, which is real content in a wordprocessing document", () => {
    expect(
      paragraphsOf(`${HEADER}\\pard a\\par\\par\\pard b\\par}`),
    ).toHaveLength(3);
  });

  it("derives headingLevel and styleId from a \\sN that names a built-in heading style", () => {
    const source =
      "{\\rtf1\\ansi{\\stylesheet{\\s0 Normal;}{\\s1\\sbasedon0\\snext0 heading 1;}}" +
      "\\pard\\s1 A Heading\\par\\pard\\s0 Body.\\par}";
    const paragraphs = paragraphsOf(source);
    expect(paragraphs[0]?.headingLevel).toBe(1);
    expect(paragraphs[0]?.styleId).toBe("heading 1");
    expect(paragraphs[1]?.headingLevel).toBeUndefined();
  });

  it("prefers the paragraph's own \\outlinelevelN over its style's heading level", () => {
    const source =
      "{\\rtf1\\ansi{\\stylesheet{\\s1\\snext0 heading 1;}}\\pard\\s1\\outlinelevel2 Deeper\\par}";
    expect(paragraphsOf(source)[0]?.headingLevel).toBe(3);
  });
});

describe("lists", () => {
  const LIST_TABLES =
    "{\\*\\listtable" +
    "{\\list\\listtemplateid1\\listsimple{\\listlevel\\levelnfc23\\leveljc0\\levelstartat1{\\leveltext \\'01\\u183 ?;}{\\levelnumbers;}}\\listid101}" +
    "{\\list\\listtemplateid2\\listsimple{\\listlevel\\levelnfc0\\leveljc0\\levelstartat1{\\leveltext \\'02\\'00.;}{\\levelnumbers\\'01;}}\\listid102}" +
    "}{\\*\\listoverridetable{\\listoverride\\listid101\\listoverridecount0\\ls1}{\\listoverride\\listid102\\listoverridecount0\\ls2}}";

  it("reads \\lsN and \\ilvlN into a list membership whose numId records the level's own marker type", () => {
    const paragraph = paragraphsOf(
      `${HEADER}${LIST_TABLES}\\pard\\ls1\\ilvl0{\\listtext\\f2 \\u183 ?}Bulleted item\\par}`,
    )[0];
    expect(paragraph?.list).toEqual({ numId: "rtf1:bullet", level: 0 });
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe(
      "Bulleted item",
    );
  });

  it("records a numbered list's level as ordered", () => {
    const paragraph = paragraphsOf(
      `${HEADER}${LIST_TABLES}\\pard\\ls2\\ilvl0{\\listtext 1.}Numbered item\\par}`,
    )[0];
    expect(paragraph?.list).toEqual({ numId: "rtf2:ordered", level: 0 });
  });

  it("carries the nesting depth \\ilvlN states", () => {
    const paragraph = paragraphsOf(
      `${HEADER}${LIST_TABLES}\\pard\\ls1\\ilvl2 Deep item\\par}`,
    )[0];
    expect(paragraph?.list?.level).toBe(2);
  });

  it("falls back to the list's own level 0 when \\ilvlN names a depth the \\listsimple table never defined", () => {
    // LIST_TABLES's own list 101 (bound to \ls1) is \listsimple, carrying exactly one \listlevel at index 0 -- \ilvl2 names a depth with no definition of its own, so the level's numberFormat (bullet, here) must be read from level 0's definition rather than from an undefined level.
    const paragraph = paragraphsOf(
      `${HEADER}${LIST_TABLES}\\pard\\ls1\\ilvl2 Deep item\\par}`,
    )[0];
    expect(paragraph?.list?.numId).toBe("rtf1:bullet");
  });

  it("carries a \\lfolevel start-at override through to the paragraph's own numId", () => {
    // The same \list102 both overrides name, restarted at 5 by \ls3's own \lfolevel while \ls2 leaves it at 1 -- so the override table, not the list table, is what tells the two apart.
    const tables =
      "{\\*\\listtable" +
      "{\\list\\listtemplateid2\\listsimple{\\listlevel\\levelnfc0\\leveljc0\\levelstartat1{\\leveltext \\'02\\'00.;}{\\levelnumbers\\'01;}}\\listid102}" +
      "}{\\*\\listoverridetable" +
      "{\\listoverride\\listid102\\listoverridecount0\\ls2}" +
      "{\\listoverride\\listid102\\listoverridecount1{\\lfolevel\\listoverridestartat\\levelstartat5}\\ls3}" +
      "}";
    const paragraphs = paragraphsOf(
      `${HEADER}${tables}\\pard\\ls2\\ilvl0 First\\par\\pard\\ls3\\ilvl0 Restarted\\par}`,
    );
    expect(paragraphs[0]?.list?.numId).toBe("rtf2:ordered");
    expect(paragraphs[1]?.list?.numId).toBe("rtf3:ordered@5");
  });

  it("carries a \\lfolevel format override, so an override can turn a numbered list bulleted", () => {
    const tables =
      "{\\*\\listtable" +
      "{\\list\\listtemplateid2\\listsimple{\\listlevel\\levelnfc0\\leveljc0\\levelstartat1{\\leveltext \\'02\\'00.;}{\\levelnumbers\\'01;}}\\listid102}" +
      "}{\\*\\listoverridetable" +
      "{\\listoverride\\listid102\\listoverridecount1{\\lfolevel\\listoverrideformat1" +
      "{\\listlevel\\levelnfc23\\leveljc0\\levelstartat1{\\leveltext \\'01\\u183 ?;}{\\levelnumbers;}}" +
      "}\\ls1}}";
    const paragraph = paragraphsOf(
      `${HEADER}${tables}\\pard\\ls1\\ilvl0 Item\\par}`,
    )[0];
    expect(paragraph?.list?.numId).toBe("rtf1:bullet");
  });

  it("discards a {\\listtext ...} group, which a numbering-aware reader must ignore", () => {
    const paragraph = paragraphsOf(
      `${HEADER}${LIST_TABLES}\\pard\\ls1\\ilvl0{\\listtext\\f0 \\'b7\\tab}Item\\par}`,
    )[0];
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe("Item");
  });
});

describe("tables", () => {
  const ROW =
    "\\trowd\\trgaph108\\trleft0\\cellx4320\\cellx8640" +
    "\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row";

  it("builds a table from the \\cell and \\row marks, since RTF has no table group", () => {
    const table = firstTable(`${HEADER}${ROW}\\pard After.\\par}`);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.cells).toHaveLength(2);
  });

  it("takes each cell's text from the paragraphs the \\cell mark closes", () => {
    const table = firstTable(`${HEADER}${ROW}\\pard After.\\par}`);
    const firstCell = table.rows[0]?.cells[0]?.blocks[0];
    expect(firstCell?.kind).toBe("paragraph");
    expect(
      firstCell?.kind === "paragraph"
        ? firstCell.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("A");
  });

  it("derives column widths from the differences between consecutive \\cellxN boundaries", () => {
    const table = firstTable(`${HEADER}${ROW}\\pard After.\\par}`);
    expect(table.columnWidthsPt).toEqual([216, 216]);
  });

  it("accumulates several rows into one table", () => {
    const table = firstTable(`${HEADER}${ROW}${ROW}\\pard After.\\par}`);
    expect(table.rows).toHaveLength(2);
  });

  it("reads the \\rtlrow/\\ltrrow <rowwrite> member onto ContentTableRow.direction", () => {
    // Each row's own \trowd opens a fresh row definition, so a direction stated inside one row's definition reaches that row alone -- the second row's plain \trowd leaves it at the unstated default.
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\rtlrow\\cellx4320\\cellx8640" +
        "\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row" +
        "\\trowd\\trleft0\\ltrrow\\cellx4320\\cellx8640" +
        "\\pard\\intbl C\\cell\\pard\\intbl D\\cell\\row" +
        "\\trowd\\trleft0\\cellx4320\\cellx8640" +
        "\\pard\\intbl E\\cell\\pard\\intbl F\\cell\\row" +
        "\\pard After.\\par",
    );
    expect(table.rows.map((row) => row.direction)).toEqual([
      "rtl",
      "ltr",
      undefined,
    ]);
  });

  it("closes the table when an ordinary paragraph follows it", () => {
    const kinds = blocksOf(`${HEADER}${ROW}\\pard After.\\par}`).map(
      (block) => block.kind,
    );
    expect(kinds).toEqual(["table", "paragraph"]);
  });

  it("keeps several paragraphs inside one cell", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx4320\\pard\\intbl one\\par\\pard\\intbl two\\cell\\row\\pard After.\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.blocks).toHaveLength(2);
  });

  it("falls back to an even split, with a diagnostic, when the \\cellxN boundaries do not increase", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\trowd\\trleft0\\cellx4320\\cellx4320\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row\\pard x\\par}`,
      ),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.TABLE_COLUMN_WIDTH_INVALID,
      ),
    ).toBe(true);
  });
});

describe("pictures", () => {
  // A one-pixel PNG, hex-encoded exactly as a \pict destination's own #SDATA payload.
  const PNG_HEX =
    "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
    "01f15c4890000000a49444154789c6300010000050001" +
    "0d0a2db40000000049454e44ae426082";

  it("reads a \\pngblip picture into a ContentImageBlock with its goal size in points", () => {
    const image = blocksOf(
      `${HEADER}\\pard{\\*\\shppict{\\pict\\pngblip\\picw1\\pich1\\picwgoal1440\\pichgoal720 ${PNG_HEX}}}\\par}`,
    ).find((block): block is ContentImageBlock => block.kind === "image");
    expect(image?.format).toBe("png");
    expect(image?.widthPt).toBe(72);
    expect(image?.heightPt).toBe(36);
    expect(image?.base64.startsWith("iVBORw0KGgo")).toBe(true);
  });

  it("applies \\picscalexN and \\picscaleyN to the goal size", () => {
    const image = blocksOf(
      `${HEADER}\\pard{\\pict\\pngblip\\picwgoal1440\\pichgoal1440\\picscalex50\\picscaley25 ${PNG_HEX}}\\par}`,
    ).find((block): block is ContentImageBlock => block.kind === "image");
    expect(image?.widthPt).toBe(36);
    expect(image?.heightPt).toBe(18);
  });

  it("falls back to \\picwN/\\pichN pixels when no goal size is stated", () => {
    const image = blocksOf(
      `${HEADER}\\pard{\\pict\\pngblip\\picw96\\pich48 ${PNG_HEX}}\\par}`,
    ).find((block): block is ContentImageBlock => block.kind === "image");
    expect(image?.widthPt).toBe(72);
    expect(image?.heightPt).toBe(36);
  });

  it("drops a metafile picture with a diagnostic, since ContentImageBlock carries PNG and JPEG only", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\pict\\wmetafile8\\picwgoal1440\\pichgoal1440 ab}\\par}`,
      ),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
      ),
    ).toBe(true);
  });

  it("skips the {\\nonshppict ...} duplicate the spec says a reader will not read", () => {
    const images = blocksOf(
      `${HEADER}\\pard{\\*\\shppict{\\pict\\pngblip\\picwgoal720\\pichgoal720 ${PNG_HEX}}}{\\nonshppict{\\pict\\pngblip\\picwgoal720\\pichgoal720 ${PNG_HEX}}}\\par}`,
    ).filter((block) => block.kind === "image");
    expect(images).toHaveLength(1);
  });

  // `picture` is carried forward by reference across every descendant group inside {\pict ...} (a stray hex byte in a nested group must still reach the same PictureState the real \pict destination started), which means a plain nested group with no destination of its own -- a malformed producer's stray "{}", not RTF's own <pict> grammar, which has no legitimate use for one -- inherits destination "picture" too. Without an ownership marker analogous to objectDataOwner/objectOwner, that nested group's own closing brace re-fires buildPicture on the identical PictureState the outer \pict group will fire on again when IT closes, doubling the image.
  it("builds one image, not two, when a plain nested group closes inside \\pict after the payload", () => {
    const images = blocksOf(
      `${HEADER}\\pard{\\pict\\pngblip\\picwgoal720\\pichgoal720 ${PNG_HEX}{}}\\par}`,
    ).filter((block) => block.kind === "image");
    expect(images).toHaveLength(1);
  });
});

describe("embedded objects", () => {
  // A genuine [MS-CFB] compound file wrapping this package's own JSON envelope -- built with the same writeEmbeddedObjectData the writer uses, so this describes the read state machine's own group/destination handling (\object -> {\*\objdata ...} -> hex -> compound file -> decode) independently of write.ts's own RTF emission around it.
  const embedded = {
    kind: "spreadsheet" as const,
    metadata: { title: "Embedded sheet" },
    sheets: [],
  };
  const OBJDATA_HEX = bytesToHex(
    writeEmbeddedObjectData({
      objectKind: "spreadsheet",
      document: embedded,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
    }),
  );

  it("reads a real \\object's \\objdata into a ContentEmbeddedObjectBlock", () => {
    const object = blocksOf(
      `${HEADER}\\pard{\\object\\objemb\\objw2000\\objh1000{\\*\\objclass spreadsheet}{\\*\\objdata ${OBJDATA_HEX}}{\\result{\\pard\\plain placeholder\\par}}}\\par}`,
    ).find(
      (block): block is ContentEmbeddedObjectBlock =>
        block.kind === "embeddedObject",
    );
    expect(object?.objectKind).toBe("spreadsheet");
    expect(object?.frame).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 100,
      heightPt: 50,
    });
    expect(object?.document).toEqual(embedded);
  });

  it("skips a non-hex, non-whitespace byte inside \\objdata's own #SDATA text rather than folding it into the nibble pairing", () => {
    // Inserted at an even offset -- a real byte boundary -- so a reader that correctly discards the stray "g" decodes identically to the unmodified hex; a reader that instead treats it as a pairable nibble value corrupts every byte from this point on.
    const poisoned = `${OBJDATA_HEX.slice(0, 10)}g${OBJDATA_HEX.slice(10)}`;
    const object = blocksOf(
      `${HEADER}\\pard{\\object\\objemb{\\*\\objdata ${poisoned}}}\\par}`,
    ).find(
      (block): block is ContentEmbeddedObjectBlock =>
        block.kind === "embeddedObject",
    );
    expect(object?.objectKind).toBe("spreadsheet");
    expect(object?.document).toEqual(embedded);
  });

  it("discards \\result's own fallback content when \\objdata already decoded, rather than folding it into the surrounding paragraph", () => {
    const paragraphs = paragraphsOf(
      `${HEADER}\\pard before {\\object\\objemb{\\*\\objdata ${OBJDATA_HEX}}{\\result{\\pard\\plain fallback text\\par}}} after\\par}`,
    );
    const text = paragraphs
      .map((p) => p.runs.map((r) => r.text).join(""))
      .join("");
    expect(text).not.toContain("fallback text");
    // \result's own scratch rendering must not touch the paragraph "before " was already accumulating in when \object opened, nor the text "after" that continues once \object closes -- both sit in the SAME paragraph as \object itself, with no \par between them, so a fix that only stops the fallback text from appearing (without checking these) would pass even if it deleted the paragraph's real content along with it.
    expect(text).toContain("before");
    expect(text).toContain("after");
  });

  // The three sibling repros below all share one root cause: \result's own retraction/placement used to operate on already-closed block INDICES within whatever list state.para.inTable pointed at, which do not correspond to what \result actually contributed once its content shares a paragraph or list with text that was never its own.
  it("preserves text accumulating in the surrounding paragraph before \\object even opened, when \\objdata decodes successfully", () => {
    const paragraphs = paragraphsOf(
      `${HEADER}\\pard before {\\object\\objemb{\\*\\objdata ${OBJDATA_HEX}}{\\result{\\pard\\plain fallback\\par}}} after\\par}`,
    );
    const text = paragraphs
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
      .join("|");
    expect(text).toContain("before");
    expect(text).toContain("after");
    expect(text).not.toContain("fallback");
  });

  // RTF 1.9.1's own <result> = '{' \result <para>+ '}' lets the group's own closing brace stand in for the final paragraph's \par -- a producer routinely omits it, exactly as a table cell's own \cell already stands in for one. A \result whose content never closes a block of its own (no \par anywhere inside it) must not be silently kept back once \objdata decodes: block-index retraction sees an empty range here and leaves the fallback text sitting in the shared run buffer, where it bleeds into whatever paragraph closes next.
  it("does not leak a bare-inline \\result (no trailing \\par) into the document when \\objdata decodes successfully", () => {
    const { document } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb{\\*\\objdata ${OBJDATA_HEX}}{\\result inline fallback}}\\par}`,
      ),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing document, got ${document.kind}`,
      );
    }
    const blocks = document.sections[0]?.blocks ?? [];
    expect(
      blocks.filter((block) => block.kind === "embeddedObject"),
    ).toHaveLength(1);
    const paragraphText = blocks
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
      .join("");
    expect(paragraphText).not.toContain("inline fallback");
  });

  // The identical scenario as the "before"/"after" preservation test above, one list deeper: \result sitting inside a table cell's own paragraph flow must not destroy the cell's own pre-existing text either. Table cells keep a separate block list (cellBlocks) from the section's own (blocks), so this exercises the same fix on the other of the two lists a \result can land in.
  it("preserves a table cell's own pre-existing text around a successfully decoded \\object", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx4320\\pard\\intbl before {\\object\\objemb{\\*\\objdata ${OBJDATA_HEX}}{\\result{\\pard\\plain fallback\\par}}} after\\cell\\row\\pard x\\par}`,
    );
    const cellBlocks = table.rows[0]?.cells[0]?.blocks ?? [];
    expect(
      cellBlocks.filter((block) => block.kind === "embeddedObject"),
    ).toHaveLength(1);
    const cellText = cellBlocks
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
      .join("|");
    expect(cellText).toContain("before");
    expect(cellText).toContain("after");
    expect(cellText).not.toContain("fallback");
  });

  // \result's own destination group inherits inTable=true by cloning \object's own para when \object sits in a table cell, but a \pard inside \result's own content (RTF 1.9.1's own \pard resets every paragraph property, \intbl included) resets a DESCENDANT group's copy of that same field to false -- and the paragraph it closes is filed under whichever of blocks/cellBlocks that descendant's own inTable says, not whatever \result's own outer group still (staled) says. Without \result's own scratch starting inTable at false regardless of \object's real placement, the write lands in `blocks` while endResultScratch reads back from `cellBlocks` (or vice versa), and the whole fallback is silently lost -- this combination (\objdata failing to decode, inside a table cell, \result opening with its own \pard) was untested before this fix.
  it("recovers \\result's own fallback content when \\objdata fails to decode inside a table cell", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx4320\\pard\\intbl before {\\object\\objemb{\\*\\objdata 68656c6c6f}{\\result{\\pard\\plain FALLBACK\\par}}} after\\cell\\row\\pard x\\par}`,
    );
    const cellBlocks = table.rows[0]?.cells[0]?.blocks ?? [];
    const cellText = cellBlocks
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
      .join("|");
    expect(cellText).toContain("FALLBACK");
    expect(cellText).toContain("before");
    expect(cellText).toContain("after");
  });

  // The mirror-image direction of the fix above: there, \result inherited inTable=true by cloning \object's own para and a descendant \pard reset its own copy back to false. Here \result's own group starts at inTable=false (that inherited case is already closed), but \result's own body restates \intbl directly on that SAME group's para before any nested group opens -- RTF 1.9.1's own <result> grammar admits \intbl among <parfmt>* on \result's own para, so this is spec-legal input, not malformed. A nested {\pard\plain ...} child still clones that now-true value and still resets its OWN copy to false via \pard, so the finished paragraph is filed into `blocks` while \result's own group-end reads back a para whose inTable is still true -- the opposite list from where content actually landed, silently losing it, and it is the divergence itself (not which side ends up true or false) that endResultScratch's own read must not depend on.
  it("recovers \\result's own fallback content when \\intbl is restated directly on \\result's own group, not inherited from \\object", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx4320\\pard\\intbl before {\\object\\objemb{\\*\\objdata 68656c6c6f}{\\result\\intbl{\\pard\\plain FALLBACK\\par}}} after\\cell\\row\\pard x\\par}`,
    );
    const cellBlocks = table.rows[0]?.cells[0]?.blocks ?? [];
    const cellText = cellBlocks
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
      .join("|");
    expect(cellText).toContain("FALLBACK");
    expect(cellText).toContain("before");
    expect(cellText).toContain("after");
    const unreadable = readRtfContent(
      bytes(
        `${HEADER}\\trowd\\trleft0\\cellx4320\\pard\\intbl before {\\object\\objemb{\\*\\objdata 68656c6c6f}{\\result\\intbl{\\pard\\plain FALLBACK\\par}}} after\\cell\\row\\pard x\\par}`,
      ),
    ).diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
    );
    expect(unreadable[0]?.message).toContain(
      "its \\result fallback content, if any, is read in its place",
    );
  });

  // The identical \intbl-restated-directly-on-\result divergence, on the OTHER of the two EMBEDDED_OBJECT_UNREADABLE messages: an \object with no \objdata destination at all states its own diagnostic unconditionally ("its \result fallback content is used in its place", no hedge), unlike buildEmbeddedObject's own decode-failure message above. Before the fix, that unconditional wording was flatly false whenever this divergence lost the fallback silently -- it is only accurate once the content is actually recovered.
  it("recovers \\result's own fallback content, with an accurate diagnostic, when an \\object has no \\objdata at all and \\intbl is restated directly on \\result's own group", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx4320\\pard\\intbl before {\\object\\objemb{\\result\\intbl{\\pard\\plain FALLBACK\\par}}} after\\cell\\row\\pard x\\par}`,
    );
    const cellBlocks = table.rows[0]?.cells[0]?.blocks ?? [];
    const cellText = cellBlocks
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
      .join("|");
    expect(cellText).toContain("FALLBACK");
    expect(cellText).toContain("before");
    expect(cellText).toContain("after");
    const unreadable = readRtfContent(
      bytes(
        `${HEADER}\\trowd\\trleft0\\cellx4320\\pard\\intbl before {\\object\\objemb{\\result\\intbl{\\pard\\plain FALLBACK\\par}}} after\\cell\\row\\pard x\\par}`,
      ),
    ).diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
    );
    expect(unreadable[0]?.message).toContain(
      "its \\result fallback content is used in its place",
    );
  });

  // isContentEmbeddedObject (the guard behind ContentEmbeddedObjectSchema) is a predicate, not a reconstructive parse: it confirms the fields ContentEmbeddedObject needs are present and well-shaped, but does not strip any OTHER key the same parsed JSON object happens to carry. \objdata comes from an arbitrary, potentially hostile input file, so a doctored payload that is otherwise a valid ContentEmbeddedObject but also carries its own "kind" (plus arbitrary extra fields) must never let that "kind" override the real "embeddedObject" discriminant once buildEmbeddedObject adds it, and must never let the extra fields ride along into the returned block either.
  it("never lets a doctored \\objdata payload's own \"kind\" field override the embeddedObject block's real discriminant", () => {
    const forged = forgeEmbeddedObjectData({
      objectKind: "spreadsheet",
      document: { kind: "spreadsheet", metadata: {}, sheets: [] },
      frame: { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
      kind: "paragraph",
      runs: [{ text: "SMUGGLED" }],
      extra: 1,
    });
    const object = blocksOf(
      `${HEADER}\\pard{\\object\\objemb{\\*\\objdata ${bytesToHex(forged)}}}\\par}`,
    ).find(
      (block): block is ContentEmbeddedObjectBlock =>
        "objectKind" in block && block.objectKind === "spreadsheet",
    );
    expect(object?.kind).toBe("embeddedObject");
    expect(object).not.toHaveProperty("runs");
    expect(object).not.toHaveProperty("extra");
  });

  // RTF's own <obj> grammar allows only one \result child, but a malformed producer can still write two -- the second sibling must not silently overwrite the first's own recovered content with no diagnostic, mirroring how a second \objdata sibling is already handled just below.
  it("keeps only the first of two \\result siblings, with a diagnostic noting the duplicate, when \\objdata cannot decode", () => {
    const { document, diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb{\\*\\objdata 68656c6c6f}{\\result{\\pard\\plain first fallback\\par}}{\\result{\\pard\\plain second fallback\\par}}}\\par}`,
      ),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing document, got ${document.kind}`,
      );
    }
    const paragraphText = document.sections[0]?.blocks
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
      .join("|");
    expect(paragraphText).toContain("first fallback");
    expect(paragraphText).not.toContain("second fallback");
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE &&
          diagnostic.message.includes("more than one \\result"),
      ),
    ).toBe(true);
  });

  it("degrades an \\object whose \\objdata is not this package's own payload, with a diagnostic", () => {
    const { document, diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb{\\*\\objdata 68656c6c6f}{\\result}}\\par}`,
      ),
    );
    const blocks =
      document.kind === "wordprocessing"
        ? (document.sections[0]?.blocks ?? [])
        : [];
    expect(blocks.some((block) => block.kind === "embeddedObject")).toBe(false);
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
      ),
    ).toBe(true);
  });

  // A real Word-authored \object's OLESaveToStream data (a genuine embedded .xls range, an Equation Editor formula, ...) has no JSON envelope inside its NativeData and so never decodes here -- "hello" stands in for that: real bytes, wrong shape. This is exactly the case RTF 1.9.1's own advice for \result exists for -- "This allows RTF readers that do not understand objects ... to use the current result, in place of the object, to maintain appearance" -- so the fallback preview paragraph is what a real Word-shaped, undecodable \object should recover as, appended to the surrounding section rather than dropped.
  it("recovers \\result's own fallback paragraphs when \\objdata cannot be decoded", () => {
    const { document, diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard before {\\object\\objemb\\objw2000\\objh1000{\\*\\objclass Excel.Sheet.8}{\\*\\objdata 68656c6c6f}{\\result{\\pard\\plain [Embedded worksheet]\\par}}} after\\par}`,
      ),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing document, got ${document.kind}`,
      );
    }
    const blocks = document.sections[0]?.blocks ?? [];
    // No embeddedObject block -- the real object never decoded -- and \result's own recovered content survives as an ordinary paragraph, but not truly spliced into \object's own former position: addBlocks appends the fallback to the section's own block list without ending the paragraph still accumulating "before "/" after" around \object (no \pard/\par appears between them), so the fallback paragraph lands as its own block BEFORE that paragraph closes, and "before "/" after" end up as two runs of that one surrounding paragraph rather than split into separate blocks around the fallback -- asserted here by exact block order/content, not merely by substring presence, since a substring check alone cannot tell "spliced in place" from "appended first".
    expect(blocks.some((block) => block.kind === "embeddedObject")).toBe(false);
    const paragraphs = blocks.filter(
      (block): block is ContentParagraph => block.kind === "paragraph",
    );
    expect(
      paragraphs.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join(""),
      ),
    ).toEqual(["[Embedded worksheet]", "before  after"]);
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
      ),
    ).toBe(true);
    // The recovery must not leave the group stack unbalanced -- reading \result as body content mid-object is a change to how deeply nested groups are interpreted, not to brace matching itself, so the reader must never report a brace fault for input that has none.
    expect(
      diagnostics.some(
        (diagnostic) => diagnostic.code === RtfDiagnosticCodes.UNBALANCED_GROUP,
      ),
    ).toBe(false);
  });

  // \result's own content builds into a totally isolated scratch accumulator that beginResultScratch swaps in place of the real one, restored only when \result's own group closes (endResultScratch). A truncated file can leave \result's group -- and therefore every group around it -- open at end of input with no closing brace at all, so endResultScratch never runs and the swap is never undone: finish() must not build the final document from that abandoned scratch state, or the real body accumulated before \object ever opened is silently replaced by whatever \result's own truncated content happened to hold, exactly backwards from \object's own real-content-over-fallback preference.
  it("keeps the real document body, not \\result's own scratch content, when \\result's group never closes", () => {
    const { document, diagnostics } = readRtfContent(
      bytes(
        "{\\rtf1\\ansi before{\\object\\objemb{\\result\\pard\\plain scratch",
      ),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing document, got ${document.kind}`,
      );
    }
    const text = document.sections[0]?.blocks
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
      .join("|");
    expect(text).toContain("before");
    expect(text).not.toContain("scratch");
    expect(
      diagnostics.some(
        (diagnostic) => diagnostic.code === RtfDiagnosticCodes.UNBALANCED_GROUP,
      ),
    ).toBe(true);
  });

  it("folds the object's own \\objw/\\objh size hint into the degrade diagnostic instead of discarding it", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb\\objw2000\\objh1000{\\*\\objdata 68656c6c6f}{\\result}}\\par}`,
      ),
    );
    const message = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
    )?.message;
    // 2000/1000 twips is 100pt x 50pt (20 twips per point).
    expect(message).toContain("100.00pt");
    expect(message).toContain("50.00pt");
  });

  it("still reports a \\objw-only size hint, rather than discarding it for the want of a matching \\objh", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb\\objw2000{\\*\\objdata 68656c6c6f}{\\result}}\\par}`,
      ),
    );
    const message = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
    )?.message;
    expect(message).toContain("100.00pt");
    expect(message).toContain("\\objw");
    expect(message).not.toContain("\\objw/\\objh");
  });

  it("still reports a \\objh-only size hint, rather than discarding it for the want of a matching \\objw", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb\\objh1000{\\*\\objdata 68656c6c6f}{\\result}}\\par}`,
      ),
    );
    const message = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
    )?.message;
    expect(message).toContain("50.00pt");
    expect(message).toContain("\\objh");
    expect(message).not.toContain("\\objw/\\objh");
  });

  it("still prefers the real decoded object over \\result when both are present, leaving no group unbalanced", () => {
    const { document, diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb{\\*\\objdata ${OBJDATA_HEX}}{\\result{\\pard\\plain should not appear\\par}}}\\par}`,
      ),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing document, got ${document.kind}`,
      );
    }
    const blocks = document.sections[0]?.blocks ?? [];
    expect(
      blocks.filter((block) => block.kind === "embeddedObject"),
    ).toHaveLength(1);
    const text = blocks
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
      .join("");
    expect(text).not.toContain("should not appear");
    expect(
      diagnostics.some(
        (diagnostic) => diagnostic.code === RtfDiagnosticCodes.UNBALANCED_GROUP,
      ),
    ).toBe(false);
  });

  // RTF 1.9.1's own <obj> grammar juxtaposes <objdata> and <result> with no '&' between them, so its own Formal Syntax legend ("AB" = "Item A followed by item B") states \objdata before \result as the required order -- but the spec's own robustness clause ("RTF readers should be robust enough to handle some minor variations") means a real producer's <result>-before-\objdata ordering must still be tolerated, not rejected as malformed. A reader that decides \result's fate from whichever sibling it happens to read first would double-render (or silently drop) content depending on order alone.
  it("renders the decoded object exactly once when \\result appears before \\objdata in the source", () => {
    const { document, diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb{\\result{\\pard\\plain should not appear\\par}}{\\*\\objdata ${OBJDATA_HEX}}}\\par}`,
      ),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing document, got ${document.kind}`,
      );
    }
    const blocks = document.sections[0]?.blocks ?? [];
    expect(
      blocks.filter((block) => block.kind === "embeddedObject"),
    ).toHaveLength(1);
    const paragraphText = blocks
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
      .join("");
    expect(paragraphText).not.toContain("should not appear");
    expect(
      diagnostics.some(
        (diagnostic) => diagnostic.code === RtfDiagnosticCodes.UNBALANCED_GROUP,
      ),
    ).toBe(false);
  });

  it("still recovers \\result's own fallback content, exactly once, when it appears before an \\objdata that fails to decode", () => {
    const { document, diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard before {\\object\\objemb{\\result{\\pard\\plain [Embedded worksheet]\\par}}{\\*\\objdata 68656c6c6f}} after\\par}`,
      ),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing document, got ${document.kind}`,
      );
    }
    const blocks = document.sections[0]?.blocks ?? [];
    expect(blocks.some((block) => block.kind === "embeddedObject")).toBe(false);
    const paragraphText = blocks
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
      .join("|");
    expect(paragraphText).toContain("before");
    expect(paragraphText).toContain("[Embedded worksheet]");
    expect(paragraphText).toContain("after");
    // Exactly one fallback rendering, not one per occurrence -- \result was read (and, before this fix, would already have been committed) before \objdata's own failure was even known.
    expect(paragraphText.split("[Embedded worksheet]")).toHaveLength(2);
    expect(
      diagnostics.some(
        (diagnostic) => diagnostic.code === RtfDiagnosticCodes.UNBALANCED_GROUP,
      ),
    ).toBe(false);
  });

  it("recovers \\result's own fallback content, with a diagnostic, when an \\object has no \\objdata destination at all", () => {
    const { document, diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard before {\\object\\objemb\\objw2000\\objh1000{\\result{\\pard\\plain [no objdata]\\par}}} after\\par}`,
      ),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing document, got ${document.kind}`,
      );
    }
    const blocks = document.sections[0]?.blocks ?? [];
    expect(blocks.some((block) => block.kind === "embeddedObject")).toBe(false);
    const paragraphText = blocks
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
      .join("|");
    expect(paragraphText).toContain("before");
    expect(paragraphText).toContain("[no objdata]");
    expect(paragraphText).toContain("after");
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE &&
          diagnostic.message.includes("no \\objdata payload at all"),
      ),
    ).toBe(true);
  });

  it("does not also report the no-\\objdata-at-all diagnostic when \\objdata genuinely exists but fails to decode instead", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb{\\*\\objdata 68656c6c6f}{\\result{\\pard\\plain fallback\\par}}}\\par}`,
      ),
    );
    const unreadable = diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
    );
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0]?.message).not.toContain("no \\objdata payload at all");
  });

  // \objdata's own grammar is (\binN #BDATA) | #SDATA: every test above delivers #SDATA (plain hex-digit text), which is only one of the two legal wire forms. \binN's raw-byte-run form, and repeated \'hh escapes inside the destination (an alternative RTF affords anywhere, not only in #SDATA-shaped destinations), are the other two shapes buildEmbeddedObject's own byte extraction has to handle identically -- covered here directly rather than only through hex text.
  it("reads \\objdata delivered as a \\binN raw-byte run rather than #SDATA hex text", () => {
    const raw = writeEmbeddedObjectData({
      objectKind: "spreadsheet",
      document: embedded,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
    });
    const object = blocksOf(
      `${HEADER}\\pard{\\object\\objemb{\\*\\objdata\\bin${String(raw.length)} ${text(raw)}}}\\par}`,
    ).find(
      (block): block is ContentEmbeddedObjectBlock =>
        block.kind === "embeddedObject",
    );
    expect(object?.document).toEqual(embedded);
  });

  it("reads \\objdata delivered as repeated \\'hh escapes inside the destination rather than #SDATA hex text", () => {
    const raw = writeEmbeddedObjectData({
      objectKind: "spreadsheet",
      document: embedded,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
    });
    const apostropheEscaped = Array.from(raw)
      .map((byte) => `\\'${byte.toString(16).padStart(2, "0")}`)
      .join("");
    const object = blocksOf(
      `${HEADER}\\pard{\\object\\objemb{\\*\\objdata${apostropheEscaped}}}\\par}`,
    ).find(
      (block): block is ContentEmbeddedObjectBlock =>
        block.kind === "embeddedObject",
    );
    expect(object?.document).toEqual(embedded);
  });

  // \'hh is a generic RTF character escape valid anywhere in a destination's text, not only inside a destination shaped for it -- so a single \objdata payload can legitimately deliver part of its data as plain #SDATA hex-digit text and the rest as scattered \'hh escapes. Collecting the two into separate buffers and keeping only whichever one turned out non-empty would silently discard whichever source came second; this proves both survive, in order.
  it("reads \\objdata whose payload is split between #SDATA hex text and \\'hh escapes, rather than dropping whichever came second", () => {
    const raw = writeEmbeddedObjectData({
      objectKind: "spreadsheet",
      document: embedded,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
    });
    const splitAt = Math.floor(raw.length / 2);
    const hexHalf = bytesToHex(raw.subarray(0, splitAt));
    const escapedHalf = Array.from(raw.subarray(splitAt))
      .map((byte) => `\\'${byte.toString(16).padStart(2, "0")}`)
      .join("");
    const object = blocksOf(
      `${HEADER}\\pard{\\object\\objemb{\\*\\objdata ${hexHalf}${escapedHalf}}}\\par}`,
    ).find(
      (block): block is ContentEmbeddedObjectBlock =>
        block.kind === "embeddedObject",
    );
    expect(object?.document).toEqual(embedded);
  });

  // RTF 1.9.1's own <objdata> production is '{\*' \objdata (<objalias>? & <objsect>?) <data> '}' -- \objalias and \objsect are legal sub-groups nested directly inside \objdata's own braces, before its real payload. A reader that predicts \objdata's decode via a flat token scan (rather than the same group-aware walk the live read uses) folds those sub-groups' own bytes into the payload it scans, disagreeing with the live read about whether \objdata will decode at all -- exactly the double-render bug this test guards against.
  it("decodes \\objdata unaffected by legal nested {\\*\\objalias ...}/{\\*\\objsect ...} sub-groups, without double-rendering \\result's own fallback content", () => {
    const { document, diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb{\\*\\objdata{\\*\\objalias Sheet1}{\\*\\objsect 1}${OBJDATA_HEX}}{\\result{\\pard\\plain should not appear\\par}}}\\par}`,
      ),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing document, got ${document.kind}`,
      );
    }
    const blocks = document.sections[0]?.blocks ?? [];
    const object = blocks.find(
      (block): block is ContentEmbeddedObjectBlock =>
        block.kind === "embeddedObject",
    );
    expect(object?.document).toEqual(embedded);
    expect(
      blocks.filter((block) => block.kind === "embeddedObject"),
    ).toHaveLength(1);
    const paragraphText = blocks
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
      .join("");
    expect(paragraphText).not.toContain("should not appear");
    // \objalias and \objsect are ordinary, spec-legal sub-productions of \objdata -- recognised destinations, not unrecognised ones this reader happens to tolerate.
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.UNKNOWN_DESTINATION_SKIPPED,
      ),
    ).toBe(false);
    expect(
      diagnostics.some(
        (diagnostic) => diagnostic.code === RtfDiagnosticCodes.UNBALANCED_GROUP,
      ),
    ).toBe(false);
  });

  // RTF 1.9.1's own <obj> production lists <objclsid> ('{\*' \oleclsid #PCDATA '}') as a direct, optional child of \object, right alongside <objalias>/<objsect>/<objtime> -- ordinary, spec-legal \object content, not an unrecognised destination this reader happens to tolerate.
  it("does not report UNKNOWN_DESTINATION_SKIPPED for a spec-legal {\\*\\oleclsid ...} sub-group", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb{\\*\\oleclsid {00020810-0000-0000-C000-000000000046}}{\\*\\objdata ${OBJDATA_HEX}}}\\par}`,
      ),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.UNKNOWN_DESTINATION_SKIPPED,
      ),
    ).toBe(false);
  });

  // \object's own group can legally close having found neither an \objdata nor a \result child at all (a producer that wrote only the informational \objw/\objh size hint and nothing else) -- a distinct, otherwise-silent construct substitution from either "objdata exists but fails to decode" (buildEmbeddedObject's own diagnostic) or "no objdata, but result recovers instead" (the sibling test above), and previously the only one of the three that produced no diagnostic at all.
  it("reports a diagnostic when an \\object has neither \\objdata nor \\result content at all", () => {
    const { document, diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard before {\\object\\objemb\\objw2000\\objh1000} after\\par}`,
      ),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing document, got ${document.kind}`,
      );
    }
    const blocks = document.sections[0]?.blocks ?? [];
    expect(blocks.some((block) => block.kind === "embeddedObject")).toBe(false);
    const paragraphText = blocks
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
      .join("|");
    expect(paragraphText).toContain("before");
    expect(paragraphText).toContain("after");
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE &&
          diagnostic.message.includes("neither \\objdata nor \\result"),
      ),
    ).toBe(true);
  });

  // RTF's own <obj> grammar allows only one \objdata child; a malformed producer writing two must not decode both into two identical blocks.
  it("recovers only one embeddedObject block from two \\objdata siblings, with a diagnostic noting the duplicate", () => {
    const { document, diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb{\\*\\objdata ${OBJDATA_HEX}}{\\*\\objdata ${OBJDATA_HEX}}}\\par}`,
      ),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing document, got ${document.kind}`,
      );
    }
    const blocks = document.sections[0]?.blocks ?? [];
    expect(
      blocks.filter((block) => block.kind === "embeddedObject"),
    ).toHaveLength(1);
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE &&
          diagnostic.message.includes("more than one \\objdata"),
      ),
    ).toBe(true);
  });

  // cloneGroupState carries `destination`/`objectData`/`object` forward BY REFERENCE to every descendant group, including a plain, unrecognised nested group RTF's own <obj>/<objdata> grammar does not allow but a malformed producer can still write. Without an ownership marker distinguishing the group that actually opened a destination from a descendant that merely inherited it, the group-end handlers below would fire once per descendant that happens to close underneath a shared \objdata/\object, not once per construct.
  describe("a stray nested group inside \\objdata or \\object", () => {
    it("does not duplicate the decoded embeddedObject block", () => {
      const object = blocksOf(
        `${HEADER}\\pard{\\object\\objemb{\\*\\objdata ${OBJDATA_HEX}{\\b x}}}\\par}`,
      ).filter((block) => block.kind === "embeddedObject");
      expect(object).toHaveLength(1);
    });

    it("does not duplicate the EMBEDDED_OBJECT_UNREADABLE warning for an undecodable payload", () => {
      const { diagnostics } = readRtfContent(
        bytes(
          `${HEADER}\\pard{\\object\\objemb{\\*\\objdata 68656c6c6f{\\b x}}}\\par}`,
        ),
      );
      expect(
        diagnostics.filter(
          (diagnostic) =>
            diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
        ),
      ).toHaveLength(1);
    });

    it("reports the exact duplicate-\\result diagnostic and keeps only the first one's own content, when a malformed \\object has two", () => {
      const { document, diagnostics } = readRtfContent(
        bytes(
          `${HEADER}\\pard{\\object\\objemb{\\result{\\pard\\plain FIRST\\par}}{\\result{\\pard\\plain SECOND\\par}}}\\par}`,
        ),
      );
      if (document.kind !== "wordprocessing") {
        throw new Error(
          `expected a wordprocessing document, got ${document.kind}`,
        );
      }
      const found = diagnostics.find(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE &&
          diagnostic.message.includes("more than one \\result"),
      );
      expect(found?.message).toBe(
        "an \\object destination has more than one \\result child, which RTF's own grammar does not allow; only the first is kept and this one is discarded",
      );
      const text = document.sections[0]?.blocks
        .filter(
          (block): block is ContentParagraph => block.kind === "paragraph",
        )
        .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
        .join("|");
      expect(text).toContain("FIRST");
      expect(text).not.toContain("SECOND");
    });

    it("reports the exact duplicate-\\objdata diagnostic and decodes only the first one, when a malformed \\object has two", () => {
      const { diagnostics } = readRtfContent(
        bytes(
          `${HEADER}\\pard{\\object\\objemb{\\*\\objdata ${OBJDATA_HEX}}{\\*\\objdata ${OBJDATA_HEX}}}\\par}`,
        ),
      );
      const found = diagnostics.find(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE &&
          diagnostic.message.includes("more than one \\objdata"),
      );
      expect(found?.message).toBe(
        "an \\object destination has more than one \\objdata child, which RTF's own grammar does not allow; only the first is decoded and this one is discarded",
      );
    });

    it("does not splice \\result's fallback content in twice", () => {
      const { document } = readRtfContent(
        bytes(
          `${HEADER}\\pard{\\object\\objemb{\\*\\objdata 0102030405}{\\result{\\pard\\plain FALLBACK\\par}}{\\b y}}\\par}`,
        ),
      );
      if (document.kind !== "wordprocessing") {
        throw new Error(
          `expected a wordprocessing document, got ${document.kind}`,
        );
      }
      const fallbackParagraphs = document.sections[0]?.blocks.filter(
        (block) =>
          block.kind === "paragraph" &&
          block.runs.some((run) => run.text.includes("FALLBACK")),
      );
      expect(fallbackParagraphs).toHaveLength(1);
    });

    it("does not report a false 'no \\objdata and no \\result' diagnostic when \\result exists later in the source", () => {
      const { diagnostics } = readRtfContent(
        bytes(
          `${HEADER}\\pard{\\object\\objemb{\\b y}{\\result{\\pard\\plain FALLBACK\\par}}}\\par}`,
        ),
      );
      const embeddedObjectDiagnostics = diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
      );
      expect(embeddedObjectDiagnostics).toHaveLength(1);
      expect(embeddedObjectDiagnostics[0]?.message).toContain(
        "its \\result fallback content is used in its place",
      );
    });
  });
});

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

  // Regression guard: formFieldControlType (constructs.ts) must anchor on the instruction's own leading token, not merely find FORMTEXT/FORMCHECKBOX/FORMDROPDOWN anywhere in the string -- an unanchored match would fire on the identical word sitting inside an unrelated field's own switch argument, here a HYPERLINK target that happens to end in "FORMTEXT".
  it("does not mistake a HYPERLINK target containing the word FORMTEXT for a form field", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst{HYPERLINK "http://example.com/FORMTEXT"}}{\\fldrslt here}}\\par}`,
    )[0];
    expect(paragraph?.constructs ?? []).toEqual([]);
    const linked = paragraph?.runs.find((run) => run.hyperlink !== undefined);
    expect(linked?.hyperlink).toBe("http://example.com/FORMTEXT");
  });

  // Regression guard: an ordinary field (no FORMTEXT/FORMCHECKBOX/FORMDROPDOWN instruction) must not fragment the runs around it. Every run of text here -- before the field, its own \fldrslt, and after it -- carries identical (default) formatting, so a reader that coalesces same-key text into one run produces exactly one run; one that force-flushes at every \field boundary regardless of whether it is a genuine form field produces three.
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
    // {\*\pn ...} is Word 6/95 paragraph numbering, superseded by the \lsN/\ilvlN this reader takes, and a real Word document carries one per numbered paragraph -- reporting it would bury the drops that matter.
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

// RTF 1.9.1, "Form Fields": a form field is an ordinary \field whose \*\fldinst names FORMTEXT/FORMCHECKBOX/FORMDROPDOWN, with a sibling \*\formfield destination carrying the control's own data (\fftypeN, \ffname, \ffres/\ffdefres, and a dropdown's \*\ffl entries). The fixtures below are trimmed from a real producer's own output (PHPRtfLite), braces and all, including the anonymous scoping group \*\formfield wraps its own control words in -- this reader never needs to know that group is there, because an unrecognised first control word simply inherits the enclosing destination, the same mechanism an ordinary {\b bold} run-formatting group already relies on.
describe("form fields", () => {
  it("reads a FORMCHECKBOX field as a checkbox contentControl point extent between the surrounding runs", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard before {\\field{\\*\\fldinst FORMCHECKBOX  {\\*\\formfield{\\fftype1\\ffres25\\ffhps20\\ffdefres1}}}{\\fldrslt }} after\\par}`,
    )[0];
    const extent = paragraph?.constructs?.[0];
    expect(extent?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "checkbox",
      checked: true,
    });
    expect(extent?.startRun).toBe(extent?.endRun);
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe(
      "before  after",
    );
  });

  // Pins the unchecked half of the pair the "reads a FORMCHECKBOX field..." test above already covers checked for, both against the identical PHPRtfLite \ffres25 fixture. \ffres25 is [MS-DOC] 2.9.79 FFDataBits's own reserved "undefined" sentinel for a checkbox's iRes, not a PHPRtfLite-specific constant -- it falls through to \ffdefres (the field's reset default) exactly as the spec's "Undefined checkboxes are treated as unchecked" describes when the default itself says 0.
  it("falls through \\ffres's own undefined sentinel (25) to \\ffdefres for a checkbox's checked state", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMCHECKBOX {\\*\\formfield{\\fftype1\\ffres25\\ffhps20\\ffdefres0}}}{\\fldrslt }}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      checked: false,
    });
  });

  it("falls through \\ffres25 all the way to unchecked when no \\ffdefres is present at all, matching a plain Word producer that never set an explicit default", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMCHECKBOX {\\*\\formfield{\\fftype1\\ffres25}}}{\\fldrslt }}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      checked: false,
    });
  });

  it("uses \\ffres for a checkbox's checked state when no \\ffdefres is present at all, since \\ffres itself already names a real (non-sentinel) state", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMCHECKBOX {\\*\\formfield{\\fftype1\\ffres1}}}{\\fldrslt }}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      checked: true,
    });
  });

  // Real Word's own FFDataBits encoding, not PHPRtfLite's: a meaningful (non-sentinel) \ffres and a \ffdefres that genuinely differ from each other. \ffres is the field's own current state and must win over \ffdefres's reset default in both directions -- these two fixtures pin that priority each way, since a precedence bug that merely swapped which control word wins (rather than handling the sentinel) would get one of the two backwards.
  it("prioritises a meaningful \\ffres over a differing \\ffdefres when the box is checked despite a false default", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMCHECKBOX {\\*\\formfield{\\fftype1\\ffres1\\ffdefres0}}}{\\fldrslt }}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      checked: true,
    });
  });

  it("prioritises a meaningful \\ffres over a differing \\ffdefres when the box is unchecked despite a true default", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMCHECKBOX {\\*\\formfield{\\fftype1\\ffres0\\ffdefres1}}}{\\fldrslt }}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      checked: false,
    });
  });

  // Regression guard: \ffres/\ffdefres are RTF 1.9.1's own generic "Value" control words (Appendix B), exactly like \ffprot, so a bare occurrence must default to 0 per the spec's own "Change Formatting Property" convention -- not read as `undefined` and fall through to \ffdefres the way FORM_FIELD_RESULT_UNDEFINED's own sentinel handling does for a genuinely absent \ffres. A bare \ffres therefore means \ffres0, taking priority over \ffdefres1 exactly as an explicit \ffres0 already does above.
  it("reads a bare \\ffres (no explicit parameter) as \\ffres0, not as absent", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMCHECKBOX {\\*\\formfield{\\fftype1\\ffres\\ffdefres1}}}{\\fldrslt }}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      checked: false,
    });
  });

  // \ffdefres0 names "Hello" (index 0) as the field's own recorded default selection -- the sentinel \ffres25 (see FORM_FIELD_RESULT_UNDEFINED in constructs.ts, and its own dropdown-branch comment) falls through to it exactly as a checkbox's sentinel \ffres falls through to \ffdefres, so `value` reads back "Hello" here even though the \fldrslt text shown ("Guten Tag") is a different entry -- \fldrslt is merely the field's last-rendered display text, not authoritative over \ffres/\ffdefres for which entry is "selected" in FFDataBits terms.
  it("reads a FORMDROPDOWN field's \\*\\ffl entries as the contentControl's options, falling through \\ffres25's undefined sentinel to \\ffdefres for the selected value, with its \\fldrslt as the wrapped run", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMDROPDOWN  {\\*\\formfield{\\fftype2\\ffres25\\fftypetxt0\\ffhaslistbox\\ffdefres0{\\*\\ffl Hello}{\\*\\ffl Guten Tag}}}}{\\fldrslt Guten Tag}}\\par}`,
    )[0];
    const extent = paragraph?.constructs?.[0];
    expect(extent?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "dropDown",
      options: ["Hello", "Guten Tag"],
      value: "Hello",
    });
    expect(
      paragraph?.runs
        .slice(extent?.startRun ?? 0, extent?.endRun ?? 0)
        .map((run) => run.text)
        .join(""),
    ).toBe("Guten Tag");
  });

  // The same \ffres field FFDataBits gives a checkbox's own state carries, for iTypeDrop, a zero-based index into the \*\ffl list -- a genuinely real Word fixture rather than PHPRtfLite's own always-25 constant: unlike the "reads a FORMDROPDOWN..." test above, whose \ffres25 sentinel falls through to \ffdefres0 for its "Hello" value, this fixture's own \ffres1 already names a real (non-sentinel) selection directly, with no fallback involved.
  it("reads a FORMDROPDOWN field's \\ffres as a zero-based index selecting one of its own \\*\\ffl entries", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMDROPDOWN  {\\*\\formfield{\\fftype2\\ffres1\\fftypetxt0\\ffhaslistbox\\ffdefres0{\\*\\ffl Hello}{\\*\\ffl Guten Tag}}}}{\\fldrslt Guten Tag}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      controlType: "dropDown",
      options: ["Hello", "Guten Tag"],
      value: "Guten Tag",
    });
  });

  it("falls through a FORMDROPDOWN's \\ffres25 undefined sentinel to a non-zero \\ffdefres, not just index 0", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMDROPDOWN  {\\*\\formfield{\\fftype2\\ffres25\\fftypetxt0\\ffhaslistbox\\ffdefres1{\\*\\ffl Hello}{\\*\\ffl Guten Tag}}}}{\\fldrslt Guten Tag}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      controlType: "dropDown",
      options: ["Hello", "Guten Tag"],
      value: "Guten Tag",
    });
  });

  it("leaves a FORMDROPDOWN's value unset when neither \\ffres nor \\ffdefres is present at all", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMDROPDOWN  {\\*\\formfield{\\fftype2\\fftypetxt0\\ffhaslistbox{\\*\\ffl Hello}{\\*\\ffl Guten Tag}}}}{\\fldrslt Hello}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "dropDown",
      options: ["Hello", "Guten Tag"],
    });
  });

  // Regression guard, dropdown side of the identical bare-Value-word-defaults-to-0 fix as the checkbox's own "reads a bare \ffres..." test above: a bare \ffdefres names index 0 ("Hello"), not "no default recorded" -- distinct from the "leaves...unset" fixture directly above, which has no \ffdefres control word at all rather than a bare one.
  it("reads a bare \\ffdefres (no explicit parameter) as index 0, selecting the first \\*\\ffl entry", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMDROPDOWN  {\\*\\formfield{\\fftype2\\ffdefres\\fftypetxt0\\ffhaslistbox{\\*\\ffl Hello}{\\*\\ffl Guten Tag}}}}{\\fldrslt Hello}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      controlType: "dropDown",
      options: ["Hello", "Guten Tag"],
      value: "Hello",
    });
  });

  it("reads a FORMTEXT field's \\*\\ffname as the contentControl's tag, with its \\fldrslt as the wrapped run", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMTEXT  {\\*\\formfield{\\fftype0\\fftypetxt0{\\*\\ffname Text1}}}}{\\fldrslt Lorem ipsum.}}\\par}`,
    )[0];
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

  // Regression guard: an earlier round of this reader promoted \ffdeftext (FFData.xstzTextDef, the field's DEFAULT/reset text) onto the descriptor's `value`, which document-schema.js's own ContentControlDescriptor defines as the control's CURRENT value -- for a text field, that current value is whatever text is actually wrapped in \fldrslt's own runs ("Lorem ipsum." here), never the default. `value` must stay unset even though a real \ffdeftext group is present, and the genuinely current text must still be readable from the wrapped runs, exactly as it is when no \ffdeftext exists at all (see "reads a FORMTEXT field's \*\ffname..." above).
  it("leaves a FORMTEXT field's value unset when \\*\\ffdeftext is present, reporting its default text nowhere while its \\fldrslt runs still carry the real current text", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMTEXT  {\\*\\formfield{\\fftype0\\fftypetxt0{\\*\\ffdeftext Jane Doe}{\\*\\ffname Text1}}}}{\\fldrslt Lorem ipsum.}}\\par}`,
    )[0];
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

  // The same guard with no wrapped-run content at all: `value` must still stay unset -- \ffdeftext is never promoted to `value` unconditionally, not merely "unless the runs are non-empty".
  it("leaves a FORMTEXT field's value unset when \\*\\ffdeftext is present and \\fldrslt is empty", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMTEXT  {\\*\\formfield{\\fftype0\\fftypetxt0{\\*\\ffdeftext Jane Doe}{\\*\\ffname Text1}}}}{\\fldrslt }}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      tag: "Text1",
    });
  });

  // Regression guard: \*\ffformat/\*\ffstattext/\*\ffentrymcr/\*\ffexitmcr are RTF's own remaining <formstrings> destination strings alongside \*\ffdeftext (RTF 1.5's own Form Fields table), which this reader already recognises and silently skips (SILENT_SKIP_DESTINATIONS in read.ts) for the identical reason -- no ContentControlDescriptor field exists to carry a text field's input-format mask, status-line text, or entry/exit macro name. A fully-populated real-world text field naming all five siblings must produce no UNKNOWN_DESTINATION_SKIPPED diagnostic for any of them.
  it("stays silent about \\*\\ffformat/\\*\\ffstattext/\\*\\ffentrymcr/\\*\\ffexitmcr, the remaining <formstrings> siblings of \\*\\ffdeftext", () => {
    const { diagnostics, document } = readRtfContent(
      bytes(
        `${HEADER}\\pard {\\field{\\*\\fldinst FORMTEXT  {\\*\\formfield{\\fftype0\\fftypetxt0{\\*\\ffname Text1}{\\*\\ffdeftext Jane Doe}{\\*\\ffformat 0}{\\*\\ffhelptext Client name}{\\*\\ffstattext Status}{\\*\\ffentrymcr Entry}{\\*\\ffexitmcr Exit}}}}{\\fldrslt Lorem ipsum.}}\\par}`,
      ),
    );
    expect(
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.UNKNOWN_DESTINATION_SKIPPED,
      ),
    ).toEqual([]);
    const paragraph =
      document.kind === "wordprocessing"
        ? (document.sections[0]?.blocks[0] as ContentParagraph | undefined)
        : undefined;
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      tag: "Text1",
    });
  });

  it("reads a FORMTEXT field's \\*\\ffhelptext as the contentControl's alias", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMTEXT  {\\*\\formfield{\\fftype0\\fftypetxt0\\ffownhelp1{\\*\\ffhelptext Client name}{\\*\\ffname Text1}}}}{\\fldrslt Lorem ipsum.}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      tag: "Text1",
      alias: "Client name",
    });
  });

  // [MS-DOC] 2.9.79 FFDataBits.fOwnHelp, verbatim: "If fOwnHelp is 0, FFData.xstzHelpText contains an empty or auto-generated string." A non-empty \ffhelptext under an explicit \ffownhelp0 is exactly that auto-generated string, not an author-set label, so it must not surface as `alias`.
  it("leaves a FORMTEXT field's alias unset when \\ffownhelp0 marks its \\ffhelptext as auto-generated", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMTEXT  {\\*\\formfield{\\fftype0\\fftypetxt0\\ffownhelp0{\\*\\ffhelptext Auto generated}{\\*\\ffname Text1}}}}{\\fldrslt Lorem ipsum.}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      tag: "Text1",
    });
  });

  // Regression guard: [MS-DOC] 2.9.79 FFDataBits itself states no default at all for fOwnHelp -- it is a fixed-width bit always physically present in the binary structure, so "default" is not a meaningful concept there. The real justification is RTF's own separate Form Fields table, which classifies \ffownhelpN as a Value control word ("1 if there is associated help text, 0 otherwise") rather than a Toggle word, so an absent control word carries no "on" meaning to inherit and this reader's own FormFieldState simply starts at false. A \*\formfield group that never spells \ffownhelp at all must therefore default identically to an explicit \ffownhelp0 -- an earlier version of this reader defaulted the absent-control-word case to true instead, which would have surfaced this same auto-generated-looking help text as an author-set alias purely because the producer happened to omit the bit rather than spell it out as 0.
  it("leaves a FORMTEXT field's alias unset when \\ffownhelp never appears at all, matching \\ffownhelp0's own default", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMTEXT  {\\*\\formfield{\\fftype0\\fftypetxt0{\\*\\ffhelptext Auto generated}{\\*\\ffname Text1}}}}{\\fldrslt Lorem ipsum.}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      tag: "Text1",
    });
  });

  it("reads a FORMTEXT field's \\ffprot as the contentControl's 'content' lock", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMTEXT  {\\*\\formfield{\\fftype0\\fftypetxt0\\ffprot1{\\*\\ffname Text1}}}}{\\fldrslt Lorem ipsum.}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      tag: "Text1",
      lock: "content",
    });
  });

  // \ffprotN is classified as a "Value" control word in RTF 1.9.1's own control-word-type table, not a "Toggle" word like \b/\i -- a Value word's own bare (unparameterised) form defaults to 0, not to "on" the way a bare \b/\i would. This regression-guards against an earlier version of this reader applying the toggle convention uniformly to every bare boolean form-field control word, which read a bare \ffprot as protected; see formFieldValueBit's own comment in read.ts for the exact citations.
  it("reads a bare \\ffprot (no explicit parameter) as unprotected, since \\ffprot is a Value word whose bare form defaults to 0, not a Toggle word", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMTEXT  {\\*\\formfield{\\fftype0\\fftypetxt0\\ffprot}}}{\\fldrslt Lorem ipsum.}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
    });
  });

  // \ffownhelp shares \ffprot's own Value-word classification but is deliberately read differently: LibreOffice's real RTF exporter (sw/source/filter/ww8/rtfattributeoutput.cxx) emits this bare form whenever the control model exposes a HelpText property at all, alongside that genuine, non-empty HelpText, so a bare \ffownhelp reads as true here rather than following the Value-word literal 0-default \ffprot's bare form still uses -- see read.ts's own comment on applyFormFieldControlWord's "ffownhelp" case.
  it("reads a bare \\ffownhelp (no explicit parameter) as true, promoting a non-empty \\ffhelptext to alias, matching real-world producers like LibreOffice that emit this bare form", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMTEXT  {\\*\\formfield{\\fftype0\\fftypetxt0\\ffownhelp{\\*\\ffhelptext Client name}{\\*\\ffname Text1}}}}{\\fldrslt Lorem ipsum.}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      tag: "Text1",
      alias: "Client name",
    });
  });

  // Regression guard against silently discarding real LibreOffice output rather than merely a synthetic minimal fixture: this exact byte sequence, checkbox included, is what LibreOffice's sw/source/filter/ww8/rtfattributeoutput.cxx actually emits for a checked FORMCHECKBOX carrying custom help text -- \ffownhelp bare, immediately before a non-empty \*\ffhelptext.
  it("reads a real LibreOffice-shaped FORMCHECKBOX's bare \\ffownhelp as carrying its \\ffhelptext through to alias", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMCHECKBOX {\\*\\formfield{\\fftype1\\ffhps20{\\*\\ffname Check1}\\ffownhelp{\\*\\ffhelptext Tick if applicable}\\ffdefres0\\ffres1}}}{\\fldrslt X}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "checkbox",
      tag: "Check1",
      alias: "Tick if applicable",
      checked: true,
    });
  });

  it("leaves the contentControl's lock unset when \\ffprot0 says the field is not protected", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMTEXT  {\\*\\formfield{\\fftype0\\fftypetxt0\\ffprot0}}}{\\fldrslt Lorem ipsum.}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
    });
  });

  it("still recognises a form field from its instruction alone when the legacy field carries no \\*\\formfield group at all", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMTEXT }{\\fldrslt legacy}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
    });
  });

  it("does not produce a contentControl for an ordinary field whose instruction names none of the three form-field keywords", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst{HYPERLINK "https://example.com/"}}{\\fldrslt link}}\\par}`,
    )[0];
    expect(paragraph?.constructs ?? []).toEqual([]);
  });

  // Regression guard: \*\ffname/\*\ffhelptext/\*\ffl/\*\formfield itself carry a name, a help string, a list entry, or nothing but their own control words -- never formatted document flow -- so a stray \par/\page/\sect inside any of them must be swallowed exactly like the analogous stray word already is inside \*\bkmkstart/\*\bkmkend, not applied to the paragraph/section/document surrounding the field. Before this guard, a \par here split the surrounding paragraph in two and a \page injected a top-level pageBreak block that does not belong to the field at all.
  it("swallows a stray \\par inside \\*\\ffname instead of splitting the surrounding paragraph", () => {
    const blocks = blocksOf(
      `${HEADER}\\pard before {\\field{\\*\\fldinst FORMTEXT {\\*\\formfield{\\fftype0\\fftypetxt0{\\*\\ffname a\\par b}}}}{\\fldrslt X}} after\\par}`,
    );
    expect(blocks).toHaveLength(1);
    const paragraph = blocks[0] as ContentParagraph;
    expect(paragraph.constructs?.[0]?.descriptor).toMatchObject({
      tag: "ab",
    });
    expect(paragraph.runs.map((run) => run.text).join("")).toBe(
      "before X after",
    );
  });

  it("swallows a stray \\page inside \\*\\ffhelptext instead of injecting a spurious pageBreak block", () => {
    const blocks = blocksOf(
      `${HEADER}\\pard before\\par {\\field{\\*\\fldinst FORMTEXT {\\*\\formfield{\\fftype0\\fftypetxt0\\ffownhelp1{\\*\\ffhelptext h\\page t}{\\*\\ffname Text1}}}}{\\fldrslt X}} after\\par}`,
    );
    expect(blocks.some((block) => block.kind === "pageBreak")).toBe(false);
    const paragraphs = blocks.filter(
      (block): block is ContentParagraph => block.kind === "paragraph",
    );
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[1]?.constructs?.[0]?.descriptor).toMatchObject({
      alias: "ht",
    });
  });

  // Regression guard: a real Word-authored \field wraps its own \*\fldinst instruction text in an anonymous nested group (`{\*\fldinst {FORMTEXT }...}`), and that nested group inherits the enclosing "fieldInstruction" destination just like \*\fldinst itself does -- so, before FieldState's own formFieldStarted guard existed, both the nested group's close and \*\fldinst's own close independently satisfied startFormField's condition, opening two extents for what is really one field while only the field's own single closing brace ever popped one back off. Five consecutive such fields exercise the guard across several fields in a row rather than just one, pinning that each field's own contentControl still lands on the correct run range with no duplication or cross-field mis-nesting.
  it("opens a Word-shaped nested \\*\\fldinst group's contentControl only once, across several consecutive fields", () => {
    const field =
      "{\\field{\\*\\fldinst {FORMTEXT }{\\*\\formfield{\\fftype0\\fftypetxt0{\\*\\ffname T}}}}{\\fldrslt X}}";
    const paragraph = paragraphsOf(
      `${HEADER}\\pard ${field.repeat(5)}\\par}`,
    )[0];
    expect(paragraph?.runs.map((run) => run.text)).toEqual([
      "X",
      "X",
      "X",
      "X",
      "X",
    ]);
    expect(paragraph?.constructs).toEqual([
      {
        descriptor: {
          kind: "contentControl",
          controlType: "plainText",
          tag: "T",
        },
        startRun: 0,
        endRun: 1,
      },
      {
        descriptor: {
          kind: "contentControl",
          controlType: "plainText",
          tag: "T",
        },
        startRun: 1,
        endRun: 2,
      },
      {
        descriptor: {
          kind: "contentControl",
          controlType: "plainText",
          tag: "T",
        },
        startRun: 2,
        endRun: 3,
      },
      {
        descriptor: {
          kind: "contentControl",
          controlType: "plainText",
          tag: "T",
        },
        startRun: 3,
        endRun: 4,
      },
      {
        descriptor: {
          kind: "contentControl",
          controlType: "plainText",
          tag: "T",
        },
        startRun: 4,
        endRun: 5,
      },
    ]);
  });

  // Regression guard for the flip side of the nested-\*\fldinst-group guard above: formFieldControlType is anchored on a \b word boundary, and a field's instruction is read incrementally across however many "fieldInstruction"-destination groups it is split across (see startFormField's own call site comment on the nested-anonymous-group case). A group that closes with the instruction reading exactly "FORMTEXT" -- nothing following it yet -- satisfies \b via the end of the string read so far, opening the extent; if the SAME instruction later grows a further identifier character directly onto that word with no separating space or switch delimiter ("FORMTEXTBOX" here), \b no longer holds once the instruction is complete, and the field is correctly not a real form field after all. Before gating endFormField's own call on formFieldStarted rather than re-deriving the type a second time from the (by-then-different) complete instruction, this field's opened extent was never closed: it leaked as an unpopped entry on the shared open-form-fields stack instead of being reported and discarded, one push short of the pop every other field's own close still performed correctly around it.
  it("drops a form field whose instruction stops matching a keyword once complete, without disturbing the fields around it", () => {
    const good =
      "{\\field{\\*\\fldinst {FORMTEXT }{\\*\\formfield{\\fftype0\\fftypetxt0{\\*\\ffname T}}}}{\\fldrslt X}}";
    const growsPastBoundary =
      "{\\field{\\*\\fldinst{FORMTEXT}BOX}{\\fldrslt Y}}";
    const { document, diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard ${good}${growsPastBoundary}${good}\\par}`),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing document, got ${document.kind}`,
      );
    }
    const paragraph = document.sections[0]?.blocks[0] as
      ContentParagraph | undefined;
    expect(paragraph?.runs.map((run) => run.text)).toEqual(["X", "Y", "X"]);
    // Both surviving contentControls still point at their own "X" run (index 0 and index 2), not shifted by the dropped field's leaked stack entry sitting between them.
    expect(
      paragraph?.constructs?.map((construct) => [
        construct.startRun,
        construct.endRun,
      ]),
    ).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(diagnostics).toContainEqual({
      code: RtfDiagnosticCodes.FORM_FIELD_KEYWORD_LOST,
      severity: "warning",
      message:
        "a form field's contentControl is dropped: its \\*\\fldinst instruction matched a form-field keyword partway through parsing but no longer did once the complete instruction was read",
    });
  });

  it("never opens a form field's own extent from a NESTED group's close whose destination isn't fieldInstruction, even one sharing state.field by reference", () => {
    // \*\ud is a real, known destination in its own right ("body", not "fieldInstruction") -- \*\fldinst's own text "FORMTEXT" matches before this nested group even opens, but a check keyed on state.field's own definedness and formFieldControlType alone, without also requiring THIS group's own destination to genuinely be "fieldInstruction", would open the extent right here, at \*\ud's own premature close, rather than waiting for \*\fldinst's own real close. Appending "EXTRA" directly afterward (still within \*\fldinst's own outer scope) breaks the word-boundary match RTF's own control-word anchoring requires ("FORMTEXTEXTRA" no longer names any recognised keyword), so the CORRECT outcome is silence -- an ordinary, non-form field, never opened, never reported. Opening it early at \*\ud's own close instead forces formFieldStarted true before "EXTRA" is even read, so the field group's own later close reads the complete (now non-matching) instruction back, drops it, and reports FORM_FIELD_KEYWORD_LOST -- a diagnostic this input must never produce, since correct code never opens the extent in the first place.
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\field{\\*\\fldinst FORMTEXT{\\*\\ud MORE}EXTRA}{\\fldrslt result}}after\\par}`,
      ),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.FORM_FIELD_KEYWORD_LOST,
      ),
    ).toBe(false);
  });

  it("swallows a stray \\par inside a \\*\\ffl entry instead of splitting the surrounding paragraph", () => {
    const blocks = blocksOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMDROPDOWN {\\*\\formfield{\\fftype2\\fftypetxt0\\ffhaslistbox{\\*\\ffl item1\\par item2}}}}{\\fldrslt X}}\\par}`,
    );
    expect(blocks).toHaveLength(1);
    const paragraph = blocks[0] as ContentParagraph;
    expect(paragraph.constructs?.[0]?.descriptor).toMatchObject({
      options: ["item1item2"],
    });
  });

  // Unlike \*\ffname/\*\ffhelptext/\*\ffl above, \fldrslt genuinely carries the field's own displayed content, so a \par or \cell inside it must still split the document the way it would anywhere else -- RTF 1.9.1's own <fieldrslt> production ('{' \fldrslt <para>+ '}') is grammatical for a multi-paragraph result even though real producers keep a form field inline. What this reader cannot do is keep the contentControl construct itself: a RunConstructExtent is scoped to one paragraph's own runs, so the construct is dropped, and endFormField reports why through the sink rather than disappearing silently.
  it("splits the document at a \\par inside \\fldrslt and drops the contentControl, reporting why", () => {
    const { document, diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard {\\field{\\*\\fldinst FORMTEXT {\\*\\formfield{\\fftype0\\fftypetxt0{\\*\\ffname Text1}}}}{\\fldrslt A\\par B}}\\par}`,
      ),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing document, got ${document.kind}`,
      );
    }
    const paragraphs = document.sections[0]?.blocks.filter(
      (block): block is ContentParagraph => block.kind === "paragraph",
    );
    expect(paragraphs?.map((paragraph) => paragraph.runs[0]?.text)).toEqual([
      "A",
      "B",
    ]);
    expect(
      paragraphs?.every((paragraph) => paragraph.constructs === undefined),
    ).toBe(true);
    expect(diagnostics).toContainEqual({
      code: RtfDiagnosticCodes.FORM_FIELD_SPAN_DROPPED,
      severity: "warning",
      message:
        "a form field's contentControl is dropped: its \\fldrslt content crossed a paragraph or table-cell boundary, and this reader's per-paragraph construct extent cannot span one",
    });
  });

  it("splits a table cell at a \\cell inside \\fldrslt and drops the contentControl, reporting why", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\trowd\\trleft0\\cellx1440\\cellx2880\\pard\\intbl {\\field{\\*\\fldinst FORMTEXT {\\*\\formfield{\\fftype0\\fftypetxt0{\\*\\ffname Text1}}}}{\\fldrslt A\\cell B\\cell}}\\row\\pard x\\par}`,
      ),
    );
    const table = blocksOf(
      `${HEADER}\\trowd\\trleft0\\cellx1440\\cellx2880\\pard\\intbl {\\field{\\*\\fldinst FORMTEXT {\\*\\formfield{\\fftype0\\fftypetxt0{\\*\\ffname Text1}}}}{\\fldrslt A\\cell B\\cell}}\\row\\pard x\\par}`,
    ).find((block): block is ContentTable => block.kind === "table");
    expect(
      table?.rows[0]?.cells.map(
        (cell) =>
          (cell.blocks[0] as ContentParagraph | undefined)?.runs[0]?.text,
      ),
    ).toEqual(["A", "B"]);
    expect(diagnostics).toContainEqual({
      code: RtfDiagnosticCodes.FORM_FIELD_SPAN_DROPPED,
      severity: "warning",
      message:
        "a form field's contentControl is dropped: its \\fldrslt content crossed a paragraph or table-cell boundary, and this reader's per-paragraph construct extent cannot span one",
    });
  });

  it("does not crash on a bare \\*\\ffname outside any \\field group, where state.field is genuinely undefined", () => {
    // \*\ffname is recognised (DESTINATION_KINDS maps it to "formFieldName") regardless of what encloses it, so a hostile or truncated producer's own stray occurrence outside \field reaches emitText with state.field inherited from the root -- undefined, never set by anything else. Without its own field?.formField !== undefined guard, `state.field.formField.name += text` would throw rather than silently discard, exactly as the trailing comment on this whole if-chain says every other unhandled destination already does.
    expect(() =>
      readRtfContent(bytes(`${HEADER}\\pard{\\*\\ffname stray}kept\\par}`)),
    ).not.toThrow();
    const paragraph = paragraphsOf(
      `${HEADER}\\pard{\\*\\ffname stray}kept\\par}`,
    )[0];
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe("kept");
  });

  it("does not crash on a bare \\*\\ffhelptext outside any \\field group, where state.field is genuinely undefined", () => {
    expect(() =>
      readRtfContent(bytes(`${HEADER}\\pard{\\*\\ffhelptext stray}kept\\par}`)),
    ).not.toThrow();
  });

  it("does not crash on a bare \\*\\ffl outside any \\field group, where state.field is genuinely undefined", () => {
    expect(() =>
      readRtfContent(bytes(`${HEADER}\\pard{\\*\\ffl stray}kept\\par}`)),
    ).not.toThrow();
  });
});

describe("byte runs larger than an argument list", () => {
  // A single paragraph whose text is one uninterrupted byte run far past the argument-count ceiling a spread call has (V8 throws RangeError somewhere around 65k-125k arguments). Bare CR/LF does not break a run -- the tokenizer skips those bytes and keeps accumulating -- so a real long paragraph reaches this size easily, and nothing smaller than a fixture this size catches it.
  const LONG_RUN_LENGTH = 300_000;

  it("reads a text run far longer than a spread call could carry", () => {
    const long = "a".repeat(LONG_RUN_LENGTH);
    const paragraph = paragraphsOf(`${HEADER}\\pard ${long}\\par}`)[0];
    expect(paragraph?.runs.map((run) => run.text).join("")).toHaveLength(
      LONG_RUN_LENGTH,
    );
  });

  it("reads a picture payload far longer than a spread call could carry", () => {
    // A PNG header followed by enough filler hex to push the payload past the same ceiling; only its size matters here, not its decodability.
    const hex = `89504e470d0a1a0a${"00".repeat(LONG_RUN_LENGTH / 2)}`;
    const image = blocksOf(
      `${HEADER}\\pard{\\pict\\pngblip\\picwgoal720\\pichgoal720 ${hex}}\\par}`,
    ).find((block): block is ContentImageBlock => block.kind === "image");
    expect(image?.base64.startsWith("iVBORw0KGgo")).toBe(true);
  });
});

// RTF 1.9.1, "Section Text": <section> is `<secfmt>* <hdrftr>? <para>+ (\sect <section>)?` -- a section's own formatting precedes its paragraphs and \sect ends it, so the properties in force when a \sect arrives are the ones belonging to the section that just closed.
describe("sections", () => {
  it("starts a new ContentSection at each \\sect rather than collapsing the document to one", () => {
    const sections = sectionsOf(
      `${HEADER}\\sectd\\pard First.\\par\\sect\\sectd\\pard Second.\\par}`,
    );
    expect(sections).toHaveLength(2);
    expect(
      sections.map((section) =>
        section.blocks
          .filter(
            (block): block is ContentParagraph => block.kind === "paragraph",
          )
          .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
          .join(""),
      ),
    ).toEqual(["First.", "Second."]);
  });

  it("carries each section's own \\pgwsxnN/\\pghsxnN/\\marg*sxnN geometry rather than the document's", () => {
    const sections = sectionsOf(
      "{\\rtf1\\ansi\\paperw12240\\paperh15840\\margl1440\\margr1440\\margt1440\\margb1440" +
        "\\sectd\\pard Portrait.\\par\\sect" +
        "\\sectd\\pgwsxn15840\\pghsxn12240\\marglsxn720\\margrsxn720\\margtsxn720\\margbsxn720\\pard Landscape.\\par}",
    );
    expect(sections[0]?.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
    expect(sections[0]?.margins.leftPt).toBe(72);
    expect(sections[1]?.pageSize).toEqual({ widthPt: 792, heightPt: 612 });
    expect(sections[1]?.margins).toEqual({
      topPt: 36,
      rightPt: 36,
      bottomPt: 36,
      leftPt: 36,
    });
  });

  it("reads the \\sbk* break vocabulary onto ContentSection.breakType", () => {
    const sections = sectionsOf(
      `${HEADER}\\sectd\\pard A\\par\\sect\\sectd\\sbknone\\pard B\\par\\sect\\sectd\\sbkodd\\pard C\\par}`,
    );
    expect(sections.map((section) => section.breakType)).toEqual([
      undefined,
      "continuous",
      "oddPage",
    ]);
  });

  it("reports \\sbkcol, whose column break ContentSection.breakType has no member for", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\sectd\\pard A\\par\\sect\\sectd\\sbkcol\\pard B\\par}`),
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      RtfDiagnosticCodes.SECTION_BREAK_UNREPRESENTED,
    );
  });

  it("keeps section properties across a \\sect that does not restate them, since only \\sectd resets", () => {
    const sections = sectionsOf(
      `${HEADER}\\sectd\\pgwsxn15840\\pghsxn12240\\pard A\\par\\sect\\pard B\\par}`,
    );
    expect(sections[1]?.pageSize).toEqual({ widthPt: 792, heightPt: 612 });
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
    // The lone space right after \bkmkstart itself is consumed as the control word's own terminating delimiter (RTF's own rule for a bare, unparameterised control word), but a SECOND space before the name -- or one before the group's own closing brace -- is ordinary #PCDATA and becomes part of bookmark.name verbatim unless explicitly trimmed.
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\*\\bkmkstart  padded }marked{\\*\\bkmkend padded}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      name: "padded",
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
    // A's own \bkmkend and B's own \bkmkstart both land in the second paragraph of the same table cell -- the shape ExaDev/documents.js#1040 names: block-granularity cannot express "A ends immediately before this paragraph's own remainder, which is B's" as two separate extents, since the paragraph is this reader's finest addressable unit. The two source ranges never actually overlap (A: "one"/"two", B: "three"/"four"), but a naive block-extent reconstruction would otherwise splice B nested inside A and silently reassign B's own trailing paragraph to A.
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
    // B's own text still reads correctly -- only its own bookmark construct is dropped, not its content.
    const paragraphs = cellBlocks.filter(
      (block): block is ContentParagraph => block.kind === "paragraph",
    );
    expect(paragraphs.map((p) => p.runs.map((r) => r.text).join(""))).toEqual([
      "one",
      "twothree",
      "four",
    ]);
    // Adjacent runs, split apart only because startBookmark/endBookmark each flush the pending run at the marker's own position -- not two genuinely different formatting spans.
    expect(paragraphs[1]?.runs).toHaveLength(2);
    const crossed = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.BLOCK_CONSTRUCT_EXTENTS_CROSSED,
    );
    expect(crossed?.message).toBe(
      "a 'anchor' construct's own block extent crosses an already-open one instead of nesting inside or sitting disjoint from it -- both bookmarks likely closed and opened within the same paragraph, which this reader cannot express as two separate extents, so this one is dropped",
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

// RTF 1.9.1, "Character Revision Mark Properties": <chrev> is `\revised? \revauthN? \revdttmN? \crauthN? \crdateN? \deleted? \revauthdelN? \revdttmdelN? \mvf? \mvt? \mvauthN? \mvdateN?`, and every one of them is a character property -- so a tracked change is a run-scoped extent, never a block marker.
describe("revision marks", () => {
  // "\*\revtbl -- This group consists of subgroups that each identify the author of a revision in the document, as in {Author1;}."
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

// RTF 1.9.1, "Table Definitions": <celldef> is the run of properties before each \cellxN, and <brdr> is `<brdrk> \brdrwN? \brspN? \brdrcfN?` -- the same border production paragraph borders use, so a cell's side is named by \clbrdrt/l/b/r and described by what follows it.
describe("table cell formatting", () => {
  it("reads each side's own \\clbrdr* border with its style, width and colour", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0` +
        "\\clbrdrt\\brdrs\\brdrw15\\brdrcf2\\clbrdrb\\brdrdot\\brdrw30\\brdrcf1\\cellx1440" +
        "\\pard\\intbl A\\cell\\row\\pard x\\par}",
    );
    const borders = table.rows[0]?.cells[0]?.borders;
    // No `style` key: ContentBorder's own "absent means 'solid'" already says what \brdrs says, and restating a default carries no information.
    expect(borders?.top).toEqual({
      color: { r: 1, g: 0, b: 0 },
      widthPt: 0.75,
    });
    expect(borders?.bottom).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 1.5,
      style: "dotted",
    });
    expect(borders?.left).toBeUndefined();
  });

  it("treats \\brdrnone and \\brdrnil as no border rather than a zero-width one", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clbrdrt\\brdrnone\\clbrdrl\\brdrnil\\cellx1440` +
        "\\pard\\intbl A\\cell\\row\\pard x\\par}",
    );
    expect(table.rows[0]?.cells[0]?.borders).toBeUndefined();
  });

  it("reads \\clcbpatN as the cell's background colour", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clcbpat2\\cellx1440\\pard\\intbl A\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
  });

  // ExaDev/documents.js#1024: \clcbpatN/\clcfpatN/\clshdngN together state a real two-colour pattern fill, not just a flat background colour.
  it("reads \\clshdngN between 0 and 10000 as a genuine two-colour pattern fill", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clcbpat1\\clcfpat2\\clshdng2500\\cellx1440\\pard\\intbl A\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.background).toEqual({
      kind: "pattern",
      patternType: "percent25",
      foregroundColor: { r: 1, g: 0, b: 0 },
      backgroundColor: { r: 0, g: 0, b: 0 },
    });
  });

  it("reads \\clshdng0 (or its absence) as a flat background colour, the same shape \\clcbpatN alone already produces", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clcbpat2\\clshdng0\\cellx1440\\pard\\intbl A\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
  });

  it("reads \\clshdng10000 (100%) as a flat fill of the foreground colour instead", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clcbpat1\\clcfpat2\\clshdng10000\\cellx1440\\pard\\intbl A\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
  });

  it("snaps an odd \\clshdngN value to its nearest percentN member", () => {
    const table = firstTable(
      // 2222/100 = 22.22%, nearest to 20 (2) rather than 25 (3).
      `${HEADER}\\trowd\\trleft0\\clcbpat1\\clcfpat2\\clshdng2222\\cellx1440\\pard\\intbl A\\cell\\row\\pard x\\par}`,
    );
    const background = table.rows[0]?.cells[0]?.background;
    expect(
      background?.kind === "pattern" ? background.patternType : undefined,
    ).toBe("percent20");
  });

  it("derives rowSpan from \\clvmgf and the \\clvmrg cells beneath it", () => {
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\clvmgf\\cellx1440\\cellx2880\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row" +
        "\\trowd\\trleft0\\clvmrg\\cellx1440\\cellx2880\\pard\\intbl\\cell\\pard\\intbl C\\cell\\row" +
        "\\pard x\\par}",
    );
    expect(table.rows[0]?.cells[0]?.rowSpan).toBe(2);
    // The continuation cell stays in the row with no blocks of its own, matching how every other codec in this family states a covered cell.
    expect(table.rows[1]?.cells[0]?.blocks).toEqual([]);
    expect(table.rows[1]?.cells[0]?.rowSpan).toBeUndefined();
  });

  it("derives colSpan from \\clmgf and the \\clmrg cells beside it", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clmgf\\cellx1440\\clmrg\\cellx2880\\cellx4320` +
        "\\pard\\intbl A\\cell\\pard\\intbl\\cell\\pard\\intbl C\\cell\\row\\pard x\\par}",
    );
    expect(table.rows[0]?.cells[0]?.colSpan).toBe(2);
  });

  it("leaves a plain cell carrying no borders, background, or span fields at all", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx1440\\pard\\intbl A\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]).toEqual({
      blocks: [{ kind: "paragraph", runs: [{ text: "A", sizePt: 12 }] }],
    });
  });

  it("reads the \\clvertalt/\\clvertalc/\\clvertalb <cellalign> member onto ContentTableCell.verticalAlign, with the stated default collapsing into absence", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clvertalt\\cellx1440\\clvertalc\\cellx2880\\clvertalb\\cellx4320` +
        "\\pard\\intbl top\\cell\\pard\\intbl middle\\cell\\pard\\intbl bottom\\cell\\row\\pard x\\par}",
    );
    // \clvertalt is the spec's own default ("Text is top-aligned in cell (the default)"), and the field's absence already means top, so the word carries nothing the absence doesn't -- the same collapse the reader applies to \sbkpage against ContentSection.breakType.
    expect(table.rows[0]?.cells.map((cell) => cell.verticalAlign)).toEqual([
      undefined,
      "center",
      "bottom",
    ]);
  });
});

describe("run identity", () => {
  it("keeps two adjacent runs with different real colours separate, not folded by a flattened key", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\cf1 black\\cf2 red\\par}`)[0]?.runs ?? [];
    expect(runs.map((run) => run.text)).toEqual(["black", "red"]);
    expect(runs[0]?.color).toEqual({ r: 0, g: 0, b: 0 });
    expect(runs[1]?.color).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("keeps two adjacent runs with different fonts separate", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\f0 times\\f1 arial\\par}`)[0]?.runs ?? [];
    expect(runs.map((run) => run.text)).toEqual(["times", "arial"]);
    expect(runs[0]?.fontFamily).toBe("Times New Roman");
    expect(runs[1]?.fontFamily).toBe("Arial");
  });

  it("reads a HYPERLINK field carrying both a quoted target and an \\l anchor as target#anchor", () => {
    const runs =
      paragraphsOf(
        `${HEADER}\\pard {\\field{\\*\\fldinst{HYPERLINK "https://example.com/page" \\\\l "part2"}}{\\fldrslt jump}}\\par}`,
      )[0]?.runs ?? [];
    expect(runs[0]?.hyperlink).toBe("https://example.com/page#part2");
  });
});

describe("unicode fallback skip", () => {
  it("stops a \\uc fallback skip early at a group boundary rather than reading into the group", () => {
    // \uc5 with only one text byte before a nested group: the spec's own scope-delimiter rule ends the skippable run at the brace, so "inside" must still be read as real content rather than swallowed as fallback.
    const runs =
      paragraphsOf(`${HEADER}\\pard \\uc5\\u9731 x{inside}\\par}`)[0]?.runs ??
      [];
    expect(runs.map((run) => run.text).join("")).toContain("inside");
  });

  it("counts a control word or symbol inside the fallback region as exactly one skipped character", () => {
    // \uc1 skips one "character" -- here a \'hh escape, which the spec's own rule counts as a single character even though it is itself a control word, not a literal byte. If the escape were NOT consumed as the fallback, the decoded e-acute would leak into the visible text alongside the real Unicode character.
    const runs =
      paragraphsOf(`${HEADER}\\pard \\uc1\\u9731 \\'e9after\\par}`)[0]?.runs ??
      [];
    const text = runs.map((run) => run.text).join("");
    expect(text).not.toContain("é");
    expect(text).toContain("after");
  });

  it("consumes a fallback text run exactly its own length and resumes reading real text immediately after it", () => {
    // \uc3 with a three-byte fallback run ("abc") that is its OWN complete text token -- ended by \b0, a genuine token boundary, rather than continuing into "real" within the same token -- so the skip count exactly exhausts it. The reader must advance past the whole token and reset its own byte offset there, not stop one byte short of it (which would leak a trailing byte of "abc" into the visible text).
    const runs =
      paragraphsOf(`${HEADER}\\pard \\uc3\\u9731 abc\\b0 real\\par}`)[0]
        ?.runs ?? [];
    const text = runs.map((run) => run.text).join("");
    expect(text).not.toContain("abc");
    expect(text).toContain("real");
  });

  it("counts a two-byte text run as fully consumed only once its own last byte is reached, then genuinely skips the control word right after it", () => {
    // \uc3 with a two-byte fallback ("ab", its own complete token) plus \i (a control word, "considered a single character" per the spec) makes exactly 3 -- the skip must fully exhaust "ab" AND advance past \i, so \i's own formatting effect never reaches "real". A reader that stopped one byte short of "ab" (leaving its own token index unmoved) would leave \i unskipped, letting it toggle italics on for real.
    const runs =
      paragraphsOf(`${HEADER}\\pard \\uc3\\u9731 ab\\i real\\par}`)[0]?.runs ??
      [];
    const text = runs.map((run) => run.text).join("");
    expect(text).toBe("☃real");
    expect(runs.some((run) => run.italic === true)).toBe(false);
  });

  it("leaves a text token's own trailing bytes visible when the fallback count is smaller than the whole token", () => {
    // \uc2 skips only the first two bytes of the SEVEN-byte token "abcreal" -- the reader must resume from that exact byte offset within the SAME token, not skip the whole token or stop reading it altogether.
    const runs =
      paragraphsOf(`${HEADER}\\pard \\uc2\\u9731 abcreal\\par}`)[0]?.runs ?? [];
    const text = runs.map((run) => run.text).join("");
    expect(text).toBe("☃creal");
  });
});

describe("block-scoped construct extent ordering", () => {
  it("returns the block list itself, not undefined, when there are genuinely no extents to splice at all", () => {
    // No bookmark anywhere in this document, so sectionBlockExtents is empty and insertConstructMarkers' own fast path is what actually produces the section's blocks -- an emptied fast path would hand endSection undefined instead of the real block list.
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
    // "outer" and "inner" both start in the first paragraph -- tied startIndex -- but "outer" spans one paragraph further before its own \bkmkend, so at that tie the longer extent must sort first (open outermost).
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
    // "first" and "second" open at genuinely different, non-tied start indices -- the sort's own first comparator clause (by startIndex) is what this fixture exercises, distinct from the tied-start case above.
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
    // "inner" starts strictly after "outer" but closes at the SAME index "outer" does -- true nesting with a shared endpoint, not a crossing pair. If the crossing check's own end-side comparison read "greater than or equal to" instead of strictly "greater than", this exact tie would be misread as a cross and "inner" would be dropped.
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

  it("still sorts an inner extent's later start ahead of an outer one's earlier start when the inner extent closes -- and so is pushed into the pending list -- first", () => {
    // "outer" opens before "inner" does but closes after it, so "inner" is the one whose \bkmkend is seen first and is therefore the one flushClosingBookmarks pushes into sectionBlockExtents first -- the pre-sort array order here is [inner, outer], the REVERSE of correct start order. If the sort's own first comparator clause summed the two startIndex values instead of subtracting them, the comparator would return the same (wrong-signed) result regardless of which extent it was asked about first -- since addition is commutative -- and never trigger the swap this out-of-order push requires, leaving "inner" sorted ahead of "outer". dropCrossingExtents would then see "outer" arrive after "inner" already claimed the first slot and misread the true nesting as a cross, dropping "outer" entirely.
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

describe("table cell merge span", () => {
  it("gives a plain, non-anchor cell a span of one even when a later, unrelated cell carries its own continuation flag", () => {
    // The second cell's own \clmrg is malformed here (no preceding \clmgf anchors it), but horizontalSpanAt's own guard must still be keyed on THIS cell's own horizontalMergeFirst flag, not fall through to scanning forward regardless of it.
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx1440\\clmrg\\cellx2880\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.colSpan).toBeUndefined();
  });
});

describe("bookmark bookkeeping", () => {
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
    // Naming only \bkmkcolf without \bkmkcoll (or vice versa) is spec-legal ("These controls are used within the \*\bkmkstart destination"), and must still produce a source-residue clause -- neither field being stated at all is the only case with no clause.
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
    // If endBookmark's own delete call were a no-op, 'dup' would still be sitting in openBookmarks when the second bkmkend arrives: it would be silently (and wrongly) treated as still open instead of triggering the bkmkend-with-no-bkmkstart diagnostic here, AND it would still be open at the document's own end, triggering reportUnclosedBookmarks' own "has no matching \\bkmkend" diagnostic instead -- a DIFFERENT diagnostic that also names 'dup' and would, wrongly, still leave the naive count-only assertion this replaced at exactly one match, masking the missing delete entirely. Asserting the exact message (not just a length-one count of anything mentioning 'dup') is what actually distinguishes the two.
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

describe("run and paragraph accumulation", () => {
  it("bumps the paragraph serial forward with each closed paragraph, never backward", () => {
    // A bookmark opened in the second paragraph and closed in the third must resolve to a block-scoped extent (its own start and end genuinely differ), which only holds if paragraphSerial actually counts upward -- a serial that decremented would make the second paragraph's own number collide with the first's.
    const blocks = blocksOf(
      `${HEADER}\\pard One\\par\\pard{\\*\\bkmkstart s}Two\\par\\pard Three{\\*\\bkmkend s}\\par}`,
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
    ]);
  });

  it("sorts a paragraph's own run-scoped constructs by start position, earliest first", () => {
    const paragraph = paragraphsOf(
      `${HEADER}{\\*\\revtbl{Unknown;}{A. Reviewer;}}\\pard kept \\revised\\revauth1 second\\revised0  middle \\deleted\\revauthdel1 first-in-source\\deleted0  end\\par}`,
    )[0];
    // Two disjoint provenance extents on the same paragraph: the insertion opens AFTER the deletion in source order here is irrelevant -- what matters is the extents come back ordered by their own startRun, not source-declaration order, matching document-schema.js's own well-formedness expectation for RunConstructExtent[].
    const starts = (paragraph?.constructs ?? []).map(
      (extent) => extent.startRun,
    );
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(paragraph?.constructs).toHaveLength(2);
  });

  it("still tie-breaks two run-scoped constructs sharing a startRun by endRun, ascending, when a bookmark extent (pushed first, regardless of its own numeric range) shares its start with a shorter coalesced revision extent (pushed second)", () => {
    // Both 'B' (a bookmark) and the revision mark on 'hi' start at run 0, but pendingRunConstructs entries are always spread into the pre-sort array BEFORE coalesceRunConstructs' own output, regardless of which one's numeric range is actually smaller -- so the pre-sort array here is [B(start=0,end=2), revision(start=0,end=1)], tied on the first comparator clause and wrong on the second. A second comparator clause that summed the two endRun values instead of subtracting them would return the same non-discriminating result regardless of argument order (both terms tied at zero on the first clause), never triggering the swap this reversed-by-numeric-value push order requires.
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\*\\bkmkstart B}\\revised\\revauth1 hi\\revised0  more{\\*\\bkmkend B}\\par}`,
    )[0];
    const extents = paragraph?.constructs ?? [];
    expect(extents).toHaveLength(2);
    expect(extents[0]?.descriptor.kind).toBe("provenance");
    expect(extents[0]?.endRun).toBe(1);
    expect(extents[1]?.descriptor.kind).toBe("anchor");
    expect(extents[1]?.endRun).toBe(2);
  });

  it("still sorts a nested bookmark pair into start order when the inner one's own endBookmark call -- and so its own push into pendingRunConstructs -- happens before the outer one's", () => {
    // 'inner' opens after 'outer' (startRun 1, not 0) but closes first, so ITS OWN pendingRunConstructs.push happens before 'outer's -- the pre-sort array here is [inner(start=1), outer(start=0)], the reverse of correct start order, exactly mirroring the block-extent sort's own out-of-push-order case above. A sort comparator that summed instead of subtracted the two startRun values (or one whose "||" read "&&") would return the same, non-discriminating result regardless of which extent it was asked about first, and never trigger the swap this reversed push order requires.
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\*\\bkmkstart outer}one {\\*\\bkmkstart inner}two{\\*\\bkmkend inner} three{\\*\\bkmkend outer}\\par}`,
    )[0];
    const names = (paragraph?.constructs ?? []).map((extent) =>
      extent.descriptor.kind === "anchor" ? extent.descriptor.name : undefined,
    );
    expect(names).toEqual(["outer", "inner"]);
  });

  it("resolves a bookmark's own block index to the paragraph it actually opened in, not to whichever later paragraph happens to close while it is still open", () => {
    // "far" opens in "One" and stays open across two further paragraphs before its own \bkmkend. A guard that kept re-resolving blockIndex on every subsequent paragraph close (rather than only once, at "far"'s own opening paragraph) would leave it pointing at "Three" instead.
    const blocks = blocksOf(
      `${HEADER}\\pard{\\*\\bkmkstart far}One\\par\\pard Two\\par\\pard Three\\par\\pard Four{\\*\\bkmkend far}\\par}`,
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "constructEnd",
    ]);
  });
});

describe("paragraph geometry derivation", () => {
  it("does not restate a style name onto styleId when the header names an empty style entry", () => {
    const source =
      "{\\rtf1\\ansi\\ansicpg1252\\deff0" +
      "{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}}" +
      "{\\colortbl;}" +
      "{\\stylesheet{\\s1 ;}}" +
      "\\pard\\s1 x\\par}";
    const paragraph = paragraphsOf(source)[0];
    expect(paragraph?.styleId).toBeUndefined();
  });

  it("omits headingLevel when a paragraph names no style and states no \\outlinelevel of its own", () => {
    const paragraph = paragraphsOf(`${HEADER}\\pard plain\\par}`)[0];
    expect(paragraph?.headingLevel).toBeUndefined();
  });

  it("treats \\sl0 (automatic spacing) the same as no \\sl at all: no lineSpacing field", () => {
    const paragraph = paragraphsOf(`${HEADER}\\pard\\sl0\\slmult1 x\\par}`)[0];
    expect(paragraph?.lineSpacing).toBeUndefined();
  });

  it("carries no lineSpacing field when \\sl is stated without \\slmult1, since the default is not left with a leftover default value", () => {
    const paragraph = paragraphsOf(`${HEADER}\\pard\\sl240 x\\par}`)[0];
    expect(paragraph?.lineSpacing).toBeUndefined();
  });

  it("reads \\ls0 (no list override) as no list field at all, matching an absent \\ls", () => {
    const paragraph = paragraphsOf(`${HEADER}\\pard\\ls0 x\\par}`)[0];
    expect(paragraph?.list).toBeUndefined();
  });
});

describe("table row and column derivation", () => {
  it("does not open a synthetic empty cell when a \\row closes with no pending text and no cell already collected", () => {
    // \row with genuinely nothing accumulated -- no \cell mark reached at all -- must not call endCell and manufacture a phantom cell from nothing; TABLE_ROW_WITHOUT_DEFINITION already covers that case on its own terms.
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\trowd\\trleft0\\cellx1440\\row\\pard x\\par}`),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.TABLE_ROW_WITHOUT_DEFINITION,
      ),
    ).toBe(true);
  });

  it("resets inTable to false once \\row closes, even with no \\pard afterward to do it instead", () => {
    // Every other table fixture in this file follows its own \row with an explicit \pard, which resets para.inTable back to false on its own via defaultParagraphState() -- masking whether \row's OWN reset does anything at all. Typing text directly after \row, with no \pard in between, is the one shape that actually depends on \row's own case resetting inTable itself: without it, "after" would stay routed into the now-closed table's own cellBlocks instead of the section's real blocks.
    const blocks = blocksOf(
      `${HEADER}\\trowd\\trleft0\\cellx1440\\pard\\intbl cell\\cell\\row after\\par}`,
    );
    const paragraphs = blocks.filter(
      (block): block is ContentParagraph => block.kind === "paragraph",
    );
    expect(
      paragraphs.some((paragraph) =>
        paragraph.runs.some((run) => run.text.includes("after")),
      ),
    ).toBe(true);
  });

  it("still closes a dangling cell whose own \\cell mark is missing but a \\row follows it directly", () => {
    // Real producers occasionally omit the final \cell before \row; endRow's own guard must still call endCell for whatever text or blocks accumulated, rather than losing it because \row's own trigger conditions were read too narrowly.
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx1440\\pard\\intbl dangling\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells).toHaveLength(1);
    const firstBlock = table.rows[0]?.cells[0]?.blocks[0];
    expect(
      firstBlock?.kind === "paragraph"
        ? firstBlock.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("dangling");
  });

  it("still closes a dangling cell holding only an already-flushed block (no pending text at all) when \\row follows directly", () => {
    // A picture already pushed into cellBlocks via addBlocks, with nothing typed after it -- pendingRunText is genuinely empty here, so this exercises endRow's own cellBlocks.length check specifically, not the pendingRunText half of its guard.
    const PNG_HEX =
      "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
      "01f15c4890000000a49444154789c6300010000050001" +
      "0d0a2db40000000049454e44ae426082";
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx1440\\pard\\intbl{\\pict\\pngblip\\picwgoal720\\pichgoal720 ${PNG_HEX}}\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells).toHaveLength(1);
    expect(table.rows[0]?.cells[0]?.blocks[0]?.kind).toBe("image");
  });

  it("produces a genuinely empty cell (no blocks at all) for a cell with no content, rather than a phantom empty paragraph", () => {
    // endCell's own endParagraph(para, false) must NOT force-close: an empty, never-typed-in cell has zero runs, and force=false is exactly what lets that produce no block at all.
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx1440\\pard\\intbl\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.blocks).toEqual([]);
  });

  it("splices a bookmark closed inside a cell into that cell's own blocks, not the section's", () => {
    // 'inCell' opens in the cell's first paragraph and closes in its second, still inside the same cell -- endCell's own flushClosingBookmarks call must target inTable=true (the cell's own cellBlockExtents), not the section's, or the marker pair ends up missing from the cell entirely.
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx1440\\pard\\intbl{\\*\\bkmkstart inCell}One\\par\\pard\\intbl Two{\\*\\bkmkend inCell}\\cell\\row\\pard x\\par}`,
    );
    const kinds = table.rows[0]?.cells[0]?.blocks.map((block) => block.kind);
    expect(kinds).toEqual([
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
    ]);
  });

  it("still resolves a bookmark whose own \\bkmkend lands in an otherwise-empty trailing paragraph right before \\cell, via endCell's own explicit flush rather than endParagraph's", () => {
    // \bkmkend here is the ONLY thing in its paragraph -- no text follows it before \cell -- so endParagraph's own force=false early return (runs.length === 0) fires without ever calling resolveBookmarkPositions, leaving 'trailing' still sitting in closingBookmarks when endCell reaches its OWN explicit flushClosingBookmarks(true, ...) call two lines later. That explicit call is the only thing that still resolves it; if its own hardcoded inTable argument read false instead of true, closing.inTable (true, since the bookmark opened inside \intbl) would no longer match, and 'trailing' would be wrongly dropped as straddling a cell boundary it never actually crossed.
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx1440\\pard\\intbl{\\*\\bkmkstart trailing}One\\par\\pard\\intbl{\\*\\bkmkend trailing}\\cell\\row\\pard x\\par}`,
    );
    const kinds = table.rows[0]?.cells[0]?.blocks.map((block) => block.kind);
    expect(kinds).toEqual(["constructStart", "paragraph", "constructEnd"]);
  });

  it("reports the exact TABLE_ROW_WITHOUT_DEFINITION message text", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\trowd\\trleft0\\cellx1440\\row\\pard x\\par}`),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.TABLE_ROW_WITHOUT_DEFINITION,
    );
    expect(found?.message).toBe(
      "a \\row closed a table row that contained no \\cell marks",
    );
  });

  it("takes column widths from the FIRST row's own \\cellxN boundaries, not a later row's", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx1000\\cellx2000\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row` +
        "\\trowd\\trleft0\\cellx5000\\cellx9000\\pard\\intbl C\\cell\\pard\\intbl D\\cell\\row\\pard x\\par}",
    );
    expect(table.columnWidthsPt).toEqual([50, 50]);
  });

  it("counts grid columns from a row's own cell spans when they exceed the \\cellxN boundary count", () => {
    // \cellxN only ever names 2 boundaries here, but a horizontally merged anchor covering both plus a genuinely wider second row proves columnCount is derived from actual cell spans, not capped at the boundary count alone.
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clmgf\\cellx2160\\clmrg\\cellx4320\\pard\\intbl wide\\cell\\pard\\intbl\\cell\\row` +
        "\\trowd\\trleft0\\cellx1440\\cellx2880\\cellx4320\\pard\\intbl a\\cell\\pard\\intbl b\\cell\\pard\\intbl c\\cell\\row\\pard x\\par}",
    );
    expect(table.columnWidthsPt.length).toBeGreaterThanOrEqual(3);
  });

  it("filters a horizontally-merged continuation cell out of the row entirely, while a vertical continuation keeps its own empty slot", () => {
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\clmgf\\cellx1440\\clmrg\\cellx2880\\pard\\intbl merged\\cell\\pard\\intbl\\cell\\row" +
        "\\trowd\\trleft0\\clvmgf\\cellx1440\\cellx2880\\pard\\intbl v\\cell\\pard\\intbl w\\cell\\row" +
        "\\trowd\\trleft0\\clvmrg\\cellx1440\\cellx2880\\pard\\intbl stray\\cell\\pard\\intbl x\\cell\\row\\pard z\\par}",
    );
    // Row 0's horizontal continuation cell is dropped, leaving one cell.
    expect(table.rows[0]?.cells).toHaveLength(1);
    // Row 2's vertical continuation cell keeps its own slot (an empty one), so the row still reports two cells. Its own cell carries a "stray" run in the source (a real producer's own vertically-merged continuation cell does sometimes still write placeholder text, even though the spec's own merge model says only the anchor's content is real) -- a genuinely early-returned `{ blocks: [] }` discards it regardless; a fallen-through cell would keep `cell.blocks` (the stray paragraph) instead.
    expect(table.rows[2]?.cells).toHaveLength(2);
    expect(table.rows[2]?.cells[0]?.blocks).toEqual([]);
  });

  it("derives rowSpan of exactly two, not three, when the row after a merge run is a genuinely ordinary row", () => {
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\clvmgf\\cellx1440\\pard\\intbl A\\cell\\row" +
        "\\trowd\\trleft0\\clvmrg\\cellx1440\\pard\\intbl\\cell\\row" +
        "\\trowd\\trleft0\\cellx1440\\pard\\intbl B\\cell\\row\\pard x\\par}",
    );
    expect(table.rows[0]?.cells[0]?.rowSpan).toBe(2);
    expect(table.rows[2]?.cells[0]?.rowSpan).toBeUndefined();
  });

  it("never scans for a continuation at all under a genuinely ordinary cell that carries no \\clvmgf anchor of its own", () => {
    // Row 0's cell is a plain, unmerged cell -- no \clvmgf -- while row 1's cell at the identical column IS a \clvmrg continuation (malformed on its own, since nothing anchors it, but the reader's own rowSpan derivation must still be gated on THIS cell's own verticalMergeFirst flag, not on whether a match happens to exist somewhere later). A guard that entered the scanning loop unconditionally would find row 1's continuation anyway and wrongly extend row 0's plain cell to rowSpan 2.
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\cellx1440\\pard\\intbl A\\cell\\row" +
        "\\trowd\\trleft0\\clvmrg\\cellx1440\\pard\\intbl\\cell\\row\\pard x\\par}",
    );
    expect(table.rows[0]?.cells[0]?.rowSpan).toBeUndefined();
  });

  it("derives rowSpan of exactly three when a merge run spans two genuine continuation rows, not one", () => {
    // Two REAL \clvmrg continuation rows after the anchor, not one: a scan loop that stepped backwards instead of forwards would revisit the anchor's own row on its second iteration (rowIndex itself is never a verticalMergeContinuation, so that immediately breaks the loop) and stop after counting only the FIRST continuation -- rowSpan 2 -- indistinguishable from the existing "exactly two, not three" fixture above, which only ever has one continuation row to begin with and so cannot tell a reversed loop direction apart from a correct one.
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\clvmgf\\cellx1440\\pard\\intbl A\\cell\\row" +
        "\\trowd\\trleft0\\clvmrg\\cellx1440\\pard\\intbl\\cell\\row" +
        "\\trowd\\trleft0\\clvmrg\\cellx1440\\pard\\intbl\\cell\\row" +
        "\\trowd\\trleft0\\cellx1440\\pard\\intbl B\\cell\\row\\pard x\\par}",
    );
    expect(table.rows[0]?.cells[0]?.rowSpan).toBe(3);
  });

  it("still matches a continuation whose own row places it at cell position one, not only at position zero", () => {
    // The anchor is the SECOND cell of its own row here (a plain first cell precedes it), so its own resolved column value is 1, not 0 -- and the continuation row below it also places its own \clvmrg continuation as its second cell, so indexOf(column) resolves to matchIndex 1 too. A check that mistook a real matchIndex of 1 for the sentinel "not found" value (rather than genuinely comparing it against -1) would wrongly treat this real match as absent and stop the scan immediately, every existing fixture only ever has its own match at position 0.
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\cellx1440\\clvmgf\\cellx2880\\pard\\intbl first\\cell\\pard\\intbl anchor\\cell\\row" +
        "\\trowd\\trleft0\\cellx1440\\clvmrg\\cellx2880\\pard\\intbl x\\cell\\pard\\intbl\\cell\\row\\pard z\\par}",
    );
    expect(table.rows[0]?.cells[1]?.rowSpan).toBe(2);
  });

  it("leaves rowSpan at one for a \\clvmgf anchor in the table's own last row, with no following row to continue into", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clvmgf\\cellx1440\\pard\\intbl only\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.rowSpan).toBeUndefined();
  });

  it("falls back to an even split when the \\cellxN boundaries describe fewer columns than the row actually has", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\trowd\\trleft0\\cellx4320\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row\\pard x\\par}`,
      ),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.TABLE_COLUMN_WIDTH_INVALID,
      ),
    ).toBe(true);
  });

  it("reports the exact TABLE_COLUMN_WIDTH_INVALID message text", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\trowd\\trleft0\\cellx4320\\cellx4320\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row\\pard x\\par}`,
      ),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.TABLE_COLUMN_WIDTH_INVALID,
    );
    expect(found?.message).toBe(
      "the row's \\cellxN boundaries do not describe increasing column widths for every column; falling back to an even split of the page's text width",
    );
  });

  it("splits the even-split fallback width by dividing the usable width, not multiplying it, across the column count", () => {
    const table = firstTable(
      "{\\rtf1\\ansi\\ansicpg1252\\deff0" +
        "{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}}{\\colortbl;}" +
        "\\paperw12240\\paperh15840\\margl1440\\margr1440" +
        "\\trowd\\trleft0\\cellx1440\\cellx1440\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row\\pard x\\par}",
    );
    // Usable width is 8.5in - 2in = 6.5in = 468pt, split across 2 columns.
    expect(table.columnWidthsPt).toEqual([234, 234]);
  });
});

describe("block accumulation across \\object/\\result scratch rendering", () => {
  it("never appends an empty block list, so addBlocks is a true no-op rather than an empty-array push", () => {
    // A picture that fails to decode (no format) produces nothing to add; the surrounding paragraph's own text must read as one unbroken run rather than being split by a flush that never needed to happen.
    const runs =
      paragraphsOf(
        `${HEADER}\\pard before{\\pict\\wmetafile8 00}after\\par}`,
      )[0]?.runs ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0]?.text).toBe("beforeafter");
  });

  it("flushes a run still pending before a genuinely non-empty addBlocks call, keeping it a separate run from identically-formatted text typed after", () => {
    // A successfully-decoded picture is the ordinary non-empty case addBlocks' own flushRun call exists for: without it, "before" would stay pending across the image insertion and silently merge with "after" into one run once the image block itself has already been spliced between them positionally -- the two texts would still end up in the same final paragraph (addBlocks does not close the paragraph, only flushes and splices), so only the RUN boundary between them reveals a missing flush.
    const PNG_HEX =
      "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
      "01f15c4890000000a49444154789c6300010000050001" +
      "0d0a2db40000000049454e44ae426082";
    const paragraph = paragraphsOf(
      `${HEADER}\\pard before{\\pict\\pngblip\\picwgoal720\\pichgoal720 ${PNG_HEX}}after\\par}`,
    )[0];
    const texts = paragraph?.runs.map((run) => run.text) ?? [];
    expect(texts).toEqual(["before", "after"]);
  });

  it("never flushes a run still pending when addBlocks is called with a genuinely empty list, so it stays merged with identically-formatted text typed after the call", () => {
    // A failed-picture-decode addBlocks call (the fixture above) never even reaches addBlocks' own emptiness check: buildPicture returning undefined is guarded by its OWN `if (image !== undefined)` at the call site, so addBlocks is never called there at all. objectState.resultBlocks is the one real call site that can genuinely pass an empty array -- an \object whose \result had no content of its own. \shppict (a "body"-kind destination, not a fresh \result scratch) types "blah" directly into the OUTER paragraph's own pendingRunText AFTER \result has already closed and restored state, so it is still genuinely pending -- unflushed -- at the exact moment \object's own close calls addBlocks(resultBlocks=[], ...). A guard-less addBlocks would flush it regardless of its own list being empty, splitting it from the identically-formatted text typed after \object closes.
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\object{\\result}{\\shppict blah}} more\\par}`,
    )[0];
    const texts = paragraph?.runs.map((run) => run.text) ?? [];
    expect(texts).toEqual(["blah more"]);
  });

  it("flushes a run still pending when \\result's own scratch rendering begins, so it is not lost or merged into \\result's content", () => {
    const OBJDATA_HEX_LOCAL = bytesToHex(
      writeEmbeddedObjectData({
        objectKind: "spreadsheet",
        document: { kind: "spreadsheet", metadata: {}, sheets: [] },
        frame: { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
      }),
    );
    const paragraphs = paragraphsOf(
      `${HEADER}\\pard pending text{\\object\\objemb{\\*\\objdata ${OBJDATA_HEX_LOCAL}}{\\result{\\pard\\plain fallback\\par}}}\\par}`,
    );
    const text = paragraphs
      .map((p) => p.runs.map((r) => r.text).join(""))
      .join("");
    expect(text).toContain("pending text");
  });

  it("keeps a run pending before \\result as its own separate run, not merged with identically-formatted text typed after \\object closes", () => {
    // \result here is genuinely EMPTY and \objdata is absent entirely, so nothing else along the way ever calls addBlocks with a non-empty list -- not \objdata's own decode (there is none), not \object's own close splicing resultBlocks in (endResultScratch returns [] for an empty scratch, and addBlocks' own length===0 guard makes that call a no-op too). beginResultScratch's own flushRun call is therefore the ONLY thing that can push "pending " into a real run before \object's group closes. captureAccumulatorState/restoreAccumulatorState round-trip the raw pendingRunText/pendingRunKey either way, so a MISSING flushRun call is invisible to a plain "is the text still there" check -- it only shows up as pendingRunKey surviving the round trip unflushed, which then lets "pending " silently merge with " more" into ONE run instead of staying two, since " more" shares the identical (plain) formatting key and appendText only flushes on a key CHANGE.
    const paragraph = paragraphsOf(
      `${HEADER}\\pard pending {\\object{\\result}} more\\par}`,
    )[0];
    const texts = paragraph?.runs.map((run) => run.text) ?? [];
    expect(texts).toEqual(["pending ", " more"]);
  });

  it("closes an open table before splicing \\result's own recovered blocks in, so a table inside \\result is not left dangling in tableRows", () => {
    const paragraphs = paragraphsOf(
      `${HEADER}\\pard{\\object\\objemb{\\*\\objdata 68656c6c6f}{\\result{\\trowd\\trleft0\\cellx1440\\pard\\intbl cell\\cell\\row\\pard done\\par}}}\\par}`,
    );
    const text = paragraphs
      .map((p) => p.runs.map((r) => r.text).join(""))
      .join("|");
    expect(text).toContain("done");
  });

  it("closes a table whose \\row is the very last thing in \\result's own content, with no \\par after it to trigger endParagraph's own closeTable call", () => {
    // \result's content ends on \row with para.inTable still true -- endParagraph(para, false)'s own internal closeTable() call is gated on `!para.inTable`, so it does NOT fire here (unlike the fixture above, where \result's content ends on an explicit \par OUTSIDE the table, and THAT closeTable call is what actually closes it, leaving endResultScratch's own trailing call redundant for that case). endResultScratch's own explicit closeTable() call is the only thing that can still turn tableRows into a real block here.
    const blocks = blocksOf(
      `${HEADER}\\pard{\\object\\objemb{\\*\\objdata 00}{\\result{\\trowd\\trleft0\\cellx1440\\pard\\intbl cell\\cell\\row}}}\\par}`,
    );
    expect(blocks.some((block) => block.kind === "table")).toBe(true);
  });
});

describe("section finalisation", () => {
  it("drops a genuinely empty trailing section rather than emitting a blank ContentSection after a real one", () => {
    // \sectd alone, with no \par and no text at all, leaves nothing pending -- finish()'s own trailing endSection() call reaches this section with blocks.length actually 0 (unlike an explicit \sect, which always force-closes at least an empty paragraph first).
    const sections = sectionsOf(
      `${HEADER}\\sectd\\pard First.\\par\\sect\\sectd}`,
    );
    expect(sections).toHaveLength(1);
    const text0 = sections[0]?.blocks
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
      .join("");
    expect(text0).toBe("First.");
  });

  it("keeps the document's only section even when it has no blocks at all, rather than producing zero sections", () => {
    const { document } = readRtfContent(bytes(`${HEADER}}`));
    if (document.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    expect(document.sections).toHaveLength(1);
    expect(document.sections[0]?.blocks).toEqual([]);
  });

  it("still pushes the document's only section through endSection itself when it is genuinely empty, not finish()'s own generic fallback -- observable via breakType surviving", () => {
    // The "sections.length > 0" half of endSection's own drop condition matters specifically because it is FALSE for this, the very first section -- so an empty-but-first section is still pushed HERE, with its own real geometry and breakType, rather than silently skipped and left for finish()'s own fallback (which pushes only bare geometry and blocks: [], no breakType field at all) to paper over. A ">= 0" in place of "> 0" is always true regardless of section count, so it would wrongly skip this push too, and the sole difference an all-empty document can reveal is exactly the breakType finish()'s own fallback never carries.
    const { document } = readRtfContent(bytes(`${HEADER}\\sectd\\sbknone}`));
    if (document.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    expect(document.sections).toHaveLength(1);
    expect(document.sections[0]?.breakType).toBe("continuous");
  });

  it("carries a stated \\sbk* break type onto the section that is ENDING, not silently dropping it when the type is a real, non-default one", () => {
    const sections = sectionsOf(
      `${HEADER}\\sectd\\sbkeven\\pard A\\par\\sect\\sectd\\pard B\\par}`,
    );
    expect(sections[0]?.breakType).toBe("evenPage");
  });

  it("omits the breakType key entirely from a section that stated no \\sbk* of its own, rather than an explicit key holding undefined", () => {
    // A plain toEqual (or any check that only reads section.breakType) cannot tell "the key is absent" apart from "the key is present with value undefined" -- both compare equal. Object.hasOwn is what actually distinguishes an unconditionally-spread { breakType: section.breakType } (present, undefined) from the real conditional spread this line performs.
    const sections = sectionsOf(`${HEADER}\\pard x\\par}`);
    expect(sections[0]).toBeDefined();
    expect(Object.hasOwn(sections[0] ?? {}, "breakType")).toBe(false);
  });

  it("reports the exact unpaired-bookmark-at-end-of-block-flow message text", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard{\\*\\bkmkstart lonely}text\\par}`),
    );
    const found = diagnostics.find(
      (diagnostic) => diagnostic.code === RtfDiagnosticCodes.BOOKMARK_UNPAIRED,
    );
    expect(found?.message).toBe(
      "the bookmark 'lonely' has no matching \\bkmkend within its own block flow, so no anchor construct is produced for it",
    );
  });

  it("actually clears the open-bookmark set at the end of a section's block flow, so it does not leak an unpaired report into the next section too", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\sectd\\pard{\\*\\bkmkstart leftover}A\\par\\sect\\sectd\\pard B\\par}`,
      ),
    );
    expect(
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.BOOKMARK_UNPAIRED,
      ),
    ).toHaveLength(1);
  });
});

describe("run field derivation", () => {
  it("treats an empty resolved font name the same as no font at all: no fontFamily field", () => {
    const source =
      "{\\rtf1\\ansi\\ansicpg1252\\deff0" +
      "{\\fonttbl{\\f0 ;}}{\\colortbl;}" +
      "\\pard\\f0 x\\par}";
    const runs = paragraphsOf(source)[0]?.runs ?? [];
    expect(runs[0]?.fontFamily).toBeUndefined();
  });
});

describe("picture derivation", () => {
  it("reports the exact metafile-format-declared message text, naming the specific unsupported control word", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\pict\\wmetafile8\\picwgoal1440\\pichgoal1440 ab}\\par}`,
      ),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
    );
    expect(found?.message).toBe(
      "a \\pict destination declared \\wmetafile picture format; this reader recognises only \\pngblip and \\jpegblip, so this picture is dropped",
    );
  });

  it('names "no" picture format in the diagnostic when the destination named no format control word at all', () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard{\\pict\\picwgoal1440\\pichgoal1440 ab}\\par}`),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
    );
    expect(found?.message).toContain("declared no picture format");
  });

  it("reads binary picture payload (\\binN) in preference to any leftover hex text", () => {
    const PNG_HEX =
      "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
      "01f15c4890000000a49444154789c6300010000050001" +
      "0d0a2db40000000049454e44ae426082";
    const raw = hexToBytes(PNG_HEX);
    const image = blocksOf(
      `${HEADER}\\pard{\\pict\\pngblip\\picwgoal720\\pichgoal720\\bin${String(raw.length)} ${text(raw)}}\\par}`,
    ).find((block): block is ContentImageBlock => block.kind === "image");
    expect(image?.base64.startsWith("iVBORw0KGgo")).toBe(true);
  });

  it("reports the exact no-payload message text for a \\pict destination with neither hex nor binary content", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\pict\\pngblip\\picwgoal720\\pichgoal720 }\\par}`,
      ),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
    );
    expect(found?.message).toBe(
      "a \\pict destination carried no picture payload",
    );
  });

  it("reports the exact no-size-stated message text", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard{\\pict\\pngblip 00}\\par}`),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.PICTURE_SIZE_UNSTATED,
    );
    expect(found?.message).toContain(
      "stated neither \\picwgoalN/\\pichgoalN nor \\picwN/\\pichN",
    );
  });

  it("drops a picture whose scaled size collapses to zero or less and reports the exact message text", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\pict\\pngblip\\picwgoal1440\\pichgoal1440\\picscalex0\\picscaley100 00}\\par}`,
      ),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.PICTURE_SIZE_UNSTATED,
    );
    expect(found?.message).toBe(
      "a \\pict destination's stated size scaled to zero or less, which ContentImageBlock cannot express",
    );
  });

  it("drops a picture whose height alone collapses to zero, even though its width is still positive", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\pict\\pngblip\\picwgoal1440\\pichgoal1440\\picscalex100\\picscaley0 00}\\par}`,
      ),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.PICTURE_SIZE_UNSTATED,
      ),
    ).toBe(true);
  });
});

describe("embedded object size hints", () => {
  it("states both \\objw and \\objh in the degrade diagnostic when both are present", () => {
    // The size-hint clause rides buildEmbeddedObject's OWN no-payload/undecodable messages, not the enclosing \object group's "no \objdata at all" message -- so a real (if empty) \objdata destination is what actually exercises it.
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb\\objw40\\objh20{\\*\\objdata }}\\par}`,
      ),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
    );
    expect(found?.message).toContain("2.00pt x 1.00pt");
  });

  it("states only \\objw in the degrade diagnostic when \\objh is absent", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard{\\object\\objemb\\objw40{\\*\\objdata }}\\par}`),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
    );
    expect(found?.message).toContain("declared a 2.00pt width");
    expect(found?.message).not.toContain("height");
  });

  it("states only \\objh in the degrade diagnostic when \\objw is absent", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard{\\object\\objemb\\objh20{\\*\\objdata }}\\par}`),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
    );
    expect(found?.message).toContain("declared a 1.00pt height");
  });

  it("adds no size-hint clause at all when an \\object states neither \\objw nor \\objh", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard{\\object\\objemb{\\*\\objdata }}\\par}`),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
    );
    expect(found?.message).toBe(
      "an \\object destination's \\objdata carried no payload",
    );
  });

  it("reports the exact no-payload message for an \\objdata destination with no content at all", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard{\\object\\objemb{\\*\\objdata }}\\par}`),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
    );
    expect(found?.message).toContain("carried no payload");
  });

  it("reports the exact undecodable-payload message for \\objdata this reader cannot parse", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard{\\object\\objemb{\\*\\objdata 68656c6c6f}}\\par}`),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
    );
    expect(found?.message).toContain("is not a payload this reader produced");
  });
});

describe("resource limits", () => {
  it("accepts input exactly at maxInputBytes, and rejects one byte more", () => {
    const source = `${HEADER}\\pard x\\par}`;
    const exact = bytes(source);
    expect(() =>
      readRtfContent(exact, { maxInputBytes: exact.length }),
    ).not.toThrow();
    expect(() =>
      readRtfContent(exact, { maxInputBytes: exact.length - 1 }),
    ).toThrow(RtfInputTooLargeError);
  });

  it("accepts nesting exactly at maxGroupDepth, and rejects one level deeper", () => {
    // The root group already occupies stack slot 1, so a document whose deepest group nests N levels needs maxGroupDepth to be at least N + 1.
    const nested = `${HEADER}${"{".repeat(3)}x${"}".repeat(3)}\\par}`;
    expect(() =>
      readRtfContent(bytes(nested), { maxGroupDepth: 5 }),
    ).not.toThrow();
    expect(() => readRtfContent(bytes(nested), { maxGroupDepth: 4 })).toThrow(
      RtfNestingLimitExceededError,
    );
  });
});

describe("group-open dispatch", () => {
  it("never initialises picture state for a plain nested group with no \\pict destination of its own", () => {
    // If every group open unconditionally began collecting picture state, an ordinary formatting group's own close would spuriously run buildPicture against an empty PictureState and report UNSUPPORTED_PICTURE_FORMAT for content that was never a picture at all.
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard{\\b bold} plain\\par}`),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
      ),
    ).toBe(false);
  });

  it("never initialises picture state for a RECOGNISED destination other than picture, either", () => {
    // \b above has no recognised destination of its own at all (known === undefined), so it never reaches the `if (known !== undefined) { ... if (kind === "picture") ... }` branch this guards -- it exercises a DIFFERENT, earlier guard entirely. \*\bkmkstart IS a known, non-picture destination, so this is the one fixture that actually reaches the kind === "picture" check itself: a `true` in its place would still spuriously initialise picture state here too.
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\*\\bkmkstart name}plain{\\*\\bkmkend name}\\par}`,
      ),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
      ),
    ).toBe(false);
  });

  it("never initialises embedded-object state for a plain nested group with no \\*\\objdata destination of its own", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard{\\b bold} plain\\par}`),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
      ),
    ).toBe(false);
  });

  it("never initialises embedded-object state for a RECOGNISED destination other than objectData, either", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\*\\bkmkstart name}plain{\\*\\bkmkend name}\\par}`,
      ),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
      ),
    ).toBe(false);
  });

  it("never routes a nested destination's own hex escape into the enclosing \\pict's own binary payload", () => {
    // \*\bkmkstart is a real, known destination -- a child group nested inside \pict -- so state.picture is inherited by reference (unlike destination, which the child correctly switches to "bookmarkStart"). A guard keyed on destination alone, forced true, would misroute the hex escape into the picture's own binary buffer instead of the bookmark's name.
    const PNG_HEX =
      "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
      "01f15c4890000000a49444154789c6300010000050001" +
      "0d0a2db40000000049454e44ae426082";
    const paragraph = paragraphsOf(
      `${HEADER}\\pard{\\pict\\pngblip\\picwgoal720\\pichgoal720{\\*\\bkmkstart\\'41}${PNG_HEX}}{\\*\\bkmkend\\'41}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      name: "A",
    });
  });

  it("never treats a plain nested group as a bookmark, so its own text is not swallowed as a bookmark name", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard before{\\b bold} after\\par}`)[0]?.runs ??
      [];
    expect(runs.map((run) => run.text).join("")).toContain("bold");
  });

  it("skips a header table's own second occurrence rather than re-reading it as body content", () => {
    // {\fonttbl ...} is already consumed by readRtfHeader; a SECOND, malformed occurrence later in the body must still be recognised as a header destination and skipped whole, not fall through to an unknown-destination diagnostic or leak its own text into the document.
    const { document, diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard{\\fonttbl{\\f9 Bogus;}}kept\\par}`),
    );
    const text0 =
      document.kind === "wordprocessing"
        ? document.sections[0]?.blocks
            .filter(
              (block): block is ContentParagraph => block.kind === "paragraph",
            )
            .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
            .join("")
        : undefined;
    expect(text0).toBe("kept");
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.UNKNOWN_DESTINATION_SKIPPED,
      ),
    ).toBe(false);
  });

  it("reads the \\*\\ud half of a \\upr wrapper and discards the ANSI half beside it", () => {
    const runs =
      paragraphsOf(
        `${HEADER}\\pard {\\upr ansi-fallback{\\*\\ud unicode-real}}\\par}`,
      )[0]?.runs ?? [];
    const text0 = runs.map((run) => run.text).join("");
    expect(text0).toContain("unicode-real");
    expect(text0).not.toContain("ansi-fallback");
  });

  it("discards every plain group nested inside a \\upr wrapper's own ANSI half, not only its direct text", () => {
    const runs =
      paragraphsOf(
        `${HEADER}\\pard {\\upr {\\b ansi in a group}{\\*\\ud kept}}\\par}`,
      )[0]?.runs ?? [];
    const text0 = runs.map((run) => run.text).join("");
    expect(text0).toBe("kept");
  });

  it("discards a second, duplicate \\result child and reports it", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb{\\result{\\pard\\plain first\\par}}{\\result{\\pard\\plain second\\par}}}\\par}`,
      ),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE &&
          diagnostic.message.includes("more than one \\result"),
      ),
    ).toBe(true);
  });

  it("discards a second, duplicate \\objdata child and decodes only the first", () => {
    const OBJDATA_HEX_LOCAL = bytesToHex(
      writeEmbeddedObjectData({
        objectKind: "spreadsheet",
        document: { kind: "spreadsheet", metadata: {}, sheets: [] },
        frame: { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
      }),
    );
    const { document, diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb{\\*\\objdata ${OBJDATA_HEX_LOCAL}}{\\*\\objdata ${OBJDATA_HEX_LOCAL}}}\\par}`,
      ),
    );
    const objects =
      document.kind === "wordprocessing"
        ? document.sections[0]?.blocks.filter(
            (block) => block.kind === "embeddedObject",
          )
        : undefined;
    expect(objects).toHaveLength(1);
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE &&
          diagnostic.message.includes("more than one \\objdata"),
      ),
    ).toBe(true);
  });
});

describe("unbalanced groups", () => {
  it("reports the exact still-open-at-end-of-input message, counting every group left open (the document's own root included)", () => {
    // HEADER's own root {\rtf1 ... group is never closed by either fixture below -- neither ends with the document's own final "}" -- so the count always includes it alongside whatever else was left open.
    const { diagnostics } = readRtfContent(bytes(`${HEADER}\\pard{\\b text`));
    const found = diagnostics.find(
      (diagnostic) => diagnostic.code === RtfDiagnosticCodes.UNBALANCED_GROUP,
    );
    expect(found?.message).toBe(
      "2 group(s) were still open at the end of the input; each is treated as closing there",
    );
  });

  it("still flushes and keeps trailing ANSI text that reached input's end with no closing brace or other event to flush it itself", () => {
    // "text" here is the very last thing the tokenizer produced: nothing after it (no control word, no brace, no hex byte) ever triggers flushBytes on its own, so only the main loop's own unconditional trailing flushBytes() call -- reached once the token stream itself is exhausted -- moves it out of the pending-bytes buffer and into a run finish() can still build a paragraph from. Without that call, "text" is silently dropped: emitText/appendText never runs for it, runs stays empty, and endParagraph's own force=false early return then produces no paragraph at all instead of one holding this trailing text.
    const paragraph = paragraphsOf(`${HEADER}\\pard{\\b text`).at(-1);
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe("text");
  });

  it("counts every still-open group at the end of input, not one fewer or one more", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard{\\b{\\i text`),
    );
    const found = diagnostics.find(
      (diagnostic) => diagnostic.code === RtfDiagnosticCodes.UNBALANCED_GROUP,
    );
    expect(found?.message).toBe(
      "3 group(s) were still open at the end of the input; each is treated as closing there",
    );
  });

  it("reports the exact extra-closing-brace message text", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\pard text\\par}}`),
    );
    const found = diagnostics.find(
      (diagnostic) => diagnostic.code === RtfDiagnosticCodes.UNBALANCED_GROUP,
    );
    expect(found?.message).toBe(
      "a closing brace appeared with no group open; the extra brace is ignored",
    );
  });
});

describe("\\uN surrogate arithmetic", () => {
  it("converts a negative \\uN parameter into its true code point by adding 65536, not subtracting it", () => {
    // A code point above 32767 is written as its own negative twin ("convert F020 to decimal (61472) and subtract 65536" gives -4064), so reading it back requires the inverse: -4064 + 65536 = 61472 = U+F020, a Private Use Area character.
    const runs =
      paragraphsOf(`${HEADER}\\pard \\u-4064 x\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.text.codePointAt(0)).toBe(0xf020);
  });
});

describe("picture format control words", () => {
  for (const [word, control] of [
    ["emfblip", "\\emfblip"],
    ["macpict", "\\macpict"],
    ["wmetafile", "\\wmetafile"],
    ["pmmetafile", "\\pmmetafile"],
    ["dibitmap", "\\dibitmap"],
    ["wbitmap", "\\wbitmap"],
  ] as const) {
    it(`names \\${word} itself, not a different metafile control word, in the unsupported-format diagnostic`, () => {
      const { diagnostics } = readRtfContent(
        bytes(
          `${HEADER}\\pard{\\pict\\${word}\\picwgoal1440\\pichgoal1440 ab}\\par}`,
        ),
      );
      const found = diagnostics.find(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
      );
      expect(found?.message).toContain(`declared ${control} picture format`);
    });
  }

  it("ignores an unrecognised picture control word rather than treating it as a format or size", () => {
    const image = blocksOf(
      `${HEADER}\\pard{\\pict\\pngblip\\picwgoal720\\pichgoal720\\picbogus5 00}\\par}`,
    ).find((block): block is ContentImageBlock => block.kind === "image");
    // Reaching a real image at all (not a dropped one, and not a thrown error) proves the unknown word fell through to the picture dispatcher's own default no-op rather than corrupting an existing field.
    expect(image?.format).toBe("png");
  });
});

describe("character control word edge cases", () => {
  it("ignores a negative \\ucN, keeping the previously stated skip count rather than adopting a negative one", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\uc2\\uc-1\\u9731 XY\\par}`)[0]?.runs ??
      [];
    // \uc-1 must not overwrite the still-valid \uc2 from just before it, so 霱's own fallback still skips exactly 2 characters ("XY"), leaving nothing of the fallback in the visible text.
    expect(runs.map((run) => run.text).join("")).not.toMatch(/[XY]/);
  });

  it("reads \\up with no parameter as the default six-half-point raise, not a no-op", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\up raised\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.verticalAlign).toBe("superscript");
  });

  it("reads a negative \\upN as lowering the text instead of raising it", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\up-3 lowered\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.verticalAlign).toBe("subscript");
  });

  it("reads an explicit positive \\upN as a genuine raise, not just the no-parameter default", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\up6 raised\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.verticalAlign).toBe("superscript");
  });

  it("reads exactly \\outlinelevel8, the spec's own upper bound, as a real heading level rather than clearing it", () => {
    const paragraph = paragraphsOf(`${HEADER}\\pard\\outlinelevel8 x\\par}`)[0];
    expect(paragraph?.headingLevel).toBe(9);
  });

  it("reads \\up0 as restoring the baseline, distinct from both a positive and a negative offset", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\up0 base\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.verticalAlign).toBeUndefined();
  });

  it("reads \\nosupersub as clearing verticalAlign to undefined, the field's own real absent state", () => {
    const runs =
      paragraphsOf(`${HEADER}\\pard \\super up\\nosupersub  base\\par}`)[0]
        ?.runs ?? [];
    expect(runs[1]?.verticalAlign).toBeUndefined();
  });

  it("reads \\revdttmdel onto the deleted-half of a run's own revision state", () => {
    const REVTBL = "{\\*\\revtbl{Unknown;}{A. Reviewer;}}";
    const DTTM = 30 | (9 << 6) | (1 << 11) | (1 << 16) | (124 << 20);
    const paragraph = paragraphsOf(
      `${HEADER}${REVTBL}\\pard \\deleted\\revauthdel1\\revdttmdel${String(DTTM)} gone\\deleted0  kept\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      change: "deletion",
      dateIso: "2024-01-01T09:30:00",
    });
  });

  it("reads \\mvdate onto a moved run's own dateIso", () => {
    const REVTBL = "{\\*\\revtbl{Unknown;}{A. Reviewer;}}";
    const DTTM = 30 | (9 << 6) | (1 << 11) | (1 << 16) | (124 << 20);
    const paragraph = paragraphsOf(
      `${HEADER}${REVTBL}\\pard \\mvf\\mvauth1\\mvdate${String(DTTM)} moved\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      dateIso: "2024-01-01T09:30:00",
    });
  });

  it("reads \\crdate onto a format-change run's own dateIso", () => {
    const REVTBL = "{\\*\\revtbl{Unknown;}{A. Reviewer;}}";
    const DTTM = 30 | (9 << 6) | (1 << 11) | (1 << 16) | (124 << 20);
    const paragraph = paragraphsOf(
      `${HEADER}${REVTBL}\\pard \\crauth1\\crdate${String(DTTM)}\\b restyled\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      dateIso: "2024-01-01T09:30:00",
    });
  });

  it("does not read \\ulc (underline colour) as a generic \\ul* underline variant", () => {
    // \ulc takes a colour-index parameter, not a toggle; treating it as an underline word would turn it on and misread its own parameter as a boolean toggle value.
    const runs = paragraphsOf(`${HEADER}\\pard \\ulc2 x\\par}`)[0]?.runs ?? [];
    expect(runs[0]?.underline).toBeUndefined();
  });
});

describe("paragraph control word edge cases", () => {
  it("reads \\outlinelevel9 (above the spec's own 0-8 range) as body text, clearing any level rather than adopting a tenth depth", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard\\outlinelevel0 zero\\par\\pard\\outlinelevel9 nine\\par}`,
    );
    expect(paragraph[0]?.headingLevel).toBe(1);
    expect(paragraph[1]?.headingLevel).toBeUndefined();
  });

  it("reads \\lin as the same left-indent field \\li writes", () => {
    const paragraph = paragraphsOf(`${HEADER}\\pard\\lin720 x\\par}`)[0];
    expect(paragraph?.indentLeftPt).toBe(36);
  });
});

describe("section control word edge cases", () => {
  it("resets section geometry back to the document's own defaults on \\sectd, not leaving a prior section's stated values", () => {
    const sections = sectionsOf(
      "{\\rtf1\\ansi\\paperw12240\\paperh15840\\margl1440\\margr1440\\margt1440\\margb1440" +
        "\\sectd\\pgwsxn15840\\pghsxn12240\\pard A\\par\\sect\\sectd\\pard B\\par}",
    );
    expect(sections[1]?.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
  });

  it("clears the pending break type when \\sbkcol arrives, so no page-level break is mistakenly kept alongside the reported column break", () => {
    const sections = sectionsOf(
      `${HEADER}\\sectd\\sbkpage\\sbkcol\\pard A\\par\\sect\\sectd\\pard B\\par}`,
    );
    expect(sections[0]?.breakType).toBeUndefined();
  });

  it("reports the exact \\sbkcol message text", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\sectd\\pard A\\par\\sect\\sectd\\sbkcol\\pard B\\par}`),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.SECTION_BREAK_UNREPRESENTED,
    );
    expect(found?.message).toBe(
      "\\sbkcol starts the section at a new column; ContentSection.breakType names page-level breaks only, so the break kind is dropped and the section itself is kept",
    );
  });
});

describe("structure control word edge cases", () => {
  it("reads \\trleft onto the row's own left edge, used as the first column boundary", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft720\\cellx1440\\pard\\intbl A\\cell\\row\\pard x\\par}`,
    );
    // 1440 - 720 = 720 twips = 36pt for the one column.
    expect(table.columnWidthsPt).toEqual([36]);
  });

  it("reports the exact nested-table-flattened message text for \\nestrow, distinct from \\nestcell's own trigger", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\trowd\\trleft0\\cellx1440\\pard\\intbl{\\*\\nesttableprops}\\nestrow x\\cell\\row\\pard y\\par}`,
      ),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.NESTED_TABLE_FLATTENED,
    );
    expect(found?.message).toBe(
      "a nested table's cell/row marks are read as ordinary cell content; the inner table's own structure is not reconstructed",
    );
  });
});

describe("control word dispatch order", () => {
  it("reads \\bkmkcolf/\\bkmkcoll inside a bookmark start, but never lets a stray \\par there actually close a paragraph", () => {
    // \par is a real structural word (builder.endParagraph), not merely a formatting flag, so a broken bookmarkStart guard that let it fall through would be directly observable as an extra paragraph -- unlike a stray \b, whose effect is confined to a group's own discarded char state either way.
    const paragraphs = paragraphsOf(
      `${HEADER}\\pard before{\\*\\bkmkstart\\par Named}after{\\*\\bkmkend Named}\\par}`,
    );
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs.map((run) => run.text).join("")).toBe(
      "beforeafter",
    );
    expect(paragraphs[0]?.constructs?.[0]?.descriptor).toMatchObject({
      name: "Named",
    });
  });

  it("never lets a stray \\par inside a \\*\\ffname destination actually close a paragraph", () => {
    // Mirrors the bookmarkStart/bookmarkEnd fixtures above: \*\ffname's own content is a name, not formatted text, so applyControlWord's own formField-family guard must discard \par here too, rather than letting it fall through to builder.endParagraph and split the surrounding text across two real paragraphs.
    const paragraphs = paragraphsOf(
      `${HEADER}\\pard before{\\field{\\*\\fldinst FORMTEXT }{\\*\\formfield{\\fftype0{\\*\\ffname\\par Name}}}}after\\par}`,
    );
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs.map((run) => run.text).join("")).toContain(
      "beforeafter",
    );
  });

  it("never lets a stray \\par inside a bookmark end destination actually close a paragraph", () => {
    const paragraphs = paragraphsOf(
      `${HEADER}\\pard before{\\*\\bkmkstart Word}mid{\\*\\bkmkend\\par Word}after\\par}`,
    );
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs.map((run) => run.text).join("")).toBe(
      "beforemidafter",
    );
    expect(paragraphs[0]?.constructs?.[0]?.descriptor).toMatchObject({
      name: "Word",
    });
  });

  it("reads a cell-definition word (\\clbrdrt) ahead of the identically-prefixed paragraph border reading, whenever a row definition is open", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clbrdrt\\brdrs\\brdrw15\\cellx1440\\pard\\intbl A\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.borders?.top).toBeDefined();
  });
});

describe("the tree-form entry point", () => {
  it("assembles the same content into a DocumentTree whose root is a wordprocessing package", () => {
    const { documentPackage } = readRtf(
      bytes(`${HEADER}\\pard\\s1 Heading\\par\\pard Body.\\par}`),
    );
    expect(documentPackage.kind).toBe("wordprocessing");
    expect(documentPackage.children.length).toBeGreaterThan(0);
  });
});
