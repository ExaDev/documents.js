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

describe("the tree-form entry point", () => {
  it("assembles the same content into a DocumentTree whose root is a wordprocessing package", () => {
    const { documentPackage } = readRtf(
      bytes(`${HEADER}\\pard\\s1 Heading\\par\\pard Body.\\par}`),
    );
    expect(documentPackage.kind).toBe("wordprocessing");
    expect(documentPackage.children.length).toBeGreaterThan(0);
  });
});
