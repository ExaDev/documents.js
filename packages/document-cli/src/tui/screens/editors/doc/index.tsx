import { Text } from "ink";
import type { ReactElement } from "react";
import { useAppDispatch, useAppState } from "../../../state/context.js";
import {
  createParagraphFamilyAdapter,
  ParagraphFamilyBodyList,
} from "../../shared/paragraph-family.js";

// The doc-specific root of the paragraph screen family: the identical shared body list docx/odt/markdown already use, built straight from DocEditor's own live-view accessors (`doc.editor.paragraphs()`/`.tables()`, re-read fresh on every render per the live-view rule in state/types.ts). doc has no `.lists()` accessor (a doc paragraph's list membership is flat per-paragraph metadata, exactly docx's and markdown's model), so its adapter omits `lists` the same way docx's and markdown's do. paragraphDetail/runEditor/tableView/tableCellDetail are the format-agnostic shared screens, narrowed through paragraph-family.tsx's own `paragraphFamilyDocument`, which admits doc alongside docx/odt/markdown.
export function DocBodyListScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = state.openDocument;

  if (doc?.format !== "doc") {
    return (
      <Text color="red">
        DocBodyListScreen requires an open doc document, found{" "}
        {doc === undefined ? "no open document" : doc.format}.
      </Text>
    );
  }

  const adapter = createParagraphFamilyAdapter({
    formatLabel: "doc",
    paragraphs: () => doc.editor.paragraphs(),
    tables: () => doc.editor.tables(),
    dispatch,
  });

  return <ParagraphFamilyBodyList adapter={adapter} />;
}
