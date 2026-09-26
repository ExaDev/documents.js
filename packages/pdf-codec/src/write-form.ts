// The AcroForm object-emission walk, split from write.ts's writePdf: the widget annotation collectors, the field/widget dict builders, and the recursive emit walk that pushes every field and widget object. Takes the allocation state (form object numbers, extra widget numbers, page allocations) and the objects sink as explicit parameters, exactly the locals writePdf threaded through it before the split.
import type { LayoutFormField } from "./layout";
import type { PdfDict, PdfObject } from "./objects";
import {
  pdfArray,
  pdfDict,
  pdfLiteralString,
  pdfName,
  pdfNum,
  pdfRef,
} from "./objects";

export interface FormEmitState {
  readonly objects: { num: number; value: PdfObject }[];
  readonly widgetAnnotsByPage: Map<number, PdfObject[]>;
  readonly pageAllocs: readonly { pageNum: number }[];
  readonly formNumOf: (field: LayoutFormField) => number;
  readonly formExtraWidgetNums: ReadonlyMap<LayoutFormField, number[]>;
}

function noteWidgetAnnot(
  state: FormEmitState,
  widget: LayoutFormField["widgets"][number],
  ref: PdfObject,
): void {
  const existing = state.widgetAnnotsByPage.get(widget.pageIndex);
  if (existing === undefined) {
    state.widgetAnnotsByPage.set(widget.pageIndex, [ref]);
  } else {
    existing.push(ref);
  }
}
function widgetRectArray(
  widget: LayoutFormField["widgets"][number],
): PdfObject {
  return pdfArray(
    [
      widget.xPt,
      widget.yPt,
      widget.xPt + widget.widthPt,
      widget.yPt + widget.heightPt,
    ].map((n) => pdfNum(n)),
  );
}
function widgetDict(
  state: FormEmitState,
  widget: LayoutFormField["widgets"][number],
): PdfDict {
  return pdfDict({
    Subtype: pdfName("Widget"),
    Rect: widgetRectArray(widget),
    P: pdfRef(state.pageAllocs[widget.pageIndex]!.pageNum, 0),
  });
}
const FIELD_TYPE_PDF_NAME: Record<
  Exclude<LayoutFormField["fieldType"], "group">,
  string
> = {
  text: "Tx",
  checkbox: "Btn",
  radio: "Btn",
  button: "Btn",
  listbox: "Ch",
  combobox: "Ch",
  signature: "Sig",
};
export function emitFormObjectsWalk(
  state: FormEmitState,
  fields: readonly LayoutFormField[],
  parentName: string | undefined,
): void {
  for (const field of fields) {
    // A root-level field carries its whole name (parentName undefined, no decomposition attempted at all); a nested field carries the segment beyond its parent's — or its whole name when the fully-qualified name does not extend the parent's, which is the model's own escape hatch for a child named independently of its parent.
    const ownName =
      parentName === undefined
        ? field.name
        : field.name.startsWith(`${parentName}.`)
          ? field.name.slice(parentName.length + 1)
          : field.name;
    const entries: [string, PdfObject][] = [];
    if (ownName.length > 0) {
      entries.push(["T", pdfLiteralString(new TextEncoder().encode(ownName))]);
    }
    if (field.alias !== undefined) {
      entries.push([
        "TU",
        pdfLiteralString(new TextEncoder().encode(field.alias)),
      ]);
    }
    if (field.fieldType === "group") {
      entries.push([
        "Kids",
        pdfArray(
          field.children.map((child) => pdfRef(state.formNumOf(child), 0)),
        ),
      ]);
    } else {
      entries.push(["FT", pdfName(FIELD_TYPE_PDF_NAME[field.fieldType])]);
      const FLAG_READ_ONLY = 1;
      const FLAG_PUSHBUTTON = 4;
      const FLAG_RADIO = 32768;
      const FLAG_COMBO = 131072;
      let flags = 0;
      if (field.readOnly === true) flags |= FLAG_READ_ONLY;
      if (field.fieldType === "button") flags |= FLAG_PUSHBUTTON;
      if (field.fieldType === "radio") flags |= FLAG_RADIO;
      if (field.fieldType === "combobox") flags |= FLAG_COMBO;
      if (flags !== 0) {
        entries.push(["Ff", pdfNum(flags)]);
      }
      if (
        field.fieldType === "text" ||
        field.fieldType === "listbox" ||
        field.fieldType === "combobox"
      ) {
        if (field.value !== undefined) {
          entries.push([
            "V",
            pdfLiteralString(new TextEncoder().encode(field.value)),
          ]);
        }
      } else if (
        field.fieldType === "checkbox" ||
        field.fieldType === "radio"
      ) {
        // The button family's checked state is a NAME export value: any name other than Off reads back as checked, so a value the model did carry is exported as itself and a value-less field falls back to Yes/Off from its own checked state.
        entries.push([
          "V",
          pdfName(field.value ?? (field.checked === true ? "Yes" : "Off")),
        ]);
      }
      if (field.options !== undefined) {
        entries.push([
          "Opt",
          pdfArray(
            field.options.map((option) =>
              pdfLiteralString(new TextEncoder().encode(option)),
            ),
          ),
        ]);
      }
      const firstWidget = field.widgets[0];
      if (field.widgets.length === 1 && firstWidget !== undefined) {
        entries.push(["Subtype", pdfName("Widget")]);
        entries.push(["Rect", widgetRectArray(firstWidget)]);
        entries.push([
          "P",
          pdfRef(state.pageAllocs[firstWidget.pageIndex]!.pageNum, 0),
        ]);
        // The merged field dict is the annotation: its page /Annots entry references this very object, not a copy of it.
        noteWidgetAnnot(state, firstWidget, pdfRef(state.formNumOf(field), 0));
      } else if (state.formExtraWidgetNums.has(field)) {
        // Every widget is one of the extra objects the allocation walk reserved, referenced from /Kids and from its page's /Annots alike — the same annotation object in both places, never a copy.
        const extraNums = state.formExtraWidgetNums.get(field) ?? [];
        entries.push([
          "Kids",
          pdfArray(extraNums.map((num) => pdfRef(num, 0))),
        ]);
        for (const [index, num] of extraNums.entries()) {
          const widget = field.widgets[index];
          if (widget !== undefined) {
            noteWidgetAnnot(state, widget, pdfRef(num, 0));
          }
        }
      }
    }
    state.objects.push({
      num: state.formNumOf(field),
      value: pdfDict(Object.fromEntries(entries)),
    });
    const extraNums = state.formExtraWidgetNums.get(field) ?? [];
    for (const [index, num] of extraNums.entries()) {
      const widget = field.widgets[index];
      if (widget !== undefined) {
        state.objects.push({ num, value: widgetDict(state, widget) });
      }
    }
    emitFormObjectsWalk(state, field.children, field.name);
  }
}

export function emitFormObjects(
  state: FormEmitState,
  fields: readonly LayoutFormField[],
): void {
  emitFormObjectsWalk(state, fields, undefined);
}
