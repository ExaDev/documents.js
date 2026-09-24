import { describe, expect, it } from "vitest";
import type { ContentImageBlock } from "document-schema.js";
import { RtfDiagnosticCodes } from "./diagnostics";
import { bytesToHex, hexToBytes } from "./base64";
import { writeEmbeddedObjectData } from "./embedded-object";
import { readRtfContent } from "./read";
import { HEADER, blocksOf, paragraphsOf } from "./test-support/read-fixtures";
import { asciiText, bytes } from "./test-support/bytes";

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

  it("reads a \\pngblip picture whose entire payload arrives as \\'hh escapes rather than plain hex text", () => {
    // Every other \pict fixture in this file states its payload as literal hex characters (a "text" token, state.picture.hex), never as \'hh escapes (a "hex" token, state.picture.binary) — buildPicture prefers binary over hex when both are populated, so a picture destination that only ever sees \'hh escapes exercises a path nothing else here reaches.
    const escaped =
      PNG_HEX.match(/.{2}/g)
        ?.map((pair) => `\\'${pair}`)
        .join("") ?? "";
    const image = blocksOf(
      `${HEADER}\\pard{\\pict\\pngblip\\picwgoal1440\\pichgoal720 ${escaped}}\\par}`,
    ).find((block): block is ContentImageBlock => block.kind === "image");
    expect(image?.format).toBe("png");
    expect(image?.base64.startsWith("iVBORw0KGgo")).toBe(true);
  });

  it("does not fold a \\binN token opened inside a bookmark nested in \\pict into the picture's own binary buffer", () => {
    // \*\bkmkstart opens a genuine child group inside \pict, inheriting state.picture by reference the same way a nested group in the ANSI-half or \*\objdata fixtures elsewhere in this file do — the \binN token sits INSIDE that bookmark's own group (not between its close and \*\bkmkend's open, which is still \pict's own direct scope and proves nothing). A binary token routed by destination alone would push the bookmark's own junk bytes into state.picture.binary, and buildPicture prefers ANY non-empty binary over the real, fully-formed hex payload sitting in state.picture.hex, so even three stray bytes there are enough to discard the real image entirely.
    const image = blocksOf(
      `${HEADER}\\pard{\\pict\\pngblip\\picwgoal1440\\pichgoal720{\\*\\bkmkstart \\bin3 JJJ}{\\*\\bkmkend x}${PNG_HEX}}\\par}`,
    ).find((block): block is ContentImageBlock => block.kind === "image");
    expect(image?.format).toBe("png");
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

  // `picture` is carried forward by reference across every descendant group inside {\pict ...} (a stray hex byte in a nested group must still reach the same PictureState the real \pict destination started), which means a plain nested group with no destination of its own — a malformed producer's stray "{}", not RTF's own <pict> grammar, which has no legitimate use for one — inherits destination "picture" too. Without an ownership marker analogous to objectDataOwner/objectOwner, that nested group's own closing brace re-fires buildPicture on the identical PictureState the outer \pict group will fire on again when IT closes, doubling the image.
  it("builds one image, not two, when a plain nested group closes inside \\pict after the payload", () => {
    const images = blocksOf(
      `${HEADER}\\pard{\\pict\\pngblip\\picwgoal720\\pichgoal720 ${PNG_HEX}{}}\\par}`,
    ).filter((block) => block.kind === "image");
    expect(images).toHaveLength(1);
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
      `${HEADER}\\pard{\\pict\\pngblip\\picwgoal720\\pichgoal720\\bin${String(raw.length)} ${asciiText(raw)}}\\par}`,
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
    // The size-hint clause rides buildEmbeddedObject's OWN no-payload/undecodable messages, not the enclosing \object group's "no \objdata at all" message — so a real (if empty) \objdata destination is what actually exercises it.
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

  it("does not let an unrelated \\object-scope word overwrite \\objh's own recorded height", () => {
    // \objcropl is a real \object-scope word carrying its own numeric parameter (a crop amount, RTF 1.9.1 "Objects"), not \objw — the only other name applyControlWord's own \object dispatch ever checks for. A dispatch that falls through to the \objh assignment for any name other than \objw, rather than genuinely matching "objh", would let this later, unrelated word silently overwrite the height \objh20 already recorded.
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb\\objh20\\objcropl999{\\*\\objdata }}\\par}`,
      ),
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
    // A successfully-decoded picture is the ordinary non-empty case addBlocks' own flushRun call exists for: without it, "before" would stay pending across the image insertion and silently merge with "after" into one run once the image block itself has already been spliced between them positionally — the two texts would still end up in the same final paragraph (addBlocks does not close the paragraph, only flushes and splices), so only the RUN boundary between them reveals a missing flush.
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
    // A failed-picture-decode addBlocks call (the fixture above) never even reaches addBlocks' own emptiness check: buildPicture returning undefined is guarded by its OWN `if (image !== undefined)` at the call site, so addBlocks is never called there at all. objectState.resultBlocks is the one real call site that can genuinely pass an empty array — an \object whose \result had no content of its own. \shppict (a "body"-kind destination, not a fresh \result scratch) types "blah" directly into the OUTER paragraph's own pendingRunText AFTER \result has already closed and restored state, so it is still genuinely pending — unflushed — at the exact moment \object's own close calls addBlocks(resultBlocks=[], ...). A guard-less addBlocks would flush it regardless of its own list being empty, splitting it from the identically-formatted text typed after \object closes.
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
    // \result here is genuinely EMPTY and \objdata is absent entirely, so nothing else along the way ever calls addBlocks with a non-empty list — not \objdata's own decode (there is none), not \object's own close splicing resultBlocks in (endResultScratch returns [] for an empty scratch, and addBlocks' own length===0 guard makes that call a no-op too). beginResultScratch's own flushRun call is therefore the ONLY thing that can push "pending " into a real run before \object's group closes. captureAccumulatorState/restoreAccumulatorState round-trip the raw pendingRunText/pendingRunKey either way, so a MISSING flushRun call is invisible to a plain "is the text still there" check — it only shows up as pendingRunKey surviving the round trip unflushed, which then lets "pending " silently merge with " more" into ONE run instead of staying two, since " more" shares the identical (plain) formatting key and appendText only flushes on a key CHANGE.
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
    // \result's content ends on \row with para.inTable still true — endParagraph(para, false)'s own internal closeTable() call is gated on `!para.inTable`, so it does NOT fire here (unlike the fixture above, where \result's content ends on an explicit \par OUTSIDE the table, and THAT closeTable call is what actually closes it, leaving endResultScratch's own trailing call redundant for that case). endResultScratch's own explicit closeTable() call is the only thing that can still turn tableRows into a real block here.
    const blocks = blocksOf(
      `${HEADER}\\pard{\\object\\objemb{\\*\\objdata 00}{\\result{\\trowd\\trleft0\\cellx1440\\pard\\intbl cell\\cell\\row}}}\\par}`,
    );
    expect(blocks.some((block) => block.kind === "table")).toBe(true);
  });
});
