import { Box, Text, useInput } from 'ink';
import { useEffect, useState, type Dispatch, type ReactElement } from 'react';
import type { Alignment, Box as GeometryBox, DocxParagraph, DocxRun, DocxTable, DocxTableCell, MarkdownParagraph, MarkdownRun, MarkdownTable, MarkdownTableCell, MathMlNode, OdtParagraph, OdtRun, OdtTable, OdtTableCell } from 'documents.js';
import { ListView } from '../../components/list-view.js';
import { TextField } from '../../components/text-field.js';
import { useNavigationInput, type NavigationInputOptions } from '../../keybindings/use-navigation-input.js';
import type { Action } from '../../state/actions.js';
import { useAppDispatch, useAppState } from '../../state/context.js';
import { anyOverlayOpen, selectionKeyFor, type DocxOpenDocument, type MarkdownOpenDocument, type OdtOpenDocument, type OpenDocument } from '../../state/types.js';
import { FieldWizard, requireFieldValue, type FieldSpec } from './field-wizard.js';
import { FormulaPicker } from './formula-picker.js';
import { parseNonNegativeIntField, parseNumberField, parsePositiveIntField, truncatePreview } from './text.js';

// docx, odt and markdown share one paragraph/run/table model closely enough (see documents.js's own README: "readDocxContent and readOdtContent both produce the identical wordprocessing-variant ContentDocument shape", and readMarkdownContent is the third format sharing that same pivot) that DocxParagraph/OdtParagraph/MarkdownParagraph and DocxRun/OdtRun/MarkdownRun are structurally interchangeable for every screen in this family -- the union types below let every helper and screen here take whichever the open document actually is without a branch, mirroring state/reducer.ts's own `WordprocessingOpenDocument` narrowing (not exported from there, so restated here for this screen family's own use). MarkdownRun/MarkdownParagraph are a genuinely narrower shape than DocxRun/DocxParagraph's own (no underline/colour/fontFamily/sizePt on a run, no alignment on a paragraph) -- see `supportsRunStyleExtras` below for how call sites that need those fields narrow the union down to docx/odt only.
export type ParagraphFamilyOpenDocument = DocxOpenDocument | OdtOpenDocument | MarkdownOpenDocument;
export type ParagraphFamilyLiveParagraph = DocxParagraph | OdtParagraph | MarkdownParagraph;
export type ParagraphFamilyLiveRun = DocxRun | OdtRun | MarkdownRun;
export type ParagraphFamilyLiveTable = DocxTable | OdtTable | MarkdownTable;
export type ParagraphFamilyLiveTableCell = DocxTableCell | OdtTableCell | MarkdownTableCell;

// The docx/odt-only subset of ParagraphFamilyLiveRun that genuinely carries underline/colour/fontFamily/sizePt -- MarkdownRun has none of the four (it carries bold/italic/strike/hyperlink/code instead). `'underline' in run` is a real TypeScript `in`-narrowing check (not a cast): true for exactly the two run classes that declare that getter.
export type ParagraphFamilyStyledRun = DocxRun | OdtRun;

export function supportsRunStyleExtras(run: ParagraphFamilyLiveRun): run is ParagraphFamilyStyledRun {
  return 'underline' in run;
}

export function paragraphFamilyDocument(openDocument: OpenDocument | undefined): ParagraphFamilyOpenDocument | undefined {
  if (openDocument === undefined) {
    return undefined;
  }
  return openDocument.format === 'docx' || openDocument.format === 'odt' || openDocument.format === 'markdown' ? openDocument : undefined;
}

export function liveParagraphAt(doc: ParagraphFamilyOpenDocument, blockIndex: number): ParagraphFamilyLiveParagraph | undefined {
  return doc.editor.paragraphs()[blockIndex];
}

export function liveTableAt(doc: ParagraphFamilyOpenDocument, tableIndex: number): ParagraphFamilyLiveTable | undefined {
  return doc.editor.tables()[tableIndex];
}

// The read-only shape the body list needs for a preview -- deliberately a small structural subset of DocxRun/OdtRun/MarkdownRun (no colour/fontFamily/sizePt: those matter once you are inside a single paragraph, not for a one-line list row) so that `doc.editor.paragraphs()`/`doc.editor.tables()` can be handed to the adapter factory below completely unwrapped -- DocxParagraph, OdtParagraph, and MarkdownParagraph all already satisfy these interfaces structurally. `underline`/`alignment` are genuinely optional keys, not merely `| undefined`-valued ones: MarkdownRun/MarkdownParagraph have no such property AT ALL (not even one reading `undefined`), so the key itself has to be absent-capable for a markdown paragraph's own `runs()`/`.alignment` to satisfy these interfaces without a wrapping adapter.
export interface ParagraphFamilyRun {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline?: boolean;
}

export interface ParagraphFamilyParagraph {
  readonly text: string;
  readonly styleId: string | undefined;
  readonly alignment?: Alignment;
  runs(): readonly ParagraphFamilyRun[];
}

export interface ParagraphFamilyTableCell {
  readonly text: string;
}

export interface ParagraphFamilyTableRow {
  cells(): readonly ParagraphFamilyTableCell[];
}

export interface ParagraphFamilyTable {
  rows(): readonly ParagraphFamilyTableRow[];
}

// odt keeps lists as a genuinely separate tree (OdtList/OdtListItem, reached via OdtEditor.lists()) rather than docx's flat per-paragraph list membership -- so this is the one adapter member docx's own factory call simply omits. It only ever carries an item count, not each item's own text (OdtListItem.text is real, but reading it here as well would mean this summary-row adapter fetching every item of every list just to render one row per list -- screens/editors/odt/list-editor.tsx reads each item's real text directly, once a list is actually opened).
export interface ParagraphFamilyList {
  readonly itemCount: number;
}

export interface ParagraphFamilyAdapter {
  readonly formatLabel: 'docx' | 'odt' | 'markdown';
  paragraphs(): readonly ParagraphFamilyParagraph[];
  tables(): readonly ParagraphFamilyTable[];
  lists?: () => readonly ParagraphFamilyList[];
  appendParagraph(): void;
}

export interface ParagraphFamilyAdapterOptions {
  readonly formatLabel: 'docx' | 'odt' | 'markdown';
  readonly paragraphs: () => readonly ParagraphFamilyParagraph[];
  readonly tables: () => readonly ParagraphFamilyTable[];
  readonly lists?: () => readonly ParagraphFamilyList[];
  readonly dispatch: Dispatch<Action>;
}

// APPEND_PARAGRAPH is already format-agnostic in the reducer (it resolves the open docx/odt document itself), so the adapter's own `appendParagraph` never needs to touch `editor` at all -- it is identical for both formats and lives here once rather than being reimplemented per format.
export function createParagraphFamilyAdapter(options: ParagraphFamilyAdapterOptions): ParagraphFamilyAdapter {
  return {
    formatLabel: options.formatLabel,
    paragraphs: options.paragraphs,
    tables: options.tables,
    lists: options.lists,
    appendParagraph: () => {
      options.dispatch({ type: 'APPEND_PARAGRAPH', text: undefined, styleId: undefined, alignment: undefined });
    },
  };
}

// keybindings/use-navigation-input.ts's own local `useState` resets to 0 on every remount, so a screen popped and pushed again does not yet resume from a previously recorded cursor -- that would need the shared hook itself to accept an initial index, which is outside this screen family's own file scope. This wrapper still records every change into `state.selection` as the foundation's own convention asks screens to (state/types.ts's `SelectionState` doc comment), so the intent is captured even though nothing reads it back into this hook yet.
export function usePersistedSelection(selectionKey: string, options: NavigationInputOptions): { readonly selectedIndex: number } {
  const dispatch = useAppDispatch();
  const { selectedIndex } = useNavigationInput(options);
  useEffect(() => {
    dispatch({ type: 'SET_SELECTION', key: selectionKey, index: selectedIndex });
  }, [selectionKey, selectedIndex, dispatch]);
  return { selectedIndex };
}

const PREVIEW_WIDTH = 60;

function paragraphBadges(paragraph: ParagraphFamilyParagraph): string {
  const runs = paragraph.runs();
  const badges: string[] = [];
  if (runs.some((run) => run.bold)) {
    badges.push('B');
  }
  if (runs.some((run) => run.italic)) {
    badges.push('I');
  }
  if (runs.some((run) => run.underline)) {
    badges.push('U');
  }
  if (paragraph.alignment !== undefined && paragraph.alignment !== 'left') {
    badges.push(paragraph.alignment);
  }
  if (paragraph.styleId !== undefined) {
    badges.push(paragraph.styleId);
  }
  return badges.length === 0 ? '' : ` [${badges.join(' ')}]`;
}

function tableSummary(table: ParagraphFamilyTable): string {
  const rows = table.rows();
  const columnCount = rows[0]?.cells().length ?? 0;
  return `Table ${rows.length}×${columnCount}`;
}

function listSummary(list: ParagraphFamilyList, index: number): string {
  return `List ${index} (${list.itemCount} item${list.itemCount === 1 ? '' : 's'})`;
}

interface HeaderRow {
  readonly kind: 'header';
  readonly label: string;
}
interface ParagraphRow {
  readonly kind: 'paragraph';
  readonly index: number;
  readonly paragraph: ParagraphFamilyParagraph;
}
interface TableRow {
  readonly kind: 'table';
  readonly index: number;
  readonly table: ParagraphFamilyTable;
}
interface ListRow {
  readonly kind: 'list';
  readonly index: number;
  readonly list: ParagraphFamilyList;
}
type BodyRow = HeaderRow | ParagraphRow | TableRow | ListRow;

// 'T' opens a 2-step rows/columns wizard (mirroring pptx/odp's own slide-detail.tsx add-table wizard exactly), then an optional third "merge cells now?" prompt whose "yes" branch collects a merge rectangle (start row, start column, row span, column span) BEFORE a single APPEND_TABLE dispatch -- carried on that action's own `merge` field so the reducer builds the table and merges it in one mutate() pass, rather than needing a second MERGE_TABLE_CELLS dispatch that would have to already know the freshly-appended table's own index.
type TableWizardStep = 'closed' | 'rows' | 'columns' | 'mergePrompt' | 'mergeStartRow' | 'mergeStartColumn' | 'mergeRowSpan' | 'mergeColSpan';

const DEFAULT_TABLE_ROWS = 2;
const DEFAULT_TABLE_COLUMNS = 2;

// odt's OdtBody.appendFormula needs a frame to position the embedded formula's own draw:frame -- mirroring odg/page-detail.tsx's own GEOMETRY_FIELDS shape, with smaller defaults sized for a single inline formula rather than a whole drawing shape.
const FORMULA_FRAME_FIELDS: readonly FieldSpec[] = [
  { key: 'xPt', label: 'X (pt)', defaultValue: '40' },
  { key: 'yPt', label: 'Y (pt)', defaultValue: '40' },
  { key: 'widthPt', label: 'Width (pt)', defaultValue: '120' },
  { key: 'heightPt', label: 'Height (pt)', defaultValue: '40' },
];

function readFormulaFrame(values: Readonly<Record<string, string>>): GeometryBox {
  return {
    xPt: parseNumberField(requireFieldValue(values, 'xPt'), 0),
    yPt: parseNumberField(requireFieldValue(values, 'yPt'), 0),
    widthPt: parseNumberField(requireFieldValue(values, 'widthPt'), 120),
    heightPt: parseNumberField(requireFieldValue(values, 'heightPt'), 40),
  };
}

// documents.js gives docx/odt editors two (or, for odt, three) SEPARATE enumeration accessors (paragraphs(), tables(), and odt's own lists()) with no shared document-order index between them at all -- there is no way to recover whether paragraph 3 came before or after table 1 in the real file. True interleaving is consequently not achievable from the public API; this renders two (or three) clearly-labelled sections instead, each in its own accessor's own order, which is the honest alternative the brief allows for.
export function ParagraphFamilyBodyList(props: { readonly adapter: ParagraphFamilyAdapter }): ReactElement {
  const { adapter } = props;
  const state = useAppState();
  const dispatch = useAppDispatch();

  const paragraphs = adapter.paragraphs();
  const tables = adapter.tables();
  // docx has no separate list concept at all (a docx paragraph's own list membership is flat metadata, not a container this adapter's shared shape can express), so an absent `lists` member means "not applicable", modelled as zero lists rather than as a missing feature to work around.
  const lists = adapter.lists === undefined ? [] : adapter.lists();

  const query = state.searchQuery.trim().toLowerCase();
  const matches = (haystack: string): boolean => query.length === 0 || haystack.toLowerCase().includes(query);

  const paragraphRows: readonly ParagraphRow[] = paragraphs
    .map((paragraph, index) => ({ kind: 'paragraph' as const, index, paragraph }))
    .filter((row) => matches(truncatePreview(row.paragraph.text, PREVIEW_WIDTH)) || matches(paragraphBadges(row.paragraph)));

  const tableRows: readonly TableRow[] = tables.map((table, index) => ({ kind: 'table' as const, index, table })).filter((row) => matches(tableSummary(row.table)));

  const listRows: readonly ListRow[] = lists.map((list, index) => ({ kind: 'list' as const, index, list })).filter((row) => matches(listSummary(row.list, row.index)));

  const rows: readonly BodyRow[] = [
    ...(paragraphRows.length > 0 ? [{ kind: 'header' as const, label: `Paragraphs (${paragraphRows.length}/${paragraphs.length})` }, ...paragraphRows] : []),
    ...(tableRows.length > 0 ? [{ kind: 'header' as const, label: `Tables (${tableRows.length}/${tables.length})` }, ...tableRows] : []),
    ...(listRows.length > 0 ? [{ kind: 'header' as const, label: `Lists (${listRows.length}/${lists.length})` }, ...listRows] : []),
  ];

  const selectableRowIndices: readonly number[] = rows.reduce<number[]>((acc, row, rowIndex) => {
    if (row.kind !== 'header') {
      acc.push(rowIndex);
    }
    return acc;
  }, []);

  const [tableWizard, setTableWizard] = useState<TableWizardStep>('closed');
  const [wizardDraft, setWizardDraft] = useState('');
  const [wizardRows, setWizardRows] = useState(DEFAULT_TABLE_ROWS);
  const [wizardColumns, setWizardColumns] = useState(DEFAULT_TABLE_COLUMNS);
  const [wizardStartRow, setWizardStartRow] = useState(0);
  const [wizardStartColumn, setWizardStartColumn] = useState(0);
  const [wizardRowSpan, setWizardRowSpan] = useState(1);
  const wizardOpen = tableWizard !== 'closed';

  // odt-only, body-scoped formula insertion (OdtBody.appendFormula has no paragraph-scoped counterpart at all -- see paragraph-detail.tsx's own docx-only 'm' handler for the paragraph-scoped path docx uses instead). Two steps rather than one: FormulaPicker resolves the mathml first (preset or raw), then a FieldWizard collects the frame appendFormula needs to position the resulting draw:frame.
  const [formulaFlow, setFormulaFlow] = useState<'closed' | 'picking' | 'frame'>('closed');
  const [pendingFormulaMathml, setPendingFormulaMathml] = useState<readonly MathMlNode[] | undefined>(undefined);
  const formulaFlowOpen = formulaFlow !== 'closed';

  const closeWizard = (): void => {
    setTableWizard('closed');
  };

  // The reducer's own APPEND_TABLE case builds and (when `merge` is given) merges the table in one mutate() pass -- `tables.length` computed BEFORE dispatch is the freshly-appended table's own index, the same "impure reducer, capture the index first" convention `onAppend` below already uses for a freshly-appended paragraph.
  const commitAppendTable = (merge: { readonly startRow: number; readonly startColumn: number; readonly rowSpan: number; readonly colSpan: number } | undefined): void => {
    const newIndex = tables.length;
    dispatch({ type: 'APPEND_TABLE', rows: wizardRows, columns: wizardColumns, merge });
    closeWizard();
    dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'tableView', blockIndex: newIndex } });
  };

  // 'T' opens the wizard -- a separate useInput from the shared navigation hook below, matching odb/table-list.tsx's own 'f'/'r' split and docx/index.tsx's own 'x' handling: active only while nothing else (an overlay, the wizard itself) already owns the keyboard.
  useInput(
    (input) => {
      if (input === 'T') {
        setWizardDraft(String(DEFAULT_TABLE_ROWS));
        setTableWizard('rows');
      }
    },
    { isActive: !anyOverlayOpen(state) && !wizardOpen && !formulaFlowOpen },
  );

  // 'L' creates a brand-new, empty odt list (OdtBody.appendList()) and drills straight into it -- capital, matching 'T' beside it, and gated to the odt adapter exactly as the 'm' formula handler below is: docx has no equivalent "create a list from nothing" action (see actions.ts's own ADD_LIST doc comment). The new list's own index is `adapter.lists().length` computed BEFORE the dispatch runs, the same "impure reducer, capture the index first" convention `onAppend` below already uses for a freshly-appended paragraph.
  useInput(
    (input) => {
      if (input === 'L' && adapter.lists !== undefined) {
        const newIndex = adapter.lists().length;
        dispatch({ type: 'ADD_LIST' });
        dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'listEditor', blockIndex: newIndex } });
      }
    },
    { isActive: !anyOverlayOpen(state) && !wizardOpen && !formulaFlowOpen },
  );

  // 'm' opens the formula flow -- odt only. docx's own formula insertion is paragraph-scoped (see paragraph-detail.tsx's own 'm' handler there), so this body-list screen exposes the key only when the open document is odt; a docx document simply has no body-level formula action to bind it to.
  useInput(
    (input) => {
      if (input === 'm' && adapter.formatLabel === 'odt') {
        setFormulaFlow('picking');
      }
    },
    { isActive: !anyOverlayOpen(state) && !wizardOpen && !formulaFlowOpen },
  );

  // The merge-prompt step is a single-key y/N prompt, not a TextField -- 'y' proceeds to the merge-rectangle picker, 'n'/Enter (the default "no") appends the table unmerged straight away.
  useInput(
    (input, key) => {
      if (key.escape) {
        closeWizard();
        return;
      }
      if (input === 'y' || input === 'Y') {
        setWizardDraft('0');
        setTableWizard('mergeStartRow');
        return;
      }
      if (input === 'n' || input === 'N' || key.return) {
        commitAppendTable(undefined);
      }
    },
    { isActive: !anyOverlayOpen(state) && tableWizard === 'mergePrompt' },
  );

  const submitWizardRows = (raw: string): void => {
    setWizardRows(parsePositiveIntField(raw, DEFAULT_TABLE_ROWS));
    setWizardDraft(String(DEFAULT_TABLE_COLUMNS));
    setTableWizard('columns');
  };

  const submitWizardColumns = (raw: string): void => {
    setWizardColumns(parsePositiveIntField(raw, DEFAULT_TABLE_COLUMNS));
    setTableWizard('mergePrompt');
  };

  // Every merge-rectangle field is clamped to the just-chosen table's own dimensions (`wizardRows`/`wizardColumns`), so a merge built here can never itself throw the out-of-range error MERGE_TABLE_CELLS' own reducer case guards against -- the clamp is the UI's own responsibility, the reducer's own try/catch is the backstop for every OTHER caller of that action.
  const submitWizardMergeStartRow = (raw: string): void => {
    setWizardStartRow(Math.min(parseNonNegativeIntField(raw, 0), Math.max(0, wizardRows - 1)));
    setWizardDraft('0');
    setTableWizard('mergeStartColumn');
  };

  const submitWizardMergeStartColumn = (raw: string): void => {
    setWizardStartColumn(Math.min(parseNonNegativeIntField(raw, 0), Math.max(0, wizardColumns - 1)));
    setWizardDraft('1');
    setTableWizard('mergeRowSpan');
  };

  const submitWizardMergeRowSpan = (raw: string): void => {
    setWizardRowSpan(Math.min(parsePositiveIntField(raw, 1), Math.max(1, wizardRows - wizardStartRow)));
    setWizardDraft('1');
    setTableWizard('mergeColSpan');
  };

  const submitWizardMergeColSpan = (raw: string): void => {
    const colSpan = Math.min(parsePositiveIntField(raw, 1), Math.max(1, wizardColumns - wizardStartColumn));
    commitAppendTable({ startRow: wizardStartRow, startColumn: wizardStartColumn, rowSpan: wizardRowSpan, colSpan });
  };

  const { selectedIndex } = usePersistedSelection(selectionKeyFor({ kind: 'bodyList' }), {
    itemCount: selectableRowIndices.length,
    isActive: !anyOverlayOpen(state) && !wizardOpen && !formulaFlowOpen,
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
    },
    onSelect: (index) => {
      const rowIndex = selectableRowIndices[index];
      const row = rowIndex === undefined ? undefined : rows[rowIndex];
      if (row === undefined) {
        return;
      }
      if (row.kind === 'paragraph') {
        dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'paragraphDetail', blockIndex: row.index } });
        return;
      }
      if (row.kind === 'table') {
        dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'tableView', blockIndex: row.index } });
        return;
      }
      if (row.kind === 'list') {
        dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'listEditor', blockIndex: row.index } });
      }
    },
    onAppend: () => {
      const newIndex = paragraphs.length;
      adapter.appendParagraph();
      dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'paragraphDetail', blockIndex: newIndex } });
    },
  });

  // Only meaningful when `rows` is non-empty (there is always at least one selectable row whenever a header is present); when `rows` is empty ListView renders its own empty message before ever reading this prop, so -1 -- a value no real row index can ever equal -- is a safe, self-documenting "nothing to highlight" rather than a guessed 0.
  const resolvedRowIndex = selectableRowIndices[selectedIndex];
  const listSelectedIndex = resolvedRowIndex ?? -1;

  return (
    <Box flexDirection="column">
      <Text bold>Body ({adapter.formatLabel})</Text>
      <ListView
        items={rows}
        selectedIndex={listSelectedIndex}
        emptyMessage="No paragraphs or tables yet -- press 'a' to append a paragraph."
        renderItem={(row, isSelected) => {
          if (row.kind === 'header') {
            return (
              <Text bold dimColor>
                {row.label}
              </Text>
            );
          }
          if (row.kind === 'paragraph') {
            return (
              <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
                {`  ¶ ${truncatePreview(row.paragraph.text, PREVIEW_WIDTH)}${paragraphBadges(row.paragraph)}`}
              </Text>
            );
          }
          if (row.kind === 'table') {
            return (
              <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
                {`  ▦ ${tableSummary(row.table)}`}
              </Text>
            );
          }
          return (
            <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
              {`  ≡ ${listSummary(row.list, row.index)}`}
            </Text>
          );
        }}
      />
      {tableWizard === 'rows' ? (
        <Box>
          <Text color="cyan">Rows: </Text>
          <TextField value={wizardDraft} isFocused onChange={setWizardDraft} onSubmit={submitWizardRows} onCancel={closeWizard} />
        </Box>
      ) : undefined}
      {tableWizard === 'columns' ? (
        <Box>
          <Text color="cyan">Columns: </Text>
          <TextField value={wizardDraft} isFocused onChange={setWizardDraft} onSubmit={submitWizardColumns} onCancel={closeWizard} />
        </Box>
      ) : undefined}
      {tableWizard === 'mergePrompt' ? <Text color="cyan">Merge cells now? y/N</Text> : undefined}
      {tableWizard === 'mergeStartRow' ? (
        <Box>
          <Text color="cyan">Merge start row (0-{Math.max(0, wizardRows - 1)}): </Text>
          <TextField value={wizardDraft} isFocused onChange={setWizardDraft} onSubmit={submitWizardMergeStartRow} onCancel={closeWizard} />
        </Box>
      ) : undefined}
      {tableWizard === 'mergeStartColumn' ? (
        <Box>
          <Text color="cyan">Merge start column (0-{Math.max(0, wizardColumns - 1)}): </Text>
          <TextField value={wizardDraft} isFocused onChange={setWizardDraft} onSubmit={submitWizardMergeStartColumn} onCancel={closeWizard} />
        </Box>
      ) : undefined}
      {tableWizard === 'mergeRowSpan' ? (
        <Box>
          <Text color="cyan">Merge row span (1-{Math.max(1, wizardRows - wizardStartRow)}): </Text>
          <TextField value={wizardDraft} isFocused onChange={setWizardDraft} onSubmit={submitWizardMergeRowSpan} onCancel={closeWizard} />
        </Box>
      ) : undefined}
      {tableWizard === 'mergeColSpan' ? (
        <Box>
          <Text color="cyan">Merge column span (1-{Math.max(1, wizardColumns - wizardStartColumn)}): </Text>
          <TextField value={wizardDraft} isFocused onChange={setWizardDraft} onSubmit={submitWizardMergeColSpan} onCancel={closeWizard} />
        </Box>
      ) : undefined}
      {formulaFlow === 'picking' ? (
        <FormulaPicker
          isActive={!anyOverlayOpen(state)}
          onCancel={() => {
            setFormulaFlow('closed');
          }}
          onMathml={(mathml) => {
            setPendingFormulaMathml(mathml);
            setFormulaFlow('frame');
          }}
          onInvalidRawMathml={(message) => {
            dispatch({ type: 'SET_STATUS', severity: 'warning', text: `Could not parse MathML: ${message}` });
          }}
        />
      ) : undefined}
      {formulaFlow === 'frame' ? (
        <FieldWizard
          fields={FORMULA_FRAME_FIELDS}
          onCancel={() => {
            setFormulaFlow('closed');
            setPendingFormulaMathml(undefined);
          }}
          onComplete={(values) => {
            if (pendingFormulaMathml !== undefined) {
              dispatch({ type: 'INSERT_ODT_FORMULA', mathml: pendingFormulaMathml, frame: readFormulaFrame(values) });
            }
            setFormulaFlow('closed');
            setPendingFormulaMathml(undefined);
          }}
        />
      ) : undefined}
      <Text dimColor>
        Enter to open, a to append a paragraph, T to append a table{adapter.lists !== undefined ? ', L to add a list' : ''}
        {adapter.formatLabel === 'odt' ? ', m to insert a formula' : ''}, Esc back
      </Text>
    </Box>
  );
}
