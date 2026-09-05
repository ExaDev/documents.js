import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentImageBlock,
  ContentParagraph,
  ContentSection,
  ContentTable,
} from "document-schema.js";
import { ContentDocumentSchema } from "document-schema.js";
import { RtfDiagnosticCodes, RtfNotAnRtfDocumentError } from "./diagnostics";
import { readRtf, readRtfContent } from "./read";
import { bytes } from "./test-support/bytes";

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

  // Regression guard: fOwnHelp's own spec-stated default is 0/false, so a \*\formfield group that never spells \ffownhelp at all must default identically to an explicit \ffownhelp0 -- an earlier version of this reader defaulted the absent-control-word case to true instead, which would have surfaced this same auto-generated-looking help text as an author-set alias purely because the producer happened to omit the bit rather than spell it out as 0.
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

  it("reads a bare \\ffprot (no explicit parameter) as protected, matching RTF's own toggle convention", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMTEXT  {\\*\\formfield{\\fftype0\\fftypetxt0\\ffprot}}}{\\fldrslt Lorem ipsum.}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      lock: "content",
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
    expect(table.rows[0]?.cells[0]?.background).toEqual({ r: 1, g: 0, b: 0 });
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
