import { describe, expect, it } from "vitest";
import { writeCompoundFile, writeOlePackage } from "archive-codec";
import type {
  ContentEmbeddedObjectBlock,
  ContentParagraph,
} from "document-schema.js";
import { RtfDiagnosticCodes } from "./diagnostics";
import { bytesToHex } from "./base64";
import { writeEmbeddedObjectData } from "./embedded-object";
import { readRtfContent } from "./read";
import {
  HEADER,
  blocksOf,
  firstTable,
  paragraphsOf,
} from "./test-support/read-fixtures";
import { asciiText, bytes } from "./test-support/bytes";

// Stands in for a hostile producer who writes the identical spec-conformant ObjectHeader/NativeDataSize/NativeData/Presentation envelope writeEmbeddedObjectData produces, but wraps an arbitrary JSON payload inside NativeData's own Package stream instead of a genuine ContentEmbeddedObject — writeEmbeddedObjectData itself always rebuilds its payload object field-by-field from a real ContentEmbeddedObject, so it cannot be used to smuggle an extra key the way a raw \objdata forged by hand can. Reuses a real envelope's own ObjectHeader and Presentation bytes verbatim (both fixed, independent of the JSON payload) and only replaces NativeData, so the forged bytes are byte-identical to a real \objdata this codec produced except for the one field under test.
function forgeEmbeddedObjectData(payload: unknown): Uint8Array<ArrayBuffer> {
  const base = writeEmbeddedObjectData({
    objectKind: "spreadsheet",
    document: { kind: "spreadsheet", metadata: {}, sheets: [] },
    frame: { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
  });
  const view = new DataView(base.buffer, base.byteOffset, base.byteLength);
  // OLEVersion(4) + FormatID(4) + ClassName "Package" (length-prefix 4 + 8 bytes) + TopicName "" (4) + ItemName "" (4) — see embedded-object.ts's own writeObjectHeader. Sanity-checked against the real FormatID this writer always emits, rather than assumed blind, so a future change to that layout fails loudly here instead of silently forging a bad envelope.
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

describe("embedded objects", () => {
  // A genuine [MS-CFB] compound file wrapping this package's own JSON envelope — built with the same writeEmbeddedObjectData the writer uses, so this describes the read state machine's own group/destination handling (\object -> {\*\objdata ...} -> hex -> compound file -> decode) independently of write.ts's own RTF emission around it.
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
    // Inserted at an even offset — a real byte boundary — so a reader that correctly discards the stray "g" decodes identically to the unmodified hex; a reader that instead treats it as a pairable nibble value corrupts every byte from this point on.
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
    // \result's own scratch rendering must not touch the paragraph "before " was already accumulating in when \object opened, nor the text "after" that continues once \object closes — both sit in the SAME paragraph as \object itself, with no \par between them, so a fix that only stops the fallback text from appearing (without checking these) would pass even if it deleted the paragraph's real content along with it.
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

  // RTF 1.9.1's own <result> = '{' \result <para>+ '}' lets the group's own closing brace stand in for the final paragraph's \par — a producer routinely omits it, exactly as a table cell's own \cell already stands in for one. A \result whose content never closes a block of its own (no \par anywhere inside it) must not be silently kept back once \objdata decodes: block-index retraction sees an empty range here and leaves the fallback text sitting in the shared run buffer, where it bleeds into whatever paragraph closes next.
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

  // \result's own destination group inherits inTable=true by cloning \object's own para when \object sits in a table cell, but a \pard inside \result's own content (RTF 1.9.1's own \pard resets every paragraph property, \intbl included) resets a DESCENDANT group's copy of that same field to false — and the paragraph it closes is filed under whichever of blocks/cellBlocks that descendant's own inTable says, not whatever \result's own outer group still (staled) says. Without \result's own scratch starting inTable at false regardless of \object's real placement, the write lands in `blocks` while endResultScratch reads back from `cellBlocks` (or vice versa), and the whole fallback is silently lost — this combination (\objdata failing to decode, inside a table cell, \result opening with its own \pard) was untested before this fix.
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

  // The mirror-image direction of the fix above: there, \result inherited inTable=true by cloning \object's own para and a descendant \pard reset its own copy back to false. Here \result's own group starts at inTable=false (that inherited case is already closed), but \result's own body restates \intbl directly on that SAME group's para before any nested group opens — RTF 1.9.1's own <result> grammar admits \intbl among <parfmt>* on \result's own para, so this is spec-legal input, not malformed. A nested {\pard\plain ...} child still clones that now-true value and still resets its OWN copy to false via \pard, so the finished paragraph is filed into `blocks` while \result's own group-end reads back a para whose inTable is still true — the opposite list from where content actually landed, silently losing it, and it is the divergence itself (not which side ends up true or false) that endResultScratch's own read must not depend on.
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

  // The identical \intbl-restated-directly-on-\result divergence, on the OTHER of the two EMBEDDED_OBJECT_UNREADABLE messages: an \object with no \objdata destination at all states its own diagnostic unconditionally ("its \result fallback content is used in its place", no hedge), unlike buildEmbeddedObject's own decode-failure message above. Before the fix, that unconditional wording was flatly false whenever this divergence lost the fallback silently — it is only accurate once the content is actually recovered.
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

  // RTF's own <obj> grammar allows only one \result child, but a malformed producer can still write two — the second sibling must not silently overwrite the first's own recovered content with no diagnostic, mirroring how a second \objdata sibling is already handled just below.
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

  // A real Word-authored \object's OLESaveToStream data (a genuine embedded .xls range, an Equation Editor formula, ...) has no JSON envelope inside its NativeData and so never decodes here — "hello" stands in for that: real bytes, wrong shape. This is exactly the case RTF 1.9.1's own advice for \result exists for — "This allows RTF readers that do not understand objects ... to use the current result, in place of the object, to maintain appearance" — so the fallback preview paragraph is what a real Word-shaped, undecodable \object should recover as, appended to the surrounding section rather than dropped.
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
    // No embeddedObject block — the real object never decoded — and \result's own recovered content survives as an ordinary paragraph, but not truly spliced into \object's own former position: addBlocks appends the fallback to the section's own block list without ending the paragraph still accumulating "before "/" after" around \object (no \pard/\par appears between them), so the fallback paragraph lands as its own block BEFORE that paragraph closes, and "before "/" after" end up as two runs of that one surrounding paragraph rather than split into separate blocks around the fallback — asserted here by exact block order/content, not merely by substring presence, since a substring check alone cannot tell "spliced in place" from "appended first".
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
    // The recovery must not leave the group stack unbalanced — reading \result as body content mid-object is a change to how deeply nested groups are interpreted, not to brace matching itself, so the reader must never report a brace fault for input that has none.
    expect(
      diagnostics.some(
        (diagnostic) => diagnostic.code === RtfDiagnosticCodes.UNBALANCED_GROUP,
      ),
    ).toBe(false);
  });

  // \result's own content builds into a totally isolated scratch accumulator that beginResultScratch swaps in place of the real one, restored only when \result's own group closes (endResultScratch). A truncated file can leave \result's group — and therefore every group around it — open at end of input with no closing brace at all, so endResultScratch never runs and the swap is never undone: finish() must not build the final document from that abandoned scratch state, or the real body accumulated before \object ever opened is silently replaced by whatever \result's own truncated content happened to hold, exactly backwards from \object's own real-content-over-fallback preference.
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

  // RTF 1.9.1's own <obj> grammar juxtaposes <objdata> and <result> with no '&' between them, so its own Formal Syntax legend ("AB" = "Item A followed by item B") states \objdata before \result as the required order — but the spec's own robustness clause ("RTF readers should be robust enough to handle some minor variations") means a real producer's <result>-before-\objdata ordering must still be tolerated, not rejected as malformed. A reader that decides \result's fate from whichever sibling it happens to read first would double-render (or silently drop) content depending on order alone.
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
    // Exactly one fallback rendering, not one per occurrence — \result was read (and, before this fix, would already have been committed) before \objdata's own failure was even known.
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

  it("keeps a bare inline \\result paragraph ahead of an inTable one nested inside it, in splice order", () => {
    // \result's own para starts inTable:false (a fresh reset at the group's own open, not inherited from wherever \object itself sits) — the nested {\pard\intbl second\par} group sets only ITS OWN cloned para true and closes into cellBlocks directly, reverting to \result's own untouched para once it closes, so "first" (accumulated afterward with no further \pard) closes via \result's own group-end using that same untouched inTable:false, into `blocks`. endResultScratch concatenates blocks before cellBlocks, so a correct reset here keeps "first" ahead of "second" in the spliced order regardless of which one actually closed first chronologically; a stuck inTable:true would instead route "first" into cellBlocks too, behind "second" there (since it closes later), reversing the pair.
    const { document } = readRtfContent(
      bytes(
        `${HEADER}\\pard{\\object\\objemb{\\result{\\pard\\intbl second\\par}first}}\\par}`,
      ),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing document, got ${document.kind}`,
      );
    }
    const texts = (document.sections[0]?.blocks ?? [])
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
      .filter((text) => text.length > 0);
    expect(texts).toEqual(["first", "second"]);
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

  // \objdata's own grammar is (\binN #BDATA) | #SDATA: every test above delivers #SDATA (plain hex-digit text), which is only one of the two legal wire forms. \binN's raw-byte-run form, and repeated \'hh escapes inside the destination (an alternative RTF affords anywhere, not only in #SDATA-shaped destinations), are the other two shapes buildEmbeddedObject's own byte extraction has to handle identically — covered here directly rather than only through hex text.
  it("reads \\objdata delivered as a \\binN raw-byte run rather than #SDATA hex text", () => {
    const raw = writeEmbeddedObjectData({
      objectKind: "spreadsheet",
      document: embedded,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
    });
    const object = blocksOf(
      `${HEADER}\\pard{\\object\\objemb{\\*\\objdata\\bin${String(raw.length)} ${asciiText(raw)}}}\\par}`,
    ).find(
      (block): block is ContentEmbeddedObjectBlock =>
        block.kind === "embeddedObject",
    );
    expect(object?.document).toEqual(embedded);
  });

  it("does not fold a \\binN token opened inside a bookmark nested in \\*\\objdata into the object's own byte buffer", () => {
    // \*\bkmkstart is a real, known destination that opens a genuine child group inside \*\objdata, inheriting state.objectData by reference exactly as the text/hex fixtures above prove — the \binN token sits INSIDE that bookmark's own group (not between its close and \*\bkmkend's open, which is still \*\objdata's own direct scope and proves nothing). A binary token routed by destination alone would splice the bookmark's own junk bytes into the front of the real payload and corrupt it.
    const raw = writeEmbeddedObjectData({
      objectKind: "spreadsheet",
      document: embedded,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
    });
    const object = blocksOf(
      `${HEADER}\\pard{\\object\\objemb{\\*\\objdata{\\*\\bkmkstart \\bin3 JJJ}{\\*\\bkmkend x}${bytesToHex(raw)}}}\\par}`,
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

  // \'hh is a generic RTF character escape valid anywhere in a destination's text, not only inside a destination shaped for it — so a single \objdata payload can legitimately deliver part of its data as plain #SDATA hex-digit text and the rest as scattered \'hh escapes. Collecting the two into separate buffers and keeping only whichever one turned out non-empty would silently discard whichever source came second; this proves both survive, in order.
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

  // RTF 1.9.1's own <objdata> production is '{\*' \objdata (<objalias>? & <objsect>?) <data> '}' — \objalias and \objsect are legal sub-groups nested directly inside \objdata's own braces, before its real payload. A reader that predicts \objdata's decode via a flat token scan (rather than the same group-aware walk the live read uses) folds those sub-groups' own bytes into the payload it scans, disagreeing with the live read about whether \objdata will decode at all — exactly the double-render bug this test guards against.
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
    // \objalias and \objsect are ordinary, spec-legal sub-productions of \objdata — recognised destinations, not unrecognised ones this reader happens to tolerate.
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

  // RTF 1.9.1's own <obj> production lists <objclsid> ('{\*' \oleclsid #PCDATA '}') as a direct, optional child of \object, right alongside <objalias>/<objsect>/<objtime> — ordinary, spec-legal \object content, not an unrecognised destination this reader happens to tolerate.
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

  // \object's own group can legally close having found neither an \objdata nor a \result child at all (a producer that wrote only the informational \objw/\objh size hint and nothing else) — a distinct, otherwise-silent construct substitution from either "objdata exists but fails to decode" (buildEmbeddedObject's own diagnostic) or "no objdata, but result recovers instead" (the sibling test above), and previously the only one of the three that produced no diagnostic at all.
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
