import { Box, Text, useInput } from "ink";
import { useEffect, useState, type Dispatch, type ReactElement } from "react";
import { rgbHexToColor, type MathMlNode } from "documents.js";
import { TextField } from "../../../components/text-field.js";
import { describeError } from "../../../errors.js";
import { readInput } from "../../../../runtime/io.js";
import type { Action } from "../../../state/actions.js";
import { useAppDispatch, useAppState } from "../../../state/context.js";
import {
  anyOverlayOpen,
  currentScreen,
  selectionKeyFor,
} from "../../../state/types.js";
import { isValidHexColorInput, layoutColorToHex } from "../../shared/color.js";
import {
  FieldWizard,
  requireFieldValue,
  type FieldSpec,
} from "../../shared/field-wizard.js";
import { FormulaPicker } from "../../shared/formula-picker.js";
import {
  liveParagraphAt,
  paragraphFamilyDocument,
  supportsRunStyleExtras,
  type ParagraphFamilyLiveRun,
} from "../../shared/paragraph-family.js";
import { parseNumberField } from "../../shared/text.js";

// A run's own current sizePt has no sensible zero-ish fallback the way a blank colour prompt does (an empty hex input just means "no colour") -- a font size prompt that fails to parse falls back to the run's OWN current size (or, for a run with none set yet, this codebase's own standard body size) rather than silently writing 0pt.
const DEFAULT_RUN_SIZE_PT = 12;

// The image-insertion wizard's own field list -- unlike odg/page-detail.tsx's identically-shaped image fields, there is no x/y position to collect: DocxParagraph.insertImageAfter/OdtParagraph.insertImageAfter always append an inline image run at the end of the paragraph's own flow, not a page-absolutely-positioned frame.
const IMAGE_FIELDS: readonly FieldSpec[] = [
  { key: "path", label: "Image file path (.png/.jpg/.jpeg)", defaultValue: "" },
  { key: "widthPt", label: "Width (pt)", defaultValue: "100" },
  { key: "heightPt", label: "Height (pt)", defaultValue: "60" },
  { key: "altText", label: "Alt text, blank for none", defaultValue: "" },
];

function inferImageFormat(path: string): "png" | "jpeg" | undefined {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (extension === "png") {
    return "png";
  }
  if (extension === "jpg" || extension === "jpeg") {
    return "jpeg";
  }
  return undefined;
}

// The one async step (reading the image file off disk) is why this whole function is async, matching odg/page-detail.tsx's own applyAddKind for the identical reason.
async function applyInsertImage(
  blockIndex: number,
  values: Readonly<Record<string, string>>,
  dispatch: Dispatch<Action>,
): Promise<void> {
  const path = requireFieldValue(values, "path");
  const format = inferImageFormat(path);
  if (format === undefined) {
    dispatch({
      type: "SET_STATUS",
      severity: "warning",
      text: `${path} is not a .png or .jpg/.jpeg file -- image not inserted`,
    });
    return;
  }
  try {
    const bytes = new Uint8Array(await readInput(path));
    const widthPt = parseNumberField(requireFieldValue(values, "widthPt"), 100);
    const heightPt = parseNumberField(
      requireFieldValue(values, "heightPt"),
      60,
    );
    const altTextRaw = requireFieldValue(values, "altText").trim();
    dispatch({
      type: "INSERT_PARAGRAPH_IMAGE",
      blockIndex,
      format,
      bytes,
      widthPt,
      heightPt,
      altText: altTextRaw.length === 0 ? undefined : altTextRaw,
    });
  } catch (error) {
    dispatch({
      type: "SET_STATUS",
      severity: "error",
      text: `Could not read ${path}: ${describeError(error)}`,
    });
  }
}

export interface ParagraphRunsViewProps {
  readonly runs: readonly ParagraphFamilyLiveRun[];
  readonly selectedRunIndex: number | undefined;
}

// Shared between this screen (full editing, a real cursor) and table-cell-detail.tsx (read-only display of a cell's own paragraphs, no cursor at all -- documents.js gives a table cell no per-run styling actions, see that screen's own comment) so the same real-styling render logic is never duplicated. `runs` can now be MarkdownRun[] as well as DocxRun[]/OdtRun[] (paragraph-family.tsx's own widened `ParagraphFamilyLiveRun`) -- `supportsRunStyleExtras` narrows each run before reading `.underline`/`.color`, since MarkdownRun has neither field at all; a markdown run renders with bold/italic only.
export function ParagraphRunsView(props: ParagraphRunsViewProps): ReactElement {
  if (props.runs.length === 0) {
    return <Text dimColor>(no runs -- press 'a' to append one)</Text>;
  }
  return (
    <Box>
      {props.runs.map((run, index) => {
        const styled = supportsRunStyleExtras(run);
        return (
          <Text
            key={index}
            bold={run.bold}
            italic={run.italic}
            underline={styled && run.underline}
            color={
              styled && run.color !== undefined
                ? layoutColorToHex(run.color)
                : undefined
            }
            inverse={index === props.selectedRunIndex}
          >
            {run.text.length === 0 ? "<empty run>" : run.text}
          </Text>
        );
      })}
    </Box>
  );
}

export function ParagraphDetailScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [runIndex, setRunIndex] = useState(0);
  const [colorInput, setColorInput] = useState<string | undefined>(undefined);
  const [fontFamilyInput, setFontFamilyInput] = useState<string | undefined>(
    undefined,
  );
  const [fontSizeInput, setFontSizeInput] = useState<string | undefined>(
    undefined,
  );
  const [imageWizardOpen, setImageWizardOpen] = useState(false);
  const [formulaPickerOpen, setFormulaPickerOpen] = useState(false);

  const screen = currentScreen(state);
  const doc = paragraphFamilyDocument(state.openDocument);
  const paragraph =
    screen.kind === "paragraphDetail" && doc !== undefined
      ? liveParagraphAt(doc, screen.blockIndex)
      : undefined;
  const runs = paragraph === undefined ? [] : paragraph.runs();
  const clampedRunIndex =
    runs.length === 0 ? 0 : Math.min(runIndex, runs.length - 1);
  const selectedRun = runs[clampedRunIndex];
  const blockIndex = screen.kind === "paragraphDetail" ? screen.blockIndex : -1;

  // A paragraph's runs are shown inline on one line and moved through with left/right, not up/down through a vertical list, so `useNavigationInput` (and this screen family's own `usePersistedSelection` wrapper around it, built for exactly that vertical case) does not fit here -- the cursor is plain local `useState` instead, and this effect is the direct equivalent of what that wrapper does: recording the cursor into `state.selection` under the same key `selectionKeyFor` would produce for this screen instance.
  useEffect(() => {
    if (screen.kind !== "paragraphDetail") {
      return;
    }
    dispatch({
      type: "SET_SELECTION",
      key: selectionKeyFor(screen),
      index: clampedRunIndex,
    });
  }, [screen, clampedRunIndex, dispatch]);

  useInput(
    (input, key) => {
      if (paragraph === undefined) {
        return;
      }
      if (key.leftArrow) {
        setRunIndex(Math.max(0, clampedRunIndex - 1));
        return;
      }
      if (key.rightArrow) {
        setRunIndex(
          runs.length === 0
            ? 0
            : Math.min(runs.length - 1, clampedRunIndex + 1),
        );
        return;
      }
      if (key.escape) {
        dispatch({ type: "POP_SCREEN" });
        return;
      }
      if (key.return) {
        if (selectedRun !== undefined) {
          dispatch({
            type: "PUSH_SCREEN",
            screen: {
              kind: "runEditor",
              blockIndex,
              runIndex: clampedRunIndex,
            },
          });
        }
        return;
      }
      if (input === "a") {
        const newIndex = runs.length;
        dispatch({ type: "APPEND_RUN", blockIndex, text: "" });
        setRunIndex(newIndex);
        dispatch({
          type: "PUSH_SCREEN",
          screen: { kind: "runEditor", blockIndex, runIndex: newIndex },
        });
        return;
      }
      // Uppercase, matching this codebase's own "uppercase variant when the lowercase letter is already taken" convention (see paragraph-family.tsx's own 'T' table wizard beside 'a' append) -- 'i' already toggles italic on this screen. docx/odt only: MarkdownParagraph has no insertImageAfter at all (the reducer's own INSERT_PARAGRAPH_IMAGE case is narrowed to styledWordprocessingDocument for exactly this reason), so the key does nothing for a markdown document rather than opening a wizard whose submission would only produce a warning.
      if (input === "I" && doc?.format !== "markdown") {
        setImageWizardOpen(true);
        return;
      }
      // docx-only: appendOfficeMath is paragraph-scoped, but odt has no paragraph-scoped formula insertion at all (OdtBody.appendFormula is body-scoped -- see paragraph-family.tsx's own 'm' handler for that path).
      if (input === "m" && doc?.format === "docx") {
        setFormulaPickerOpen(true);
        return;
      }
      if (selectedRun === undefined) {
        return;
      }
      if (input === "b") {
        dispatch({
          type: "TOGGLE_RUN_BOLD",
          blockIndex,
          runIndex: clampedRunIndex,
        });
        return;
      }
      if (input === "i") {
        dispatch({
          type: "TOGGLE_RUN_ITALIC",
          blockIndex,
          runIndex: clampedRunIndex,
        });
        return;
      }
      // The four keys below all read/write a field MarkdownRun has no getter or setter for at all (underline, colour, font family, font size) -- disabled outright for a markdown document rather than opening a prompt that could only ever end in a wrongDocument warning from the reducer.
      if (!supportsRunStyleExtras(selectedRun)) {
        return;
      }
      if (input === "u") {
        dispatch({
          type: "TOGGLE_RUN_UNDERLINE",
          blockIndex,
          runIndex: clampedRunIndex,
        });
        return;
      }
      if (input === "c") {
        setColorInput(
          selectedRun.color === undefined
            ? ""
            : layoutColorToHex(selectedRun.color).slice(1),
        );
        return;
      }
      if (input === "f") {
        setFontFamilyInput(selectedRun.fontFamily ?? "");
        return;
      }
      if (input === "s") {
        setFontSizeInput(
          selectedRun.sizePt === undefined ? "" : String(selectedRun.sizePt),
        );
      }
    },
    {
      isActive:
        !anyOverlayOpen(state) &&
        colorInput === undefined &&
        fontFamilyInput === undefined &&
        fontSizeInput === undefined &&
        !imageWizardOpen &&
        !formulaPickerOpen,
    },
  );

  if (screen.kind !== "paragraphDetail") {
    return (
      <Text color="red">
        ParagraphDetailScreen rendered outside a paragraphDetail screen.
      </Text>
    );
  }
  if (doc === undefined) {
    return (
      <Text color="red">
        ParagraphDetailScreen requires an open docx, odt or markdown document.
      </Text>
    );
  }
  if (paragraph === undefined) {
    return (
      <Text color="red">
        There is no paragraph at index {screen.blockIndex}.
      </Text>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        Paragraph {screen.blockIndex}
        {paragraph.styleId === undefined ? "" : ` (${paragraph.styleId})`}
      </Text>
      <ParagraphRunsView
        runs={runs}
        selectedRunIndex={runs.length === 0 ? undefined : clampedRunIndex}
      />
      {colorInput === undefined ? undefined : (
        <Box>
          <Text color="cyan"># </Text>
          <TextField
            value={colorInput}
            isFocused
            placeholder="rrggbb"
            onChange={setColorInput}
            onSubmit={(value) => {
              if (isValidHexColorInput(value)) {
                dispatch({
                  type: "SET_RUN_COLOR",
                  blockIndex,
                  runIndex: clampedRunIndex,
                  color: rgbHexToColor(value.trim()),
                });
              } else {
                dispatch({
                  type: "SET_STATUS",
                  severity: "warning",
                  text: `"${value}" is not a 6-digit hex colour`,
                });
              }
              setColorInput(undefined);
            }}
            onCancel={() => {
              setColorInput(undefined);
            }}
          />
        </Box>
      )}
      {fontFamilyInput === undefined ? undefined : (
        <Box>
          <Text color="cyan">Font family: </Text>
          <TextField
            value={fontFamilyInput}
            isFocused
            placeholder="e.g. Calibri"
            onChange={setFontFamilyInput}
            onSubmit={(value) => {
              const trimmed = value.trim();
              if (trimmed.length === 0) {
                dispatch({
                  type: "SET_STATUS",
                  severity: "warning",
                  text: "A font family name cannot be blank",
                });
              } else {
                dispatch({
                  type: "SET_RUN_FONT_FAMILY",
                  blockIndex,
                  runIndex: clampedRunIndex,
                  fontFamily: trimmed,
                });
              }
              setFontFamilyInput(undefined);
            }}
            onCancel={() => {
              setFontFamilyInput(undefined);
            }}
          />
        </Box>
      )}
      {fontSizeInput === undefined ? undefined : (
        <Box>
          <Text color="cyan">Font size (pt): </Text>
          <TextField
            value={fontSizeInput}
            isFocused
            placeholder="e.g. 12"
            onChange={setFontSizeInput}
            onSubmit={(value) => {
              // This field only ever opens via the 's' handler, itself gated behind supportsRunStyleExtras(selectedRun) -- but that guard lives in a separate closure (the useInput callback), so TypeScript has no way to carry the narrowing through to this one; re-checking it here is what lets `selectedRun.sizePt` read without a cast.
              const currentSizePt =
                selectedRun !== undefined && supportsRunStyleExtras(selectedRun)
                  ? (selectedRun.sizePt ?? DEFAULT_RUN_SIZE_PT)
                  : DEFAULT_RUN_SIZE_PT;
              const sizePt = parseNumberField(value, currentSizePt);
              if (sizePt <= 0) {
                dispatch({
                  type: "SET_STATUS",
                  severity: "warning",
                  text: `"${value}" is not a positive font size`,
                });
              } else {
                dispatch({
                  type: "SET_RUN_FONT_SIZE",
                  blockIndex,
                  runIndex: clampedRunIndex,
                  sizePt,
                });
              }
              setFontSizeInput(undefined);
            }}
            onCancel={() => {
              setFontSizeInput(undefined);
            }}
          />
        </Box>
      )}
      {imageWizardOpen ? (
        <FieldWizard
          fields={IMAGE_FIELDS}
          onCancel={() => {
            setImageWizardOpen(false);
          }}
          onComplete={(values) => {
            void applyInsertImage(blockIndex, values, dispatch).then(() => {
              setImageWizardOpen(false);
            });
          }}
        />
      ) : undefined}
      {formulaPickerOpen ? (
        <FormulaPicker
          isActive={!anyOverlayOpen(state)}
          onCancel={() => {
            setFormulaPickerOpen(false);
          }}
          onMathml={(mathml: readonly MathMlNode[]) => {
            dispatch({ type: "INSERT_DOCX_FORMULA", blockIndex, mathml });
            setFormulaPickerOpen(false);
          }}
          onInvalidRawMathml={(message) => {
            dispatch({
              type: "SET_STATUS",
              severity: "warning",
              text: `Could not parse MathML: ${message}`,
            });
          }}
        />
      ) : undefined}
      <Text dimColor>
        &lt;- / -&gt; move, Enter edit text, b/i
        {doc.format === "markdown" ? "" : "/u"} toggle
        {doc.format === "markdown" ? "" : ", c colour, f font, s size"}, a
        append run{doc.format === "markdown" ? "" : ", I image"}
        {doc.format === "docx" ? ", m formula" : ""}, Esc back
      </Text>
    </Box>
  );
}
