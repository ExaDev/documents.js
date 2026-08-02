import type { LayoutItem } from 'documents.js';
import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { ListView } from '../../../components/list-view.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen, currentScreen } from '../../../state/types.js';
import { formatSize, requirePdfDocument } from './shared.js';

// Long enough to tell two similarly-worded paragraphs apart at a glance while still leaving room for the kind label and index prefix on one row.
const TEXT_PREVIEW_MAX_CHARS = 48;

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

// `LayoutPath` has no widthPt/heightPt of its own -- unlike image/rect/ellipse, its geometry lives entirely in its subpaths' points -- so its "dimensions" preview is the tight bounding box of every point the path actually visits, cubic control points included (a cubic curve is guaranteed to lie within their convex hull, so this never clips the curve; it can only ever be as large as or larger than a tighter, curve-aware bound).
function pathDimensions(item: Extract<LayoutItem, { kind: 'path' }>): string {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const consider = (xPt: number, yPt: number): void => {
    minX = Math.min(minX, xPt);
    minY = Math.min(minY, yPt);
    maxX = Math.max(maxX, xPt);
    maxY = Math.max(maxY, yPt);
  };
  for (const subpath of item.subpaths) {
    consider(subpath.startXPt, subpath.startYPt);
    for (const segment of subpath.segments) {
      if (segment.kind === 'cubic') {
        consider(segment.c1xPt, segment.c1yPt);
        consider(segment.c2xPt, segment.c2yPt);
      }
      consider(segment.xPt, segment.yPt);
    }
  }
  if (minX > maxX) {
    return 'empty path';
  }
  return formatSize(maxX - minX, maxY - minY);
}

function previewFor(item: LayoutItem): string {
  switch (item.kind) {
    case 'text':
      return truncate(item.text, TEXT_PREVIEW_MAX_CHARS);
    case 'link':
      return item.uri;
    case 'image':
    case 'rect':
    case 'ellipse':
      return formatSize(item.widthPt, item.heightPt);
    case 'line':
      return formatSize(Math.abs(item.x2Pt - item.x1Pt), Math.abs(item.y2Pt - item.y1Pt));
    case 'path':
      return pathDimensions(item);
  }
}

interface IndexedItem {
  readonly item: LayoutItem;
  readonly itemIndex: number;
}

// A scrollable dump of one page's own positioned items, in the exact paint order `readPdf` recovered them -- text shows a truncated preview of its own string, a link shows its target URI, and every other kind (image/rect/ellipse/line/path) shows a short size summary since none of them carry meaningful inline text.
export function PdfPageItemsScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = requirePdfDocument(state.openDocument);
  const screen = currentScreen(state);
  if (screen.kind !== 'pdfPageItems') {
    throw new Error(`PdfPageItemsScreen rendered while the current screen is "${screen.kind}", not "pdfPageItems".`);
  }
  const page = doc.layout.pages[screen.pageIndex];
  if (page === undefined) {
    throw new Error(`pdfPageItems was pushed for page ${screen.pageIndex}, but the open PDF has no page at that index.`);
  }

  const query = state.searchQuery.trim().toLowerCase();
  const indexed: IndexedItem[] = page.items.map((item, itemIndex) => ({ item, itemIndex }));
  const items = query === '' ? indexed : indexed.filter((entry) => `${entry.item.kind} ${previewFor(entry.item)}`.toLowerCase().includes(query));

  const { selectedIndex } = useNavigationInput({
    itemCount: items.length,
    onSelect: (index) => {
      const entry = items[index];
      if (entry === undefined) {
        return;
      }
      dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'pdfItemDetail', pageIndex: screen.pageIndex, itemIndex: entry.itemIndex } });
    },
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
    },
    isActive: !anyOverlayOpen(state),
  });

  return (
    <Box flexDirection="column">
      <Text bold>
        Page {screen.pageIndex + 1} items ({items.length} of {page.items.length})
      </Text>
      <ListView
        items={items}
        selectedIndex={selectedIndex}
        emptyMessage={query === '' ? 'This page has no items.' : `No items match "${state.searchQuery}".`}
        renderItem={({ item, itemIndex }, isSelected) => (
          <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
            {itemIndex + 1}. {item.kind} -- {previewFor(item)}
          </Text>
        )}
      />
    </Box>
  );
}
