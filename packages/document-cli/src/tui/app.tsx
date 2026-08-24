import { Box, Text, useApp, useInput } from "ink";
import { useEffect, type ReactElement } from "react";
import { CommandPalette } from "./components/command-palette.js";
import { ConfirmDialog } from "./components/confirm-dialog.js";
import { DiagnosticsPanel } from "./components/diagnostics-panel.js";
import { ErrorDetail } from "./components/error-detail.js";
import { HelpOverlay } from "./components/help-overlay.js";
import { SearchOverlay } from "./components/search-overlay.js";
import { StatusLine } from "./components/status-line.js";
import { describeError } from "./errors.js";
import { openDocumentAtPath } from "./format/open-document.js";
import {
  DocxBodyListScreen,
  ParagraphDetailScreen,
  RunEditorScreen,
  TableCellDetailScreen,
  TableViewScreen,
} from "./screens/editors/docx/index.js";
import { DocxExtrasScreen } from "./screens/editors/docx/extras.js";
import {
  MarkdownBodyListScreen,
  MarkdownViewSourceScreen,
} from "./screens/editors/markdown/index.js";
import { OdbFormDetailScreen } from "./screens/editors/odb/form-detail.js";
import { OdbFormListScreen } from "./screens/editors/odb/form-list.js";
import { OdbReportDetailScreen } from "./screens/editors/odb/report-detail.js";
import { OdbReportListScreen } from "./screens/editors/odb/report-list.js";
import { OdbReportRenderScreen } from "./screens/editors/odb/report-render.js";
import { OdbTableListScreen } from "./screens/editors/odb/table-list.js";
import { OdbTableRowsScreen } from "./screens/editors/odb/table-rows.js";
import { OdgPageListScreen } from "./screens/editors/odg/page-list.js";
import { OdgPageDetailScreen } from "./screens/editors/odg/page-detail.js";
import { OdgShapeOrVectorDetailScreen } from "./screens/editors/odg/shape-or-vector-detail.js";
import {
  NotesEditorScreen,
  OdpSlideListScreen,
  ShapeEditorScreen,
  SlideDetailScreen,
  SlideTableDetailScreen,
} from "./screens/editors/odp/index.js";
import { OdsSheetListScreen } from "./screens/editors/ods/sheet-list.js";
import { OdsPrintSettingsEditorScreen } from "./screens/editors/ods/print-settings-editor.js";
import { OdsSpreadsheetGridScreen } from "./screens/editors/ods/spreadsheet-grid.js";
import {
  ListEditorScreen,
  OdtBodyListScreen,
} from "./screens/editors/odt/index.js";
import { PdfPageListScreen } from "./screens/editors/pdf/page-list.js";
import { PdfItemDetailScreen } from "./screens/editors/pdf/item-detail.js";
import { PdfPageItemsScreen } from "./screens/editors/pdf/page-items.js";
import { PptxSlideListScreen } from "./screens/editors/pptx/index.js";
import { ExportOptionsScreen } from "./screens/export-options.js";
import { FilePickerScreen } from "./screens/file-picker.js";
import { LauncherScreen } from "./screens/launcher.js";
import { NewDocumentPickerScreen } from "./screens/new-document-picker.js";
import { SaveAsPromptScreen } from "./screens/save-as-prompt.js";
import { MetadataScreen } from "./screens/shared/metadata.js";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "./state/context.js";
import { saveOpenDocumentAction } from "./state/save-document.js";
import {
  anyOverlayOpen,
  currentScreen,
  type AppState,
  type Screen,
} from "./state/types.js";

export function App(props: {
  readonly startPath?: string;
  readonly cwd?: string;
}): ReactElement {
  return (
    <AppStateProvider cwd={props.cwd}>
      <AppShell startPath={props.startPath} />
    </AppStateProvider>
  );
}

// The router lives here, and here only: a screen never renders another screen directly, it pushes onto `state.stack` and lets this switch resolve it. Most screen kinds map to a single zero-prop component that reads `currentScreen(state)`/`useAppState()` itself; the docx/odt and pptx/odp root screens (`bodyList`/`slideList`) are the two places this switch itself has to pick a format-specific component, since paragraph-family/slide-family's shared body-list/slide-list components are constructed per format (DocxBodyListScreen vs OdtBodyListScreen, PptxSlideListScreen vs OdpSlideListScreen) rather than being one component that branches internally. `cellDetail` is a real Screen union member with no reachable route: OdsCellEditor (the ODS cell-editing UI) is rendered inline by OdsSpreadsheetGridScreen itself rather than pushed as its own stack screen, so this case is kept only for the switch's own exhaustiveness and is never actually hit.
function ScreenBody({ screen }: { readonly screen: Screen }): ReactElement {
  const state = useAppState();
  const format = state.openDocument?.format;

  switch (screen.kind) {
    case "launcher":
      return <LauncherScreen />;
    case "filePicker":
      return <FilePickerScreen />;
    case "newDocumentPicker":
      return <NewDocumentPickerScreen />;
    case "bodyList":
      if (format === "odt") {
        return <OdtBodyListScreen />;
      }
      return format === "markdown" ? (
        <MarkdownBodyListScreen />
      ) : (
        <DocxBodyListScreen />
      );
    case "docxExtras":
      return <DocxExtrasScreen />;
    case "paragraphDetail":
      return <ParagraphDetailScreen />;
    case "runEditor":
      return <RunEditorScreen />;
    case "tableView":
      return <TableViewScreen />;
    case "tableCellDetail":
      return <TableCellDetailScreen />;
    case "listEditor":
      return <ListEditorScreen />;
    case "slideList":
      return format === "odp" ? (
        <OdpSlideListScreen />
      ) : (
        <PptxSlideListScreen />
      );
    case "slideDetail":
      return <SlideDetailScreen screen={screen} />;
    case "shapeEditor":
      return <ShapeEditorScreen screen={screen} />;
    case "slideTableDetail":
      return <SlideTableDetailScreen screen={screen} />;
    case "notesEditor":
      return <NotesEditorScreen screen={screen} />;
    case "sheetList":
      return <OdsSheetListScreen />;
    case "spreadsheetGrid":
      return <OdsSpreadsheetGridScreen />;
    case "cellDetail":
      return (
        <Text>
          cellDetail is rendered inline by spreadsheetGrid and is never pushed
          as its own screen.
        </Text>
      );
    case "printSettingsEditor":
      return <OdsPrintSettingsEditorScreen />;
    case "pageList":
      return <OdgPageListScreen />;
    case "pageDetail":
      return <OdgPageDetailScreen />;
    case "shapeOrVectorDetail":
      return <OdgShapeOrVectorDetailScreen />;
    case "odbTableList":
      return <OdbTableListScreen />;
    case "odbTableRows":
      return <OdbTableRowsScreen />;
    case "odbFormList":
      return <OdbFormListScreen />;
    case "odbFormDetail":
      return <OdbFormDetailScreen />;
    case "odbReportList":
      return <OdbReportListScreen />;
    case "odbReportDetail":
      return <OdbReportDetailScreen />;
    case "odbReportRender":
      return <OdbReportRenderScreen />;
    case "viewSource":
      return <MarkdownViewSourceScreen />;
    case "pdfPageList":
      return <PdfPageListScreen />;
    case "pdfPageItems":
      return <PdfPageItemsScreen />;
    case "pdfItemDetail":
      return <PdfItemDetailScreen />;
    case "exportOptions":
      return <ExportOptionsScreen />;
    case "saveAsPrompt":
      return <SaveAsPromptScreen />;
    case "metadata":
      return <MetadataScreen />;
  }
}

function Overlay({ state }: { readonly state: AppState }): ReactElement {
  const dispatch = useAppDispatch();

  if (state.errorDetail !== undefined) {
    return <ErrorDetail />;
  }
  if (state.overlays.confirmQuit) {
    return (
      <ConfirmDialog
        message="Quit? The open document has unsaved changes."
        onConfirm={() => {
          dispatch({ type: "CONFIRM_QUIT" });
        }}
        onCancel={() => {
          dispatch({ type: "CANCEL_QUIT" });
        }}
      />
    );
  }
  if (state.overlays.confirmClose) {
    return (
      <ConfirmDialog
        message="Close this document? It has unsaved changes."
        onConfirm={() => {
          dispatch({ type: "CONFIRM_CLOSE" });
        }}
        onCancel={() => {
          dispatch({ type: "CANCEL_CLOSE" });
        }}
      />
    );
  }
  if (state.overlays.commandPalette) {
    return <CommandPalette />;
  }
  if (state.overlays.search) {
    return <SearchOverlay />;
  }
  if (state.overlays.diagnosticsPanel) {
    return <DiagnosticsPanel />;
  }
  if (state.overlays.help) {
    return <HelpOverlay />;
  }
  return <Box />;
}

function AppShell({
  startPath,
}: {
  readonly startPath?: string;
}): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { exit } = useApp();
  const overlayOpen = anyOverlayOpen(state);

  useEffect(() => {
    if (startPath === undefined) {
      return;
    }
    // A property on a const holder rather than a bare `let`, because the only write happens in the cleanup closure below. TypeScript ignores assignments made inside a nested function when narrowing the enclosing scope, so a `let` here reads as its initialiser at both checks and both guards look statically dead -- while the write genuinely happens and the guards are what stop a dispatch after unmount.
    const lifecycle = { cancelled: false };
    void (async () => {
      try {
        const doc = await openDocumentAtPath(startPath, {
          onDiagnostic: (diagnostic) => {
            dispatch({ type: "APPEND_DIAGNOSTIC", diagnostic });
          },
        });
        if (!lifecycle.cancelled) {
          // OPEN_FILE_SUCCESS resets the stack to that format's root screen itself, so there is no separate RESET_STACK to dispatch here.
          dispatch({ type: "OPEN_FILE_SUCCESS", path: startPath, doc });
        }
      } catch (error) {
        if (!lifecycle.cancelled) {
          dispatch({
            type: "OPEN_FILE_ERROR",
            message: `Could not open ${startPath}`,
            detail: describeError(error),
          });
        }
      }
    })();
    return () => {
      lifecycle.cancelled = true;
    };
  }, [startPath, dispatch]);

  useEffect(() => {
    if (state.isExiting) {
      exit();
    }
  }, [state.isExiting, exit]);

  // Ctrl+C only reaches this handler when the caller renders with `{ exitOnCtrlC: false }`; Ink's default swallows it and unmounts directly, skipping the unsaved-changes confirmation.
  useInput(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) {
        dispatch({ type: "REQUEST_QUIT" });
        return;
      }
      if (key.ctrl && input === "s") {
        const doc = state.openDocument;
        if (doc === undefined) {
          dispatch({
            type: "SET_STATUS",
            severity: "warning",
            text: "There is no open document to save",
          });
          return;
        }
        const path = doc.path;
        if (path === undefined) {
          dispatch({ type: "SAVE_AS_REQUEST" });
          return;
        }
        void (async () => {
          dispatch(await saveOpenDocumentAction(doc, path));
        })();
        return;
      }
      if (key.ctrl && input === "w") {
        dispatch({ type: "REQUEST_CLOSE" });
        return;
      }
      if (key.ctrl && input === "z") {
        dispatch({ type: "UNDO" });
        return;
      }
      if (input === ":") {
        dispatch({ type: "OPEN_OVERLAY", overlay: "commandPalette" });
        return;
      }
      if (input === "/") {
        dispatch({ type: "OPEN_OVERLAY", overlay: "search" });
        return;
      }
      if (input === "?") {
        dispatch({ type: "OPEN_OVERLAY", overlay: "help" });
        return;
      }
      if (key.ctrl && input === "d") {
        dispatch({ type: "OPEN_OVERLAY", overlay: "diagnosticsPanel" });
        return;
      }
      if (input === "m") {
        if (state.openDocument === undefined) {
          dispatch({
            type: "SET_STATUS",
            severity: "warning",
            text: "There is no open document to show metadata for",
          });
          return;
        }
        dispatch({ type: "PUSH_SCREEN", screen: { kind: "metadata" } });
      }
    },
    { isActive: !overlayOpen },
  );

  // The screen stays mounted underneath an open overlay -- unmounting it would throw away its local cursor state and the context the overlay is being used against. A screen must therefore pass `isActive: !anyOverlayOpen(state)` to its own input hooks, exactly as this shell does above, so only one component reacts to a key press.
  return (
    <Box flexDirection="column">
      <ScreenBody screen={currentScreen(state)} />
      {overlayOpen ? <Overlay state={state} /> : undefined}
      <StatusLine />
    </Box>
  );
}
