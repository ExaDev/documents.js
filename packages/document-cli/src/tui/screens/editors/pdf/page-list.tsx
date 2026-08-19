import type { LayoutItem, LayoutPage } from 'documents.js';
import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { ListView } from '../../../components/list-view.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen } from '../../../state/types.js';
import { formatSize, requirePdfDocument } from './shared.js';

// Fixed rather than derived from the union's own member count, because the order here is display order (text and images first, as the most common content, vector primitives after), not an exhaustiveness requirement -- `summariseItemKinds` below tolerates a kind never appearing at all.
const LAYOUT_ITEM_KIND_ORDER: readonly LayoutItem['kind'][] = ['text', 'image', 'rect', 'ellipse', 'line', 'path', 'link'];

function summariseItemKinds(items: readonly LayoutItem[]): string {
  const counts = new Map<LayoutItem['kind'], number>();
  for (const item of items) {
    const current = counts.get(item.kind);
    counts.set(item.kind, current === undefined ? 1 : current + 1);
  }
  const parts: string[] = [];
  for (const kind of LAYOUT_ITEM_KIND_ORDER) {
    const count = counts.get(kind);
    if (count !== undefined) {
      parts.push(`${count} ${kind}`);
    }
  }
  return parts.length === 0 ? 'no items' : parts.join(', ');
}

function pageSummaryText(page: LayoutPage): string {
  return `${formatSize(page.widthPt, page.heightPt)}, ${summariseItemKinds(page.items)}`;
}

interface IndexedPage {
  readonly page: LayoutPage;
  readonly pageIndex: number;
}

// The root screen of every open PDF (see `rootScreenForFormat`): one row per page, each summarised by its own size and a count of the item kinds it holds so a caller can spot, say, "the page with the images" without opening every page in turn.
export function PdfPageListScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = requirePdfDocument(state.openDocument);

  const query = state.searchQuery.trim().toLowerCase();
  const indexed: IndexedPage[] = doc.layout.pages.map((page, pageIndex) => ({ page, pageIndex }));
  const pages = query === '' ? indexed : indexed.filter((entry) => pageSummaryText(entry.page).toLowerCase().includes(query));

  const { selectedIndex } = useNavigationInput({
    itemCount: pages.length,
    onSelect: (index) => {
      const entry = pages[index];
      if (entry === undefined) {
        return;
      }
      dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'pdfPageItems', pageIndex: entry.pageIndex } });
    },
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
    },
    isActive: !anyOverlayOpen(state),
  });

  return (
    <Box flexDirection="column">
      <Text bold>
        Pages ({pages.length} of {doc.layout.pages.length})
      </Text>
      <ListView
        items={pages}
        selectedIndex={selectedIndex}
        emptyMessage={query === '' ? 'This PDF has no pages.' : `No pages match "${state.searchQuery}".`}
        renderItem={({ page, pageIndex }, isSelected) => (
          <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
            Page {pageIndex + 1} -- {pageSummaryText(page)}
          </Text>
        )}
      />
    </Box>
  );
}
