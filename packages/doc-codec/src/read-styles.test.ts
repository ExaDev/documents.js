import { describe, expect, it } from "vitest";
import { DocFormatError } from "./errors";
import { FIB_RG_LW_OFFSET, LW_OFFSET } from "./fib/offsets";
import { readDocContent, readDocStreams } from "./read";
import { compoundFile } from "./test-support/cfb";
import { buildDoc, buildInlinePictureBytes } from "./test-support/doc";
import {
  CELL_MARK,
  FIELD_BEGIN,
  FIELD_END,
  FIELD_SEPARATOR,
  FOOTNOTE_REFERENCE,
  INLINE_PICTURE,
  LINE_BREAK,
  SECTION_MARK,
} from "./text/special";
import {
  BOLD_ON,
  CENTRED,
  ITALIC_ON,
  SIZE_24PT,
  SPACE_BEFORE_12PT,
  paragraphAt,
  paragraphs,
  textOf,
} from "./test-support/read";

describe("readDocContent", () => {
  // Issue #1005: a style's own grLPUpxSw was read for identity only (name, kind, base) and never for its own formatting sets, so a "heading 1" paragraph carried its styleId but none of the boldness, size, or spacing the style itself supplies. These pin the fix — both the paragraph-level and run-level halves of a style's own formatting, the "more specific wins" precedence up an istdBase inheritance chain, and every layer's own precedence over the one beneath it.
  describe("resolves a style's own formatting (#1005)", () => {
    it("folds a paragraph style's own grpprlPapx into the paragraph, with no direct exception present", () => {
      const document = readDocContent(
        buildDoc({
          styles: [
            { name: "Normal" },
            { name: "heading 1", papxGrpprl: SPACE_BEFORE_12PT },
          ],
          paragraphs: [{ runs: [{ text: "Title" }], istd: 1 }],
        }),
      );
      expect(paragraphAt(document, 0).spacingBeforePt).toBe(12);
    });

    it("folds a paragraph style's own grpprlChpx into every run of the paragraph, with no direct run exception present", () => {
      const document = readDocContent(
        buildDoc({
          styles: [
            { name: "Normal" },
            { name: "heading 1", chpxGrpprl: [...BOLD_ON, ...SIZE_24PT] },
          ],
          paragraphs: [{ runs: [{ text: "Title" }], istd: 1 }],
        }),
      );
      const run = paragraphAt(document, 0).runs[0];
      expect(run?.bold).toBe(true);
      expect(run?.sizePt).toBe(24);
    });

    it("lets a paragraph's own direct PAPX exception override its style's grpprlPapx", () => {
      const document = readDocContent(
        buildDoc({
          styles: [
            { name: "Normal" },
            { name: "heading 1", papxGrpprl: SPACE_BEFORE_12PT },
          ],
          paragraphs: [{ runs: [{ text: "Title" }], istd: 1, grpprl: CENTRED }],
        }),
      );
      const paragraph = paragraphAt(document, 0);
      // The style's own spacing still applies — direct formatting overrides only the properties it actually touches, not the whole style.
      expect(paragraph.spacingBeforePt).toBe(12);
      expect(paragraph.alignment).toBe("center");
    });

    it("lets a run's own direct CHPX exception override its paragraph style's grpprlChpx", () => {
      const document = readDocContent(
        buildDoc({
          styles: [
            { name: "Normal" },
            { name: "heading 1", chpxGrpprl: [...BOLD_ON, ...SIZE_24PT] },
          ],
          paragraphs: [
            {
              istd: 1,
              runs: [{ text: "Title", grpprl: ITALIC_ON }],
            },
          ],
        }),
      );
      const run = paragraphAt(document, 0).runs[0];
      // The style's own bold and size still apply — the run's own exception only touches italic.
      expect(run?.bold).toBe(true);
      expect(run?.sizePt).toBe(24);
      expect(run?.italic).toBe(true);
    });

    it("resolves an istdBase inheritance chain with the more specific (derived) style's own property winning", () => {
      const document = readDocContent(
        buildDoc({
          styles: [
            { name: "Normal" },
            // heading 1: bold + 24pt, no base.
            { name: "heading 1", chpxGrpprl: [...BOLD_ON, ...SIZE_24PT] },
            // heading 2: based on heading 1, overrides only the size to 12pt (half-points 24) — bold must still come from the base, and 12pt (not 24pt) must win for size.
            {
              name: "heading 2",
              istdBase: 1,
              chpxGrpprl: [0x43, 0x4a, 0x18, 0x00],
            },
          ],
          paragraphs: [{ runs: [{ text: "Subtitle" }], istd: 2 }],
        }),
      );
      const run = paragraphAt(document, 0).runs[0];
      expect(run?.bold).toBe(true);
      expect(run?.sizePt).toBe(12);
    });

    it("folds a run's own referenced character style (sprmCIstd) between the paragraph style and the run's own direct exception", () => {
      const CHARACTER_STYLE_ISTD = [0x30, 0x4a, 0x02, 0x00]; // sprmCIstd, istd 2.
      const document = readDocContent(
        buildDoc({
          styles: [
            { name: "Normal" },
            { name: "heading 1", chpxGrpprl: [...BOLD_ON] },
            { name: "Strong", stk: 2, chpxGrpprl: [...SIZE_24PT] },
          ],
          paragraphs: [
            {
              istd: 1,
              runs: [
                {
                  text: "Title",
                  grpprl: [...CHARACTER_STYLE_ISTD, ...ITALIC_ON],
                },
              ],
            },
          ],
        }),
      );
      const run = paragraphAt(document, 0).runs[0];
      // heading 1's own bold, Strong's own size, and the run's own direct italic all survive together.
      expect(run?.bold).toBe(true);
      expect(run?.sizePt).toBe(24);
      expect(run?.italic).toBe(true);
    });

    it("resolves no formatting at all for a table- or numbering-kind style, without throwing", () => {
      // stk 3 (table) and 4 (numbering) carry StkTableGRLPUPX/StkListGRLPUPX, a differently-shaped formatting set parseGrLPUpxSw does not read — a paragraph naming one as its istd (an unusual document, but not a malformed one) must still read cleanly, with nothing folded in from the style.
      const document = readDocContent(
        buildDoc({
          styles: [{ name: "Normal" }, { name: "Table Grid", stk: 3 }],
          paragraphs: [{ runs: [{ text: "Cell text" }], istd: 1 }],
        }),
      );
      const paragraph = paragraphAt(document, 0);
      expect(paragraph.styleId).toBe("Table Grid");
      expect(paragraph.runs[0]?.bold).toBeUndefined();
    });

    it("throws when an istdBase chain loops back on itself, rather than recursing forever", () => {
      const document = buildDoc({
        styles: [
          { name: "Normal" },
          { name: "A", istdBase: 2 },
          { name: "B", istdBase: 1 },
        ],
        paragraphs: [{ runs: [{ text: "Text" }], istd: 1 }],
      });
      expect(() => readDocContent(document)).toThrow(DocFormatError);
      expect(() => readDocContent(document)).toThrow(/loops back/);
    });
  });

  // No sprmPFInTable is set on either paragraph here, so these cell marks sit outside any table — the case this asserts is a bare cell-mark character still ending a paragraph on its own account (endsParagraph's own rule), not table grouping, which table/read.test.ts covers directly.
  it("treats a cell mark outside a table as an ordinary paragraph end", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          { runs: [{ text: "cell one" }], mark: CELL_MARK },
          { runs: [{ text: "cell two" }], mark: CELL_MARK },
        ],
      }),
    );
    expect(paragraphs(document)).toHaveLength(2);
    expect(paragraphAt(document, 0).runs[0]?.text).toBe("cell one");
  });

  // sprmPHugePapx (0x6646), hand-encoded: a lone first Prl whose 4-byte operand is a Data-stream offset.
  const HUGE_PAPX_AT_0 = [0x46, 0x66, 0x00, 0x00, 0x00, 0x00];
  // A PrcData (cbGrpprl then GrpPrl) whose GrpPrl states sprmPDxaLeft 720 twips and sprmPDyaBefore 240 twips — 11 bytes of GrpPrl, at or past the 10-byte minimum [MS-DOC] 2.6.2's own sprmPHugePapx entry requires of a referenced PrcData.
  const indirectGrpPrl = [
    0x5e,
    0x84,
    0xd0,
    0x02, // sprmPDxaLeft, 720 twips (36pt).
    0x13,
    0xa4,
    0xf0,
    0x00, // sprmPDyaBefore, 240 twips (12pt).
    0x07,
    0x24,
    0x00, // sprmPFPageBreakBefore, false.
  ];
  const prcData = new Uint8Array([
    indirectGrpPrl.length & 0xff,
    indirectGrpPrl.length >> 8,
    ...indirectGrpPrl,
  ]);

  it("resolves a paragraph's properties through sprmPHugePapx's Data-stream PrcData, which replaces the rest of its grpprl", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          // The direct grpprl opens with sprmPHugePapx naming the PrcData at Data offset 0, then a sprmPJc the PrcData's own GrpPrl displaces — "it MUST NOT process any more Prl elements in the array that contained the sprmPHugePapx".
          {
            runs: [{ text: "indirect" }],
            grpprl: [...HUGE_PAPX_AT_0, 0x61, 0x24, 0x01],
          },
          { runs: [{ text: "direct" }] },
        ],
        data: prcData,
      }),
    );
    const indirect = paragraphAt(document, 0);
    expect(indirect.indentLeftPt).toBe(36);
    expect(indirect.spacingBeforePt).toBe(12);
    // The displaced trailing sprmPJc must not also apply.
    expect(indirect.alignment).toBeUndefined();
    expect(paragraphAt(document, 1).indentLeftPt).toBeUndefined();
  });

  it("throws on a sprmPHugePapx chain that never terminates, rather than looping", () => {
    const loopGrpPrl = [
      ...HUGE_PAPX_AT_0, // names the PrcData at offset 0 — this very one.
      0x07,
      0x24,
      0x00, // sprmPFPageBreakBefore, false, padding the GrpPrl past the 10-byte minimum.
    ];
    const looping = new Uint8Array([
      loopGrpPrl.length & 0xff,
      loopGrpPrl.length >> 8,
      ...loopGrpPrl,
    ]);
    expect(() =>
      readDocContent(
        buildDoc({
          paragraphs: [{ runs: [{ text: "loop" }], grpprl: HUGE_PAPX_AT_0 }],
          data: looping,
        }),
      ),
    ).toThrow(/did not terminate within 16 sprmPHugePapx hops/);
  });

  it("throws when a grpprl opens with sprmPHugePapx but the container carries no Data stream", () => {
    expect(() =>
      readDocContent(
        buildDoc({
          paragraphs: [{ runs: [{ text: "no data" }], grpprl: HUGE_PAPX_AT_0 }],
        }),
      ),
    ).toThrow(/this compound file carries no Data stream for it to point into/);
  });

  it("reads a run of sprmPFInTable paragraphs that never closes a row as paragraphs, not a refusal", () => {
    // The genuine Word 2000 shape: title-page paragraphs each carrying sprmPFInTable and sprmPItap, with no cell mark and no row mark anywhere — a run that states zero rows and therefore no table at all (see tryAssembleTable's own note).
    const inTable = [
      0x16,
      0x24,
      0x01, // sprmPFInTable, true.
      0x49,
      0x66,
      0x01,
      0x00,
      0x00,
      0x00, // sprmPItap, depth 1.
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          { runs: [{ text: "flagged one" }], grpprl: inTable },
          { runs: [{ text: "flagged two" }], grpprl: inTable },
          { runs: [{ text: "plain" }] },
        ],
      }),
    );
    expect(paragraphs(document)).toHaveLength(3);
    expect(textOf(paragraphAt(document, 0))).toBe("flagged one");
    expect(textOf(paragraphAt(document, 1))).toBe("flagged two");
    expect(textOf(paragraphAt(document, 2))).toBe("plain");
  });

  it("reads the same never-closes-a-row run as paragraphs even at the end of a non-last section, not a refusal", () => {
    // Only the true last section's own walk ever passes documentStreamEnds true to assembleBlocks — an earlier section ending in this identical unclosed run must still degrade to paragraphs (the wider document continues past it, in its own next section), not throw the "ends without a row-ending mark" refusal that firing here would mean documentStreamEnds leaked into a section that is not actually the document's last.
    const inTable = [
      0x16,
      0x24,
      0x01, // sprmPFInTable, true.
      0x49,
      0x66,
      0x01,
      0x00,
      0x00,
      0x00, // sprmPItap, depth 1.
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "flagged" }],
            grpprl: inTable,
            mark: SECTION_MARK,
          },
          { runs: [{ text: "second section" }] },
        ],
        sections: [[], []],
      }),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("a .doc always reads as a wordprocessing document");
    }
    expect(document.sections).toHaveLength(2);
    const firstSectionBlocks = document.sections[0]?.blocks ?? [];
    expect(firstSectionBlocks.map((block) => block.kind)).toEqual([
      "paragraph",
    ]);
    if (firstSectionBlocks[0]?.kind === "paragraph") {
      expect(textOf(firstSectionBlocks[0])).toBe("flagged");
    }
  });

  it("reads a document whose Plcfhdd carries Word 97's placeholder CPs (-1, and past the header document's own end) without refusing", () => {
    // Build a genuine well-formed header document first, then corrupt its Plcfhdd into the shape a real Word 97 file carries when a document has (mostly) no headers: separator-story keys replaced by -1 placeholders and one CP past ccpHdd. The per-section slots' own keys stay well formed, so the one real story must still come through.
    const original = buildDoc({
      paragraphs: [{ runs: [{ text: "main text" }] }],
      headerFooterStories: [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [{ runs: [{ text: "the odd header" }] }],
        [],
        [],
        [],
        [],
      ],
    });
    const streams = readDocStreams(original);
    const table = new Uint8Array(streams.table);
    const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
    const keyAt = (index: number): number =>
      view.getInt32(streams.fib.fcPlcfHdd + index * 4, true);
    // Sanity: the built file's keys are ascending and in range, so any normalisation below is genuinely exercised against the placeholder shape rather than a fixture that was already broken.
    const ccpHdd = streams.fib.ccpHdd;
    expect(keyAt(1)).toBeGreaterThanOrEqual(0);
    expect(keyAt(7)).toBeLessThanOrEqual(ccpHdd);
    view.setInt32(streams.fib.fcPlcfHdd + 2 * 4, -1, true);
    view.setInt32(streams.fib.fcPlcfHdd + 3 * 4, -1, true);
    view.setInt32(streams.fib.fcPlcfHdd + 4 * 4, ccpHdd + 99, true);
    const patched = compoundFile([
      { path: "WordDocument", bytes: new Uint8Array(streams.wordDocument) },
      { path: "1Table", bytes: table },
    ]);
    const document = readDocContent(patched);
    expect(document.headerFooterStories).toHaveLength(1);
    expect(document.headerFooterStories[0]?.slot).toBe("oddHeader");
    expect(
      document.headerFooterStories[0]?.blocks.map((block) =>
        block.kind === "paragraph"
          ? block.runs.map((run) => run.text).join("")
          : "",
      ),
    ).toEqual(["the odd header"]);
  });

  it("keeps a field's result and drops its instruction", () => {
    const instruction = `${String.fromCharCode(FIELD_BEGIN)} HYPERLINK "https://example.com" ${String.fromCharCode(FIELD_SEPARATOR)}`;
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [
              { text: "See " },
              { text: instruction },
              { text: "the site" },
              { text: String.fromCharCode(FIELD_END) },
              { text: " for more." },
            ],
          },
        ],
      }),
    );
    const text = textOf(paragraphAt(document, 0));
    expect(text).toBe("See the site for more.");
    expect(text).not.toContain("HYPERLINK");
  });

  // A nested field inside an OUTER field's RESULT is the case a depth counter gets wrong: when the inner field ends, the outer field is still past its own separator, so its remaining text is result text and must survive.
  it("resumes the enclosing field's result after a nested field closes inside it", () => {
    const begin = String.fromCharCode(FIELD_BEGIN);
    const separator = String.fromCharCode(FIELD_SEPARATOR);
    const end = String.fromCharCode(FIELD_END);
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [
              {
                text: `${begin} OUTER ${separator}before ${begin} INNER ${separator}inner${end} after${end}`,
              },
              { text: " tail." },
            ],
          },
        ],
      }),
    );
    expect(textOf(paragraphAt(document, 0))).toBe("before inner after tail.");
  });

  it("keeps a line break inside a paragraph as a newline rather than a control character", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          { runs: [{ text: `one${String.fromCharCode(LINE_BREAK)}two` }] },
        ],
      }),
    );
    const text = textOf(paragraphAt(document, 0));
    expect(text).toBe("one\ntwo");
  });

  it("emits no run for an empty paragraph rather than a run of empty text", () => {
    const document = readDocContent(
      buildDoc({ paragraphs: [{ runs: [{ text: "" }] }] }),
    );
    expect(paragraphAt(document, 0).runs).toEqual([]);
  });

  it("refuses a chain of exactly MAX_PAPX_INDIRECTION_HOPS redirects, one more than this reader permits before reaching a terminal PrcData", () => {
    const HOPS = 16; // MAX_PAPX_INDIRECTION_HOPS itself: 16 purely-redirecting blobs before the terminal one, one more redirect than the bound allows reading.
    const REDIRECT_LEN = 2 + 6; // cbGrpprl (2 bytes) + a 6-byte sprmPHugePapx-only grpprl.
    const terminalGrpprl = [0x5e, 0x84, 0xd0, 0x02]; // sprmPDxaLeft 720 twips, a real terminating exception.
    const data = new Uint8Array(
      HOPS * REDIRECT_LEN + 2 + terminalGrpprl.length,
    );
    const view = new DataView(data.buffer);
    for (let i = 0; i < HOPS; i += 1) {
      const thisOffset = i * REDIRECT_LEN;
      const nextOffset = (i + 1) * REDIRECT_LEN; // the last redirect's own target is the terminal blob, right after the final redirect.
      view.setUint16(thisOffset, 6, true); // cbGrpprl: 6 bytes (sprmPHugePapx opcode + 4-byte offset).
      view.setUint16(thisOffset + 2, 0x6646, true); // sprmPHugePapx opcode.
      view.setUint32(thisOffset + 4, nextOffset, true);
    }
    const terminalStart = HOPS * REDIRECT_LEN;
    view.setUint16(terminalStart, terminalGrpprl.length, true);
    data.set(terminalGrpprl, terminalStart + 2);
    expect(() =>
      readDocContent(
        buildDoc({
          paragraphs: [{ runs: [{ text: "x" }], grpprl: HUGE_PAPX_AT_0 }],
          data,
        }),
      ),
    ).toThrow(/did not terminate within 16 sprmPHugePapx hops/);
  });

  it("names 'a sprmPHugePapx-referenced PrcData's GrpPrl' when the PrcData's own declared length runs past the Data stream", () => {
    const tooShortData = new Uint8Array([200, 0]); // cbGrpprl = 200, but no GrpPrl bytes follow at all.
    expect(() =>
      readDocContent(
        buildDoc({
          paragraphs: [{ runs: [{ text: "x" }], grpprl: HUGE_PAPX_AT_0 }],
          data: tooShortData,
        }),
      ),
    ).toThrow(/a sprmPHugePapx-referenced PrcData's GrpPrl/);
  });

  it("keeps trailing text with no paragraph mark at all, locating its properties from its own first character", () => {
    const original = buildDoc({
      paragraphs: [
        { runs: [{ text: "first" }] },
        // Its own direct character formatting, not shared with "first" — a wrong (unsliced) fcs handed to buildRuns for this trailing text would resolve formatting from "first"'s own byte range instead, so this only passes when the trailing text's own bytes are genuinely what gets looked up.
        { runs: [{ text: "second", grpprl: BOLD_ON }] },
      ],
    });
    const streams = readDocStreams(original);
    const patched = new Uint8Array(streams.wordDocument);
    const view = new DataView(
      patched.buffer,
      patched.byteOffset,
      patched.byteLength,
    );
    const ccpTextOffset = FIB_RG_LW_OFFSET + LW_OFFSET.ccpText;
    const ccpText = view.getUint32(ccpTextOffset, true);
    // Excludes only the very last character (the second paragraph's own mark) from the readable range, leaving "second" as real trailing text with no mark of its own.
    view.setUint32(ccpTextOffset, ccpText - 1, true);
    const patchedDoc = compoundFile([
      { path: "WordDocument", bytes: patched },
      { path: "1Table", bytes: new Uint8Array(streams.table) },
    ]);
    const document = readDocContent(patchedDoc);
    expect(paragraphs(document)).toHaveLength(2);
    expect(textOf(paragraphAt(document, 0))).toBe("first");
    expect(textOf(paragraphAt(document, 1))).toBe("second");
    expect(paragraphAt(document, 0).runs[0]?.bold).toBeUndefined();
    expect(paragraphAt(document, 1).runs[0]?.bold).toBe(true);
  });

  describe("paragraph-level attributes absent by default", () => {
    it("carries none of alignment/spacing/indent/headingLevel/list/pageBreakBefore on a paragraph that states none of them", () => {
      const document = readDocContent(
        buildDoc({ paragraphs: [{ runs: [{ text: "plain" }] }] }),
      );
      const paragraph = paragraphAt(document, 0);
      for (const key of [
        "alignment",
        "spacingBeforePt",
        "spacingAfterPt",
        "lineSpacing",
        "indentLeftPt",
        "indentRightPt",
        "indentFirstLinePt",
        "headingLevel",
        "list",
        "pageBreakBefore",
        "styleId",
      ] as const) {
        expect(paragraph).not.toHaveProperty(key);
      }
    });
  });

  it("does not set styleId for a style whose own name is empty", () => {
    const document = readDocContent(
      buildDoc({
        styles: [{ name: "" }],
        paragraphs: [{ runs: [{ text: "x" }], istd: 0 }],
      }),
    );
    expect(paragraphAt(document, 0)).not.toHaveProperty("styleId");
  });

  describe("sprmPOutLvl's precedence against an istd-derived heading level", () => {
    it("derives headingLevel from sprmPOutLvl's own zero-based level when the paragraph carries no heading istd", () => {
      const outlineLevel3 = [0x40, 0x26, 3]; // sprmPOutLvl, level 3.
      const document = readDocContent(
        buildDoc({
          styles: [{ name: "Normal" }],
          paragraphs: [
            { runs: [{ text: "x" }], istd: 0, grpprl: outlineLevel3 },
          ],
        }),
      );
      expect(paragraphAt(document, 0).headingLevel).toBe(4);
    });

    it("keeps the istd-derived heading level, ignoring sprmPOutLvl entirely, when the paragraph's own istd already supplies one", () => {
      const outlineLevel5 = [0x40, 0x26, 5]; // sprmPOutLvl, level 5 — a different level than the style's own istd would derive.
      const document = readDocContent(
        buildDoc({
          styles: [{ name: "Normal" }, { name: "heading 1" }],
          paragraphs: [
            { runs: [{ text: "x" }], istd: 1, grpprl: outlineLevel5 },
          ],
        }),
      );
      expect(paragraphAt(document, 0).headingLevel).toBe(1);
    });
  });

  describe("HYPERLINK field matching's own whitespace tolerance", () => {
    function hyperlinkDocument(
      instruction: string,
    ): ReturnType<typeof readDocContent> {
      const begin = String.fromCharCode(FIELD_BEGIN);
      const separator = String.fromCharCode(FIELD_SEPARATOR);
      const end = String.fromCharCode(FIELD_END);
      return readDocContent(
        buildDoc({
          paragraphs: [
            {
              runs: [
                { text: `${begin}${instruction}${separator}the site${end}` },
              ],
            },
          ],
        }),
      );
    }

    it("tags the result at each whitespace boundary the regex still permits", () => {
      // No leading whitespace at all before HYPERLINK.
      expect(
        paragraphAt(hyperlinkDocument('HYPERLINK "https://a.example" '), 0)
          .runs[0]?.hyperlink,
      ).toBe("https://a.example");
      // Two spaces between HYPERLINK and the quoted URI, not exactly one.
      expect(
        paragraphAt(hyperlinkDocument(' HYPERLINK  "https://b.example" '), 0)
          .runs[0]?.hyperlink,
      ).toBe("https://b.example");
      // No trailing whitespace at all after the closing quote.
      expect(
        paragraphAt(hyperlinkDocument(' HYPERLINK "https://c.example"'), 0)
          .runs[0]?.hyperlink,
      ).toBe("https://c.example");
    });

    it("does not tag the result when HYPERLINK is not the instruction's own first word, or something follows the closing quote", () => {
      expect(
        paragraphAt(hyperlinkDocument(' NOTHYPERLINK "https://d.example" '), 0)
          .runs[0]?.hyperlink,
      ).toBeUndefined();
      expect(
        paragraphAt(
          hyperlinkDocument(' HYPERLINK "https://e.example" TRAILING'),
          0,
        ).runs[0]?.hyperlink,
      ).toBeUndefined();
    });
  });

  it("leaves state untouched for a FIELD_END with no matching FIELD_BEGIN before it", () => {
    const end = String.fromCharCode(FIELD_END);
    const document = readDocContent(
      buildDoc({
        paragraphs: [{ runs: [{ text: `${end}plain text` }] }],
      }),
    );
    expect(textOf(paragraphAt(document, 0))).toBe("plain text");
  });

  it("tags every one of a HYPERLINK field's own result runs, not only its first, and nothing outside the field", () => {
    const begin = String.fromCharCode(FIELD_BEGIN);
    const separator = String.fromCharCode(FIELD_SEPARATOR);
    const end = String.fromCharCode(FIELD_END);
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [
              { text: "prefix " },
              {
                text: `${begin} HYPERLINK "https://example.com" ${separator}plain`,
              },
              // A distinct exception from the result's first run, so the field's result is genuinely two runs rather than one — the case that distinguishes tagging every result run from tagging only resultStart itself.
              { text: "bold", grpprl: BOLD_ON },
              { text: end },
            ],
          },
        ],
      }),
    );
    const runs = paragraphAt(document, 0).runs;
    expect(runs.map((run) => run.text)).toEqual(["prefix ", "plain", "bold"]);
    expect(runs[0]?.hyperlink).toBeUndefined();
    expect(runs[1]?.hyperlink).toBe("https://example.com");
    expect(runs[2]?.hyperlink).toBe("https://example.com");
  });

  it("drops a footnote/annotation/drawn-object anchor character from the run text, never emitting it literally", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [
              { text: `before${String.fromCharCode(FOOTNOTE_REFERENCE)}after` },
            ],
          },
        ],
      }),
    );
    expect(textOf(paragraphAt(document, 0))).toBe("beforeafter");
  });

  it("splits a paragraph around an inline picture, resolving sprmCPicLocation even when it is not the run's own first Prl", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const dataOffset = 200;
    const { dataStreamBytes, picLocationGrpprl } = buildInlinePictureBytes(
      dataOffset,
      png,
      1000,
      1000,
    );
    // A benign, non-matching sprm placed BEFORE sprmCPicLocation in the picture run's own grpprl — proving the reader scans past it rather than only ever checking the first Prl.
    const pictureGrpprl = [...BOLD_ON, ...picLocationGrpprl];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [
              { text: "before " },
              {
                text: String.fromCharCode(INLINE_PICTURE),
                grpprl: pictureGrpprl,
              },
              // Its own direct character formatting, distinct from "before "'s (which carries none): a wrong (unsliced) fcs handed to buildRuns for this second segment would resolve formatting from the whole paragraph's byte 0 instead of this segment's own start, missing this exception entirely.
              { text: " after", grpprl: ITALIC_ON },
            ],
          },
        ],
        data: dataStreamBytes,
      }),
    );
    const blocks = paragraphs(document);
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "image",
      "paragraph",
    ]);
    if (blocks[0]?.kind === "paragraph") {
      expect(textOf(blocks[0])).toBe("before ");
      expect(blocks[0].runs[0]?.italic).toBeUndefined();
    }
    if (blocks[2]?.kind === "paragraph") {
      expect(textOf(blocks[2])).toBe(" after");
      expect(blocks[2].runs[0]?.italic).toBe(true);
    }
  });
});
