import { describe, expect, it } from "vitest";
import { ContentDocumentSchema } from "document-schema.js";
import type { ContentParagraph } from "document-schema.js";
import {
  RtfDiagnosticCodes,
  RtfInputTooLargeError,
  RtfNestingLimitExceededError,
  RtfNotAnRtfDocumentError,
} from "./diagnostics";
import { readRtf, readRtfContent } from "./read";
import { HEADER, paragraphsOf, sectionsOf } from "./test-support/read-fixtures";
import { bytes } from "./test-support/bytes";

describe("document shape", () => {
  it("rejects input that does not open with the {\\rtfN the <File> production requires", () => {
    expect(() => readRtfContent(bytes("not rtf at all"))).toThrow(
      RtfNotAnRtfDocumentError,
    );
  });

  it("rejects a document whose very first token is not itself a group-opening brace, even when a later token happens to be a control word named rtf", () => {
    // No leading "{" at all: the first token is the \rtf control word itself, so its own kind is "controlWord", not "groupStart". A second \rtf1 immediately after makes the SECOND and THIRD conditions of assertRtfHeaderPresent's own OR chain both individually false on this input — the first condition (checking the very first token's kind) is the only one standing between this and being wrongly accepted as well-formed.
    expect(() => readRtfContent(bytes("\\rtf1\\rtf1"))).toThrow(
      RtfNotAnRtfDocumentError,
    );
  });

  it("rejects a properly braced document whose first control word names a destination other than rtf", () => {
    // The brace and the control-word shape are both correct here — only the control word's own NAME is wrong (\ansi, not \rtf) — so this is the one fixture that actually exercises assertRtfHeaderPresent's own third OR clause: the first two conditions are both false on this input, leaving the name check alone to reject it.
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

// RTF 1.9.1, "Section Text": <section> is `<secfmt>* <hdrftr>? <para>+ (\sect <section>)?` — a section's own formatting precedes its paragraphs and \sect ends it, so the properties in force when a \sect arrives are the ones belonging to the section that just closed.
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

  it("still produces an empty paragraph when \\sect arrives with nothing accumulated, exactly as \\par does", () => {
    // \sect closes its own paragraph with force=true (see applyStructureControlWord's own "sect" case), matching \par's own always-produce-a-paragraph convention rather than \page/\cell's implicit force=false boundary, which produces nothing when empty. \pard here opens a paragraph that accumulates no text at all before \sect.
    const sections = sectionsOf(
      `${HEADER}\\sectd\\pard\\sect\\sectd\\pard After.\\par}`,
    );
    expect(sections).toHaveLength(2);
    expect(sections[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [] } satisfies Partial<ContentParagraph>,
    ]);
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

describe("section finalisation", () => {
  it("drops a genuinely empty trailing section rather than emitting a blank ContentSection after a real one", () => {
    // \sectd alone, with no \par and no text at all, leaves nothing pending — finish()'s own trailing endSection() call reaches this section with blocks.length actually 0 (unlike an explicit \sect, which always force-closes at least an empty paragraph first).
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

  it("still pushes the document's only section through endSection itself when it is genuinely empty, not finish()'s own generic fallback — observable via breakType surviving", () => {
    // The "sections.length > 0" half of endSection's own drop condition matters specifically because it is FALSE for this, the very first section — so an empty-but-first section is still pushed HERE, with its own real geometry and breakType, rather than silently skipped and left for finish()'s own fallback (which pushes only bare geometry and blocks: [], no breakType field at all) to paper over. A ">= 0" in place of "> 0" is always true regardless of section count, so it would wrongly skip this push too, and the sole difference an all-empty document can reveal is exactly the breakType finish()'s own fallback never carries.
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
    // A plain toEqual (or any check that only reads section.breakType) cannot tell "the key is absent" apart from "the key is present with value undefined" — both compare equal. Object.hasOwn is what actually distinguishes an unconditionally-spread { breakType: section.breakType } (present, undefined) from the real conditional spread this line performs.
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

describe("the tree-form entry point", () => {
  it("assembles the same content into a DocumentTree whose root is a wordprocessing package", () => {
    const { documentPackage } = readRtf(
      bytes(`${HEADER}\\pard\\s1 Heading\\par\\pard Body.\\par}`),
    );
    expect(documentPackage.kind).toBe("wordprocessing");
    expect(documentPackage.children.length).toBeGreaterThan(0);
  });
});
