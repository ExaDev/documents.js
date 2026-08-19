import { z } from 'zod';

// The harmonised semantic construct vocabulary (ExaDev/document-schema.js#22, landed additively per ExaDev/document-schema.js#24): the descriptor payloads a package-tree group may carry in place of a container descriptor or an anchor paragraph. The tree was designed construct-capable from day one -- a group is `{ node, children }`, and a construct is exactly that shape with a descriptor as its node and its extent as its children -- so these kinds land without a second structural break: a 4.0.0 tree contains none of them and parses identically under this release.

// The vocabulary is format-agnostic by construction: every kind below is confirmed by at least two of the four codec inventories (ExaDev/ooxml.js#65, ExaDev/odf.js#59, ExaDev/markdown-codec#63, ExaDev/pdf-codec#66), and a construct with no cross-format analogue never gets a bespoke kind -- it degrades to the nearest kind here with its format-specific specifics quarantined in the residue channel that ExaDev/document-schema.js#22 still owns. This module deliberately does NOT define that residue channel: channel 2 is a per-node and package-level `source` facility spanning the whole content model, not a construct-descriptor field, and pre-empting it with a descriptor-only escape hatch would mint exactly the parallel shape the facility exists to avoid.

// EXTENT SCOPE, stated once because it bounds every kind below: a construct group wraps BLOCK-scoped extents -- the block flow of a section, a heading group, a shape, or a list item. It does not wrap a sub-sequence of one paragraph's runs, because a run-level extent is not expressible without changing ContentParagraph's own shape, and the content model is unchanged by this release. The run-level constructs the formats do carry keep their existing homes: an external hyperlink stays on ContentRun.hyperlink (the standing reconciliation on ExaDev/document-schema.js#22 -- `link` groups are for block-scoped and annotated extents a flat run field cannot express, never a replacement for it), and the inline field/bookmark/tracked-change cases wait on a run-level extent mechanism rather than being forced into a block wrapper that would split the paragraph they sit inside.

// A typed container of content: docx block and inline SDTs (`w:sdt`/`w:sdtContent`), docx legacy form fields (`w:ffData`), ODF `office:forms` controls in ordinary odt, ODF TOC and index wrappers as typed containers, and PDF AcroForm widgets with their field tree. The member set is the union of what those four producers actually spell, with each member named by a real inventory row rather than invented for symmetry: a control's own rendered content is its children, and this names what kind of control produced it.
export const ContentControlTypeSchema = z.enum([
  'richText', // docx rich-text SDT at block and inline level; the general "container of arbitrary content" case
  'plainText', // docx plain-text SDT, docx `w:ffData` textInput, PDF AcroForm `/FT /Tx`
  'checkbox', // docx checkbox SDT, docx `w:ffData` checkbox, PDF AcroForm `/FT /Btn` checkbox, ODF form checkbox
  'dropDown', // docx `w:dropDownList` SDT, docx `w:ffData` ddList, PDF AcroForm `/FT /Ch` list box, ODF form listbox -- a closed list, no free text
  'comboBox', // docx `w:comboBox` SDT, PDF AcroForm `/FT /Ch` with the combo flag, ODF form combobox -- a list that also accepts free text
  'date', // docx date SDT
  'picture', // docx picture SDT
  'repeatingSection', // docx repeatingSection SDT
  'button', // PDF AcroForm push button, ODF form button
  'index', // ODF `text:table-of-content`/`text:alphabetical-index`/`text:bibliography`/`text:illustration-index`/`text:table-index`/`text:user-index`/`text:object-index`, and docx's TOC-as-SDT (`w:docPartObj` gallery) -- the wrapper, with its cached rendered entries as children
  'group', // a container of other controls carrying no value of its own: PDF AcroForm non-terminal `/Fields` nodes, ODF `office:forms`
]);
export type ContentControlType = z.infer<typeof ContentControlTypeSchema>;

// What a producer locked, harmonised across the three spellings that exist: docx `w:lock` (`contentLocked`/`sdtLocked`/`sdtContentLocked`), PDF AcroForm's `/Ff` ReadOnly bit, and ODF form controls' read-only flag. Absent means nothing is locked -- there is deliberately no 'none' member, because an absent key and a key naming the absence of a lock are the same fact and two spellings of one fact is how tables drift.
export const ContentControlLockSchema = z.enum([
  'content', // the contents cannot be edited, but the control itself can be removed -- docx `contentLocked`, AcroForm ReadOnly, ODF read-only
  'container', // the control cannot be removed, but its contents can be edited -- docx `sdtLocked`
  'both', // docx `sdtContentLocked`
]);
export type ContentControlLock = z.infer<typeof ContentControlLockSchema>;

export const ContentControlDescriptorSchema = z.strictObject({
  kind: z.literal('contentControl'),
  controlType: ContentControlTypeSchema,
  tag: z.string().optional(), // the machine-readable identifier a producer addresses this control by: docx `w:tag`, PDF AcroForm's partial field name `/T`
  alias: z.string().optional(), // the human-readable label shown to an author: docx `w:alias`, PDF AcroForm's alternate description `/TU`
  lock: ContentControlLockSchema.optional(),
  value: z.string().optional(), // the control's current scalar value where it has one -- PDF AcroForm `/V`, a date control's date, a text input's text. A control whose value IS its rendered content carries that content in `children` and leaves this absent.
  checked: z.boolean().optional(), // a checkbox or radio control's state, which is a boolean in every format that has one and would lose its type spelled through `value`
  options: z.array(z.string()).optional(), // the choice list of a dropDown/comboBox control: docx `w:listItem` entries, PDF AcroForm `/Opt`, an ODF form control's list source
});
export type ContentControlDescriptor = z.infer<typeof ContentControlDescriptorSchema>;

// Instruction plus cached result, with the field's extent expressed as containment rather than as the marker pairs the formats serialise: docx `w:fldChar` begin/separate/end ranges and `w:fldSimple`, the ODF field-master families and the everyday simple-field set, ODF cross-reference displays, and pptx `a:fld` (which is what confirms the kind is genuinely cross-format rather than a docx-only shape).
//
// There is deliberately no harmonised `fieldType` enum here. `instruction` is required and verbatim, so nothing is lost without one; the harmonised type vocabulary is the kind of shape the four inventories' own corpus gate exists to settle (several field families have no real producer fixture in any repo yet), and ExaDev/document-schema.js#24 asks for exactly one new vocabulary -- the internal-target vocabulary on `link` below -- rather than one per kind. Minting a type enum from spec recollection now would freeze the member set before a single real file has been read against it.
export const FieldDescriptorSchema = z.strictObject({
  kind: z.literal('field'),
  instruction: z.string(), // the producer's own field code, verbatim: docx `w:instrText` text or `w:fldSimple/@w:instr`, an ODF field element with its attributes, a pptx `a:fld/@type`
  cachedResult: z.string().optional(), // the field's last-computed display text where the producer cached a scalar one (an ODF field element's own text content, a pptx `a:fld`'s `a:t`). A field whose result is block content carries that content in `children` and leaves this absent -- the two are the block and the scalar case of one fact, never two encodings of the same one.
});
export type FieldDescriptor = z.infer<typeof FieldDescriptorSchema>;

// What an anchor marks. A bookmark is a named target and nothing else; the other three are reference-site markers whose body lives in a definitions-table entry -- the marker-plus-definition split all four inventories independently landed on, and the reason a footnote is not a contiguous extent.
export const AnchorTypeSchema = z.enum([
  'bookmark', // docx `w:bookmarkStart`/`w:bookmarkEnd`, ODF `text:bookmark` and `text:reference-mark*`, a PDF named destination's target site
  'footnote', // docx `w:footnoteReference`, ODF `text:note` with note-class footnote, a markdown `[^n]` marker
  'endnote', // docx `w:endnoteReference`, ODF `text:note` with note-class endnote
  'comment', // docx `w:commentRangeStart`/`End`, ODF `office:annotation`, a PDF sticky note or markup annotation
]);
export type AnchorType = z.infer<typeof AnchorTypeSchema>;

// A named extent or a reference-site marker. A point anchor -- a footnote reference, a bookmark with no range -- is a group with no children; a ranged anchor -- a docx bookmark pair, a comment extent -- wraps the blocks it spans.
//
// Scope note, because one inventory row cannot land as this kind: a sheet-scoped named range (xlsx defined names and tables, ODF `table:named-expressions`) has no block-flow extent to wrap -- a sheet group's children are its images and embedded documents, never a block flow -- so those ride a definitions-table entry naming their range, which is the odf inventory's own verdict for the identical construct. `anchor` covers block-flow extents.
export const AnchorDescriptorSchema = z.strictObject({
  kind: z.literal('anchor'),
  anchorType: AnchorTypeSchema,
  name: z.string(), // the anchor's own name: docx `w:name`, ODF `text:name`, a PDF destination name. Required -- an anchor nothing can address is not an anchor.
  definition: z.string().optional(), // the definitions-table key holding this marker's body, for the note and comment cases; the entry's own tenant vocabulary carries the body, its author, and its date
});
export type AnchorDescriptor = z.infer<typeof AnchorDescriptorSchema>;

// The internal-target vocabulary ExaDev/document-schema.js#24 asks for, spelled as the one place a link's two target families are distinguished: an external URI, or a name resolved inside this document. The internal arm is what docx `w:hyperlink/@w:anchor`, pptx slide jumps, and PDF `GoTo`/`/Dest` all need and none of them can express through a flat run field.
export const LinkTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('external'),
    uri: z.string(), // the resolved external URI, the same value ContentRun.hyperlink carries for the run-level case
  }),
  z.strictObject({
    kind: z.literal('internal'),
    anchor: z.string(), // the name of an `anchor` construct in this document, or of a `destinations` table entry -- one namespace, so a resolver has one place to look
  }),
]);
export type LinkTarget = z.infer<typeof LinkTargetSchema>;

// Target plus the extent it wraps, reserved for exactly what a flat `ContentRun.hyperlink` cannot express: a block-scoped extent (a PDF link annotation whose rect matches no recovered run), an annotated one (a markdown link or image title), and an internal target. Run-level external hyperlinks stay on ContentRun.hyperlink per the standing reconciliation on ExaDev/document-schema.js#22 -- this kind does not replace them, and a producer that emits both encodings for one link has emitted it twice.
export const LinkDescriptorSchema = z.strictObject({
  kind: z.literal('link'),
  target: LinkTargetSchema,
  title: z.string().optional(), // the annotation a run field has nowhere to put: a markdown link/image title, a PDF link annotation's contents
});
export type LinkDescriptor = z.infer<typeof LinkDescriptorSchema>;

// What kind of tracked change a provenance wrapper records. The five members are the union of docx's `w:ins`/`w:del`/`w:moveFrom`/`w:moveTo`/`w:rPrChange`-`w:pPrChange` and ODF's `text:changed-region` children (`text:insertion`, `text:deletion`, `text:format-change`); the move relation itself -- which moveFrom pairs with which moveTo -- has no ODF counterpart and stays residue, per the ooxml inventory's own verdict.
export const ProvenanceChangeSchema = z.enum(['insertion', 'deletion', 'moveFrom', 'moveTo', 'formatChange']);
export type ProvenanceChange = z.infer<typeof ProvenanceChangeSchema>;

// An author/date wrapper around content: docx `w:ins`/`w:del` and move tracking, ODF `text:tracked-changes`/`text:changed-region` with its inline markers. A deletion's children are the deleted content -- carried, not dropped, which is the whole point of the kind: today's readers merge insertions anonymously and drop deletions outright.
export const ProvenanceDescriptorSchema = z.strictObject({
  kind: z.literal('provenance'),
  change: ProvenanceChangeSchema,
  author: z.string().optional(),
  dateIso: z.string().optional(), // ISO-8601, matching LayoutMetadata's own createdIso/modifiedIso spelling rather than minting a second date convention
});
export type ProvenanceDescriptor = z.infer<typeof ProvenanceDescriptorSchema>;

// The external-chapter link of a division: ODF `text:section-source`, which the odm reader already reads verbatim as its chapter model. `text:filter-name` has no cross-format meaning and stays residue.
export const DivisionSourceSchema = z.strictObject({
  href: z.string(), // `xlink:href` -- the document this division's content is linked from
  sectionName: z.string().optional(), // `text:section-name` -- which named division inside that document, when the link is to part of it
});
export type DivisionSource = z.infer<typeof DivisionSourceSchema>;

// A named, arbitrarily nestable grouping of block flow: the ODF `text:section` shape, and the sixth kind ExaDev/document-schema.js#24 poses as a decision. Decided first-class rather than degraded to `contentControl`, on the odf inventory's own recommendation and its stated reasoning: ContentSection cannot host it (that is page geometry, one pageSize/margins pair, and it does not nest, while a division nests arbitrarily and usually changes no page geometry at all), and burying a structural container in the form-control vocabulary would make `contentControl` mean two unrelated things. It clears ExaDev/document-schema.js#22's no-format-specific-kinds bar on a real cross-format analogue rather than on ODF's say-so: tagged PDF's `/Sect` and `/Div` structure elements are the same construct, and docx spells the linked-chapter case through subdocuments.
//
// Named `division`, not `section`, because `{ kind: 'section' }` is already taken by the page-geometry container descriptor (src/package-node.ts) and one word cannot mean both. The name is tagged PDF's own for the same shape.
export const DivisionDescriptorSchema = z.strictObject({
  kind: z.literal('division'),
  name: z.string().optional(), // ODF `text:name`; how the odm chapter model and cross-document links address a division
  columnCount: z.number().int().positive().optional(), // the column count a division sets over its own flow, which is pre-layout geometry with no other home -- the styles table carries paragraph and run properties only
  protected: z.boolean().optional(), // ODF `text:protected` -- the content is not editable in place
  source: DivisionSourceSchema.optional(),
});
export type DivisionDescriptor = z.infer<typeof DivisionDescriptorSchema>;

// The node payload of a construct group, discriminated on `kind` exactly as the container descriptors are. Adding a member here is schema-additive (a value carrying it simply starts parsing) and TS-breaking only for a consumer switching exhaustively over the union -- which is the whole reason these kinds could land in a minor after the tree major rather than needing one of their own.
export const ConstructDescriptorSchema = z.discriminatedUnion('kind', [
  ContentControlDescriptorSchema,
  FieldDescriptorSchema,
  AnchorDescriptorSchema,
  LinkDescriptorSchema,
  ProvenanceDescriptorSchema,
  DivisionDescriptorSchema,
]);
export type ConstructDescriptor = z.infer<typeof ConstructDescriptorSchema>;
