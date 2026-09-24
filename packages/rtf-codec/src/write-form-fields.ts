// The legacy-form-field (\*\formfield) payload machinery, the run-scoped extent helpers writeParagraph in write-body.ts walks a paragraph's own constructs with, and the "why does this construct have no RTF spelling" diagnostic-message functions both write-body.ts and write.ts's own openConstruct reach for.
import {
  type AnchorDescriptor,
  type ConstructDescriptor,
  type ContentControlDescriptor,
  type ContentControlType,
  type ProvenanceChange,
  type ProvenanceDescriptor,
  type RunConstructExtent,
  type TableGridPosition,
  tableCellColumnSpan,
  tableCellRowSpan,
} from "document-schema.js";
import { isBookmarkAnchor } from "./constructs";
import { RtfDiagnosticCodes, type RtfDiagnosticSink } from "./diagnostics";
import { escapeText } from "./write-text";

export const FORM_FIELD_SPEC: ReadonlyMap<
  ContentControlType,
  { readonly instruction: string; readonly fftype: number }
> = new Map([
  ["plainText", { instruction: "FORMTEXT", fftype: 0 }],
  ["checkbox", { instruction: "FORMCHECKBOX", fftype: 1 }],
  ["dropDown", { instruction: "FORMDROPDOWN", fftype: 2 }],
]);

// [MS-DOC] 2.9.78 FFData.hsttbDropList, verbatim: "An optional STTB that specifies the entries in the dropdown list box. This MUST exist if and only if bits.iType is iTypeDrop (2). The entries are Unicode strings and do not have extra data. This MUST NOT exceed 25 elements." Not an arbitrary round number: FFDataBits' own iRes field reserves index 25 as its "undefined selection" sentinel (see FORM_FIELD_RESULT_UNDEFINED in constructs.ts), so a 26th real entry would sit exactly where a real Word/DOC consumer expects "no selection" instead of an actual option.
const MAX_DROPDOWN_OPTIONS = 25;

// The content of a `\*\formfield` group, emitted in a fixed, deterministic order this writer itself chooses — RTF 1.9.1's own "Form Fields" section gives a real Formal Syntax production for this destination, `<formfield> '{\*' \formfield '{' <formparams> <formstrings> '}}'`, plus productions for `<formparams>` and `<formstrings>` themselves: `<formparams> \fftypeN? \ffownhelpN? \ffownstatN? \ffprotN? \ffsizeN? \fftypetxtN? \ffrecalcN? \ffhaslistboxN? \ffhaslistboxN? \ffmaxlenN? \ffhpsN? \ffdefresN? \ffresN?` (sic — \ffhaslistboxN? is printed twice in the spec's own text) and `<formstrings> <ffname>? <ffdeftext>? <ffformat>? <ffhelptext>? <ffstattext>? <ffentrymcr>? <ffexitmcr>? <ffl>*`. Both ARE real RTF nonterminals the spec names, and both mandate a fixed order: the spec's own Formal Syntax section defines plain juxtaposition (`AB`) as "item A followed by item B", reserving `&` for "item A or item B, in any order" — and neither production uses `&` anywhere, unlike Fields' own `<fieldmod> \flddirty? & \fldedit? & \fldlock? & \fldpriv?` immediately alongside it, which does. `formparams`/`formstrings` are this codec's own names for the same two groupings the spec already splits the Form Fields table into, covering only the subset of each production's members this codec actually reads and writes — the numeric flag/index words (`\fftype`, `\ffownhelp`, `\ffprot`, `\ffhaslistbox`, `\ffdefres`/`\ffres`) from `<formparams>`, and the destination strings (`\ffname`, `\ffdeftext`, `\ffhelptext`, `\ffl`) from `<formstrings>`. The order used here — fftype, ffownhelp, ffprot, ffhaslistbox, ffdefres, ffres, then ffname, ffdeftext, ffhelptext, then the ffl entries — is a genuine subsequence of each production's own spec-mandated order, not an arbitrary house convention (LibreOffice's own exporter interleaving a `{\*\ffname ...}` destination ahead of its `\ffownhelp` flag departs from that mandated order, rather than demonstrating the spec leaves it free). Built as separate fragments — `ffOwnHelpFragment` and `ffProtFragment` computed first, ahead of the controlType-specific block, precisely because this writer's own chosen order places both of them before every field that block decides; `controlTypeParams` for that block itself (a checkbox/dropDown's ffdefres+ffres pair, a dropdown's own ffhaslistbox and ffl entries); one variable per string-destination member (a plainText's ffdeftext, the shared ffname) — and only concatenated into this writer's own stated sequence in the `return` below, once every fragment is known. This is a correction, not merely a description: an earlier version of this function built every formparams-shaped member into one running string via sequential `+=` calls in whatever order its own controlType branch happened to run, which put ffprot/ffownhelp (mutated only after that branch returned) after ffhaslistbox/ffdefres/ffres despite this same comment already claiming a fixed order — the fragment split here is what actually makes that claim true, verified against the raw emitted bytes in write.test.ts's own formfield-payload-order assertions.
export function formFieldPayload(
  descriptor: ContentControlDescriptor,
  fftype: number,
  sink: RtfDiagnosticSink,
): string {
  const fftypeFragment = `\\fftype${String(fftype)}`;
  let ffNameString = "";
  let ffDefTextString = "";
  let ffHelpTextString = "";
  let fflEntries = "";

  // [MS-DOC] 2.9.78 FFData.xstzHelpText, gated by FFDataBits.fOwnHelp ("A bit that specifies whether the form field has custom help text in FFData.xstzHelpText. If fOwnHelp is 0, FFData.xstzHelpText contains an empty or auto-generated string."): RTF 1.9.1's own \ffhelptext ("Help text (string). This is a destination control word.") is this vocabulary's one human-readable descriptive-text slot for a form field, and the closest analogue RTF has to docx `w:alias`/PDF AcroForm's `/TU` alternate description — both are a label shown to whoever is looking at the control, distinct from the control's own machine-readable name that \ffname/`w:tag`/AcroForm's `/T` already carry. \ffownhelp1 is minted alongside it, mirroring what a real producer does whenever xstzHelpText genuinely carries author-set text rather than an "empty or auto-generated string"; the help text itself is a string-destination member and so goes into `ffHelpTextString` instead, joined in with the rest only at the very end. Decided here, ahead of the controlType-specific block below, because this writer's own chosen order places \ffownhelp before every field that block decides (\ffprot, \ffhaslistbox, \ffdefres/\ffres) — see this function's own top comment for why that order is this writer's convention, not a spec requirement.
  let ffOwnHelpFragment = "";
  if (descriptor.alias !== undefined && descriptor.alias.trim().length > 0) {
    ffOwnHelpFragment = "\\ffownhelp1";
    ffHelpTextString = `{\\*\\ffhelptext ${escapeText(descriptor.alias)}}`;
  }

  // [MS-DOC] 2.9.79 FFDataBits.fProt, verbatim: "A bit that specifies whether the form field is protected and its value cannot be changed" — RTF 1.9.1's own Form Fields table states the identical fact, "\ffprotN: 1 if this field is protected, 0 otherwise." It is a single content-protection bit, so it captures the 'content' and 'both' halves of ContentControlLock exactly (both lock the field's own value); 'container' locks only the control's own removal, a fact RTF's form-field vocabulary has no bit for at all — a legacy form field is ordinary document text with no separate "delete the control" operation to protect in the first place — so a 'container' lock is reported through the diagnostic sink below rather than silently folded into "unprotected". Written as the explicit `\ffprot1` form rather than a bare `\ffprot`: `\ffprotN` is classified a Value control word, not a Toggle word like `\b`/`\i`, in RTF 1.9.1's own Appendix B ("Index of RTF Control Words"), and a Value word's own bare form defaults to 0/off rather than to an ambiguous "on" — per "Conventions of an RTF Reader"'s own separate "Change Formatting Property" entry, a different part of the spec from Appendix B's classification table: "If a parameter is needed and not specified, then a default value is used... If the control word does not specify a default, then RTF readers should assume a default of 0 except for the toggle control words (like \b), which have a default of 1"; this reader's own formFieldValueBit in read.ts applies that default on the way in. Writing the explicit `\ffprot1` form here is not hedging against any ambiguity (there is none left to hedge against) — it costs one character and matches how every real producer-derived fixture in this package's own read.test.ts (PHPRtfLite) writes the sibling `\ffres`/`\ffdefres` bits, none of which settle `\ffprot` specifically since none of those fixtures sets it at all. Decided here, ahead of the controlType-specific block below, for the identical reason `ffOwnHelpFragment` above is: this writer's own chosen order places \ffprot before \ffhaslistbox and \ffdefres/\ffres.
  let ffProtFragment = "";
  if (descriptor.lock === "content" || descriptor.lock === "both") {
    ffProtFragment = "\\ffprot1";
  }
  if (descriptor.lock === "container" || descriptor.lock === "both") {
    const message =
      descriptor.lock === "both"
        ? `a contentControl's 'both' lock also protects the control from removal, which RTF's \\ffprot ([MS-DOC] 2.9.79 FFDataBits.fProt) cannot express — \\ffprot1 above already carries the content-protection half of 'both', so only the container-removal half is dropped here`
        : `a contentControl's 'container' lock protects the control from removal, which RTF's \\ffprot ([MS-DOC] 2.9.79 FFDataBits.fProt) cannot express at all — it names only whether the field's own value can be changed, and a 'container' lock leaves that value editable, so nothing is written for it and the whole lock is dropped, not merely half of it`;
    sink({
      code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      severity: "warning",
      message,
    });
  }

  // The controlType-specific formparams-shaped members — \ffhaslistbox and \ffdefres/\ffres — both of which this writer's own chosen order places after \ffownhelp/\ffprot above, so this fragment is concatenated in after them (see the `return` at the end of this function) rather than appended into the same running string those two build.
  let controlTypeParams = "";
  if (descriptor.controlType === "checkbox") {
    // \ffres is what a reader (this package's own included, per FORM_FIELD_RESULT_UNDEFINED in constructs.ts) actually reads back as the checkbox's current state — omitting it, as this writer once did, opens the box unchecked in Word regardless of `checked`, since an absent \ffres reads as 0. \ffdefres mirrors the same value: ContentControlDescriptor carries one `checked` boolean, not a separate reset default, so the field's default is the value it was minted with. Written ffdefres before ffres, matching this writer's own chosen order for formparams-shaped members.
    const value = descriptor.checked === true ? "1" : "0";
    controlTypeParams += `\\ffdefres${value}\\ffres${value}`;
    if (descriptor.value !== undefined && descriptor.value.length > 0) {
      // A real, reachable case, from the identical reachability path as the plainText \ffdeftext handling below: documents.js's own PDF AcroForm-to-contentControl reconstruction spreads a checkbox widget's `/V` export-value name (e.g. 'Yes', a custom on-state string, distinct from AcroForm's own boolean derived-from-/V `checked`) onto `value` alongside `checked` (see pdf-codec's own valueFields — `checked: value !== 'Off', ...(value !== 'Off' ? { value } : {})`). RTF's own \ffres/\ffdefres are a bare 0/1/25 state with no room for a named export value at all, so a checkbox's `value` has no RTF spelling whatsoever, unlike a dropDown's `value` (which at least sometimes matches a real \ffl entry) — this is unconditional data loss whenever `value` is present, reported through the same sink every other unrepresentable construct in this writer uses rather than silently dropped the way an earlier version of this writer dropped it. Gated on `.length > 0`, not merely `!== undefined`, for the same reason the plainText branch's own \ffdeftext gating below is (see its comment): this function's one consistent rule for every value-shaped field across every controlType branch — `alias`, `tag`, and a plainText `value` already all treat an empty string as carrying no distinguishable value to preserve, so it reads as "never recorded" rather than as a genuine present-but-empty value; a checkbox's own `value` follows that same rule rather than firing this diagnostic for a string with nothing in it.
      sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: `a checkbox contentControl's value '${descriptor.value}' (its on-state export name) is dropped: RTF's \\ffres/\\ffdefres can only carry the field's boolean checked state, with no spelling for a named export value at all`,
      });
    }
    if (descriptor.options !== undefined && descriptor.options.length > 0) {
      // Nothing about a checkbox has a list to hold this — `options` is the dropDown/comboBox choice list, and a producer handing this writer a checkbox descriptor that also carries one (a mis-typed reconstruction, or a shape shared with a sibling controlType upstream) has recorded data this control type cannot carry regardless of format, not merely one RTF can't spell — reported the same way as the value case above, rather than the writer quietly reading past a field it has no use for. Gated on `.length > 0`, matching this function's own rule for every other value-shaped field (see the plainText `value` branch's comment below): an empty options array carries nothing that was actually dropped, so it reads as "never recorded" rather than firing a diagnostic over zero entries.
      sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: `a checkbox contentControl's options list (${String(descriptor.options.length)} entries) is dropped: a checkbox has no choice list at all, in RTF or in the harmonised contentControl vocabulary itself`,
      });
    }
  } else if (descriptor.controlType === "dropDown") {
    // \ffhaslistbox is minted unconditionally for a dropDown, independent of whether it carries any options at all: [MS-DOC] 2.9.79 FFDataBits.fHasListBox "specifies that the form field has a list box. This value MUST be 1 if iType is iTypeDrop (2)." A dropdown with no options is still a dropdown — there is no degenerate case in which that bit stops being true, so it cannot be gated behind `options !== undefined` the way an earlier version of this writer gated it (which then also left \ffdefres unminted for exactly that shape, a real, common one: a docx `w:dropDownList`/`w:comboBox` with no `w:listItem` children, or an ODF `form:listbox`, both currently read back by this ecosystem with no options recorded at all — tracked as ExaDev/documents.js#1016). Written as the explicit `\ffhaslistbox1` form, never bare: RTF 1.9.1's own Form Fields table states "\ffhaslistboxN: 1 if this field has list box attached to it, 0 otherwise", a genuine N-parameterised control word — an earlier version of this comment claimed \ffhaslistbox had "no N-parameter spelling at all", which that same Form Fields table entry and Appendix B's own "Value" classification for it both contradict. A conformant reader applying RTF's own general Value-word default ("Conventions of an RTF Reader"'s "Change Formatting Property" entry: an omitted parameter on a Value word defaults to 0) would read a bare \ffhaslistbox as 0/false, the opposite of what a dropdown actually has — but this codec's own reader never has to apply that default here at all, since applyFormFieldControlWord in read.ts has no \ffhaslistbox case whatsoever and simply does not consult the control word on the way in. A dropdown genuinely has a list box regardless of which reader is doing the reading, so writing the bare form would still assert the wrong thing to any conformant reader that does apply the default.
    controlTypeParams += "\\ffhaslistbox1";
    const allOptions = descriptor.options;
    let options = allOptions;
    if (allOptions !== undefined && allOptions.length > MAX_DROPDOWN_OPTIONS) {
      sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: `a dropDown contentControl's ${String(allOptions.length)} options exceed [MS-DOC] 2.9.78 FFData.hsttbDropList's own ${String(MAX_DROPDOWN_OPTIONS)}-entry limit; only the first ${String(MAX_DROPDOWN_OPTIONS)} are written`,
      });
      options = allOptions.slice(0, MAX_DROPDOWN_OPTIONS);
    }
    // Deliberately NOT gated on `descriptor.value.length === 0` the way the checkbox/plainText `value` branches are: an empty string is not inherently "no value" for a dropDown the way it is for those — `options` can genuinely contain the empty string as one of its own real, indexable entries, and when it does, `value: ''` is a fully representable, legitimate selection (index 0 is as valid an \ffres/\ffdefres target as any other). `options.indexOf` already distinguishes the two cases this branch actually needs to tell apart: an empty string matching a real empty-string option (index >= 0, a genuine selection) from an empty string matching nothing at all (index -1, falling into the diagnostic-suppression case below). Folding `.length === 0` in here as well would silently discard a real selection whenever it happens to select that entry, with no diagnostic at all — and this reader's own writer can produce exactly that shape from real RTF bytes, so a read-then-write round trip of a document this package itself emits could otherwise lose the selection.
    const selectedIndex =
      options === undefined || descriptor.value === undefined
        ? undefined
        : options.indexOf(descriptor.value);
    if (selectedIndex !== undefined && selectedIndex !== -1) {
      // `value` genuinely names one of `options`: \ffres records the real current selection and \ffdefres mirrors it, exactly as the checkbox branch above mirrors its own single `checked` boolean into both \ffres and \ffdefres. Written ffdefres before ffres, matching this writer's own chosen order for formparams-shaped members.
      controlTypeParams += `\\ffdefres${String(selectedIndex)}\\ffres${String(selectedIndex)}`;
    } else if (descriptor.value !== undefined && descriptor.value.length > 0) {
      // `value` was recorded but names none of the entries actually written — real, signalable data loss, distinct from "no value was ever set" below. Substituting the nearest available index (e.g. 0) would silently write a DIFFERENT, wrong selection with no signal that the recorded value was never actually represented, so this writer mints neither \ffres nor \ffdefres and reports the drop through the same sink every other unrepresentable construct in this writer uses (see the "mints neither \ffres nor \ffdefres for a dropDown whose value names none of its own options" test). Two genuinely different reasons collapse into this one branch: `value` may never have matched any of `options` at all, or it may have matched one that the 25-entry truncation above then cut away — distinguished here so the message names the real cause rather than always blaming a mismatch that, in the truncated case, never actually happened.
      // Not also gated on `options !== allOptions`: this branch is only ever reached with selectedIndex either undefined or -1, i.e. `descriptor.value` was not found in `options` — and whenever options === allOptions (no truncation happened), options.indexOf/allOptions.indexOf are the identical lookup, so allOptions.includes(descriptor.value) is already false here regardless. The truncation check would only ever agree with what allOptions.includes(...) alone already decides, making it a redundant, equivalent-mutant-prone AST node with no reachable case where it changes the result.
      const truncatedAway = allOptions?.includes(descriptor.value) ?? false;
      sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: truncatedAway
          ? `a dropDown contentControl's selected value '${descriptor.value}' is dropped: its matching option was truncated away by [MS-DOC] 2.9.78 FFData.hsttbDropList's own ${String(MAX_DROPDOWN_OPTIONS)}-entry limit, and \\ffres/\\ffdefres can only name a real index into the entries actually written`
          : `a dropDown contentControl's selected value '${descriptor.value}' is dropped: it does not match any of the field's own options, and \\ffres/\\ffdefres can only name a real index into that list`,
      });
    }
    // The remaining case — no value was ever recorded at all — mints neither \ffres nor \ffdefres, exactly like the unmatched-value case above, but for a different reason. A real producer spells "no current selection" as \ffres25 (FFDataBits' own undefined-selection sentinel) plus a genuine \ffdefres0, not by omitting both — but this writer cannot emit that exact form without reintroducing the ambiguity an earlier round of it removed: formFieldContentControl in constructs.ts deliberately falls a sentinel \ffres25 through to \ffdefres, precisely so a real PHPRtfLite-produced checkbox's sentinel-plus-meaningful-default pair round-trips as that meaningful default rather than as "unchecked", and that same fallback would read a written \ffdefres0 back as "option 0 is selected" rather than "nothing is selected" for a dropdown with no real selection at all. Omitting both fields instead sidesteps that: read.test.ts's own "leaves a FORMDROPDOWN's value unset when neither \ffres nor \ffdefres is present at all" fixture is a hand-edited variant of a real PHPRtfLite fixture (with its \ffres25\ffdefres0 pair deleted), which proves only that THIS reader tolerates the omission cleanly — not that a real producer would ever write it that way — but that is exactly the property this writer needs: a form its own reader decodes back to value:undefined with no ambiguity, at the cost of not matching what a real producer would have written for the identical "nothing selected" case. [MS-DOC] 2.9.78 FFData.wDef "MUST exist if and only if bits.iType is iTypeChck (1) or iTypeDrop (2)" is a real MS-DOC production rule this omission does not satisfy: a producer omitting wDef is spec-noncompliant but demonstrably tolerated in practice, since this reader (built to survive real-world RTF, not just conformant RTF) decodes the omission cleanly. Converging both no-match branches onto the identical "omit both fields" output also makes the round-trip a genuine fixed point: an unmatched-or-unset value always reads back as value:undefined, and writing that again reproduces byte-identical output, with no second-pass drift onto a fabricated default.
    if (options !== undefined) {
      for (const option of options) {
        fflEntries += `{\\*\\ffl ${escapeText(option)}}`;
      }
    }
    if (descriptor.checked !== undefined) {
      // The identical sibling-gap shape as the checkbox branch's own dropped `options` above and the plainText branch's own dropped `checked` below: `checked` is the checkbox/radio boolean, and a dropDown descriptor carrying one has recorded a fact this control type has no concept of at all — reported rather than silently ignored, matching this function's own treatment of every other recorded-but-unrepresentable field on every OTHER controlType branch.
      sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: `a dropDown contentControl's checked state (${String(descriptor.checked)}) is dropped: a dropdown has no boolean checked state at all, in RTF or in the harmonised contentControl vocabulary itself`,
      });
    }
  } else {
    // formFieldPayload is only ever called for a controlType FORM_FIELD_SPEC covers (checkbox, dropDown, plainText — see formFieldOpenGroup, its only caller), so having already ruled out checkbox and dropDown above, this is always plainText: no further name check is needed or safe to mutate away. [MS-DOC] 2.9.78 FFData.xstzTextDef, verbatim: "An optional Xstz that specifies the default text of this textbox. This structure MUST exist if and only if bits.iType is iTypeTxt (0)." RTF 1.9.1's own `\ffdeftext` ("Default text for text field. This is a destination control word.") is its serialisation. This is real, reachable data: documents.js's own PDF AcroForm-to-contentControl reconstruction hands a plainText control exactly `{controlType:'plainText', value, ...}` for a real `/V` string, so a plainText descriptor's `value` is not hypothetical input — note that this is a WRITE-only use of `value`: the read side deliberately does not restore `\ffdeftext` back onto `value` (see constructs.ts's own formFieldContentControl), since a field's default/reset text is not its current value, so a document built from a descriptor carrying this `value` does not read back with that same `value` on a round trip. Minted only when the descriptor actually carries a non-empty one — omitted, like the dropdown branch's own "nothing to name" cases above, when no value was ever recorded, rather than mint an empty `{\*\ffdeftext}` FFData.xstzTextDef's own presence rule would technically require: this writer already diverges from that binary-structure requirement for the identical round-trip-determinism reason the dropdown branch's own wDef note above explains. Gated on `.length > 0`, not merely `!== undefined`, for the same reason `alias`/`tag` are below: an empty string carries no distinguishable default text to preserve, so it is treated as "no value was ever recorded" rather than as a genuine, meaningful empty default — consistent with how this function already treats an empty `alias`/`tag` as absent rather than minting an empty `{\*\ffhelptext}`/`{\*\ffname}` destination for it.
    if (descriptor.value !== undefined && descriptor.value.length > 0) {
      ffDefTextString = `{\\*\\ffdeftext ${escapeText(descriptor.value)}}`;
      // Reported through the same sink every other cross-field mis-slot in this function uses, for consistency: `value` names the control's CURRENT scalar value, and \ffdeftext names its DEFAULT/reset text — a genuinely different fact, per xstzTextDef's own presence rule quoted above, not a spelling of the same one. The string itself is not dropped (it lands in the RTF byte stream), but this codec's own reader never restores \ffdeftext back onto `value` (see constructs.ts's own formFieldContentControl), so a document built from this descriptor does not read `value` back as `value` on a round trip — the identical one-directional degradation shape as the checkbox branch's own dropped `value` above, just landing in a real destination instead of nowhere at all.
      sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: `a plainText contentControl's value '${descriptor.value}' is written into {\\*\\ffdeftext ...}, FFData.xstzTextDef's default/reset text, not a slot for the field's current value: this codec's own reader does not restore \\ffdeftext back onto \`value\`, so this does not round-trip`,
      });
    }
    if (descriptor.checked !== undefined) {
      // The identical sibling-gap shape as the checkbox branch's own dropped `options` above, mirrored: `checked` is the checkbox/radio boolean, and a plainText descriptor carrying one has recorded a fact this control type has no concept of at all — reported rather than silently ignored, matching this function's own treatment of every other recorded-but-unrepresentable field.
      sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: `a plainText contentControl's checked state (${String(descriptor.checked)}) is dropped: a text field has no boolean checked state at all, in RTF or in the harmonised contentControl vocabulary itself`,
      });
    }
    if (descriptor.options !== undefined && descriptor.options.length > 0) {
      // Same shape again: `options` is the dropDown/comboBox choice list, and a plainText field has no list to hold it. Gated on `.length > 0` for the identical reason the checkbox branch's own `options` check above is: an empty array is nothing dropped.
      sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: `a plainText contentControl's options list (${String(descriptor.options.length)} entries) is dropped: a text field has no choice list at all, in RTF or in the harmonised contentControl vocabulary itself`,
      });
    }
  }

  // The first of the string-destination members in this writer's own chosen order: the field's bookmark-style name, from \ffname. Trimmed before the length check to match the reader's own convention (constructs.ts's formFieldContentControl trims \ffname/\ffhelptext before gating on them) — otherwise a whitespace-only alias/tag would write as if it were real content but read back as absent, an asymmetric round trip.
  if (descriptor.tag !== undefined && descriptor.tag.trim().length > 0) {
    ffNameString = `{\\*\\ffname ${escapeText(descriptor.tag)}}`;
  }
  // Concatenated in this writer's own chosen deterministic order: every formparams-shaped member first (fftype, ffownhelp, ffprot, then whatever controlTypeParams decided), then formstrings-shaped members in this writer's own order (ffname, ffdeftext, ffhelptext, ffl entries) — see this function's own top comment for why that order is a convention, not a spec requirement.
  return (
    fftypeFragment +
    ffOwnHelpFragment +
    ffProtFragment +
    controlTypeParams +
    ffNameString +
    ffDefTextString +
    ffHelpTextString +
    fflEntries
  );
}

export function formFieldOpenGroup(
  descriptor: ContentControlDescriptor,
  sink: RtfDiagnosticSink,
): string | undefined {
  const spec = FORM_FIELD_SPEC.get(descriptor.controlType);
  if (spec === undefined) {
    return undefined;
  }
  return `{\\field{\\*\\fldinst ${spec.instruction} {\\*\\formfield{${formFieldPayload(descriptor, spec.fftype, sink)}}}}{\\fldrslt `;
}

// Each ProvenanceChange's own <chrev> spelling. formatChange is the one with no flag of its own — "\crauthN ... Note This keyword is used to indicate formatting revisions, such as bold, italic" — so its author control word is what states that the run carries one at all.
export const CHREV_CONTROL_WORDS: Readonly<
  Record<ProvenanceChange, { flag: string; author: string; date: string }>
> = {
  insertion: { flag: "\\revised", author: "revauth", date: "revdttm" },
  deletion: { flag: "\\deleted", author: "revauthdel", date: "revdttmdel" },
  moveFrom: { flag: "\\mvf", author: "mvauth", date: "mvdate" },
  moveTo: { flag: "\\mvt", author: "mvauth", date: "mvdate" },
  formatChange: { flag: "", author: "crauth", date: "crdate" },
};

// The provenance descriptors whose half-open range covers this run index. A point extent (startRun === endRun) covers no run, so it names a boundary rather than any text and contributes no character property.
export function revisionsCovering(
  extents: readonly RunConstructExtent[],
  index: number,
): ProvenanceDescriptor[] {
  // The kind check lives only in the final type-guard filter below, not here too: this range filter runs before it regardless of an extent's own descriptor kind, and the type guard already narrows the result to ProvenanceDescriptor — repeating the same check here first would be a redundant, equivalent-mutant-prone AST node with no effect on the final, narrowed result.
  return extents
    .filter((extent) => extent.startRun <= index && index < extent.endRun)
    .map((extent) => extent.descriptor)
    .filter(
      (descriptor): descriptor is ProvenanceDescriptor =>
        descriptor.kind === "provenance",
    );
}

// The merge control words a grid position states in its <celldef>. RTF writes one cell slot per grid column, so every position of a merged region has a slot: the anchor opens the region along each axis it spans (\clmgf across columns, \clvmgf down rows), a position the region reaches along its own row continues it horizontally (\clmrg), and a position it reaches from an earlier row continues it vertically (\clvmrg).
export function mergeControlWords(position: TableGridPosition): string {
  if (position.anchorRowIndex === undefined) {
    return `${tableCellRowSpan(position.cell) > 1 ? "\\clvmgf" : ""}${tableCellColumnSpan(position.cell) > 1 ? "\\clmgf" : ""}`;
  }
  return position.anchorRowIndex < position.rowIndex ? "\\clvmrg" : "\\clmrg";
}

// A properly bookmark-narrowed extent, so its own .descriptor.name is directly accessible with no runtime fallback needed for a case the type checker alone cannot rule out — .filter() narrows the ARRAY's element type only when the predicate itself is passed directly (not wrapped in an arrow calling a separate helper on one of its properties), which is exactly why this exists instead of reusing isBookmarkAnchor as the filter predicate.
export type BookmarkExtent = RunConstructExtent & {
  descriptor: AnchorDescriptor;
};

export function isBookmarkExtent(
  extent: RunConstructExtent,
): extent is BookmarkExtent {
  return isBookmarkAnchor(extent.descriptor);
}

export type ContentControlExtent = RunConstructExtent & {
  descriptor: ContentControlDescriptor;
};

export function isContentControlExtent(
  extent: RunConstructExtent,
): extent is ContentControlExtent {
  return extent.descriptor.kind === "contentControl";
}

// Threaded by reference rather than passed as a bare array parameter: opened is the real, order-sensitive stack writeFormFieldBoundaries and drainOpenedFormFields share across a whole paragraph's own boundary walk (see writeFormFieldBoundaries's own note on why it must be a real stack, popped and pushed in place, not a Set). Wrapping it in a one-field sink whose own opened property is not itself a primitive or callback keeps exadev/prefer-readonly-array-param out of scope for it, the same way appendBytes's own ByteSink in bytes.ts does.
export interface FormFieldStackSink {
  readonly opened: ContentControlExtent[];
}

// Two contentControl extents "cross" when neither nests inside or around the other: one starts before the other ends but also ends after it does (e.g. {startRun:0,endRun:2} and {startRun:1,endRun:3}). RTF's own \*\formfield destination is a bracket, not a range — a `{\field...}` group nests cleanly inside another `{\field...}` group's own \fldrslt, but two crossing groups have no valid brace sequence at all: whichever one physically closes second necessarily closes the OTHER one's own braces instead of its own, corrupting both (verified by execution against writeFormFieldBoundaries below: the pair above produced output where the first extent's own closing braces closed the second field's groups and vice versa, brace-balanced overall but mis-nested throughout). Detected and dropped HERE, before either extent's own open half is ever written, rather than at close time — by then a crossing extent's own opening braces are already in the output and cannot be un-written. Processes extents sorted (startRun ascending, endRun descending, so a tied startRun opens the wider extent first) because that is also the order writeFormFieldBoundaries itself must open extents in to keep two same-position opens correctly nested — an ordinary non-crossing extent (nested, disjoint, or sharing a boundary with another) passes through unchanged, in this order, for exactly that reason.
export function selectNestableFormFields(
  extents: readonly ContentControlExtent[],
  sink: RtfDiagnosticSink,
): readonly ContentControlExtent[] {
  const sorted = [...extents].sort(
    (a, b) => a.startRun - b.startRun || b.endRun - a.endRun,
  );
  const stack: ContentControlExtent[] = [];
  const accepted: ContentControlExtent[] = [];
  for (const extent of sorted) {
    let top = stack[stack.length - 1];
    while (top !== undefined && top.endRun <= extent.startRun) {
      stack.pop();
      top = stack[stack.length - 1];
    }
    if (top !== undefined && extent.endRun > top.endRun) {
      sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message:
          "a contentControl construct is dropped: it crosses another contentControl extent in the same paragraph (starts before that extent ends but ends after it too), and RTF's \\*\\formfield destination can only nest properly, never cross",
      });
      continue;
    }
    stack.push(extent);
    accepted.push(extent);
  }
  return accepted;
}

// Why a given descriptor kind has no RTF spelling, stated per kind rather than as one generic sentence, because the reasons genuinely differ: two of them are format gaps this package could close and two are gaps in RTF itself.
export function describeConstructGap(descriptor: ConstructDescriptor): string {
  switch (descriptor.kind) {
    case "contentControl":
      return "block-scoped structured-document-tag equivalent — a run-scoped plainText/checkbox/dropDown form field mints its own \\*\\formfield instead; any other controlType (richText, comboBox, date, and the rest) has no \\*\\formfield spelling at all";
    case "provenance":
      return "block-scoped revision mark: its <chrev> production is a character property, so a tracked change reaches RTF only as a run-level extent";
    case "anchor":
      return `spelling for a '${descriptor.anchorType}' anchor, whose body would need the note or annotation destination this reader does not place`;
    case "field":
      return "block-scoped field: a field is a character-stream construct, written from a run's own hyperlink rather than from a block marker";
    case "link":
      return "block-scoped link; an external target rides ContentRun.hyperlink instead";
    default:
      return "equivalent construct";
  }
}

// Why a contentControl that IS ALREADY run-scoped (an extent openConstruct/closeConstruct never sees, since it never reaches block level at all — see the top-of-file comment on formFieldContentControl's own analogue in constructs.ts) still has no RTF spelling: writeFormFieldBoundaries below reaches this only once formFieldOpenGroup has already returned undefined for the extent's own controlType, i.e. its being run-scoped was never in question. describeConstructGap's own "contentControl" case above answers a different question — why openConstruct, called for a genuinely block-scoped construct, has nothing block-scoped to open — and leads with "RTF has no block-scoped ... equivalent", a fact that was never why THIS drop happened. Kept as its own function, not a case reused from describeConstructGap, so the two call sites (block-scoped open, run-scoped form field) each state the reason that is actually true of them.
export function describeFormFieldGap(
  descriptor: ContentControlDescriptor,
): string {
  return `\\*\\formfield spelling for a '${descriptor.controlType}' controlType — only plainText/checkbox/dropDown form fields mint one`;
}
