import type { PdfDiagnosticSink } from "./diagnostics";
import type { PdfObjectResolver } from "./interpret";
import type { LayoutFormField, LayoutFormWidget } from "./layout";
import type { PageIndexLookup } from "./navigation";
import type { PdfDict, PdfObject } from "./objects";
import { asArray, asName, asNumber, dictGet } from "./objects";
import { decodePdfString } from "./pdf-text";

// AcroForm reading (#721 phase 5): the /AcroForm /Fields recursion, one node per field. The walk splits terminal fields (which carry /FT) from non-terminal groups (whose /Kids are more fields), and within a terminal field splits widget annotations (a /Kid with no /FT, placed by its /P page) from child fields -- the merged-field/widget split the verdict row names. Names are fully qualified per ISO 32000-1 12.7.3.2: the /T chain from the root joined with '.'.

// /Ff flag bit values (ISO 32000-1 Table 220).
const FLAG_READ_ONLY = 1;
const FLAG_PUSHBUTTON = 4;
const FLAG_RADIO = 32768;
const FLAG_COMBO = 131072;

export function readAcroForm(
  catalog: PdfDict,
  resolver: PdfObjectResolver,
  pageIndex: PageIndexLookup,
  sink: PdfDiagnosticSink,
): LayoutFormField[] {
  const acroForm = resolver.resolveDict(dictGet(catalog, "AcroForm"));
  if (acroForm === undefined) {
    return [];
  }
  const fields: LayoutFormField[] = [];
  const visited = new Set<PdfDict>();
  for (const fieldRef of asArray(
    resolver.resolve(dictGet(acroForm, "Fields")),
  ) ?? []) {
    const fieldDict = resolver.resolveDict(fieldRef);
    if (fieldDict !== undefined) {
      readField(fieldDict, "", resolver, pageIndex, sink, fields, visited);
    }
  }
  return fields;
}

function readField(
  node: PdfDict,
  parentName: string,
  resolver: PdfObjectResolver,
  pageIndex: PageIndexLookup,
  sink: PdfDiagnosticSink,
  out: LayoutFormField[],
  visited: Set<PdfDict>,
): void {
  if (visited.has(node)) {
    sink({
      code: "pdf/form-field-cycle",
      severity: "warning",
      message:
        "the AcroForm field tree contains a cycle; stopping descent at the repeated field",
    });
    return;
  }
  visited.add(node);
  const ownName = annotText(node, "T");
  const name =
    ownName === undefined
      ? parentName
      : parentName.length > 0
        ? `${parentName}.${ownName}`
        : ownName;
  const fieldObj = dictGet(node, "FT");
  const fieldType = asName(fieldObj);

  // A node with no /FT is a non-terminal group: its /Kids are fields, never widgets.
  if (fieldType === undefined) {
    const children: LayoutFormField[] = [];
    for (const kidRef of asArray(resolver.resolve(dictGet(node, "Kids"))) ??
      []) {
      const kid = resolver.resolveDict(kidRef);
      if (kid !== undefined) {
        readField(kid, name, resolver, pageIndex, sink, children, visited);
      }
    }
    out.push({
      name,
      fieldType: "group",
      widgets: [],
      children,
    });
    return;
  }

  const flags = asNumber(resolver.resolve(dictGet(node, "Ff"))) ?? 0;
  const value = fieldValue(node, resolver);
  const options = fieldOptions(node, resolver);
  const alias = annotText(node, "TU");
  const widgets: LayoutFormWidget[] = [];
  // Widget kids first; a merged field/widget (its own /Rect, no widget kids) places itself through its own /P exactly as a kid would.
  for (const kidRef of asArray(resolver.resolve(dictGet(node, "Kids"))) ?? []) {
    const kid = resolver.resolveDict(kidRef);
    if (kid === undefined || dictGet(kid, "FT") !== undefined) {
      continue;
    }
    const widget = widgetPlacement(kid, pageIndex);
    if (widget !== undefined) {
      widgets.push(widget);
    }
  }
  if (widgets.length === 0 && dictGet(node, "Rect") !== undefined) {
    const widget = widgetPlacement(node, pageIndex);
    if (widget !== undefined) {
      widgets.push(widget);
    }
  }
  out.push({
    name,
    fieldType: mapFieldType(fieldType, flags),
    ...valueFields(fieldType, value),
    ...(options !== undefined ? { options } : {}),
    ...(alias !== undefined ? { alias } : {}),
    ...((flags & FLAG_READ_ONLY) !== 0 ? { readOnly: true } : {}),
    widgets,
    children: [],
  });
}

// The harmonised control vocabulary the content layer's contentControl construct speaks: /Btn's pushbutton and radio flag bits, /Ch's combo bit, everything else one-to-one.
function mapFieldType(
  fieldType: string,
  flags: number,
): LayoutFormField["fieldType"] {
  if (fieldType === "Tx") {
    return "text";
  }
  if (fieldType === "Btn") {
    if ((flags & FLAG_PUSHBUTTON) !== 0) {
      return "button";
    }
    if ((flags & FLAG_RADIO) !== 0) {
      return "radio";
    }
    return "checkbox";
  }
  if (fieldType === "Ch") {
    return (flags & FLAG_COMBO) !== 0 ? "combobox" : "listbox";
  }
  return "signature";
}

// /V as a scalar string (text and choice fields carry strings or names), and for the button family the checked state: any export value other than Off means checked, with the export value kept beside it.
function valueFields(
  fieldType: string,
  value: string | undefined,
): { value?: string; checked?: boolean } {
  if (value === undefined) {
    return {};
  }
  if (fieldType === "Btn") {
    return { checked: value !== "Off", ...(value !== "Off" ? { value } : {}) };
  }
  if (fieldType === "Sig") {
    return {};
  }
  return { value };
}

function fieldValue(
  node: PdfDict,
  resolver: PdfObjectResolver,
): string | undefined {
  const value = resolver.resolve(dictGet(node, "V"));
  if (value?.kind === "string") {
    return decodePdfString(value.bytes);
  }
  if (value?.kind === "name") {
    return value.name;
  }
  if (value?.kind === "number") {
    return String(value.value);
  }
  return undefined;
}

// /Opt entries are strings or [export label] two-element arrays (ISO 32000-1 12.7.4.3); the export value is the harmonised choice list.
function fieldOptions(
  node: PdfDict,
  resolver: PdfObjectResolver,
): string[] | undefined {
  const opts = asArray(resolver.resolve(dictGet(node, "Opt")));
  if (opts === undefined) {
    return undefined;
  }
  const values: string[] = [];
  for (const opt of opts) {
    const resolved = resolver.resolve(opt);
    if (resolved?.kind === "string") {
      values.push(decodePdfString(resolved.bytes));
    } else if (resolved?.kind === "array") {
      const first = resolved.items[0];
      const exportValue =
        first?.kind === "string"
          ? decodePdfString(first.bytes)
          : first?.kind === "name"
            ? first.name
            : undefined;
      if (exportValue !== undefined) {
        values.push(exportValue);
      }
    }
  }
  return values.length > 0 ? values : undefined;
}

function widgetPlacement(
  widget: PdfDict,
  pageIndex: PageIndexLookup,
): LayoutFormWidget | undefined {
  const pageNo = pageIndex(dictGet(widget, "P"));
  if (pageNo === undefined) {
    return undefined;
  }
  return rectWidget(asArray(dictGet(widget, "Rect")), pageNo);
}

function rectWidget(
  rect: PdfObject[] | undefined,
  pageNo: number,
): LayoutFormWidget | undefined {
  if (rect === undefined) {
    return undefined;
  }
  const x1 = asNumber(rect[0]) ?? 0;
  const y1 = asNumber(rect[1]) ?? 0;
  const x2 = asNumber(rect[2]) ?? 0;
  const y2 = asNumber(rect[3]) ?? 0;
  return {
    pageIndex: pageNo,
    xPt: Math.min(x1, x2),
    yPt: Math.min(y1, y2),
    widthPt: Math.abs(x2 - x1),
    heightPt: Math.abs(y2 - y1),
  };
}

function annotText(dict: PdfDict, key: string): string | undefined {
  const obj = dictGet(dict, key);
  return obj?.kind === "string" ? decodePdfString(obj.bytes) : undefined;
}
