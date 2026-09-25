// The reader's incremental state machine: accumulates runs, paragraphs, table rows/cells and block-scoped constructs as the token loop (read-parse.ts) feeds it, and produces the final ContentDocument once the document closes. See this module's own header comment on read.ts (the original, now split, home of this reader) for the "conventions of an RTF reader" model this implements.
import {
  type Color,
  type ConstructDescriptor,
  type ContentBlock,
  type ContentBorder,
  type ContentCellBorders,
  type ContentDocument,
  type ContentParagraph,
  type ContentRun,
  type ContentSection,
  type ContentTable,
  type ContentTableCell,
  type ContentTableRow,
  type LayoutMetadata,
  type PositionedTableRow,
  type RunConstructExtent,
  type TextDirection,
  denseTableRows,
} from "document-schema.js";
import {
  applyCellDefinitionControlWord,
  newPendingCell,
  resolveBorder,
  resolveCellFill,
  type CellBorderSide,
  type PendingCell,
} from "./cell-format";
import {
  bookmarkAnchorDescriptor,
  coalesceRunConstructs,
  provenanceDescriptors,
} from "./constructs";
import { RtfDiagnosticCodes, type RtfDiagnosticSink } from "./diagnostics";
import type { RtfHeader } from "./header";
import { LEVEL_NUMBER_FORMAT_BULLET, mintRtfListNumId } from "./list-id";
import { buildRunFields, sectionGeometry } from "./read-build";
import { LINE_SPACING_UNITS_PER_LINE, twipsToPoints } from "./units";
import {
  closingBookmarkExtent,
  freshAccumulatorState,
  horizontalSpanAt,
  insertConstructMarkers,
  runKey,
  verticalMergeRowSpan,
  type BlockConstructExtent,
  type BookmarkState,
  type BuilderAccumulatorState,
  type CharacterState,
  type OpenBookmark,
  type OpenFormField,
  type ParagraphState,
  type RawTableRow,
  type SectionState,
} from "./read-state";

export class ContentBuilder {
  private readonly sections: ContentSection[] = [];
  private blocks: ContentBlock[] = [];
  private runs: ContentRun[] = [];
  private pendingRunKey: string | undefined;
  private pendingRunText = "";
  private pendingRunFields: Omit<ContentRun, "text"> = {};
  // The provenance descriptors each pushed run carries, positionally parallel to `runs` — coalesced into the fewest run extents that say the same thing when the paragraph closes, so a revision spanning several formatting runs is one extent rather than one per run.
  private runProvenance: ConstructDescriptor[][] = [];
  private pendingRunProvenance: ConstructDescriptor[] = [];
  // Rows as read, each keeping its own <celldef> run beside its cells so the spans can be derived once the whole table is known.
  private tableRows: RawTableRow[] = [];
  private tableColumnRights: number[] = [];
  private rowCells: ContentTableCell[] = [];
  private cellBlocks: ContentBlock[] = [];
  private pendingCellRights: number[] = [];
  private pendingCellDefinitions: PendingCell[] = [];
  private pendingCell: PendingCell = newPendingCell();
  private rowLeftTwips = 0;
  // The <rowwrite> member (\ltrrow | \rtlrow) of the row definition currently accumulating — reset by startRowDefinition with the rest of the pending row state, so a \rtlrow anywhere between a \trowd and its \cellxN run (where the spec's own <tbldef> production places it) reaches the row it belongs to.
  private rowDirection: TextDirection | undefined;
  // The \trhdr row property of the row definition currently accumulating, reset by startRowDefinition with the rest of the pending row state exactly as rowDirection is, so a \trhdr anywhere between a \trowd and its \cellxN run reaches the row it belongs to.
  private rowIsHeader = false;
  // Bookmark bookkeeping. A bookmark's two halves are matched by name and may bracket a sub-sequence of one paragraph's runs or a run of whole paragraphs, and document-schema.js gives those two scopes two different encodings — a RunConstructExtent on the paragraph, or a constructStart/constructEnd marker pair in the block list. Which one applies is not knowable when the start is seen, only when its end arrives, so a start is held open here and resolved then.
  private paragraphSerial = Symbol("paragraph");
  private openBookmarks = new Map<string, OpenBookmark>();
  // Extents whose two halves landed in different paragraphs of the same block list, waiting for that list to be finalised. Two lists, because a table cell's blocks and a section's blocks are separate bracket scopes and a pair may not straddle them.
  private sectionBlockExtents: BlockConstructExtent[] = [];
  private cellBlockExtents: BlockConstructExtent[] = [];
  private pendingRunConstructs: RunConstructExtent[] = [];
  // Bookmarks whose end half arrived in the paragraph currently accumulating, having started in an earlier one — resolvable only once that paragraph's own block index is known.
  private closingBookmarks: OpenBookmark[] = [];
  // Form fields, held open the same way as a bookmark, but stacked rather than named: a \field group's own open and close are one matched pair, not two independently placed halves. Real producers keep a form field's \fldrslt inline, within one paragraph, but RTF's own grammar permits a multi-paragraph result (see OpenFormField's own comment above), so the paragraphSerial check in endFormField below is a genuine cross-paragraph guard, not merely defensive: it catches that case and drops the contentControl with a diagnostic rather than producing an inverted or mis-attached range.
  private readonly openFormFields: OpenFormField[] = [];
  // Suspended accumulator states, one per \result currently rendering — a stack rather than a single slot because a malformed producer can nest an \object (with its own \result) inside another \object's own \result content; see beginResultScratch/endResultScratch.
  private readonly resultScratchStack: BuilderAccumulatorState[] = [];

  constructor(
    private readonly header: RtfHeader,
    private readonly sink: RtfDiagnosticSink,
  ) {}

  // "{\*\bkmkstart ...}" — flushing first so the bookmark's boundary is a run boundary, which is what makes the extent expressible at all.
  startBookmark(
    bookmark: Readonly<BookmarkState>,
    para: Readonly<ParagraphState>,
  ): void {
    this.flushRun();
    const name = bookmark.name;
    if (name.length === 0) {
      return;
    }
    this.openBookmarks.set(name, {
      // bookmarkAnchorDescriptor's own bookmarkColumnResidue already treats {first: undefined, last: undefined} identically to undefined itself (both fields absent means no residue either way), so there is no need to pre-collapse the two here — the object is always the same shape, and the callee's own undefined-field handling is what actually decides whether a clause is produced.
      descriptor: bookmarkAnchorDescriptor(name, {
        first: bookmark.columnFirst,
        last: bookmark.columnLast,
      }),
      paragraphSerial: this.paragraphSerial,
      runIndex: this.runs.length,
      inTable: para.inTable,
      blockIndex: undefined,
    });
  }

  // "{\*\bkmkend ...}". "Each bookmark start should have a matching bookmark end; however, the bookmark start and the bookmark end may be in any order" — an end naming a bookmark no start opened is therefore reported rather than treated as an error, since the pairing is by name and not by nesting.
  endBookmark(name: string): void {
    this.flushRun();
    const open = this.openBookmarks.get(name);
    if (open === undefined) {
      this.sink({
        code: RtfDiagnosticCodes.BOOKMARK_UNPAIRED,
        severity: "warning",
        message: `a \\bkmkend named '${name}' has no matching \\bkmkstart, so no anchor construct is produced for it`,
      });
      return;
    }
    this.openBookmarks.delete(name);
    if (open.paragraphSerial === this.paragraphSerial) {
      this.pendingRunConstructs.push({
        descriptor: open.descriptor,
        startRun: open.runIndex,
        endRun: this.runs.length,
      });
      return;
    }
    this.closingBookmarks.push(open);
  }

  // Called only once a `\*\fldinst` destination's own close has confirmed the field is a genuine form field (FORMTEXT/FORMCHECKBOX/FORMDROPDOWN) — never for an ordinary field (PAGE, DATE, NUMPAGES, REF, SEQ, TOC, MERGEFIELD, and the rest), which has no `\*\formfield` extent to open at all. Flushing first for the same reason startBookmark does: the extent's boundary is a run boundary. No text is appended between `{\field`'s own open and `\*\fldinst`'s close, so the run boundary this opens lands in exactly the same place it would if opened at `{\field` itself.
  startFormField(): void {
    this.flushRun();
    this.openFormFields.push({
      paragraphSerial: this.paragraphSerial,
      runIndex: this.runs.length,
    });
  }

  // The matching "}" for a `\field` group startFormField above already opened an extent for — the caller invokes this whenever FieldState.formFieldStarted is true, so `open` here is never undefined except for genuinely malformed, unbalanced RTF. `descriptor` can still be undefined: startFormField fires as soon as an EARLY, partial instruction (read at some nested \*\fldinst-destination group's own close) names a form-field keyword, but a real Word-authored instruction can keep growing after that point (see startFormField's own call site comment), and RTF's word-boundary anchoring in formFieldControlType means appending more identifier characters directly after the keyword — with no separating space or switch delimiter — can make the COMPLETE instruction stop matching a pattern a strictly shorter prefix of it satisfied. Popping unconditionally here, rather than only when a descriptor happens to still be available, is what keeps this stack's own push and pop provably paired regardless of that edge case.
  endFormField(descriptor: ConstructDescriptor | undefined): void {
    this.flushRun();
    const open = this.openFormFields.pop();
    if (open === undefined) {
      return;
    }
    if (descriptor === undefined) {
      // The word-boundary edge case above: this field's own instruction named a recognised form-field keyword at some intermediate point, opening the extent, but no longer does now that it is complete. There is no contentControl left to attach the extent to, so it is dropped — reported through the sink like every other drop this feature makes, rather than disappearing silently.
      this.sink({
        code: RtfDiagnosticCodes.FORM_FIELD_KEYWORD_LOST,
        severity: "warning",
        message:
          "a form field's contentControl is dropped: its \\*\\fldinst instruction matched a form-field keyword partway through parsing but no longer did once the complete instruction was read",
      });
      return;
    }
    if (open.paragraphSerial !== this.paragraphSerial) {
      // A RunConstructExtent is scoped to one paragraph's own runs, so a \fldrslt whose content crossed a \par or \cell (see the comment on OpenFormField above) leaves no extent this reader can express — the contentControl is dropped rather than mis-attached to whichever paragraph happens to be open now. Every other drop in this feature reports through the sink; this one must too rather than disappearing silently.
      this.sink({
        code: RtfDiagnosticCodes.FORM_FIELD_SPAN_DROPPED,
        severity: "warning",
        message:
          "a form field's contentControl is dropped: its \\fldrslt content crossed a paragraph or table-cell boundary, and this reader's per-paragraph construct extent cannot span one",
      });
      return;
    }
    this.pendingRunConstructs.push({
      descriptor,
      startRun: open.runIndex,
      endRun: this.runs.length,
    });
  }

  appendText(
    text: string,
    char: CharacterState,
    hyperlink: string | undefined,
  ): void {
    // No length guard on `text` itself: this method's one call site (emitText, below) is only ever reached with a non-empty string — decodeCodepageBytes runs after flushBytes' own `pendingBytes.length === 0` guard, and every other emitText caller (a \uN escape, a special character or symbol) hands it a literal 1-character string — so an empty-string branch here would never fire on real input.
    if (char.hidden) {
      return;
    }
    const fontName =
      char.fontIndex === undefined
        ? undefined
        : this.header.fonts.get(char.fontIndex)?.name;
    const color =
      char.colorIndex === undefined
        ? undefined
        : this.header.colors[char.colorIndex];
    const key = runKey(char, fontName, color, hyperlink);
    if (this.pendingRunKey !== key) {
      this.flushRun();
      this.pendingRunKey = key;
      this.pendingRunFields = buildRunFields(char, fontName, color, hyperlink);
      this.pendingRunProvenance = provenanceDescriptors(
        char.revision,
        this.header.revisionAuthors,
      );
    }
    this.pendingRunText += text;
  }

  private flushRun(): void {
    if (this.pendingRunText.length > 0) {
      this.runs.push({ ...this.pendingRunFields, text: this.pendingRunText });
      this.runProvenance.push(this.pendingRunProvenance);
    }
    this.pendingRunText = "";
    this.pendingRunKey = undefined;
    this.pendingRunFields = {};
    this.pendingRunProvenance = [];
  }

  // Closes the paragraph currently accumulating. `force` distinguishes an explicit \par (which always produces a paragraph, empty ones included — an empty paragraph is real content in a wordprocessing document) from an implicit boundary such as a \cell or the end of the document, which produces nothing when nothing has accumulated.
  endParagraph(para: Readonly<ParagraphState>, force: boolean): void {
    this.flushRun();
    if (!force && this.runs.length === 0) {
      return;
    }
    const target = para.inTable ? this.cellBlocks : this.blocks;
    if (!para.inTable) {
      this.closeTable();
    }
    const blockIndex = target.length;
    target.push(this.buildParagraph(para));
    this.runs = [];
    this.runProvenance = [];
    this.resolveBookmarkPositions(para, blockIndex);
    // A fresh symbol identifies this new paragraph uniquely against every other one, past or future — see OpenFormField's own comment on why identity, not a counted ordering, is what every reader of this field actually needs.
    this.paragraphSerial = Symbol("paragraph");
  }

  // Once a paragraph has taken its place in a block list, every bookmark that opened inside it learns that index (so a pair closing later knows where to bracket from), and every pair whose end landed in it becomes a block extent. Both are deferred to here rather than recorded at the marker, because closeTable() above can push a table between the marker and the paragraph and shift the index the marker would have guessed.
  private resolveBookmarkPositions(
    para: Readonly<ParagraphState>,
    blockIndex: number,
  ): void {
    // No `open.blockIndex === undefined` guard: a still-open bookmark's own paragraphSerial is fixed at the paragraph it opened in, and this reader gives every closed paragraph a fresh symbol identity that is never reused, so `open.paragraphSerial === this.paragraphSerial` can hold true for at most one resolveBookmarkPositions call per bookmark — the very call for the paragraph it opened in. A defined blockIndex and a matching serial can therefore never coincide, making the guard permanently redundant rather than a real defensive check.
    for (const open of this.openBookmarks.values()) {
      if (open.paragraphSerial === this.paragraphSerial) {
        open.blockIndex = blockIndex;
      }
    }
    this.flushClosingBookmarks(para.inTable, blockIndex + 1);
  }

  // Turns every bookmark whose end half has arrived into a block extent ending at `endIndex`. Called once per closed paragraph, and again when a block list is finalised — a bookmark whose {\*\bkmkend ...} follows the list's last \par has no later paragraph to be resolved against, so without the second call it would silently vanish.
  private flushClosingBookmarks(inTable: boolean, endIndex: number): void {
    // No `this.closingBookmarks.length === 0` guard: looping over an empty array and reassigning `this.closingBookmarks = []` to an already-empty array are both no-ops, so a dedicated fast path here would be equivalent-mutant-prone with no observable difference.
    const target = inTable ? this.cellBlockExtents : this.sectionBlockExtents;
    for (const closing of this.closingBookmarks) {
      if (closing.inTable !== inTable) {
        // The pair straddles a table cell's wall, which document-schema.js states as a ratified drop rather than a shape to repair: "each block list is its own bracket scope and cross-list pairing is ids again".
        this.sink({
          code: RtfDiagnosticCodes.BOOKMARK_UNPAIRED,
          severity: "warning",
          message: `the bookmark '${closing.descriptor.name}' spans a table cell boundary; a construct extent cannot straddle two block lists, so no anchor construct is produced for it`,
        });
        continue;
      }
      target.push(closingBookmarkExtent(closing, endIndex));
    }
    this.closingBookmarks = [];
  }

  // The run-scoped extents this paragraph carries, in document order by where each starts. No filter against runs.length here for the well-formedness bound document-schema.js's own findRunConstructFault states (0 <= startRun <= endRun <= runs.length): every entry in pendingRunConstructs is pushed with endRun set to this.runs.length AT THAT EXACT MOMENT (endBookmark's own same-paragraph branch, endFormField), and runs.length only ever grows between then and this call (more text can still follow within the same paragraph, but nothing ever shortens it) — so a stale, now-too-large endRun can never occur by construction. coalesceRunConstructs draws its own endRun values from indices into `this.runProvenance`, which is pushed in lockstep with `this.runs` (flushRun always pushes both together), so its own bound holds for the identical reason. A filter here would never remove anything a real call could produce.
  private takeRunConstructs(): RunConstructExtent[] {
    const extents = [
      ...this.pendingRunConstructs,
      ...coalesceRunConstructs(this.runProvenance),
    ];
    this.pendingRunConstructs = [];
    this.runProvenance = [];
    return extents.sort(
      (left, right) =>
        left.startRun - right.startRun || left.endRun - right.endRun,
    );
  }

  private buildParagraph(para: Readonly<ParagraphState>): ContentParagraph {
    const style =
      para.styleIndex === undefined
        ? undefined
        : this.header.styles.get(para.styleIndex);
    const headingLevel =
      para.outlineLevel === undefined
        ? style?.headingLevel
        : para.outlineLevel + 1;
    const constructs = this.takeRunConstructs();
    const paragraph: ContentParagraph = {
      kind: "paragraph",
      runs: this.runs,
      ...(constructs.length === 0 ? {} : { constructs }),
    };
    const withStyle =
      style?.name === undefined || style.name.length === 0
        ? paragraph
        : { ...paragraph, styleId: style.name };
    return {
      ...withStyle,
      // Every consumer reads .headingLevel/.alignment/.direction by value, never by key presence (toEqual ignores an undefined-valued key the same way it ignores an absent one), so unconditionally including all three removes equivalent-mutant-prone ternaries with no observable difference.
      headingLevel,
      alignment: para.alignment,
      direction: para.direction,
      ...(para.indentLeftTwips === 0
        ? {}
        : { indentLeftPt: twipsToPoints(para.indentLeftTwips) }),
      ...(para.indentFirstLineTwips === 0
        ? {}
        : { indentFirstLinePt: twipsToPoints(para.indentFirstLineTwips) }),
      ...(para.spaceBeforeTwips === 0
        ? {}
        : { spacingBeforePt: twipsToPoints(para.spaceBeforeTwips) }),
      ...(para.spaceAfterTwips === 0
        ? {}
        : { spacingAfterPt: twipsToPoints(para.spaceAfterTwips) }),
      ...this.lineSpacingFields(para),
      ...(para.pageBreakBefore ? { pageBreakBefore: true } : {}),
      ...this.listFields(para),
    };
  }

  // "\slN Space between lines ... If N is a positive value, this size is used only if it is taller than the tallest character ... if N is a negative value, the absolute value of N is used" and "\slmultN Line spacing multiple ... 1 Multiple line spacing, relative to 'Single'". ContentParagraph.lineSpacing is a multiple of single line height, so only the \slmult1 form converts exactly: RTF states its multiple in 240ths of a line, Word's own unit for it. An \sl0 or absent value means automatic spacing and produces no field at all.
  private lineSpacingFields(para: Readonly<ParagraphState>): {
    lineSpacing?: number;
  } {
    const value = para.lineSpacingTwips;
    // No `value === 0` clause: when value is 0, multiple below is also exactly 0, and the trailing `multiple > 0` check already returns {} for that case — an explicit early check for the same thing here would be an equivalent-mutant-prone duplicate of that guard, not a distinct check.
    if (value === undefined || !para.lineSpacingIsMultiple) {
      return {};
    }
    const multiple = Math.abs(value) / LINE_SPACING_UNITS_PER_LINE;
    return multiple > 0 ? { lineSpacing: multiple } : {};
  }

  private listFields(para: Readonly<ParagraphState>): {
    list?: { numId: string; level: number };
  } {
    const overrideIndex = para.listOverrideIndex;
    if (overrideIndex === undefined || overrideIndex === 0) {
      return {};
    }
    const list = this.header.lists.get(overrideIndex);
    const level = list?.levels[para.listLevel] ?? list?.levels[0];
    const type =
      level?.numberFormat === LEVEL_NUMBER_FORMAT_BULLET ? "bullet" : "ordered";
    return {
      list: {
        numId: mintRtfListNumId({
          listOverrideIndex: overrideIndex,
          type,
          // mintRtfListNumId reads .start by value (options.start !== undefined), never by key presence.
          start: level?.startAt,
        }),
        level: para.listLevel,
      },
    };
  }

  startRowDefinition(): void {
    this.pendingCellRights = [];
    this.pendingCellDefinitions = [];
    this.pendingCell = newPendingCell();
    this.rowLeftTwips = 0;
    this.rowDirection = undefined;
    this.rowIsHeader = false;
  }

  setRowLeft(twips: number): void {
    this.rowLeftTwips = twips;
  }

  setRowDirection(direction: TextDirection): void {
    this.rowDirection = direction;
  }

  setRowHeader(): void {
    this.rowIsHeader = true;
  }

  // Every control word of the <celldef> currently accumulating. Void: applyControlWord's own dispatch chain calls this unconditionally now (see its own comment on why that is safe), so the caller no longer needs this wrapper's own report of whether the word was one of the cell-definition's — only applyCellDefinitionControlWord's own return value, which its own direct unit tests already exercise on its own terms.
  applyCellDefinition(name: string, param: number | undefined): void {
    applyCellDefinitionControlWord(name, param, this.pendingCell);
  }

  // "\cellxN Defines the right boundary of a cell" — and, being the last member of <celldef>, closes the definition that preceded it.
  addCellBoundary(rightTwips: number): void {
    this.pendingCellRights.push(rightTwips);
    this.pendingCellDefinitions.push(this.pendingCell);
    this.pendingCell = newPendingCell();
  }

  endCell(para: Readonly<ParagraphState>): void {
    this.endParagraph(para, false);
    this.flushClosingBookmarks(true, this.cellBlocks.length);
    this.rowCells.push({
      blocks: insertConstructMarkers(
        this.cellBlocks,
        this.cellBlockExtents,
        this.sink,
      ),
    });
    this.cellBlocks = [];
    this.cellBlockExtents = [];
  }

  endRow(para: Readonly<ParagraphState>): void {
    if (this.cellBlocks.length > 0 || this.pendingRunText.length > 0) {
      this.endCell(para);
    }
    if (this.rowCells.length === 0) {
      this.sink({
        code: RtfDiagnosticCodes.TABLE_ROW_WITHOUT_DEFINITION,
        severity: "warning",
        message: "a \\row closed a table row that contained no \\cell marks",
      });
      return;
    }
    this.tableRows.push({
      cells: this.rowCells,
      definitions: this.pendingCellDefinitions,
      direction: this.rowDirection,
      isHeader: this.rowIsHeader,
    });
    if (this.tableColumnRights.length === 0) {
      this.tableColumnRights = [...this.pendingCellRights];
    }
    this.rowCells = [];
  }

  closeTable(): void {
    if (this.tableRows.length === 0) {
      return;
    }
    const rows = this.resolveRows();
    // Every resolved row is already as wide as the grid (see resolveRows), so any row's length is the grid width; the row definition's own \cellxN boundaries are the other lower bound, since a row can end before the definition's last boundary.
    const columnCount = Math.max(
      this.tableColumnRights.length,
      ...rows.map((row) => row.cells.length),
    );
    this.blocks.push({
      kind: "table",
      rows,
      // RTF states no header-column concept at all (no \trhdr-style control word scoped to a column rather than a row), so every column here states a width alone.
      columns: this.columnWidths(columnCount).map((widthPt) => ({ widthPt })),
    } satisfies ContentTable);
    this.tableRows = [];
    this.tableColumnRights = [];
  }

  // Folds each row's own <celldef> run onto its cells, resolving the two merge families into ContentTable's dense grid: RTF writes one \cellxN and one \cell per grid column, so a cell's index in its row is its grid column, the anchor carries the span, and every covered position keeps its own entry with no blocks.
  //
  // Neither span count is stored by RTF — \clvmgf/\clvmrg and \clmgf/\clmrg are flags, not counts — so both are derived by scanning forward for the continuation flags, exactly as ooxml.js derives rowSpan from w:vMerge.
  private resolveRows(): ContentTableRow[] {
    const rows = this.tableRows;
    const positioned = rows.map((row, rowIndex): PositionedTableRow => {
      const rowsBelow = rows.slice(rowIndex + 1);
      return {
        // The row's own <rowwrite> member (\ltrrow | \rtlrow), absent meaning the default the spec states for \ltrrow. Every consumer reads .direction by value, never by key presence.
        direction: row.direction,
        // Absent rather than false for an ordinary row, so a table with no header row reads back as the object a producer that has never heard of \trhdr would build.
        isHeader: row.isHeader ? true : undefined,
        cells: row.cells.map((cell, column) => ({
          columnIndex: column,
          cell: this.resolveCell(row, rowsBelow, column, cell),
        })),
      };
    });
    // A row that ends before the definition's last \cellxN boundary is padded with empty cells, so every row is as wide as the grid.
    return denseTableRows(positioned, this.tableColumnRights.length);
  }

  private resolveCell(
    row: RawTableRow,
    rowsBelow: readonly RawTableRow[],
    column: number,
    cell: ContentTableCell,
  ): ContentTableCell {
    const definition = row.definitions[column];
    const borders = this.resolveBorders(definition);
    const background =
      definition === undefined
        ? undefined
        : resolveCellFill(definition, (index) => this.header.colors[index]);
    // Every consumer reads .background/.borders/.verticalAlign by value, never by key presence.
    const own = {
      background,
      borders,
      verticalAlign: definition?.verticalAlign,
    };
    // A covered position holds no blocks: the merged region's content belongs to its anchor alone, whatever placeholder text a producer wrote into the continuation's own \cell. It still carries the position's own cell properties.
    if (
      definition?.horizontalMergeContinuation === true ||
      definition?.verticalMergeContinuation === true
    ) {
      return { blocks: [], ...own };
    }
    const colSpan = horizontalSpanAt(row.definitions, column);
    const rowSpan =
      definition?.verticalMergeFirst === true
        ? verticalMergeRowSpan(rowsBelow, column)
        : 1;
    return {
      blocks: cell.blocks,
      ...(colSpan > 1 ? { colSpan } : {}),
      ...(rowSpan > 1 ? { rowSpan } : {}),
      ...own,
    };
  }

  private resolveBorders(
    definition: PendingCell | undefined,
  ): ContentCellBorders | undefined {
    if (definition === undefined) {
      return undefined;
    }
    const colorAt = (index: number): Color | undefined =>
      this.header.colors[index];
    const sides: [CellBorderSide, ContentBorder | undefined][] = (
      ["top", "left", "bottom", "right"] as const
    ).map((side) => {
      const pending = definition.borders[side];
      return [
        side,
        pending === undefined ? undefined : resolveBorder(pending, colorAt),
      ];
    });
    const present = sides.filter(
      (entry): entry is [CellBorderSide, ContentBorder] =>
        entry[1] !== undefined,
    );
    return present.length === 0
      ? undefined
      : Object.fromEntries(present as [string, ContentBorder][]);
  }

  // \cellxN states "the right boundary of a cell, including its half of the space between cells" as a cumulative offset, so a column's width is the difference between consecutive boundaries, with the row's own \trleftN as the first left edge. A boundary sequence that is not increasing is malformed — it would produce a zero or negative width, which ContentTable's own schema refuses — so the whole derivation is replaced by an even split of the section's text width, reported rather than silently substituted.
  private columnWidths(columnCount: number): number[] {
    // No `.slice(0, columnCount)` on this iteration: closeTable's own sole call site always derives columnCount as Math.max(this.tableColumnRights.length, ...), so columnCount can never be smaller than this.tableColumnRights.length itself — a slice bounded by columnCount can therefore never actually truncate the array it is called on, making it equivalent to iterating the array bare.
    const rights = this.tableColumnRights;
    const widths: number[] = [];
    let previous = this.rowLeftTwips;
    for (const right of rights) {
      widths.push(twipsToPoints(right - previous));
      previous = right;
    }
    const usable = twipsToPoints(
      this.header.page.paperWidthTwips -
        this.header.page.marginLeftTwips -
        this.header.page.marginRightTwips,
    );
    if (widths.length !== columnCount || widths.some((width) => width <= 0)) {
      this.sink({
        code: RtfDiagnosticCodes.TABLE_COLUMN_WIDTH_INVALID,
        severity: "warning",
        message:
          "the row's \\cellxN boundaries do not describe increasing column widths for every column; falling back to an even split of the page's text width",
      });
      return Array.from({ length: columnCount }, () => usable / columnCount);
    }
    return widths;
  }

  // Splices zero or more already-finished blocks into place — one at a time for a decoded \pict/\object, or a whole run at once for \result's own recovered fallback content (see endResultScratch) — flushing whatever run is mid-accumulation first, exactly as a single addBlock always did, and targeting the open table cell's own list or the section's the same way endParagraph does. A no-op for an empty list, so callers never need to guard the \result case (which recovers nothing when \objdata decoded, or when \result itself had no content) with their own length check.
  addBlocks(blocks: readonly ContentBlock[], inTable: boolean): void {
    if (blocks.length === 0) {
      return;
    }
    this.flushRun();
    const target = inTable ? this.cellBlocks : this.blocks;
    target.push(...blocks);
  }

  // Snapshots every field BuilderAccumulatorState names, by reference — the arrays/map themselves move to the snapshot, not copies of their contents, so the fields below can be pointed at a fresh empty set without the old one changing shape underneath whoever holds the snapshot.
  private captureAccumulatorState(): BuilderAccumulatorState {
    return {
      blocks: this.blocks,
      runs: this.runs,
      pendingRunKey: this.pendingRunKey,
      pendingRunText: this.pendingRunText,
      pendingRunFields: this.pendingRunFields,
      runProvenance: this.runProvenance,
      pendingRunProvenance: this.pendingRunProvenance,
      tableRows: this.tableRows,
      tableColumnRights: this.tableColumnRights,
      rowCells: this.rowCells,
      cellBlocks: this.cellBlocks,
      pendingCellRights: this.pendingCellRights,
      pendingCellDefinitions: this.pendingCellDefinitions,
      pendingCell: this.pendingCell,
      rowLeftTwips: this.rowLeftTwips,
      rowDirection: this.rowDirection,
      rowIsHeader: this.rowIsHeader,
      paragraphSerial: this.paragraphSerial,
      openBookmarks: this.openBookmarks,
      sectionBlockExtents: this.sectionBlockExtents,
      cellBlockExtents: this.cellBlockExtents,
      pendingRunConstructs: this.pendingRunConstructs,
      closingBookmarks: this.closingBookmarks,
    };
  }

  private restoreAccumulatorState(saved: BuilderAccumulatorState): void {
    this.blocks = saved.blocks;
    this.runs = saved.runs;
    this.pendingRunKey = saved.pendingRunKey;
    this.pendingRunText = saved.pendingRunText;
    this.pendingRunFields = saved.pendingRunFields;
    this.runProvenance = saved.runProvenance;
    this.pendingRunProvenance = saved.pendingRunProvenance;
    this.tableRows = saved.tableRows;
    this.tableColumnRights = saved.tableColumnRights;
    this.rowCells = saved.rowCells;
    this.cellBlocks = saved.cellBlocks;
    this.pendingCellRights = saved.pendingCellRights;
    this.pendingCellDefinitions = saved.pendingCellDefinitions;
    this.pendingCell = saved.pendingCell;
    this.rowLeftTwips = saved.rowLeftTwips;
    this.rowDirection = saved.rowDirection;
    this.rowIsHeader = saved.rowIsHeader;
    this.paragraphSerial = saved.paragraphSerial;
    this.openBookmarks = saved.openBookmarks;
    this.sectionBlockExtents = saved.sectionBlockExtents;
    this.cellBlockExtents = saved.cellBlockExtents;
    this.pendingRunConstructs = saved.pendingRunConstructs;
    this.closingBookmarks = saved.closingBookmarks;
  }

  // Begins rendering \result's own fallback content into a totally isolated accumulator, suspending whatever paragraph, block list, table, or bookmark state was already accumulating around \object — so \result's content can neither destroy that state (a paragraph still open before \object started, as "before" is in `before {\object...}`) nor be destroyed by the block-index confusion a range-based retraction produced (a bare-inline \result closing no block of its own, or a second \result sibling overwriting the first's range). flushRun() first so a run already pending in the SUSPENDED paragraph is completed before it is set aside, rather than left half-built underneath the fresh state. endResultScratch, called when \result's own group closes, hands back whatever this produced and restores the suspended state.
  beginResultScratch(): void {
    this.flushRun();
    this.resultScratchStack.push(this.captureAccumulatorState());
    this.restoreAccumulatorState(freshAccumulatorState());
  }

  // Ends \result's own scratch rendering: force-closes whatever paragraph it was still accumulating — RTF 1.9.1's own <result> = '{' \result <para>+ '}' lets the group's own closing brace stand in for the final paragraph's \par exactly as a table cell's \cell or the document's own end already do elsewhere in this reader (endParagraph's own force=false is exactly that "implicit boundary" case: it produces nothing new when \result's content already closed with its own explicit \par, and produces the one paragraph still pending when it did not) — then hands back every block \result's content produced, from BOTH of the scratch's own block lists, before restoring the accumulator `beginResultScratch` suspended. Reading both rather than picking one by `para.inTable` matters because that flag can genuinely diverge from where a nested paragraph's own content actually landed: \intbl restated directly on \result's own group sets `para.inTable` here, but a child group nested inside \result (RTF 1.9.1's own <result> grammar admits \intbl among <parfmt>* on \result's own para, so this is spec-legal input, not malformed) can \pard-reset ITS OWN copy back to false before its own \par closes it into `blocks` instead of `cellBlocks` — so `para.inTable` at this group's own end no longer says which list the content actually reached. Concatenating both sidesteps the question entirely: `beginResultScratch` started both empty and nothing outside \result's own content can write to either, so everything either list holds by now belongs to \result regardless of which one it is. `closeTable()` runs unconditionally first (matching endSection's own unconditional call, not gated on `para.inTable` either) so a table that genuinely closed inside \result (a real \trowd/\cellx/\cell/\row run) is already folded into `blocks` before the read, rather than left sitting in `tableRows` where neither returned list would surface it.
  endResultScratch(para: Readonly<ParagraphState>): ContentBlock[] {
    this.endParagraph(para, false);
    this.closeTable();
    const blocks = [...this.blocks, ...this.cellBlocks];
    const saved = this.resultScratchStack.pop();
    if (saved !== undefined) {
      this.restoreAccumulatorState(saved);
    }
    return blocks;
  }

  // A truncated or otherwise malformed input can leave one or more \result groups never closed at all (no matching '}' before the input ends), so endResultScratch above — the only place that ever pops resultScratchStack — never runs for them: the accumulator stays swapped to \result's own isolated scratch state, mid-render, forever. Were finish() to build the document from that state as-is, it would emit whatever \result's own truncated content happened to accumulate in place of the ENTIRE suspended real document \result's own \object was sitting inside — fallback content kept, the real body silently discarded, exactly backwards from \object's own group-end preference (real \objdata over \result, real content over a still-open \result's placeholder). Restoring every still-suspended state here, most-recently-opened first, throws the incomplete scratch content away and hands the real accumulator back before finish() ever reads from it; well-formed input closes every \result group's own scratch normally, so resultScratchStack is already empty by the time this runs and the loop is a no-op.
  private discardUnclosedResultScratches(): void {
    while (this.resultScratchStack.length > 0) {
      const saved = this.resultScratchStack.pop();
      if (saved !== undefined) {
        this.restoreAccumulatorState(saved);
      }
    }
  }

  endSection(
    section: Readonly<SectionState>,
    para: Readonly<ParagraphState>,
  ): void {
    this.endParagraph(para, false);
    this.closeTable();
    this.flushClosingBookmarks(false, this.blocks.length);
    this.reportUnclosedBookmarks();
    const blocks = insertConstructMarkers(
      this.blocks,
      this.sectionBlockExtents,
      this.sink,
    );
    this.sectionBlockExtents = [];
    if (blocks.length === 0 && this.sections.length > 0) {
      this.blocks = [];
      return;
    }
    this.sections.push({
      ...sectionGeometry(section),
      ...(section.breakType === undefined
        ? {}
        : { breakType: section.breakType }),
      blocks,
    });
    this.blocks = [];
  }

  // A section's block list is the outermost bracket scope this reader builds, so a bookmark still open when one ends never closes at all. The spec requires that "each bookmark start should have a matching bookmark end"; one that has none names an extent with no end, which neither encoding can state, so it is reported and dropped rather than silently extended to the end of the document.
  private reportUnclosedBookmarks(): void {
    for (const open of this.openBookmarks.values()) {
      this.sink({
        code: RtfDiagnosticCodes.BOOKMARK_UNPAIRED,
        severity: "warning",
        message: `the bookmark '${open.descriptor.name}' has no matching \\bkmkend within its own block flow, so no anchor construct is produced for it`,
      });
    }
    this.openBookmarks.clear();
  }

  finish(
    metadata: LayoutMetadata,
    section: Readonly<SectionState>,
    para: Readonly<ParagraphState>,
  ): ContentDocument {
    this.discardUnclosedResultScratches();
    // No `if (this.sections.length === 0) { this.sections.push(...) }` fallback after this call: endSection's own drop condition (`blocks.length === 0 && this.sections.length > 0`) can only ever skip pushing when sections.length is ALREADY at least 1 — its second operand is false whenever sections.length is 0, so THIS call, the one endSection call finish() ever makes, is unconditionally guaranteed to leave sections.length at least 1 regardless of what it was beforehand. A fallback guarding against a state this call can never produce would be genuinely unreachable, not defensive.
    this.endSection(section, para);
    return { kind: "wordprocessing", metadata, sections: this.sections };
  }
}
