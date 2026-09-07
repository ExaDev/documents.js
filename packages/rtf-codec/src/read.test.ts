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
import { RtfDiagnosticCodes, RtfNotAnRtfDocumentError } from "./diagnostics";
import { bytesToHex } from "./base64";
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

  it("drops a footnote's body, which the flat ContentDocument has no definitions table to hold, and says so", () => {
    const source = `${HEADER}\\pard Body{\\super\\chftn}{\\footnote\\pard\\plain\\chftn The note.}.\\par}`;
    const runs = paragraphsOf(source)[0]?.runs ?? [];
    expect(runs.map((run) => run.text).join("")).toBe("Body.");
    expect(
      readRtfContent(bytes(source)).diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain(RtfDiagnosticCodes.CONTENT_DESTINATION_SKIPPED);
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
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      RtfDiagnosticCodes.BLOCK_CONSTRUCT_EXTENTS_CROSSED,
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
