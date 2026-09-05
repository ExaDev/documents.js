// RTF's own fidelity constructs, mapped onto document-schema.js's harmonised construct vocabulary (its src/construct.ts) in both directions. A sibling module by the same name exists in ooxml.js (src/typed/docx/constructs.ts) and odf.js (src/typed/shared/constructs.ts) for exactly the same job, and this one follows their discipline: the descriptor SHAPES live here, next to the format spellings they translate, while the walk that decides an extent's position stays in the reader and the writer.
//
// Two of RTF's three candidates are real. Bookmarks are `'{\*' \bkmkstart (\bkmkcolfN? & \bkmkcollN?) #PCDATA '}'` / `'{\*' \bkmkend #PCDATA '}'` (RTF 1.9.1, "Bookmarks") and map onto the `anchor` descriptor with anchorType 'bookmark'. Revision marks are the <chrev> character-property production -- `\revised? \revauthN? \revdttmN? \crauthN? \crdateN? \deleted? \revauthdelN? \revdttmdelN? \mvf? \mvt? \mvauthN? \mvdateN?` (RTF 1.9.1, "Character Revision Mark Properties") -- and map onto `provenance`, one descriptor per change kind a run carries.
//
// The third, CONTENT CONTROLS, has no direct RTF spelling of its own -- RTF 1.9.1 predates OOXML's `w:sdt` and specifies nothing equivalent: its "Custom XML Tags" production (\xmlopen/\xmlclose with the \xmlsdtt* scoping keywords) is a namespace/name tag over a run range with no type, lock, alias, placeholder or value, and its "Custom XML Data Properties" \*\datastore is an opaque #SDATA blob whose "format ... is unknown to RTF" by the spec's own words. What RTF has INSTEAD is form fields (`'{\*' \formfield '{' <formparams> <formstrings> '}}'`, nested inside a field's own `\*\fldinst` alongside its FORMTEXT/FORMCHECKBOX/FORMDROPDOWN instruction), which ARE a real contentControl analogue -- ooxml.js maps docx's own legacy w:ffData twin onto exactly that kind, and this module does the same for RTF's: `formFieldContentControl` below reads a form field's instruction plus whatever `\*\formfield` data the reader collected into a `contentControl` descriptor (checkbox/dropDown/plainText), and `formFieldPayload`/`FORM_FIELD_SPEC` in the writer mint one back. A form field is always inline -- one `{\field ...}` group, never spanning a paragraph boundary -- so the construct rides a `RunConstructExtent` on the paragraph, exactly like a revision mark, never a block-level `constructStart`/`constructEnd` pair.

import type {
  AnchorDescriptor,
  ConstructDescriptor,
  ContentControlDescriptor,
  ContentControlType,
  ProvenanceChange,
  ProvenanceDescriptor,
  RunConstructExtent,
} from "document-schema.js";

// The residue channel's own format name for everything this package quarantines. `xml` names the field, not the payload's syntax -- an rtf residue value carries RTF's own brace-and-control-word text (document-schema.js's src/source.ts states this).
export const RTF_SOURCE_FORMAT = "rtf" as const;

// A bookmark's optional table-column range: "\bkmkcolfN is used to denote the first column of a table covered by a bookmark ... \bkmkcollN is used to denote the last column." No ContentDocument field carries it -- an AnchorDescriptor names an extent, not a rectangle of a table -- so it rides the descriptor's own residue verbatim, which is exactly what makes a same-format writer able to restore it.
export interface BookmarkColumnRange {
  readonly first: number | undefined;
  readonly last: number | undefined;
}

export function bookmarkAnchorDescriptor(
  name: string,
  columns: BookmarkColumnRange | undefined,
): AnchorDescriptor {
  const residue = bookmarkColumnResidue(columns);
  return {
    kind: "anchor",
    anchorType: "bookmark",
    name,
    ...(residue === undefined
      ? {}
      : { source: { format: RTF_SOURCE_FORMAT, xml: residue } }),
  };
}

function bookmarkColumnResidue(
  columns: BookmarkColumnRange | undefined,
): string | undefined {
  if (columns === undefined) {
    return undefined;
  }
  const parts = [
    columns.first === undefined ? "" : `\\bkmkcolf${String(columns.first)}`,
    columns.last === undefined ? "" : `\\bkmkcoll${String(columns.last)}`,
  ].join("");
  return parts.length === 0 ? undefined : parts;
}

// The inverse: the control words a same-format writer re-emits inside its own {\*\bkmkstart ...}. Re-serialising opaque text is not interpreting it, which is precisely the re-emission the quarantine contract permits -- and the `format` check is what makes it decidable, so another format's residue is left alone rather than pasted into RTF.
export function bookmarkResidueControlWords(
  descriptor: AnchorDescriptor,
): string {
  const source = descriptor.source;
  return source?.format === RTF_SOURCE_FORMAT ? source.xml : "";
}

export function isBookmarkAnchor(
  descriptor: ConstructDescriptor,
): descriptor is AnchorDescriptor {
  return descriptor.kind === "anchor" && descriptor.anchorType === "bookmark";
}

// One run's worth of <chrev> state. Every field is a character property, scoped to the group exactly as \b and \i are, so it rides this package's own CharacterState and splits runs at its own boundaries.
export interface RevisionState {
  // "\revised Text has been added since revision marking was turned on."
  readonly revised: boolean;
  readonly revisedAuthor: number | undefined; // \revauthN
  readonly revisedDateTime: number | undefined; // \revdttmN
  // "\deleted Text has been deleted since revision marking was turned on."
  readonly deleted: boolean;
  readonly deletedAuthor: number | undefined; // \revauthdelN
  readonly deletedDateTime: number | undefined; // \revdttmdelN
  // "\mvf Text has been moved to another location (is part of a 'Move From')" / "\mvt ... (is part of a 'Move To')".
  readonly moved: "moveFrom" | "moveTo" | undefined;
  readonly movedAuthor: number | undefined; // \mvauthN
  readonly movedDateTime: number | undefined; // \mvdateN
  // \crauthN is the formatting-revision author: "Note This keyword is used to indicate formatting revisions, such as bold, italic." Its presence is what says the run carries one -- there is no \crrevised flag beside it.
  readonly formatAuthor: number | undefined;
  readonly formatDateTime: number | undefined; // \crdateN
}

export const NO_REVISION: RevisionState = {
  revised: false,
  revisedAuthor: undefined,
  revisedDateTime: undefined,
  deleted: false,
  deletedAuthor: undefined,
  deletedDateTime: undefined,
  moved: undefined,
  movedAuthor: undefined,
  movedDateTime: undefined,
  formatAuthor: undefined,
  formatDateTime: undefined,
};

export function hasRevision(state: RevisionState): boolean {
  return (
    state.revised ||
    state.deleted ||
    state.moved !== undefined ||
    state.formatAuthor !== undefined
  );
}

// The provenance descriptors one run's revision state carries -- several, because a run can be inserted AND format-changed at once, and run extents are ranges rather than brackets so two of them may overlap freely.
export function provenanceDescriptors(
  state: RevisionState,
  authors: readonly string[],
): ProvenanceDescriptor[] {
  const out: ProvenanceDescriptor[] = [];
  if (state.revised) {
    out.push(
      provenanceDescriptor(
        "insertion",
        state.revisedAuthor,
        state.revisedDateTime,
        authors,
      ),
    );
  }
  if (state.deleted) {
    out.push(
      provenanceDescriptor(
        "deletion",
        state.deletedAuthor,
        state.deletedDateTime,
        authors,
      ),
    );
  }
  if (state.moved !== undefined) {
    out.push(
      provenanceDescriptor(
        state.moved,
        state.movedAuthor,
        state.movedDateTime,
        authors,
      ),
    );
  }
  if (state.formatAuthor !== undefined) {
    out.push(
      provenanceDescriptor(
        "formatChange",
        state.formatAuthor,
        state.formatDateTime,
        authors,
      ),
    );
  }
  return out;
}

function provenanceDescriptor(
  change: ProvenanceChange,
  authorIndex: number | undefined,
  dateTime: number | undefined,
  authors: readonly string[],
): ProvenanceDescriptor {
  const author = authorIndex === undefined ? undefined : authors[authorIndex];
  const dateIso = dateTime === undefined ? undefined : isoFromDttm(dateTime);
  return {
    kind: "provenance",
    change,
    // An index naming no revision-table entry produces a descriptor with no author at all rather than a fabricated name: ProvenanceDescriptor.author is optional precisely so an unresolvable one can be absent, and inventing "Unknown" would be indistinguishable from a table that really says "Unknown".
    ...(author === undefined || author.length === 0 ? {} : { author }),
    ...(dateIso === undefined ? {} : { dateIso }),
  };
}

// The DTTM bit field every revision timestamp uses, stated by RTF 1.9.1's own table under "Revision Marks":
//
// bits 0-5   Minute        0-59 bits 6-10  Hour          0-23 bits 11-15 Day of month  1-31 bits 16-19 Month         1-12 bits 20-28 Year          = Year - 1900 bits 29-31 Day of week   0 (Sun) - 6 (Sat)
//
// The weekday is derivable from the date and is not read: a DTTM whose weekday disagrees with its own date is a producer bug, and recomputing it is strictly more reliable than trusting it. The result is a bare local wall-clock ISO string with no zone designator, because DTTM carries no zone -- stamping one would assert a fact the format never stated.
const DTTM_MINUTE_MASK = 0x3f;
const DTTM_HOUR_SHIFT = 6;
const DTTM_HOUR_MASK = 0x1f;
const DTTM_DAY_SHIFT = 11;
const DTTM_DAY_MASK = 0x1f;
const DTTM_MONTH_SHIFT = 16;
const DTTM_MONTH_MASK = 0xf;
const DTTM_YEAR_SHIFT = 20;
const DTTM_YEAR_MASK = 0x1ff;
const DTTM_YEAR_EPOCH = 1900;

export function isoFromDttm(value: number): string | undefined {
  // A DTTM is emitted "as a long integer", so a value with its top bit set arrives here signed; the unsigned right shift restores the 32-bit pattern the bit field is defined over.
  const bits = value >>> 0;
  const minute = bits & DTTM_MINUTE_MASK;
  const hour = (bits >>> DTTM_HOUR_SHIFT) & DTTM_HOUR_MASK;
  const day = (bits >>> DTTM_DAY_SHIFT) & DTTM_DAY_MASK;
  const month = (bits >>> DTTM_MONTH_SHIFT) & DTTM_MONTH_MASK;
  const year = ((bits >>> DTTM_YEAR_SHIFT) & DTTM_YEAR_MASK) + DTTM_YEAR_EPOCH;
  // A zero DTTM -- day 0, month 0 -- is what a producer writes for "no time recorded", and it is not a date. Rejecting it here keeps a fabricated 1900-00-00 out of dateIso rather than letting the field claim a timestamp the document never carried.
  if (day === 0 || month === 0 || month > 12 || day > 31) {
    return undefined;
  }
  return (
    `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` +
    `T${pad(hour, 2)}:${pad(minute, 2)}:00`
  );
}

// The inverse, for the writer: an ISO date back into the packed field. A dateIso this package cannot parse produces no \revdttmN at all rather than a zero one, since a zero DTTM is itself a claim ("no time recorded") the source may not have made.
const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?/;

export function dttmFromIso(dateIso: string): number | undefined {
  const match = ISO_DATE_TIME.exec(dateIso);
  if (match === null) {
    return undefined;
  }
  const year = Number(match[1]) - DTTM_YEAR_EPOCH;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  if (year < 0 || year > DTTM_YEAR_MASK) {
    return undefined;
  }
  // Emitted as a signed long, matching how the parameter is read back: a value above 2^31-1 would not survive the tokenizer's own 10-digit signed parameter.
  const bits =
    (minute & DTTM_MINUTE_MASK) |
    ((hour & DTTM_HOUR_MASK) << DTTM_HOUR_SHIFT) |
    ((day & DTTM_DAY_MASK) << DTTM_DAY_SHIFT) |
    ((month & DTTM_MONTH_MASK) << DTTM_MONTH_SHIFT) |
    ((year & DTTM_YEAR_MASK) << DTTM_YEAR_SHIFT);
  return bits | 0;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

// Whatever `{\*\formfield ...}` handed the reader beyond the field's own instruction: the bookmark-style name from `{\*\ffname ...}`, the human-readable label from `{\*\ffhelptext ...}` (gated by `ownHelp`, see below), a plainText field's own default text from `{\*\ffdeftext ...}`, a dropdown's own `{\*\ffl ...}` entries, the result indices `\ffres`/`\ffdefres` carry, and the `\ffprot` protection bit. RTF 1.5's own Form Fields table defines the result indices purely in list-field terms, but they serialise the binary FFDataBits structure [MS-DOC] 2.9.79 defines, whose iRes field carries a real, spec-defined meaning per iType -- a checkbox's checked state (0/1/25-undefined) for iTypeChck, a zero-based \ffl index for iTypeDrop (25 again for an undefined selection); see formFieldContentControl below for how each iType's own reading is decided. Optional end to end -- `\*\formfield` itself is optional per the grammar, so a bare FORMTEXT/FORMCHECKBOX/FORMDROPDOWN instruction with no `\*\formfield` group still names a control type on its own.
export interface RtfFormFieldData {
  readonly name: string;
  readonly helpText: string;
  // [MS-DOC] 2.9.79 FFDataBits.fOwnHelp, verbatim: "A bit that specifies whether the form field has custom help text in FFData.xstzHelpText. If fOwnHelp is 0, FFData.xstzHelpText contains an empty or auto-generated string." Read from `\ffownhelp` via the ordinary toggle convention (present-but-unparameterised means true, `\ffownhelp0` means false), and defaulting to fOwnHelp's own spec-stated default of 0/false when the control word never appears in the group at all -- an absent parameterised bit names its spec default, not "on", matching this reader's convention for every other parameterised (not bare-toggle) form-field bit rather than the `\b`/`\i`-style bare-toggle convention `toggleValue` itself implements for when the word IS present. formFieldContentControl below gates promoting `helpText` to the descriptor's `alias` on this flag, so a genuinely auto-generated (or wholly absent) xstzHelpText string never surfaces as an author-set alias.
  readonly ownHelp: boolean;
  // [MS-DOC] 2.9.78 FFData.xstzTextDef, "MUST exist if and only if bits.iType is iTypeTxt (0)" -- read from `\ffdeftext`, RTF 1.9.1's own "Default text for text field" destination. Empty when the field carries no `\ffdeftext` group at all, or none of iTypeTxt.
  readonly defaultText: string;
  readonly listItems: readonly string[];
  readonly resultIndex: number | undefined;
  readonly defaultResultIndex: number | undefined;
  readonly protectedField: boolean;
}

// [MS-DOC] 2.9.79 FFDataBits, verbatim: "If iType is iTypeChck (1), iRes specifies the state of the checkbox and MUST be 0 (unchecked), 1 (checked), or 25 (undefined). Undefined checkboxes are treated as unchecked." 25 is FFDataBits's own reserved sentinel for "no explicit state", not a PHPRtfLite-specific quirk: real Word output emits it too on any checkbox whose \ffres was never meaningfully set, alongside a real \ffdefres carrying the field's reset default. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/22a1f1e5-f4b2-4a7d-9e10-3afa26056122 -- the code below deliberately goes one step further than this bare quote: rather than treating every undefined \ffres as unchecked outright, it falls through to a *defined* \ffdefres first and only lands on "unchecked" when that too is absent. This is a considered divergence from the spec's own literal default, not an oversight: a real PHPRtfLite-produced file always emits the sentinel \ffres25 alongside a meaningful \ffdefres naming the field's actual intended state, so treating 25 as "fall through to \ffdefres" recovers real-world checkbox state that the bare spec quote alone would silently discard as unchecked. Do not "simplify" this back to matching the quote above verbatim -- that would re-break the real-world case this fallback exists for.
const FORM_FIELD_RESULT_UNDEFINED = 25;

const FORM_FIELD_CHECKBOX_INSTRUCTION = /\bFORMCHECKBOX\b/i;
const FORM_FIELD_DROPDOWN_INSTRUCTION = /\bFORMDROPDOWN\b/i;
const FORM_FIELD_TEXT_INSTRUCTION = /\bFORMTEXT\b/i;

// The one place a form field's instruction keyword decides its controlType, so the reader and the write-side keyword table (FORM_FIELD_SPEC in write.ts) stay the two ends of one mapping rather than two independent guesses. Order matters only in that FORMCHECKBOX and FORMDROPDOWN are checked before the FORMTEXT fallback would otherwise never apply -- the three keywords do not overlap as substrings, so no ordering is actually load-bearing, but checking the two more specific keywords first reads as the intended precedence.
function formFieldControlType(
  instruction: string,
): ContentControlType | undefined {
  if (FORM_FIELD_CHECKBOX_INSTRUCTION.test(instruction)) {
    return "checkbox";
  }
  if (FORM_FIELD_DROPDOWN_INSTRUCTION.test(instruction)) {
    return "dropDown";
  }
  if (FORM_FIELD_TEXT_INSTRUCTION.test(instruction)) {
    return "plainText";
  }
  return undefined;
}

// A form field's instruction plus whatever `\*\formfield` data the reader collected, folded into the one construct document-schema.js gives a content control -- undefined for an ordinary field (HYPERLINK, PAGE, and the rest) whose instruction names none of RTF's three form-field keywords, so the reader's existing hyperlink-only handling for those is untouched. The field's actual DISPLAYED text is not duplicated onto `value` here: it rides the ordinary runs the extent already wraps (the `\fldrslt` content). What a plainText field's own `\ffdeftext` carries is a different fact -- FFData.xstzTextDef, the field's default/reset text -- and IS promoted to `value` below, since it is real data a genuine producer (documents.js's own PDF AcroForm-to-contentControl reconstruction, for one) can hand this writer and this reader must be able to recover; ooxml.js's own w:ffData mapping leaves a text input's `value` unset only because it has no `w:default`-reading branch of its own yet, not because the concept has no home in `ContentControlDescriptor`.
export function formFieldContentControl(
  instruction: string,
  formField: RtfFormFieldData | undefined,
): ContentControlDescriptor | undefined {
  const controlType = formFieldControlType(instruction);
  if (controlType === undefined) {
    return undefined;
  }
  const descriptor: ContentControlDescriptor = {
    kind: "contentControl",
    controlType,
  };
  if (formField === undefined) {
    return descriptor;
  }
  const name = formField.name.trim();
  if (name.length > 0) {
    descriptor.tag = name;
  }
  const helpText = formField.helpText.trim();
  if (formField.ownHelp && helpText.length > 0) {
    // Gated on \ffownhelp ([MS-DOC] 2.9.79 FFDataBits.fOwnHelp): when a producer sets \ffownhelp0, xstzHelpText is "an empty or auto-generated string" by the spec's own words, not an author-set label -- surfacing it as `alias` regardless would misrepresent auto-generated help text as something an author actually typed.
    descriptor.alias = helpText;
  }
  if (formField.protectedField) {
    // \ffprot is a single bit ("the form field is protected and its value cannot be changed" -- [MS-DOC] 2.9.79 FFDataBits.fProt), so reading it back can only ever name ContentControlLock's 'content' member: RTF's own vocabulary has no second bit for the 'container' (removal) half 'both' also carries, and there is no way to tell a written 'content' apart from a written 'both' once both have collapsed onto the identical \ffprot bit -- an inherent, one-directional loss the writer's own diagnostic (formFieldPayload in write.ts) names at write time, not something this read side can recover.
    descriptor.lock = "content";
  }
  if (controlType === "plainText") {
    // FFData.xstzTextDef ("MUST exist if and only if bits.iType is iTypeTxt (0)"), read from \ffdeftext -- a distinct fact from the field's DISPLAYED text (the \fldrslt run content, never duplicated here), and the writer's own inverse of this: formFieldPayload in write.ts mints \ffdeftext from exactly this field.
    const defaultText = formField.defaultText.trim();
    if (defaultText.length > 0) {
      descriptor.value = defaultText;
    }
  } else if (controlType === "checkbox") {
    // \ffres carries the checkbox's real current state and takes priority whenever it is not FFDataBits's own undefined sentinel (see FORM_FIELD_RESULT_UNDEFINED above); only the sentinel -- or \ffres being absent altogether -- falls through to \ffdefres, the field's reset default, which itself defaults to 0 (unchecked) when that too is absent. Verified against both PHPRtfLite's own output (which always emits the sentinel \ffres25 alongside a meaningful \ffdefres) and real Word's FFDataBits encoding (which can emit a meaningful \ffres alongside a \ffdefres that differs, and the current value must win over the reset default in that case).
    const current =
      formField.resultIndex === FORM_FIELD_RESULT_UNDEFINED
        ? undefined
        : formField.resultIndex;
    descriptor.checked = (current ?? formField.defaultResultIndex ?? 0) !== 0;
  } else if (controlType === "dropDown" && formField.listItems.length > 0) {
    descriptor.options = [...formField.listItems];
    // \ffres also names a dropdown's own currently selected entry -- the same field FFDataBits gives the checkbox's state, read here under iTypeDrop's own "zero-based index into \ffl" meaning instead. FFDataBits's reserved 25 sentinel (see FORM_FIELD_RESULT_UNDEFINED above) means "selection is undefined" for iTypeDrop exactly as it means "checkbox state is undefined" for iTypeChck, so the identical sentinel-then-default fallback the checkbox branch above applies to its own `current` value applies here too: a sentinel or absent \ffres falls through to \ffdefres, the field's own recorded default selection. Confirmed against a real PHPRtfLite fixture, which always emits the sentinel \ffres25 alongside a meaningful \ffdefres -- without this fallback, a real-world dropdown's selection is silently lost even though \ffdefres names it. Bounds-checked against the list actually read, since an out-of-range index names no real entry.
    const current =
      formField.resultIndex === FORM_FIELD_RESULT_UNDEFINED
        ? undefined
        : formField.resultIndex;
    const selectedIndex = current ?? formField.defaultResultIndex;
    if (
      selectedIndex !== undefined &&
      selectedIndex >= 0 &&
      selectedIndex < formField.listItems.length
    ) {
      const selected = formField.listItems[selectedIndex];
      if (selected !== undefined) {
        descriptor.value = selected;
      }
    }
  }
  return descriptor;
}

// Coalesces a per-run descriptor list into the fewest run extents that say the same thing: adjacent runs carrying an equal descriptor become one extent rather than one per run. Equality is structural over the descriptor's own serialisation, which is exact here because a descriptor is a plain data object built by this module with its keys always in the same order.
export function coalesceRunConstructs(
  perRun: readonly (readonly ConstructDescriptor[])[],
): RunConstructExtent[] {
  const open = new Map<
    string,
    { descriptor: ConstructDescriptor; start: number }
  >();
  const out: RunConstructExtent[] = [];
  const close = (key: string, end: number): void => {
    const entry = open.get(key);
    if (entry === undefined) return;
    out.push({
      descriptor: entry.descriptor,
      startRun: entry.start,
      endRun: end,
    });
    open.delete(key);
  };
  for (const [index, descriptors] of perRun.entries()) {
    const present = new Map(
      descriptors.map((descriptor) => [JSON.stringify(descriptor), descriptor]),
    );
    for (const key of [...open.keys()]) {
      if (!present.has(key)) {
        close(key, index);
      }
    }
    for (const [key, descriptor] of present) {
      if (!open.has(key)) {
        open.set(key, { descriptor, start: index });
      }
    }
  }
  for (const key of [...open.keys()]) {
    close(key, perRun.length);
  }
  // Document order by where each extent starts, so a paragraph's constructs array reads the way the source did.
  return out.sort(
    (left, right) =>
      left.startRun - right.startRun || left.endRun - right.endRun,
  );
}
