import { Box, Text } from 'ink';
import { useEffect, type Dispatch, type ReactElement } from 'react';
import type { Alignment, DocxParagraph, DocxRun, DocxTable, DocxTableCell, OdtParagraph, OdtRun, OdtTable, OdtTableCell } from 'documents.js';
import { ListView } from '../../components/list-view.js';
import { useNavigationInput, type NavigationInputOptions } from '../../keybindings/use-navigation-input.js';
import type { Action } from '../../state/actions.js';
import { useAppDispatch, useAppState } from '../../state/context.js';
import { anyOverlayOpen, selectionKeyFor, type DocxOpenDocument, type OdtOpenDocument, type OpenDocument } from '../../state/types.js';
import { truncatePreview } from './text.js';

// docx and odt share one paragraph/run/table model closely enough (see documents.js's own README: "readDocxContent and readOdtContent both produce the identical wordprocessing-variant ContentDocument shape") that DocxParagraph/OdtParagraph and DocxRun/OdtRun are structurally interchangeable for every screen in this family -- the union types below let every helper and screen here take whichever the open document actually is without a branch, mirroring state/reducer.ts's own `WordprocessingOpenDocument` narrowing (not exported from there, so restated here for this screen family's own use).
export type ParagraphFamilyOpenDocument = DocxOpenDocument | OdtOpenDocument;
export type ParagraphFamilyLiveParagraph = DocxParagraph | OdtParagraph;
export type ParagraphFamilyLiveRun = DocxRun | OdtRun;
export type ParagraphFamilyLiveTable = DocxTable | OdtTable;
export type ParagraphFamilyLiveTableCell = DocxTableCell | OdtTableCell;

export function paragraphFamilyDocument(openDocument: OpenDocument | undefined): ParagraphFamilyOpenDocument | undefined {
  if (openDocument === undefined) {
    return undefined;
  }
  return openDocument.format === 'docx' || openDocument.format === 'odt' ? openDocument : undefined;
}

export function liveParagraphAt(doc: ParagraphFamilyOpenDocument, blockIndex: number): ParagraphFamilyLiveParagraph | undefined {
  return doc.editor.paragraphs()[blockIndex];
}

export function liveTableAt(doc: ParagraphFamilyOpenDocument, tableIndex: number): ParagraphFamilyLiveTable | undefined {
  return doc.editor.tables()[tableIndex];
}

// The read-only shape the body list needs for a preview -- deliberately a small structural subset of DocxRun/OdtRun (no colour/fontFamily/sizePt: those matter once you are inside a single paragraph, not for a one-line list row) so that `doc.editor.paragraphs()`/`doc.editor.tables()` can be handed to the adapter factory below completely unwrapped -- both DocxParagraph and OdtParagraph already satisfy these interfaces structurally.
export interface ParagraphFamilyRun {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
}

export interface ParagraphFamilyParagraph {
  readonly text: string;
  readonly styleId: string | undefined;
  readonly alignment: Alignment | undefined;
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

// odt keeps lists as a genuinely separate tree (OdtList/OdtListItem, reached via OdtEditor.lists()) rather than docx's flat per-paragraph list membership, and OdtListItem exposes no getter at all for its own content (see screens/editors/odt/list-editor.tsx) -- so this is the one adapter member that only ever gets an item count, and the one docx's own factory call simply omits.
export interface ParagraphFamilyList {
  readonly itemCount: number;
}

export interface ParagraphFamilyAdapter {
  readonly formatLabel: 'docx' | 'odt';
  paragraphs(): readonly ParagraphFamilyParagraph[];
  tables(): readonly ParagraphFamilyTable[];
  lists?: () => readonly ParagraphFamilyList[];
  appendParagraph(): void;
}

export interface ParagraphFamilyAdapterOptions {
  readonly formatLabel: 'docx' | 'odt';
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

  const { selectedIndex } = usePersistedSelection(selectionKeyFor({ kind: 'bodyList' }), {
    itemCount: selectableRowIndices.length,
    isActive: !anyOverlayOpen(state),
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
      <Text dimColor>Enter to open, a to append a paragraph, Esc back</Text>
    </Box>
  );
}
