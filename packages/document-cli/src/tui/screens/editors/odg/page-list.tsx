import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { ListView } from "../../../components/list-view.js";
import { useNavigationInput } from "../../../keybindings/use-navigation-input.js";
import { useAppDispatch, useAppState } from "../../../state/context.js";
import { anyOverlayOpen } from "../../../state/types.js";
import { requireOdgDocument } from "./shared.js";

// v1 renders no canvas or shape preview at all -- every odg screen in this family is a text-only summary list (page count, then per-page item kind/frame/fill-stroke). A braille/canvas rendering of the actual drawing is a deliberate, bounded gap for a future pass, not an oversight: see this file family's own manifest note.
export function OdgPageListScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = requireOdgDocument(state);
  const pages = doc.editor.pages();

  // Pages carry no name of their own to filter against -- position is the only identifying text a search query could match, so filtering narrows to "page N" rather than leaving the shared search contract inert on this screen.
  const query = state.searchQuery.trim().toLowerCase();
  const pageIndices = pages
    .map((_, index) => index)
    .filter(
      (index) => query.length === 0 || `page ${index + 1}`.includes(query),
    );

  const { selectedIndex } = useNavigationInput({
    itemCount: pageIndices.length,
    isActive: !anyOverlayOpen(state),
    onBack: () => {
      dispatch({ type: "POP_SCREEN" });
    },
    onSelect: (index) => {
      const pageIndex = pageIndices[index];
      if (pageIndex === undefined) {
        return;
      }
      dispatch({
        type: "PUSH_SCREEN",
        screen: { kind: "pageDetail", pageIndex },
      });
    },
    onAppend: () => {
      dispatch({ type: "ADD_PAGE" });
    },
  });

  return (
    <Box flexDirection="column">
      <Text bold>Drawing pages ({pages.length})</Text>
      <ListView
        items={pageIndices}
        selectedIndex={selectedIndex}
        emptyMessage="No pages yet -- press 'a' to add one"
        renderItem={(pageIndex, isSelected) => {
          const page = pages[pageIndex];
          // A count of `page.shapes()` (text/image frames) only -- cheap and always available. Vector (rect/ellipse/line/path) counts need a `readOdgContent` read per page (see shared.ts's `buildPageItems`), too heavy to run once per row on every list render; page-detail.tsx pays that cost for the one page actually being viewed.
          const shapeCount = page === undefined ? 0 : page.shapes().length;
          return (
            <Text color={isSelected ? "cyan" : undefined}>
              {isSelected ? "> " : "  "}Page {pageIndex + 1} ({shapeCount} shape
              {shapeCount === 1 ? "" : "s"}, vectors not counted here)
            </Text>
          );
        }}
      />
    </Box>
  );
}
