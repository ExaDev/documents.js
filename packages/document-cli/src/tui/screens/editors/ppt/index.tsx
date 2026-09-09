import { Box, Text, useInput } from "ink";
import { useState, type ReactElement } from "react";
import {
  buildPptSlideFamilyAdapter,
  SlideFamilySlideList,
} from "../../shared/slide-family.js";
import {
  FieldWizard,
  requireFieldValue,
  type FieldSpec,
} from "../../shared/field-wizard.js";
import { parseNumberField } from "../../shared/text.js";
import { TextField } from "../../../components/text-field.js";
import { useNavigationInput } from "../../../keybindings/use-navigation-input.js";
import { useAppDispatch, useAppState } from "../../../state/context.js";
import { anyOverlayOpen, type PptOpenDocument } from "../../../state/types.js";

// The ppt root screens. The slide list is the shared slide-family list (PptSlide/PptShape carry the identical summary subset it reads); the detail screen is deliberately NOT the shared rich one -- that screen's shape/table/image editing runs on PptxSlide/OdpSlide's full API, while a ppt slide carries the text-box-and-notes subset [MS-PPT]'s own writer supports -- so this narrower companion exists beside it, editing exactly what a .ppt can state: shape text and frames, speaker notes, and adding text boxes.

function pptDocument(state: ReturnType<typeof useAppState>): PptOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "ppt") {
    throw new Error(
      "A ppt screen rendered without an open ppt document; check the screen router in app.tsx.",
    );
  }
  return doc;
}

export function PptSlideListScreen(): ReactElement {
  const state = useAppState();
  const doc = pptDocument(state);
  return (
    <SlideFamilySlideList adapter={buildPptSlideFamilyAdapter(doc.editor)} />
  );
}

const TEXTBOX_FIELDS: readonly FieldSpec[] = [
  { key: "xPt", label: "x (pt)", defaultValue: "40" },
  { key: "yPt", label: "y (pt)", defaultValue: "30" },
  { key: "widthPt", label: "width (pt)", defaultValue: "640" },
  { key: "heightPt", label: "height (pt)", defaultValue: "80" },
  { key: "text", label: "text", defaultValue: "" },
];

interface Row {
  readonly kind: "shape" | "notes";
  readonly index: number;
  readonly label: string;
}

export function PptSlideDetailScreen(props: {
  readonly slideIndex: number;
}): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = pptDocument(state);
  const overlayOpen = anyOverlayOpen(state);
  const slide = doc.editor.slides()[props.slideIndex];

  // undefined = browsing; a string = the draft buffer while a shape's text is being edited.
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [draftShape, setDraftShape] = useState<number | undefined>(undefined);
  const [addingTextbox, setAddingTextbox] = useState(false);

  const shapes = slide?.shapes() ?? [];
  const rows: readonly Row[] = [
    ...shapes.map((shape, index): Row => {
      const frame = shape.frame;
      const geometry = `${frame.xPt.toFixed(0)},${frame.yPt.toFixed(0)} ${frame.widthPt.toFixed(0)}x${frame.heightPt.toFixed(0)}pt`;
      const label = shape.text === "" ? "(empty shape)" : shape.text;
      return { kind: "shape", index, label: `${geometry} ${label}` };
    }),
    {
      kind: "notes",
      index: shapes.length,
      label:
        slide === undefined || slide.notes === ""
          ? "Notes: (none)"
          : `Notes: ${slide.notes}`,
    },
  ];

  const { selectedIndex } = useNavigationInput({
    itemCount: rows.length,
    isActive: !overlayOpen && draft === undefined && !addingTextbox,
    onBack: () => {
      dispatch({ type: "POP_SCREEN" });
    },
    onSelect: (index) => {
      const row = rows[index];
      if (row === undefined) {
        return;
      }
      if (row.kind === "notes") {
        dispatch({
          type: "PUSH_SCREEN",
          screen: {
            kind: "notesEditor",
            slideIndex: props.slideIndex,
          },
        });
        return;
      }
      setDraft(shapes[row.index]?.text ?? "");
      setDraftShape(row.index);
    },
    onAppend: () => {
      setAddingTextbox(true);
    },
  });

  useInput(
    (input) => {
      if (input === "n" && slide !== undefined) {
        dispatch({
          type: "PUSH_SCREEN",
          screen: {
            kind: "notesEditor",
            slideIndex: props.slideIndex,
          },
        });
      }
    },
    { isActive: !overlayOpen && draft === undefined && !addingTextbox },
  );

  if (slide === undefined) {
    return (
      <Text color="red">
        There is no slide at index {props.slideIndex} in this presentation.
      </Text>
    );
  }

  if (draft !== undefined && draftShape !== undefined) {
    return (
      <Box flexDirection="column">
        <Text bold>Shape {draftShape} text</Text>
        <TextField
          value={draft}
          isFocused={!overlayOpen}
          placeholder="Shape text"
          onChange={setDraft}
          onSubmit={(value) => {
            dispatch({
              type: "SET_SHAPE_TEXT",
              containerIndex: props.slideIndex,
              shapeIndex: draftShape,
              text: value,
            });
            setDraft(undefined);
            setDraftShape(undefined);
          }}
          onCancel={() => {
            setDraft(undefined);
            setDraftShape(undefined);
          }}
        />
        <Text dimColor>Enter to save, Esc to cancel</Text>
      </Box>
    );
  }

  if (addingTextbox) {
    return (
      <FieldWizard
        fields={TEXTBOX_FIELDS}
        onCancel={() => {
          setAddingTextbox(false);
        }}
        onComplete={(values) => {
          dispatch({
            type: "ADD_TEXTBOX",
            containerIndex: props.slideIndex,
            frame: {
              xPt: parseNumberField(requireFieldValue(values, "xPt"), 40),
              yPt: parseNumberField(requireFieldValue(values, "yPt"), 30),
              widthPt: parseNumberField(
                requireFieldValue(values, "widthPt"),
                640,
              ),
              heightPt: parseNumberField(
                requireFieldValue(values, "heightPt"),
                80,
              ),
            },
            text: requireFieldValue(values, "text"),
          });
          setAddingTextbox(false);
        }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Slide {props.slideIndex + 1}</Text>
      {rows.map((row, index) => (
        <Text
          key={`${row.kind}:${row.index}`}
          color={index === selectedIndex ? "cyan" : undefined}
          inverse={index === selectedIndex}
        >
          {row.kind === "notes" ? row.label : `  ${row.label}`}
        </Text>
      ))}
      <Text dimColor>
        Enter: edit text / notes n: notes a: add text box Esc: back
      </Text>
    </Box>
  );
}
