import { describe, expect, it } from "vitest";
import type { ContentParagraph, ContentTable } from "document-schema.js";
import { RtfDiagnosticCodes } from "./diagnostics";
import { readRtfContent } from "./read";
import { HEADER, blocksOf, paragraphsOf } from "./test-support/read-fixtures";
import { bytes } from "./test-support/bytes";

// RTF 1.9.1, "Form Fields": a form field is an ordinary \field whose \*\fldinst names FORMTEXT/FORMCHECKBOX/FORMDROPDOWN, with a sibling \*\formfield destination carrying the control's own data (\fftypeN, \ffname, \ffres/\ffdefres, and a dropdown's \*\ffl entries). The fixtures below are trimmed from a real producer's own output (PHPRtfLite), braces and all, including the anonymous scoping group \*\formfield wraps its own control words in — this reader never needs to know that group is there, because an unrecognised first control word simply inherits the enclosing destination, the same mechanism an ordinary {\b bold} run-formatting group already relies on.
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

  // Pins the unchecked half of the pair the "reads a FORMCHECKBOX field..." test above already covers checked for, both against the identical PHPRtfLite \ffres25 fixture. \ffres25 is [MS-DOC] 2.9.79 FFDataBits's own reserved "undefined" sentinel for a checkbox's iRes, not a PHPRtfLite-specific constant — it falls through to \ffdefres (the field's reset default) exactly as the spec's "Undefined checkboxes are treated as unchecked" describes when the default itself says 0.
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

  // Real Word's own FFDataBits encoding, not PHPRtfLite's: a meaningful (non-sentinel) \ffres and a \ffdefres that genuinely differ from each other. \ffres is the field's own current state and must win over \ffdefres's reset default in both directions — these two fixtures pin that priority each way, since a precedence bug that merely swapped which control word wins (rather than handling the sentinel) would get one of the two backwards.
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

  // Regression guard: \ffres/\ffdefres are RTF 1.9.1's own generic "Value" control words (Appendix B), exactly like \ffprot, so a bare occurrence must default to 0 per the spec's own "Change Formatting Property" convention — not read as `undefined` and fall through to \ffdefres the way FORM_FIELD_RESULT_UNDEFINED's own sentinel handling does for a genuinely absent \ffres. A bare \ffres therefore means \ffres0, taking priority over \ffdefres1 exactly as an explicit \ffres0 already does above.
  it("reads a bare \\ffres (no explicit parameter) as \\ffres0, not as absent", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMCHECKBOX {\\*\\formfield{\\fftype1\\ffres\\ffdefres1}}}{\\fldrslt }}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toMatchObject({
      checked: false,
    });
  });

  // \ffdefres0 names "Hello" (index 0) as the field's own recorded default selection — the sentinel \ffres25 (see FORM_FIELD_RESULT_UNDEFINED in constructs.ts, and its own dropdown-branch comment) falls through to it exactly as a checkbox's sentinel \ffres falls through to \ffdefres, so `value` reads back "Hello" here even though the \fldrslt text shown ("Guten Tag") is a different entry — \fldrslt is merely the field's last-rendered display text, not authoritative over \ffres/\ffdefres for which entry is "selected" in FFDataBits terms.
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

  it("never routes a nested destination's own text into a \\*\\ffl entry, even one sharing state.field.formField by reference", () => {
    // \listtext nested directly inside the first \*\ffl group shares state.field.formField by reference (the same shape the bookmark and \*\fldinst fixtures elsewhere in this file exercise) but its own destination is "listText", not "formFieldListItem" — a check keyed on state.field.formField's own definedness alone would let "stray" leak into the entry ahead of "Hello" itself.
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMDROPDOWN  {\\*\\formfield{\\fftype2\\ffres0\\fftypetxt0\\ffhaslistbox\\ffdefres0{\\*\\ffl{\\listtext stray}Hello}{\\*\\ffl Guten Tag}}}}{\\fldrslt Hello}}\\par}`,
    )[0];
    const extent = paragraph?.constructs?.[0];
    expect(extent?.descriptor).toMatchObject({
      options: ["Hello", "Guten Tag"],
    });
  });

  // The same \ffres field FFDataBits gives a checkbox's own state carries, for iTypeDrop, a zero-based index into the \*\ffl list — a genuinely real Word fixture rather than PHPRtfLite's own always-25 constant: unlike the "reads a FORMDROPDOWN..." test above, whose \ffres25 sentinel falls through to \ffdefres0 for its "Hello" value, this fixture's own \ffres1 already names a real (non-sentinel) selection directly, with no fallback involved.
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

  // Regression guard, dropdown side of the identical bare-Value-word-defaults-to-0 fix as the checkbox's own "reads a bare \ffres..." test above: a bare \ffdefres names index 0 ("Hello"), not "no default recorded" — distinct from the "leaves...unset" fixture directly above, which has no \ffdefres control word at all rather than a bare one.
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

  it("ignores a stray \\par inside a \\*\\formfield destination rather than force-closing the surrounding paragraph", () => {
    // \*\formfield carries no #PCDATA or real block structure of its own (its content is entirely its own \fftypeN/\ffname/... control words), so a structure word like \par landing inside it — a malformed producer's mistake, not RTF's own grammar — must be silently ignored, exactly like the analogous bookmark/fieldInstruction guards elsewhere in this file. A destination check that matched only formFieldName/formFieldHelpText/formFieldListItem, and missed formField itself, would let this \par force-close the paragraph the whole field is sitting in in the middle of the destination's own control words, splitting one paragraph into two.
    const paragraphs = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMTEXT  {\\*\\formfield{\\fftype0\\par\\fftypetxt0{\\*\\ffname Text1}}}}{\\fldrslt Lorem ipsum.}}\\par}`,
    );
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      tag: "Text1",
    });
  });

  // Regression guard: an earlier round of this reader promoted \ffdeftext (FFData.xstzTextDef, the field's DEFAULT/reset text) onto the descriptor's `value`, which document-schema.js's own ContentControlDescriptor defines as the control's CURRENT value — for a text field, that current value is whatever text is actually wrapped in \fldrslt's own runs ("Lorem ipsum." here), never the default. `value` must stay unset even though a real \ffdeftext group is present, and the genuinely current text must still be readable from the wrapped runs, exactly as it is when no \ffdeftext exists at all (see "reads a FORMTEXT field's \*\ffname..." above).
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

  // The same guard with no wrapped-run content at all: `value` must still stay unset — \ffdeftext is never promoted to `value` unconditionally, not merely "unless the runs are non-empty".
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

  // Regression guard: \*\ffformat/\*\ffstattext/\*\ffentrymcr/\*\ffexitmcr are RTF's own remaining <formstrings> destination strings alongside \*\ffdeftext (RTF 1.5's own Form Fields table), which this reader already recognises and silently skips (SILENT_SKIP_DESTINATIONS in read.ts) for the identical reason — no ContentControlDescriptor field exists to carry a text field's input-format mask, status-line text, or entry/exit macro name. A fully-populated real-world text field naming all five siblings must produce no UNKNOWN_DESTINATION_SKIPPED diagnostic for any of them.
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

  // Regression guard: [MS-DOC] 2.9.79 FFDataBits itself states no default at all for fOwnHelp — it is a fixed-width bit always physically present in the binary structure, so "default" is not a meaningful concept there. The real justification is RTF's own separate Form Fields table, which classifies \ffownhelpN as a Value control word ("1 if there is associated help text, 0 otherwise") rather than a Toggle word, so an absent control word carries no "on" meaning to inherit and this reader's own FormFieldState simply starts at false. A \*\formfield group that never spells \ffownhelp at all must therefore default identically to an explicit \ffownhelp0 — an earlier version of this reader defaulted the absent-control-word case to true instead, which would have surfaced this same auto-generated-looking help text as an author-set alias purely because the producer happened to omit the bit rather than spell it out as 0.
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

  // \ffprotN is classified as a "Value" control word in RTF 1.9.1's own control-word-type table, not a "Toggle" word like \b/\i — a Value word's own bare (unparameterised) form defaults to 0, not to "on" the way a bare \b/\i would. This regression-guards against an earlier version of this reader applying the toggle convention uniformly to every bare boolean form-field control word, which read a bare \ffprot as protected; see formFieldValueBit's own comment in read.ts for the exact citations.
  it("reads a bare \\ffprot (no explicit parameter) as unprotected, since \\ffprot is a Value word whose bare form defaults to 0, not a Toggle word", () => {
    const paragraph = paragraphsOf(
      `${HEADER}\\pard {\\field{\\*\\fldinst FORMTEXT  {\\*\\formfield{\\fftype0\\fftypetxt0\\ffprot}}}{\\fldrslt Lorem ipsum.}}\\par}`,
    )[0];
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
    });
  });

  // \ffownhelp shares \ffprot's own Value-word classification but is deliberately read differently: LibreOffice's real RTF exporter (sw/source/filter/ww8/rtfattributeoutput.cxx) emits this bare form whenever the control model exposes a HelpText property at all, alongside that genuine, non-empty HelpText, so a bare \ffownhelp reads as true here rather than following the Value-word literal 0-default \ffprot's bare form still uses — see read.ts's own comment on applyFormFieldControlWord's "ffownhelp" case.
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

  // Regression guard against silently discarding real LibreOffice output rather than merely a synthetic minimal fixture: this exact byte sequence, checkbox included, is what LibreOffice's sw/source/filter/ww8/rtfattributeoutput.cxx actually emits for a checked FORMCHECKBOX carrying custom help text — \ffownhelp bare, immediately before a non-empty \*\ffhelptext.
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

  // Regression guard: \*\ffname/\*\ffhelptext/\*\ffl/\*\formfield itself carry a name, a help string, a list entry, or nothing but their own control words — never formatted document flow — so a stray \par/\page/\sect inside any of them must be swallowed exactly like the analogous stray word already is inside \*\bkmkstart/\*\bkmkend, not applied to the paragraph/section/document surrounding the field. Before this guard, a \par here split the surrounding paragraph in two and a \page injected a top-level pageBreak block that does not belong to the field at all.
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

  // Regression guard: a real Word-authored \field wraps its own \*\fldinst instruction text in an anonymous nested group (`{\*\fldinst {FORMTEXT }...}`), and that nested group inherits the enclosing "fieldInstruction" destination just like \*\fldinst itself does — so, before FieldState's own formFieldStarted guard existed, both the nested group's close and \*\fldinst's own close independently satisfied startFormField's condition, opening two extents for what is really one field while only the field's own single closing brace ever popped one back off. Five consecutive such fields exercise the guard across several fields in a row rather than just one, pinning that each field's own contentControl still lands on the correct run range with no duplication or cross-field mis-nesting.
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

  // Regression guard for the flip side of the nested-\*\fldinst-group guard above: formFieldControlType is anchored on a \b word boundary, and a field's instruction is read incrementally across however many "fieldInstruction"-destination groups it is split across (see startFormField's own call site comment on the nested-anonymous-group case). A group that closes with the instruction reading exactly "FORMTEXT" — nothing following it yet — satisfies \b via the end of the string read so far, opening the extent; if the SAME instruction later grows a further identifier character directly onto that word with no separating space or switch delimiter ("FORMTEXTBOX" here), \b no longer holds once the instruction is complete, and the field is correctly not a real form field after all. Before gating endFormField's own call on formFieldStarted rather than re-deriving the type a second time from the (by-then-different) complete instruction, this field's opened extent was never closed: it leaked as an unpopped entry on the shared open-form-fields stack instead of being reported and discarded, one push short of the pop every other field's own close still performed correctly around it.
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
    // \*\ud is a real, known destination in its own right ("body", not "fieldInstruction") — \*\fldinst's own text "FORMTEXT" matches before this nested group even opens, but a check keyed on state.field's own definedness and formFieldControlType alone, without also requiring THIS group's own destination to genuinely be "fieldInstruction", would open the extent right here, at \*\ud's own premature close, rather than waiting for \*\fldinst's own real close. Appending "EXTRA" directly afterward (still within \*\fldinst's own outer scope) breaks the word-boundary match RTF's own control-word anchoring requires ("FORMTEXTEXTRA" no longer names any recognised keyword), so the CORRECT outcome is silence — an ordinary, non-form field, never opened, never reported. Opening it early at \*\ud's own close instead forces formFieldStarted true before "EXTRA" is even read, so the field group's own later close reads the complete (now non-matching) instruction back, drops it, and reports FORM_FIELD_KEYWORD_LOST — a diagnostic this input must never produce, since correct code never opens the extent in the first place.
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

  // Unlike \*\ffname/\*\ffhelptext/\*\ffl above, \fldrslt genuinely carries the field's own displayed content, so a \par or \cell inside it must still split the document the way it would anywhere else — RTF 1.9.1's own <fieldrslt> production ('{' \fldrslt <para>+ '}') is grammatical for a multi-paragraph result even though real producers keep a form field inline. What this reader cannot do is keep the contentControl construct itself: a RunConstructExtent is scoped to one paragraph's own runs, so the construct is dropped, and endFormField reports why through the sink rather than disappearing silently.
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
    // \*\ffname is recognised (DESTINATION_KINDS maps it to "formFieldName") regardless of what encloses it, so a hostile or truncated producer's own stray occurrence outside \field reaches emitText with state.field inherited from the root — undefined, never set by anything else. Without its own field?.formField !== undefined guard, `state.field.formField.name += text` would throw rather than silently discard, exactly as the trailing comment on this whole if-chain says every other unhandled destination already does.
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
