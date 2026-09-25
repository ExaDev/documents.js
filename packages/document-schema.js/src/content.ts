import { z } from "zod";
import { ConstructDescriptorSchema } from "./construct";
import {
  BoxSchema,
  LayoutFrameSchema,
  MarginsSchema,
  PageSizeSchema,
} from "./geometry";
import type { Box, LayoutFrame } from "./geometry";
import {
  MathExpressionSchema,
  MathPresentationSchema,
  MathProvenanceSchema,
  SymbolTableSchema,
} from "./math";
import { MathMlNodeSchema } from "./mathml";
import { LayoutMetadataSchema } from "./metadata";
import { SourceResidueSchema, type SourceResidue } from "./source";
import {
  AlignmentSchema,
  type TextDirection,
  TextDirectionSchema,
} from "./style";
// The shared vocabularies (annotation channel, run font, borders, floats, images, embedded objects) live in content-vocabulary.ts; the spreadsheet and drawing halves of the model in content-sheet.ts and content-drawing.ts. Every import below is one-directional: those modules reach back into this one only inside z.lazy thunks, deferred past module evaluation.
import {
  CONTENT_ANNOTATION_FIELDS,
  ContentBorderSchema,
  ContentEmbeddedObjectBlockSchema,
  ContentImageBlockSchema,
  ContentRunSchema,
  contentDocumentSchemaBox,
  contentBlockSchemaBox,
  RunConstructExtentSchema,
  isImageFormat,
  type ContentImageBlock,
  type ContentInterpretation,
  type ContentOrigin,
  type ContentRun,
  type RunConstructExtent,
} from "./content-vocabulary";
import {
  ContentCellBordersSchema,
  ContentCellFillSchema,
  ContentSheetSchema,
  type ContentCellBorders,
  type ContentCellFill,
} from "./content-sheet";
import { ContentDrawPageSchema, ContentSlideSchema } from "./content-drawing";

// The shared block model underlying a wordprocessing document's sections and a presentation document's slides. Ported from ooxml.js's src/typed/shared/content.ts (itself ported from documents.js's src/model/content.ts) — the canonical home now; ooxml.js and documents.js both import this instead of maintaining their own copy. The ContentDocument envelope below (kind + wordprocessing/presentation/spreadsheet/drawing/formula variants) is this package's own addition on top of that shared vocabulary, matching documents.js's existing model/content.ts shape, since a caller needs a single top-level value to carry through a conversion pipeline.

// sourcePath is assigned by each format's reader at read time; this package only defines the field, it doesn't generate values. Known limitation: sourcePath values are stable within one read+layout pass over a single document, not across edits — inserting content earlier in a document shifts every later path. It exists for tagged/accessible-PDF-style traceability and debugging, not edit-tracking, and not (any more, see `frames` immediately below) as the mechanism a node's own rendered position is found through.

// The quarantined residue channel (src/source.ts): an optional `source: { format, xml }` on every content node below that a format reader produces — the same node set that carries sourcePath and frames, plus the containers and the formula. It holds what has no cross-format meaning (a proofing mark, a custom XML payload, raw HTML in markdown): carried verbatim, validated as opaque text, never semantically interpreted anywhere in this package, and never factored into a styles entry (the styles table's strict objects reject the key). A same-format writer may re-emit its own residue verbatim; every other consumer leaves it alone. The generalises-a-precedent lineage: starMath beside canonical MathML, styleId's opaque producer names, sourcePath traceability — one field, one shape, everywhere.

// The fusion primitive every content-kind leaf below adds via its own literal `frames?: LayoutFrame[]` field (Zod's discriminated-union/object model needs the field spliced in field-by-field per variant, not layered on generically through this generic type) — FusedNode<T> names that exact pattern once, for a consumer describing "a content node carrying its own rendered position(s)" in the general case rather than repeating the union of leaf types by hand. A node's own `frames` entries record wherever — and on however many pages — its rendered content actually landed, replacing DocumentTree's old two-tree design of correlating a wholly separate LayoutDocument's own positioned items back to their originating ContentDocument node purely by matching sourcePath strings (see src/package.ts). A node with more than one frame appeared in more than one rendered position — a paragraph's runs wrapping across a page boundary is the common case — without the content itself needing to be split or duplicated. `frames` is absent on a content-only value that has never been through a layout pass, exactly mirroring how DocumentTree.layout used to be absent for the same reason.
export type FusedNode<T> = T & { frames?: LayoutFrame[] };

// --- The annotation channel: `origin` and `interpretation`, one field pair on every content node ----------------------------------------------------------------
//
// Two independent facts a document consumer needs beside the content itself, neither of which any codec produces. They sit on the same node set as the residue channel (every leaf and container below that carries `source`, plus the formula) minus the sheet rule objects (a validation or conditional-format rule is a constraint, not content — nothing about it can be the subject of an origin or a model's reading), and they ride the flat/tree boundary the same way `source` does: decompose and flatten embed node objects, so the fields cross untouched and the bijection laws hold over them unchanged.
//
// `origin` names WHAT the content is, set by whichever reader knows — the only layer that can. The motivating case is the two paths one visual object arrives by: a slide's chart is either a native chart part (exact numbers, from the cache) or a pasted screenshot, and to every consumer downstream they look identical. styleId survives round-trip but is format-specific and says nothing for a chart or a diagram; origin is the format-agnostic classification.
//
// `interpretation` carries what a MODEL made of the content, attached by the consumer that ran the model — never by a codec, which stays model-free and offline by the family's own charter. It exists as a field group on the node for the same reason `frames` replaced the two-tree design: a side table keyed by sourcePath was that same shape of problem, and the fix was the same — put the fact on the thing it is about. Two fields rather than one marked string, because they carry different rights: a TRANSCRIPTION is the document's own words that happen to be in pixels (quotable), a DESCRIPTION is the model's words about the document (referenceable, never quotable); both may be present for one subject, and a flag would let a consumer forget the difference.
//
// mechanism rides the transcript alone. A description has no deterministic path — it is always model-generated prose — so a mechanism on it would be a constant, and the original 'ocr' | 'vision' spelling conflated WHICH PRODUCT produced the text with whether the text is quotable: a vision model asked to transcribe verbatim is OCR functionally, it just is not reproducible. 'deterministic' | 'model' names the property that actually decides downstream behaviour. confidence is a three-value enum deliberately, not a 0-1 float: a self-reported numeric confidence from a vision model does not calibrate, and a float invites thresholds that look principled and are not.

export const ContentListMembershipSchema = z.object({
  numId: z.string().optional(), // identifies a shared numbering definition when the source format has one — docx's w:numId, ODF's minted structural identity — and is absent when the format carries only a depth (OOXML drawing paragraphs' a:pPr/@lvl), where fabricating one would invent numbering identity the source never had
  level: z.number().int().nonnegative(), // w:ilvl
  checked: z.boolean().optional(), // a GFM task-list item's checkbox state — absent when the source format's list items carry no checkbox at all, which is every format but markdown's task-list extension; deliberately on the membership (not the paragraph) because it is a fact about the ITEM, carried on each block that belongs to the item
  itemId: z.string().optional(), // the identity of ONE list item, minted by the reader that produced the membership — absent when the source format states each block as its own item or carries no item identity at all; it distinguishes "one item, several blocks" (same itemId) from "several items sharing this numId/level" (different itemIds), which numId+level alone cannot
  format: z
    .enum([
      "bullet",
      "decimal",
      "lowerLetter",
      "upperLetter",
      "lowerRoman",
      "upperRoman",
    ])
    .optional(), // the item's own numbering format — docx's w:numFmt, ODF's style:num-format — absent when the source format states only a depth with no format of its own (the OOXML drawing paragraphs case numId's own comment describes), which downstream renderers have always treated as an implicit bullet; this field lets a renderer distinguish that from a genuinely ordered list instead of defaulting every list to a bullet marker
});
export type ContentListMembership = z.infer<typeof ContentListMembershipSchema>;

// Per-side borders directly on a paragraph (WordprocessingML's own w:pBdr; ODF's fo:border-top/right/bottom/left) — no diagonals, unlike ContentCellBordersSchema (further down, alongside the table/sheet cell schemas it decorates), since a paragraph is not a rectangular cell with corner-to-corner rules. An otherwise-empty paragraph carrying only `bottom` is the exact shape Word's AutoCorrect "---" then Enter produces (a horizontal rule), and LibreOffice can produce the identical border-only shape without going through a named "Horizontal Line" style.
export const ContentParagraphBordersSchema = z.object({
  left: ContentBorderSchema.optional(),
  right: ContentBorderSchema.optional(),
  top: ContentBorderSchema.optional(),
  bottom: ContentBorderSchema.optional(),
});
export type ContentParagraphBorders = z.infer<
  typeof ContentParagraphBordersSchema
>;

export const ContentParagraphSchema = z.object({
  kind: z.literal("paragraph"),
  runs: z.array(ContentRunSchema),
  constructs: z.array(RunConstructExtentSchema).optional(), // the run-scoped constructs this paragraph carries (RunConstructExtent above) — absent when it carries none, which is the overwhelming common case. Scope split, stated once: a construct bracketing whole BLOCKS is the constructStart/constructEnd marker pair below, never this field; a construct covering a sub-sequence of this paragraph's runs is this field, never a marker pair. One occurrence, one scope, one encoding.
  styleId: z.string().optional(), // w:pStyle/@w:val, e.g. 'Heading1' — round-trip-only: a producer's own style name, meaningful only to a consumer that already knows that producer's naming convention
  codeLanguage: z.string().optional(), // the source-format language identifier of a code-styled block — a markdown fence's info word, the language a syntax-highlighting consumer keys on. Absent on ordinary paragraphs and on a code block whose source named no language. Deliberately a free string, not an enum: no format's language vocabulary is closed, and the field names what the source said, never what a renderer supports
  preformatted: z.boolean().optional(), // whitespace inside this paragraph's own runs is significant and must survive verbatim (no collapsing, no re-wrapping) — the cross-format signal this field exists to carry, meant for any reader whose source format has its own verbatim-whitespace construct: HTML/EPUB's <pre>, markdown's fenced/indented code block, ODF's Preformatted_20_Text paragraph style (its raw ODF style:name — LibreOffice encodes the display name "Preformatted Text"'s own space as "_20_", the identical convention "Heading_20_1"/"Text_20_body" already follow). Independent of codeLanguage: a preformatted block need not name a language, and a language-tagged block is not necessarily whitespace-significant in every source format. A reader that DOES set this field sets it whenever it reads content it knows came from a verbatim/preformatted construct, regardless of how many runs that content produced or whether any of them happens to embed a newline — the run count and run content are never a reliable proxy for this fact (a construct such as a footnote reference nested inside the preformatted block splits it into further runs with no bearing on whitespace significance), so a writer that needs to recognise preformatted content again must consult this field rather than inferring it from run shape. epub-codec's readPre, markdown-codec's code-block lowering, and odf.js's Preformatted_20_Text-chain reading (ExaDev/documents.js#1020) all set it as of #1020's own resolution.
  headingLevel: z.number().int().positive().optional(), // canonical, format-agnostic heading depth (1 = the outermost heading), independent of styleId's own producer-specific spelling — e.g. docx's w:outlineLvl (0-based, so read as level + 1), odf's text:outline-level (already 1-based), markdown's '#' count. Deliberately unbounded here (ODF alone permits ten levels): a format whose own vocabulary tops out lower than what's present (six for HTML/Markdown) clamps on its own way out, via clampHeadingLevel below, rather than this canonical field silently losing information a richer source format actually carried.
  alignment: AlignmentSchema.optional(),
  list: ContentListMembershipSchema.optional(),
  spacingBeforePt: z.number().optional(),
  spacingAfterPt: z.number().optional(),
  lineSpacing: z.number().positive().optional(), // multiple of single line height
  indentLeftPt: z.number().optional(),
  indentRightPt: z.number().optional(),
  indentFirstLinePt: z.number().optional(),
  direction: TextDirectionSchema.optional(), // RTF's own \rtlpar/\ltrpar scope — the paragraph-level of the four this format states direction at (see ContentRun.direction, ContentTableRow.direction, LayoutMetadata.direction for the other three)
  // Explicit page boundaries a paragraph style forces around its own paragraph (docx w:pageBreakBefore, ODF fo:break-before/fo:break-after="page"). A break INSIDE one page style is this per-paragraph flag; a break that SWITCHES page geometry is a section boundary (ContentSection.breakType), and the two never encode one occurrence between them — the same split w:pageBreakBefore and w:sectPr already make in WordprocessingML.
  pageBreakBefore: z.boolean().optional(),
  pageBreakAfter: z.boolean().optional(),
  borders: ContentParagraphBordersSchema.optional(), // direct paragraph-level border formatting (w:pBdr; fo:border-*) — distinct from any table/cell border this paragraph might separately sit inside, and from styleId: a producer can apply a border as direct formatting with no named style involved at all, which is exactly how Word's own AutoCorrect horizontal rule is built
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
  source: SourceResidueSchema.optional(), // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts)
  frames: z.array(LayoutFrameSchema).optional(), // this paragraph's own rendered position(s), once a layout pass has fused one in — see FusedNode above
  ...CONTENT_ANNOTATION_FIELDS,
});
export type ContentParagraph = z.infer<typeof ContentParagraphSchema>;

// The deepest heading level every consumer whose own heading vocabulary tops out at six shares: HTML/Markdown's h1-h6, docx's built-in Heading1-Heading6 style set.
const MAX_HEADING_LEVEL = 6;

// Clamps an arbitrary heading level to the 1-MAX_HEADING_LEVEL range. Exported so a writer targeting one of those (markdown-codec's own private clamp-to-6 logic on write is the motivating case) can share this exact clamp instead of reimplementing it. Deliberately simple: rounds a fractional level to the nearest integer first (a level is conceptually a whole step of depth; a producer should never genuinely hand this a fraction, but rounding rather than truncating avoids silently favouring shallower headings if one ever does), then clamps into [1, MAX_HEADING_LEVEL].
export function clampHeadingLevel(level: number): number {
  return Math.min(MAX_HEADING_LEVEL, Math.max(1, Math.round(level)));
}

export const ContentPageBreakSchema = z.object({
  kind: z.literal("pageBreak"),
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
  source: SourceResidueSchema.optional(), // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts)
  frames: z.array(LayoutFrameSchema).optional(), // where this page break actually landed, once a layout pass has fused one in — see FusedNode above
  ...CONTENT_ANNOTATION_FIELDS,
});
export type ContentPageBreak = z.infer<typeof ContentPageBreakSchema>;

// — Construct boundary markers: the flat form's encoding of a fidelity construct (src/construct.ts) --
//
// The package tree carries a construct as a group — `{ node: <descriptor>, children: <the extent it spans> }` (src/package-node.ts) — but the flat form has no wrapper to hang an extent off: a section's, shape's, or table cell's content is one block list and nothing else. So the flat encoding of a construct is a matched pair of markers bracketing the blocks it spans, and decompose promotes each pair into the group the tree already has. The pair is what makes the 4.1.0 descriptor vocabulary reachable at all from the only shape a codec ever produces: every codec (ooxml.js, odf.js, markdown-codec, pdf-codec) reads and writes ContentDocument, so a construct facility wired only onto the tree is a facility no codec can emit into.
//
// BLOCK scope only — and, since the run-level extent mechanism landed, one of two scopes rather than the only one: this pair brackets whole blocks, while a construct covering a sub-sequence of one paragraph's runs is a RunConstructExtent on that paragraph's own constructs field (see the schema above). The two mechanisms never encode one occurrence between them — a producer picks by where the source format put the construct's extent, not by preference — and the pair keeps its half of that split for the same reason it always had it: a marker is a member of the block list, so it can sit nowhere else.
//
// THE BRACKET-MATCHING CONTRACT, stated once and binding on every producer and consumer: markers pair exactly as balanced parentheses do — a `constructEnd` closes the nearest preceding still-open `constructStart` in the SAME block list, and the blocks between them are that construct's extent. That is the entire pairing mechanism; there is deliberately no id, name, or other pairing key on either marker. Matching never straddles a block list: a pair opened in a section's blocks closes in that same array, and a pair opened inside a table cell closes inside that cell — which is also the only way a construct inside a table is expressible in EITHER encoding, since decomposition treats a table as one leaf and never descends into its cells. A block list whose markers do not balance (an end with no open start, or a start still open when the list ends) is malformed input rather than a shape to repair: see findConstructMarkerImbalance below, the one shared definition of that check.
//
// BALANCE IS NECESSARY, AND A MARKER'S EXTENT IS ITS OWN HEADING/LIST SCOPE (ExaDev/document-schema.js#1122): a heading or list paragraph inside a constructStart/constructEnd pair's extent groups against the OTHER headings and list items inside that same extent only, never against whatever heading or list scope was open outside the pair when it started, and never leaving anything standing for content after constructEnd to inherit. decompose (src/decompose.ts) enforces this by construction rather than by rejecting anything: walkSectionBlocks recurses into a construct's extent with fresh, empty heading and list stacks (the identical reset every OTHER container boundary — a section, a shape, a sheet — already gets), and returns the outer stacks exactly as it found them once the extent's own constructEnd is consumed. A heading paragraph carries its own headingLevel directly (HeadingParagraphSchema, src/package-node.ts) rather than having it inferred from tree depth, so this reset costs nothing: flatten (src/flatten.ts) reads headingLevel straight off each anchor paragraph, never off its ancestry, so which heading scope a construct's own tree position happens to nest under has zero bearing on flatten(decompose(x)) reproducing x. Two consequences follow. First, this is total: it holds for every combination of outer-scope depth and inner heading levels, including a heading inside the extent shallower than whatever was open outside, with no case decompose refuses — see decompose.test.ts's "construct-boundary promotion" suite, including the crossing case itself (a heading open outside the pair, and a shallower one opened and left standing inside it). Second, it is the only design that keeps a construct's own tree position fixed at exactly where its constructStart occurred: the alternative — letting an inner heading retroactively pop an ancestor scope the construct's own attachment point already committed to — would require the construct's own subtree to fork across the popped boundary, which only works if two tree positions can be reassembled back into the one pair the flat form emits, i.e. exactly the marker id "WHY NO ID ON EITHER MARKER" below states this encoding deliberately has no way to carry. A consumer that wants a construct-oblivious global heading walk (an SDT-wrapped heading in Word participating in the surrounding outline, say) already has one: the flat ContentDocument's own block list carries every paragraph's headingLevel in document order regardless of any marker sitting among them, so that walk reads the flat form directly rather than the tree. List scope crossing at a constructStart resolves the same way for the outer side specifically (ExaDev/document-schema.js#1022): decompose closes an open list scope before the pair attaches, exactly as a plain paragraph would, and hoists the construct group to the enclosing heading scope, so a construct at the tail of a list does not strand as a phantom child of the last item it happens to follow. findConstructMarkerImbalance below states only the bracket-matching half of this contract (balance is a property of the marker pair alone); the scope-isolation half above is decompose's own, stated here because both halves bind every producer emitting a pair (ooxml.js, odf.js, markdown-codec, pdf-codec) equally.
//
// WHY NO ID ON EITHER MARKER: an id would have to be minted by whichever producer emitted the pair and then reproduced byte-for-byte by flatten to satisfy the encoding pair's own first law, flatten(decompose(x)) === x (src/package.ts). A construct group carries a descriptor and its children and nothing else, so a marker id would be a value with no home on the tree side and no deterministic way back — whereas a bare bracket has nothing to reproduce and nothing to get wrong. Bracket matching also already generalises to arbitrary nesting depth and to different construct kinds nested inside each other, which is the whole of what a pairing key would have bought.
//
// WHY NO style, sourcePath, frames, OR source: a marker is a boundary, not content — it renders nothing, occupies no space, and has no position — so `frames` and `sourcePath`, which every real block leaf carries, would name facts a boundary does not have. A `style` ref would be worse: refs are a tree-only, table-compression concept (the flat form is always fully materialised, ExaDev/document-schema.js#21), and a construct group's own style ref never resolves onto the construct itself — a construct group is a wrapper with no anchor of its own, so its ref only extends the chain passed to its children, which are ordinary blocks and paragraphs already carrying their own fully-resolved direct properties by the time they reach a marker. And the construct's own residue (src/source.ts) is not a marker field: it rides inside the descriptor the open marker embeds, the same `source` field that descriptor carries as a node in the tree — so nothing sits on either marker beyond the descriptor the open marker names.
export const ContentConstructStartSchema = z.object({
  kind: z.literal("constructStart"),
  descriptor: ConstructDescriptorSchema, // the construct this marker opens — the identical payload a construct group carries as its `node`, so promoting a pair into a group moves this value across untouched
});
export type ContentConstructStart = z.infer<typeof ContentConstructStartSchema>;

// The close half of the pair: its kind is its entire payload, for the reasons stated above. Which construct it closes is a fact about the sequence it sits in, never a fact stored on the marker.
export const ContentConstructEndSchema = z.object({
  kind: z.literal("constructEnd"),
});
export type ContentConstructEnd = z.infer<typeof ContentConstructEndSchema>;

// ContentTable is mutually recursive with ContentBlock (a cell contains blocks, which may themselves be tables) — hand-written, mirroring ooxml.js's own XmlElement/isXmlNode pattern, since z.lazy() collapses to `unknown` for recursive children in the pinned Zod version.
//
// THE GRID RULE, binding on every producer and consumer of a ContentTable (ExaDev/documents.js#1316): a row's `cells` array is DENSE. It holds exactly one entry per grid column, so `row.cells[n]` is the cell occupying grid column n and ContentTable.columns[n] is that same column's own width and header state, and every row of one table has the same length. A merged region is one ANCHOR entry at its top-left position carrying colSpan and/or rowSpan, plus one entry at each remaining position the region covers. Array index is therefore grid column outright: no consumer accumulates preceding spans to recover a column, and no consumer pads a row it is handed.
//
// A COVERED ENTRY IS A REAL CELL, not a hole. It carries no blocks of its own — the region's content belongs to the anchor and appears there exactly once, so a consumer extracting text or counting content visits it once whichever position it reads — but it may carry that position's own background, borders, verticalAlign, sourcePath and source residue. That is the entire reason the rule is dense rather than sparse: a format that models covered positions explicitly (ODF's table:covered-table-cell, a pptx a:tc with hMerge/vMerge="1", each with its own tcPr) has per-covered-position properties with nowhere else to live, while a format that models only anchors (a docx w:tc with w:gridSpan, an HTML td with colspan) loses nothing by having empty placeholders synthesised on read and dropped again on write. Dense is also the form that degrades safely: a consumer oblivious to spans renders a merged table as an unmerged grid of the correct width, where the sparse alternative would silently shift every later column left.
//
// WHICH POSITIONS ARE COVERED IS DERIVED, NEVER STORED. No field marks a covered entry, because the anchors' own spans already determine coverage completely and a flag would be a second source of truth able to contradict them. walkTableGrid (src/table-grid.ts) is the one shared derivation, alongside denseTableRows and placeAnchorTableRows, the two constructions a reader whose source format omits covered positions uses to satisfy this rule rather than re-deriving the placement itself. A well-formed table's anchors tile the grid: the footprints of any two anchors are disjoint, and together with the anchors themselves they cover every position exactly once.
export interface ContentTableCell {
  blocks: ContentBlock[];
  colSpan?: number; // grid columns this cell occupies, set on the anchor only; absent means one. See THE GRID RULE above for where the columns it covers appear.
  rowSpan?: number; // grid rows this cell occupies, set on the anchor only; absent means one. See THE GRID RULE above for where the rows it covers appear.
  background?: ContentCellFill;
  borders?: ContentCellBorders;
  verticalAlign?: "top" | "center" | "bottom"; // RTF's \clvertalt/\clvertalc/\clvertalb; absent means the format's own default (top)
  formula?: string; // a wordprocessing table cell's own computed-value formula (WordPerfect's table math feature), carried verbatim in whatever syntax the source format used — the identical "structure yes, formula content no" boundary ContentSheetCell.formula already draws, since neither this format nor a spreadsheet's own formula language has a closed grammar this package could parse without a general formula engine
  sourcePath?: string;
  source?: SourceResidue; // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts)
  frames?: LayoutFrame[]; // this cell's own rendered position(s), once a layout pass has fused one in — see FusedNode above
  origin?: ContentOrigin; // the annotation channel, stated on this hand-written interface because the recursive family's interfaces do not derive from their zod schemas (ContentTableSchema's spread alone would leave this side silently without the field — the drift its own comment warns about)
  interpretation?: ContentInterpretation;
}

// THE HEADER RULE (ExaDev/documents.js#1377): header-ness is a fact about ONE row, stated per row, never a count or a range on the table. Every format that states it at all states it on the row — docx's w:tblHeader on w:trPr (ECMA-376 17.4.78), RTF's \trhdr, HTML's own <th> cells and the <thead> its rows sit in — and ODF, the one format whose spelling is a wrapper element around a block of rows (table:table-header-rows, OASIS ODF 1.3 part 3, 9.1.7), is read and written by deriving that wrapper from the per-row flags rather than the other way round: its reader sets isHeader on every row inside a wrapper, and its writer wraps each contiguous run of flagged rows in its own wrapper. A count of leading header rows on ContentTable would have been a smaller field and a lossy one — it cannot state docx's own legal "row 3 is a repeat header and rows 0-2 are not", so a docx carrying that would have to be refused or silently flattened on the way in, before any writer ever saw it.
//
// The flags carry no contiguity or position constraint of their own, for that same reason: any subset of rows may be flagged, including a non-leading or non-contiguous one, and no reader, writer or consumer may assume a flagged run starts at row 0. What a format DOES with a flag it cannot spell natively is that format's own writer's business, stated in its own code: ODF wraps each run separately (its grammar allows several table:table-header-rows blocks in one table, and a consumer that only repeats the first degrades exactly as docx's own spec says a mid-table w:tblHeader should), while a format with no header concept at all drops the flag and says so through its diagnostic sink rather than silently.
export interface ContentTableRow {
  cells: ContentTableCell[];
  // pptx tables carry an explicit row height (a:tr/@h); docx tables do not model one at the row level in the same way, so this is undefined there.
  heightPt?: number;
  direction?: TextDirection; // RTF's own \rtlrow/\ltrrow scope — the row-level of the four this format states direction at (see ContentRun.direction, ContentParagraph.direction, LayoutMetadata.direction for the other three)
  isHeader?: boolean; // this row is a header row: a heading band over the columns below it, which a paginating consumer repeats at the top of each page the table continues onto. Absent means it is not, the same absent-means-false optional-boolean convention ContentRun.bold and ContentParagraph.preformatted already follow — so a row a format states nothing about reads back byte-identically rather than gaining an `isHeader: false` no producer wrote. See THE HEADER RULE above for why this is per-row.
}

// THE HEADER COLUMN RULE (ExaDev/documents.js#1381): a mirror of THE HEADER RULE above, one axis over. Header-column-ness is a fact about ONE column, stated on that column's own object, never a parallel boolean array indexed alongside columns: a parallel array would be a second source of truth able to disagree with columns.length, exactly what THE GRID RULE's "which positions are covered is derived, never stored" note already argues against for row/cell coverage. A bare `columnWidthsPt: number[]` had no per-column object for the flag to live on at all, which is why this field is `columns: ContentTableColumn[]` rather than a width array. Only ODF ever states it (table:table-header-columns, OASIS ODF 1.3 part 3, 9.1.8): which columns repeat at the left of each page a wide table is split across when printed, the column-axis mirror of table:table-header-rows repeating rows at the top of each page a tall table is split across. docx states no header-column concept on w:tblGrid at all, and no other format this package reads states one either. This is deliberately not HTML's `<th scope="row">`, which states that a cell semantically labels the row it sits in, a fact about ONE cell rather than about the whole column, and belongs on ContentTableCell if it is ever modelled; conflating the two would state a print-pagination fact using a semantic-labelling vocabulary that does not carry it.
export interface ContentTableColumn {
  widthPt: number;
  isHeader?: boolean; // this column is a header column: repeated at the left of each page a wide table is split across when printed. Absent means it is not, the same absent-means-false optional-boolean convention ContentTableRow.isHeader already follows. See THE HEADER COLUMN RULE above for why only ODF ever sets this.
}

export interface ContentTable {
  kind: "table";
  rows: ContentTableRow[];
  columns: ContentTableColumn[];
  sourcePath?: string; // deterministic, document-order-derived path assigned by the format reader
  source?: SourceResidue; // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts)
  frames?: LayoutFrame[]; // this table's own rendered position(s), once a layout pass has fused one in — see FusedNode above
  origin?: ContentOrigin; // the annotation channel, on the hand-written interface for the same reason as ContentTableCell's own copy above
  interpretation?: ContentInterpretation;
}

// ContentEmbeddedObject is mutually recursive with ContentDocument (an embedded object carries a whole ContentDocument, which can itself contain another embedded object — e.g. a formula embedded inside a drawing embedded inside a spreadsheet) — hand-written, mirroring ContentTable/ContentBlock's own recursive-guard-plus-z.custom pattern immediately below, since z.lazy() collapses to `unknown` for recursive children in this pinned Zod version. Every objectKind except 'chart' names an embedded whole sub-document of the identically-named ContentDocument kind, 'formula' included now that ContentDocument has a real 'formula' variant of its own (below) — so an embedded equation carries genuine MathML rather than, as before, a wordprocessing document standing in for one. 'chart' is the deliberate exception (ExaDev/documents.js#719): a chart is not a document kind and may never gain a lossless ContentDocument variant, so it names a chart graphic frame's cached series/category model and its document holds whatever data projection the producing codec could express — ooxml.js carries an xlsx or pptx chart part's cached table as a small spreadsheet ContentDocument (one sheet whose cells are that table, the honest document-granularity spelling of tabular data), while odf.js reads the chart's own local data cache onto a frame-sized drawing page — with the chart's own serialised specifics riding the object's residue channel. That is the objectKind/document pairing being a convention rather than a constraint, doing real work: 'chart' says what the frame held (so a consumer can tell a chart from an embedded workbook), document.kind says how the payload is shaped, and neither lies about the other. A 'formula' object is expected to be short enough that a layout engine can reasonably lay it out and render it; the others are expected to round-trip through this model losslessly without ever being laid out or rendered. This package holds schemas only, so no rendering/layout logic lives here regardless of objectKind.
export type ContentEmbeddedObjectKind =
  | "formula"
  | "wordprocessing"
  | "presentation"
  | "spreadsheet"
  | "drawing"
  | "chart";

export interface ContentEmbeddedObject {
  objectKind: ContentEmbeddedObjectKind;
  document: ContentDocument;
  frame: Box; // page-space position and size, in the same xPt/yPt/widthPt/heightPt convention as ContentShape.frame
  // Cell-anchor position, mirroring ContentSheetImageSchema's own anchorRow/anchorColumn/offsetXPt/offsetYPt field names and types exactly (src/content.ts's ContentSheetImageSchema, further down this file) — all four optional here, unlike on ContentSheetImageSchema where they're required, since only a spreadsheet-anchored embedded object (one held in ContentSheetSchema.embeddedObjects) ever sets them; a wordprocessing/presentation/drawing embedded object has no cell to anchor into and simply omits all four.
  anchorRow?: number;
  anchorColumn?: number;
  offsetXPt?: number; // offset from the anchor cell's own top-left corner
  offsetYPt?: number;
  source?: SourceResidue; // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts)
  origin?: ContentOrigin; // the annotation channel, on the hand-written interface for the same reason as ContentTableCell's own copy above
  interpretation?: ContentInterpretation;
}

// The block-level anchoring point for an embedded object inside a wordprocessing section's or a presentation/drawing shape's own block flow — reuses ContentEmbeddedObject's fields directly (frame included) rather than nesting a separate `embeddedObject: ContentEmbeddedObject` field, since ContentEmbeddedObject already carries its own frame and duplicating it would just be two copies of the same position.
export interface ContentEmbeddedObjectBlock extends ContentEmbeddedObject {
  kind: "embeddedObject";
  sourcePath?: string; // deterministic, document-order-derived path assigned by the format reader
  frames?: LayoutFrame[]; // this embedded object's own rendered position(s), once a layout pass has fused one in — see FusedNode above
}

// The two boundary markers join the union at the end, so a 4.1.0 block list parses identically here. That is not the whole of this addition's type-level impact, though: a consumer switching exhaustively over the union is one thing it breaks — the same additive-plus-exhaustive-switch trade the construct descriptor kinds themselves made — and a second, distinct break rides along with it. The package tree admits every member of this union at a leaf position EXCEPT the two markers (src/package-node.ts's TreeBlockLeaf): a construct is a group there, and one fact carried in two encodings inside one tree would break the encoding pair's laws. Enforcing that exclusion in the types narrows SectionChild/ShapeChild/ListChild/TreeLeaf from ContentBlock down to TreeBlockLeaf (src/package-node.ts), so code that previously assigned an already-typed ContentBlock/ContentBlock[] value into one of those narrower positions — e.g. `const children: SectionChild[] = blocks` where blocks: ContentBlock[] — stops compiling on upgrade, independent of whether it ever switches exhaustively over anything.
export type ContentBlock =
  | ContentParagraph
  | ContentTable
  | ContentImageBlock
  | ContentPageBreak
  | ContentEmbeddedObjectBlock
  | ContentConstructStart
  | ContentConstructEnd;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContentRun(value: unknown): value is ContentRun {
  return isRecord(value) && typeof value.text === "string";
}

function isContentTableCell(value: unknown): value is ContentTableCell {
  return (
    isRecord(value) &&
    Array.isArray(value.blocks) &&
    value.blocks.every(isContentBlock)
  );
}

function isContentTableRow(value: unknown): value is ContentTableRow {
  return (
    isRecord(value) &&
    Array.isArray(value.cells) &&
    value.cells.every(isContentTableCell) &&
    (value.heightPt === undefined || typeof value.heightPt === "number") &&
    (value.isHeader === undefined || typeof value.isHeader === "boolean")
  );
}

function isContentTableColumn(value: unknown): value is ContentTableColumn {
  return (
    isRecord(value) &&
    typeof value.widthPt === "number" &&
    (value.isHeader === undefined || typeof value.isHeader === "boolean")
  );
}

function isContentEmbeddedObjectKind(
  value: unknown,
): value is ContentEmbeddedObjectKind {
  return (
    value === "formula" ||
    value === "wordprocessing" ||
    value === "presentation" ||
    value === "spreadsheet" ||
    value === "drawing" ||
    value === "chart"
  );
}

// Delegates document validation to ContentDocumentSchema itself (via the box above) instead of hand-rolling a second, parallel structural guard for every ContentDocument variant — ContentDocumentSchema is a plain Zod discriminated union of ordinary object schemas, not a self-referential z.lazy schema, so one already-built schema value validating another already-built schema value at runtime carries none of the "collapses to unknown" risk that motivates the z.custom pattern in the first place; that risk is specific to Zod's own static type inference over a self-referential schema *definition*. contentDocumentSchemaBox.value is read here only inside this function's body (a closure), and by the time this function is ever called the whole module, including the box's own population further down this file, has already finished evaluating.
function isContentEmbeddedObject(
  value: unknown,
): value is ContentEmbeddedObject {
  return (
    isRecord(value) &&
    isContentEmbeddedObjectKind(value.objectKind) &&
    BoxSchema.safeParse(value.frame).success &&
    contentDocumentSchemaBox.value!.safeParse(value.document).success &&
    (value.anchorRow === undefined ||
      (typeof value.anchorRow === "number" &&
        Number.isInteger(value.anchorRow) &&
        value.anchorRow >= 0)) &&
    (value.anchorColumn === undefined ||
      (typeof value.anchorColumn === "number" &&
        Number.isInteger(value.anchorColumn) &&
        value.anchorColumn >= 0)) &&
    (value.offsetXPt === undefined || typeof value.offsetXPt === "number") &&
    (value.offsetYPt === undefined || typeof value.offsetYPt === "number")
  );
}

// The two marker guards, exported for the consumers that have to recognise a boundary without parsing the whole block: the package tree's leaf predicates, which reject them (src/package-node.ts), and findConstructMarkerImbalance below, which walks a block list looking for exactly these two kinds.
export function isContentConstructStart(
  value: unknown,
): value is ContentConstructStart {
  return (
    isRecord(value) &&
    value.kind === "constructStart" &&
    ConstructDescriptorSchema.safeParse(value.descriptor).success
  );
}

export function isContentConstructEnd(
  value: unknown,
): value is ContentConstructEnd {
  return isRecord(value) && value.kind === "constructEnd";
}

// The run-extent guard, exported beside the marker guards for the same consumers: the block guard's paragraph arm (immediately below), which must recognise a well-formed constructs array without parsing the whole paragraph, and any codec or reader that has to recognise a run-level extent without a full parse. It validates the entry's own shape — a record carrying a descriptor the construct vocabulary accepts and two non-negative integer bounds — and deliberately NOT the range's validity against a paragraph's runs: that cross-object fact is findRunConstructFault's to state, exactly as bracket balance is findConstructMarkerImbalance's.
export function isRunConstructExtent(
  value: unknown,
): value is RunConstructExtent {
  if (!isRecord(value)) return false;
  if (!ConstructDescriptorSchema.safeParse(value.descriptor).success)
    return false;
  return isValidRunBound(value.startRun) && isValidRunBound(value.endRun);
}

function isValidRunBound(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

// Recursive structural guard. Used via z.custom so table cells (and now embedded-object documents) validate without a recursive Zod schema (which collapses to `unknown` under z.lazy in this Zod version).
export function isContentBlock(value: unknown): value is ContentBlock {
  if (!isRecord(value)) {
    return false;
  }
  const kind = value.kind;
  if (kind === "paragraph") {
    return (
      Array.isArray(value.runs) &&
      value.runs.every(isContentRun) &&
      (value.constructs === undefined ||
        (Array.isArray(value.constructs) &&
          value.constructs.every(isRunConstructExtent)))
    );
  }
  if (kind === "image") {
    return (
      isImageFormat(value.format) &&
      typeof value.base64 === "string" &&
      typeof value.widthPt === "number" &&
      typeof value.heightPt === "number"
    );
  }
  if (kind === "pageBreak") {
    return true;
  }
  if (kind === "table") {
    return (
      Array.isArray(value.rows) &&
      value.rows.every(isContentTableRow) &&
      Array.isArray(value.columns) &&
      value.columns.every(isContentTableColumn)
    );
  }
  if (kind === "embeddedObject") {
    return isContentEmbeddedObject(value);
  }
  if (kind === "constructStart") {
    return isContentConstructStart(value);
  }
  if (kind === "constructEnd") {
    return true;
  }
  return false;
}

// ContentBlockSchema itself is defined further down this file (after ContentTableSchema, one of its own recursive members) as a real, self-recursive z.discriminatedUnion() — ExaDev/documents.js#1009's z.lazy() rewrite, the identical treatment #937 already applied to MathMlNodeSchema (src/mathml.ts) and this file's own MathExpressionSchema import now shares (src/math.ts). isContentBlock (above) stays exported as a standalone type guard regardless, the same "kept, no longer backing a z.custom() node" treatment isMathExpression/isMathMlNode already got.

// Where a block list's construct markers stop balancing: an `unmatchedEnd` is a close with no construct open at that point, an `unclosedStart` is an open still standing when the list ended. `index` is the offending block's own position in the list — the close itself for the first, and for the second the OUTERMOST still-open start, since that is where the unbalanced region begins rather than where the walk happened to notice it.
export type ConstructMarkerImbalance =
  | { kind: "unmatchedEnd"; index: number }
  | { kind: "unclosedStart"; index: number };

// The one shared definition of the bracket-matching contract's balance check (see the marker schemas above for the contract itself): returns the first place a block list's markers fail to match, or undefined when they balance. It lives here rather than in each consumer because at least three of them must agree exactly — every codec that emits a pair, and this package's own decompose (src/decompose.ts), which promotes each matched pair into a construct group and so must reject a list it cannot promote instead of silently repairing one — and because no schema can express it: balance is a property of a block list's sequence, not of any block in it, so ContentBlockSchema validating every member says nothing about whether the members pair up.
//
// Deliberately non-recursive. Each block list is its own bracket scope (a table cell's list matches independently of the list containing the table), so a caller walking nested lists calls this once per list — which is exactly the walk decompose already performs — rather than this helper duplicating that walk with its own idea of where the nested lists are.
export function findConstructMarkerImbalance(
  blocks: readonly ContentBlock[],
): ConstructMarkerImbalance | undefined {
  const openStartIndices: number[] = [];
  for (const [index, block] of blocks.entries()) {
    if (isContentConstructStart(block)) {
      openStartIndices.push(index);
    } else if (
      isContentConstructEnd(block) &&
      openStartIndices.pop() === undefined
    ) {
      return { kind: "unmatchedEnd", index };
    }
  }
  const outermostUnclosed = openStartIndices[0];
  if (outermostUnclosed !== undefined) {
    return { kind: "unclosedStart", index: outermostUnclosed };
  }
  return undefined;
}

// Where a paragraph's run-level construct extents stop naming real runs: an `invertedRange` is an extent whose end precedes its start, a `beyondRuns` one whose bounds reach outside 0..runs.length (a negative bound included — the schema's non-negative integers already refuse it at parse time, but this helper's contract is stated over runtime values, not only parsed ones). `index` is the offending entry's own position in the paragraph's constructs array. The run-level twin of findConstructMarkerImbalance above, existing for the same reason: a codec emitting run extents, and any consumer walking them, must agree on exactly one definition of a well-formed extent, and no schema can express it — the range bound is the paragraph's own runs.length, a cross-object fact no single node's schema states. Deliberately silent on crossing extents: two entries whose ranges overlap are well-formed data (see RunConstructExtentSchema), not a fault, because ranges impose no nesting the way a bracket sequence must.
export type RunConstructFault =
  | { kind: "invertedRange"; index: number }
  | { kind: "beyondRuns"; index: number };

export function findRunConstructFault(
  paragraph: ContentParagraph,
): RunConstructFault | undefined {
  const constructs = paragraph.constructs;
  if (constructs === undefined) return undefined;
  for (const [index, extent] of constructs.entries()) {
    if (extent.startRun > extent.endRun) {
      return { kind: "invertedRange", index };
    }
    if (extent.startRun < 0 || extent.endRun > paragraph.runs.length) {
      return { kind: "beyondRuns", index };
    }
  }
  return undefined;
}

export const ContentTableCellSchema = z.object({
  blocks: z.lazy(() => z.array(contentBlockSchemaBox.value!)),
  colSpan: z.number().int().positive().optional(),
  rowSpan: z.number().int().positive().optional(),
  background: ContentCellFillSchema.optional(),
  borders: ContentCellBordersSchema.optional(),
  verticalAlign: z.enum(["top", "center", "bottom"]).optional(), // RTF's \clvertalt/\clvertalc/\clvertalb; absent means the format's own default (top)
  formula: z.string().optional(), // a wordprocessing table cell's own computed-value formula, carried verbatim — see the ContentTableCell interface's own field comment
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
  source: SourceResidueSchema.optional(), // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts)
  frames: z.array(LayoutFrameSchema).optional(), // this cell's own rendered position(s), once a layout pass has fused one in — see FusedNode above
  ...CONTENT_ANNOTATION_FIELDS,
});

export const ContentTableRowSchema = z.object({
  cells: z.array(ContentTableCellSchema),
  heightPt: z.number().positive().optional(),
  direction: TextDirectionSchema.optional(), // RTF's own \rtlrow/\ltrrow scope — the row-level of the four this format states direction at (see ContentRun.direction, ContentParagraph.direction, LayoutMetadata.direction for the other three)
  isHeader: z.boolean().optional(), // this row is a header row — see THE HEADER RULE on the ContentTableRow interface above for why it is stated per row rather than as a count or range on the table
});

export const ContentTableColumnSchema = z.object({
  // nonnegative, not positive: both ooxml.js's docx reader (a w:gridCol with no w:w attribute) and odf.js's table reader (a table:table-column resolving no style-column-width) deliberately default an unresolvable column's own width to 0 rather than omitting it or guessing, a real, common shape in real-world documents, not a defect this constraint should reject. Confirmed against this package's own real-corpus bijection gate (ExaDev/documents.js#1009: ContentBlockSchema's z.lazy() rewrite was the first time this field was ever actually validated at runtime, since the opaque z.custom() guard it replaced never checked column-width positivity at all).
  widthPt: z.number().nonnegative(),
  isHeader: z.boolean().optional(), // this column is a header column; see THE HEADER COLUMN RULE on the ContentTable interface above for why only ODF ever states it
});

export const ContentTableSchema = z.object({
  kind: z.literal("table"),
  rows: z.array(ContentTableRowSchema),
  columns: z.array(ContentTableColumnSchema),
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
  source: SourceResidueSchema.optional(), // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts)
  frames: z.array(LayoutFrameSchema).optional(), // this table's own rendered position(s), once a layout pass has fused one in — see FusedNode above
  ...CONTENT_ANNOTATION_FIELDS,
});

// The real, self-recursive z.discriminatedUnion() ContentBlockSchema's own doc comment (above, where the old z.custom() binding used to live) points to — placed here, after ContentTableSchema, because this is the first point in the module every one of its seven members already exists as a real binding (ContentTableSchema, defined immediately above, is the last of the seven to become available; ContentParagraphSchema/ContentImageBlockSchema/ContentPageBreakSchema/ContentEmbeddedObjectBlockSchema/ContentConstructStartSchema/ContentConstructEndSchema all sit earlier in the file). Every member is deliberately left unannotated — the same "annotate only the outer union's own binding, not its members" rule MathExpressionSchema/MathMlNodeSchema already follow, since annotating a member widens it so z.discriminatedUnion (which needs each member's own propValues) rejects the union.
//
// Both z.ZodType type arguments are ContentBlock — not just the first (Output). Supplying only one would leave Input at its own default of `unknown`, invisible to this package's own tests (which read Output alone via z.infer<>) but not to a z.codec() consumer elsewhere in the workspace — the identical MathMlNodeSchema/MathExpressionSchema gotcha (#937/#1009). ContentBlockSchema has no transform, so Input and Output are genuinely identical, and annotating both is correct rather than merely defensive.
export const ContentBlockSchema: z.ZodType<ContentBlock, ContentBlock> =
  z.discriminatedUnion("kind", [
    ContentParagraphSchema,
    ContentTableSchema,
    ContentImageBlockSchema,
    ContentPageBreakSchema,
    ContentEmbeddedObjectBlockSchema,
    ContentConstructStartSchema,
    ContentConstructEndSchema,
  ]);

contentBlockSchemaBox.value = ContentBlockSchema;
contentBlockSchemaBox.value = ContentBlockSchema;

// One furniture kind's per-slot block flows — see ContentSectionSchema's own headers/footers comment for the slot vocabulary's format evidence. A slot is absent when the section states no furniture for it: an absent default slot with a present even slot is the even/odd-headers shape, not a gap (ExaDev/documents.js#1128).
export const ContentPageFurnitureSchema = z.object({
  default: z.lazy(() => z.array(ContentBlockSchema)).optional(),
  even: z.lazy(() => z.array(ContentBlockSchema)).optional(),
  first: z.lazy(() => z.array(ContentBlockSchema)).optional(),
});
export type ContentPageFurniture = z.infer<typeof ContentPageFurnitureSchema>;

// A docx section: a run of pages sharing one page size/margins (a w:sectPr boundary starts a new one).
export const ContentSectionSchema = z.object({
  pageSize: PageSizeSchema,
  margins: MarginsSchema,
  blocks: z.lazy(() => z.array(ContentBlockSchema)),
  // How this section begins relative to the one before it, in the producer's own four-word vocabulary (docx w:sectPr/w:type's nextPage/continuous/evenPage/oddPage; an ODF page style's break-before rule narrows onto the same members). Absent means the format's own default break — nextPage in WordprocessingML — rather than a stored default: an absent key and a key restating the default are one fact, and only the spelled members carry information.
  breakType: z
    .enum(["nextPage", "continuous", "evenPage", "oddPage"])
    .optional(),
  // The page furniture this section repeats on its rendered pages — the block flow a header or footer paints — in the three-slot vocabulary WordprocessingML itself defines (w:headerReference/w:footerReference's own @w:type values default/even/first, with evenAndOddHeaders gating the even slot). Every page-furniture-carrying format narrows onto it: an ODF master page's style:header/style:header-left pair is default/even, its style:header-first the first slot; a WordPerfect D6 header's own occurrence bits (occurs on odd pages / occurs on even pages) state odd-only -> default, even-only -> even, both -> default. Section-scoped rather than document-level for the reason breakType is: page furniture belongs to the section that renders it, and a document with two sections may give each its own header.
  headers: ContentPageFurnitureSchema.optional(),
  footers: ContentPageFurnitureSchema.optional(),
  // The section's watermarks — page furniture that is neither a header nor a footer: a full-page background (WordPerfect's D6 watermark, painted behind the body text on every page it occurs on) rather than a band at a page edge, so it owns no place in the headers/footers pair and owns the same three-slot per-parity shape they do (a WordPerfect D6 watermark's occurrence bits narrow exactly as a header's do: odd-only -> default, even-only -> even, both parities -> default). Section-scoped for the identical reason headers/footers are. Carried per-slot with the same one-flow-per-slot contract: a format whose own mechanism supplies more than one watermark per parity (WordPerfect's A/B supersede pair) resolves to the first claimant, exactly as it does for headers.
  watermarks: ContentPageFurnitureSchema.optional(),
  source: SourceResidueSchema.optional(), // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts); rides the tree's section descriptor automatically (omit+extend, src/package-node.ts)
  ...CONTENT_ANNOTATION_FIELDS,
});
export type ContentSection = z.infer<typeof ContentSectionSchema>;

// Formula content model: a standalone equation document (an ODF .odf formula document, or the equation an embedded 'formula' object carries). Unlike the other four kinds this has no page/slide/sheet structure at all — a formula is one expression, positioned by whatever embeds it, so there is nothing here to paginate or place. Whatever embeds it supplies position through its own frames field (a ContentEmbeddedObjectBlock's frames describe the rendered box the equation occupies); the semantic payload here is position-independent by nature, and the fusion invariant deliberately reaches no further into a formula than that box.
//
// A formula's meaning is carried as two co-equal authoritative layers, joined in this one shape: `presentation` (rendering-authoritative) and `content` (computation-authoritative), alongside the source formats' own trees and strings. Neither layer is stored derived from the other — string-to-tree lowering is total (worst case an `unparsed` node), tree-to-string rendering is partial, and storage takes the recoverable side by carrying both verbatim. The atomic pair-edit rule: editing one layer must never silently mutate the other — an editor changing `content` leaves `presentation` byte-identical unless it explicitly rewrites both — and any canonical form used to match or diff the two layers is a derived view computed at comparison time, never written back in place. That rule is documentation-stated rather than Zod-enforced on purpose: the schema's job is to carry both layers losslessly, and a producer that mutates one layer in place is misbehaving in a way no input shape can prevent — consumers comparing layers recompute their own canonical views rather than trusting either layer to be normalised.
export const ContentFormulaSchema = z.object({
  // The formula's own MathML presentation-layer tree, carried as raw XML nodes (see src/mathml.ts for why that, rather than a MathML-specific element vocabulary). An array rather than a single root because a real formula part's content is a node list — an XML declaration and/or whitespace text nodes commonly precede the <math> element itself, and dropping them on the way in would make this model lossy for no gain. Required even when the source carried no MathML of its own (a LaTeX-authored equation lowered on the way in): such a formula carries an empty array, which keeps every existing constructor of this shape valid.
  mathml: z.array(MathMlNodeSchema),
  // The equivalent StarMath source, when the producing format carried one alongside the MathML (ODF stores it as the formula's own annotation). Purely informational: MathML is the authoritative content, and a consumer that renders from starMath instead is rendering a secondary encoding of the same expression.
  starMath: z.string().optional(),
  // The rendering-authoritative layer: the formula's LaTeX, stored verbatim (src/math.ts's MathPresentationSchema). A renderer serialises this string exactly as it stands and never re-emits it from the semantic layer below. Absent on a formula whose source offered nothing LaTeX-shaped, in which case rendering falls back to the MathML tree above.
  presentation: MathPresentationSchema.optional(),
  // The computation-authoritative layer: a MathExpression tree (src/math.ts). Absent means nobody has lowered this formula to semantics yet; an `unparsed` node inside it means somebody tried and hit a construct the grammar does not cover — coverage gaps stay visible data, never parse failures. The symbol and unit references inside resolve against the embedding document's own symbolTable field (below).
  content: MathExpressionSchema.optional(),
  // Where this formula came from and what has touched it since (src/math.ts's MathProvenanceSchema).
  provenance: MathProvenanceSchema.optional(),
  // Quarantined residue (src/source.ts) — opaque text the producing format carries and no other format interprets; the formula document's own node position, since a formula package's single leaf is the formula itself.
  source: SourceResidueSchema.optional(),
  ...CONTENT_ANNOTATION_FIELDS,
});
export type ContentFormula = z.infer<typeof ContentFormulaSchema>;

// ContentDocument carries no formatVersion of its own: it is the in-process codec-exchange type the codecs hand each other and never a serialised artefact in its own right, so it has no version to declare. Versioning lives entirely at the serialised-artefact boundary — a dumped document or package states its version through the release-pinned $schema URI its dumper stamped (src/schema-io.ts), which is also what an ingesting documentFromJson dispatches on. Releases 1.x-3.x carried a per-arm formatVersion literal here; 4.0.0 retired it (ExaDev/document-schema.js#20's errata).

// Fields every one of the five ContentDocument arms below carries in addition to its own kind and metadata — currently the document-level math symbol table (SymbolTableSchema, src/math.ts): the curation layer mapping each written symbol glyph to its quantity kind, preferred unit, and definition, alongside the unit registry a formula's expressions resolve their symbol and unit references against. Spliced into each arm via spread rather than factored through a base schema the arms extend, because z.discriminatedUnion() needs each member as a plain z.object carrying its own literal `kind` field in place. Optional on every arm: a document with no lowered math content (most of them) simply omits it, and the table is presentation-inert by construction — it curates what symbols mean, never how any formula renders — so its presence or absence changes no rendering. Exported because DocumentTreeSchema's own arms (src/package.ts) spread the identical field set — one declaration, so a shared field added here reaches the package root without a second edit.
export const contentDocumentSharedFields = {
  symbolTable: SymbolTableSchema.optional(),
};

// A workbook-level defined name (xlsx workbook.xml's definedNames/definedName, [MS-XLS] DEFINEDNAME, ODF table:named-expressions/table:named-expression): a name bound to a range or formula, which a sheet's own formulas then reference by name. refersTo is carried verbatim in whatever syntax the source format used — Excel's own formula language has no closed grammar this package could parse without a general formula engine, the identical reasoning ContentSheetCell.formula and the dataValidation formulas already record — so a same-format writer re-emits it unchanged and a cross-format consumer treats it as opaque text. scopeSheetIndex names the sheet a sheet-local name belongs to (a 0-based index into the spreadsheet document's own sheets array, the model's own identity for a sheet object); absent means workbook-global. Two entries may share one name across different scopes, exactly as xlsx and BIFF8 themselves allow — which is also why these are an array on the document rather than a record keyed by name.
export const ContentDefinedNameSchema = z.object({
  name: z.string(),
  refersTo: z.string(),
  scopeSheetIndex: z.number().int().nonnegative().optional(),
});
export type ContentDefinedName = z.infer<typeof ContentDefinedNameSchema>;

export const ContentDocumentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("wordprocessing"),
    metadata: LayoutMetadataSchema,
    ...contentDocumentSharedFields,
    sections: z.array(ContentSectionSchema),
  }),
  z.object({
    kind: z.literal("presentation"),
    metadata: LayoutMetadataSchema,
    ...contentDocumentSharedFields,
    slides: z.array(ContentSlideSchema),
  }),
  z.object({
    kind: z.literal("spreadsheet"),
    metadata: LayoutMetadataSchema,
    ...contentDocumentSharedFields,
    sheets: z.array(ContentSheetSchema),
    names: z.array(ContentDefinedNameSchema).optional(), // workbook-level defined names — see ContentDefinedNameSchema above. Workbook-level rather than sheet-level because that is where every source format states them (xlsx workbook.xml, BIFF8's workbook-stream DEFINEDNAME records, ODF's table:named-expressions beside the body), and a name's own scopeSheetIndex is what binds a sheet-local one to its sheet
  }),
  z.object({
    kind: z.literal("drawing"),
    metadata: LayoutMetadataSchema,
    ...contentDocumentSharedFields,
    pages: z.array(ContentDrawPageSchema),
  }),
  z.object({
    kind: z.literal("formula"),
    metadata: LayoutMetadataSchema,
    ...contentDocumentSharedFields,
    formula: ContentFormulaSchema,
  }),
]);
contentDocumentSchemaBox.value = ContentDocumentSchema;
export type ContentDocument = z.infer<typeof ContentDocumentSchema>;
