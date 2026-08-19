import type { OdbForm, OdbFormControl, OdbFormDefinition, OdbReport, OdbReportBand, OdbReportElement, OdbReportFunction, OdbReportGroup } from 'documents.js';

// The one place a `.odb`'s form and report STRUCTURE turns into text, shared by the `odb-forms`/`odb-reports` commands and by the TUI's own form/report detail screens -- the same relationship `src/format.ts` has to the two layers, and for the same reason: the CLI renders these lines joined by newlines while the TUI renders one per `ListView` row, so a flat `readonly string[]` of already-indented lines is the shape that genuinely serves both without either owning the other's rendering.
//
// This module never touches a package, a file, or documents.js's readers -- it is a pure function of the `OdbForm`/`OdbReport` values `readOdbForms`/`readOdbReports` hand back, which is what lets both layers' tests assert against real fixture-derived structure with no I/O of their own.

const INDENT = '  ';

function indent(depth: number): string {
  return INDENT.repeat(depth);
}

function quoted(value: string): string {
  return `"${value}"`;
}

// A form definition's own `command`/`commandType` pair, and a report's -- the "what data does this thing sit on top of" line both vocabularies express identically (`form:datasource`/`form:command`, `rpt:command`/`rpt:command-type`). `commandType` is genuinely optional in both models, so a command with no declared type still renders rather than being dropped.
function describeDataSource(command: string | undefined, commandType: string | undefined): string | undefined {
  if (command === undefined) {
    return commandType;
  }
  return commandType === undefined ? quoted(command) : `${commandType} ${quoted(command)}`;
}

export function countOdbFormControls(controls: readonly OdbFormControl[]): number {
  return controls.reduce((total, control) => total + 1 + countOdbFormControls(control.controls), 0);
}

export function countOdbFormDefinitionControls(definition: OdbFormDefinition): number {
  return countOdbFormControls(definition.controls) + definition.subForms.reduce((total, subForm) => total + countOdbFormDefinitionControls(subForm), 0);
}

function countOdbFormBoundControls(controls: readonly OdbFormControl[]): number {
  return controls.reduce((total, control) => total + (control.dataField === undefined ? 0 : 1) + countOdbFormBoundControls(control.controls), 0);
}

function countOdbFormDefinitionBoundControls(definition: OdbFormDefinition): number {
  return countOdbFormBoundControls(definition.controls) + definition.subForms.reduce((total, subForm) => total + countOdbFormDefinitionBoundControls(subForm), 0);
}

// The one-line summary a list row shows: enough to tell two forms apart and to see at a glance which one carries the bindings, without opening either.
export function describeOdbForm(form: OdbForm): string {
  const controlCount = form.forms.reduce((total, definition) => total + countOdbFormDefinitionControls(definition), 0);
  const boundCount = form.forms.reduce((total, definition) => total + countOdbFormDefinitionBoundControls(definition), 0);
  return `${form.name} [${form.href}] -- ${form.forms.length} form${form.forms.length === 1 ? '' : 's'}, ${controlCount} control${controlCount === 1 ? '' : 's'} (${boundCount} bound)`;
}

function formControlLines(control: OdbFormControl, depth: number): readonly string[] {
  const parts: string[] = [control.tag];
  if (control.name !== undefined) {
    parts.push(control.name);
  }
  // The field binding is the whole point of listing a control at all, so it leads the annotations rather than trailing them.
  if (control.dataField !== undefined) {
    parts.push(`-> ${control.dataField}`);
  }
  if (control.label !== undefined) {
    parts.push(`label ${quoted(control.label)}`);
  }
  if (control.controlImplementation !== undefined) {
    parts.push(`(${control.controlImplementation})`);
  }
  const nested = control.controls.flatMap((child) => formControlLines(child, depth + 1));
  return [`${indent(depth)}${parts.join(' ')}`, ...nested];
}

function formDefinitionLines(definition: OdbFormDefinition, depth: number, kindLabel: string): readonly string[] {
  const headerParts: string[] = [kindLabel];
  if (definition.name !== undefined) {
    headerParts.push(definition.name);
  }
  const dataSource = describeDataSource(definition.command, definition.commandType);
  if (dataSource !== undefined) {
    headerParts.push(`on ${dataSource}`);
  }

  const lines: string[] = [`${indent(depth)}${headerParts.join(' ')}`];
  if (definition.datasource !== undefined) {
    lines.push(`${indent(depth + 1)}datasource: ${definition.datasource}`);
  }
  if (definition.filter !== undefined) {
    lines.push(`${indent(depth + 1)}filter: ${definition.filter}`);
  }
  if (definition.order !== undefined) {
    lines.push(`${indent(depth + 1)}order: ${definition.order}`);
  }
  if (definition.controls.length === 0) {
    lines.push(`${indent(depth + 1)}(no controls)`);
  }
  for (const control of definition.controls) {
    lines.push(...formControlLines(control, depth + 1));
  }
  // A sub-form is an ordinary `form:form` nested inside its parent's own element, carrying its own command against a different table or query -- rendered with the identical shape one level in, since that is exactly what it is.
  for (const subForm of definition.subForms) {
    lines.push(...formDefinitionLines(subForm, depth + 1, 'subform'));
  }
  return lines;
}

export function formatOdbFormLines(form: OdbForm): readonly string[] {
  if (form.forms.length === 0) {
    return ['(this form document declares no form:form definitions)'];
  }
  return form.forms.flatMap((definition) => formDefinitionLines(definition, 0, 'form'));
}

// `OdbForm.document` is the form sub-document's whole parsed `OdtDocument` (every paragraph, table, and style of the layout the controls sit on) -- orders of magnitude larger than the structure a caller asked for, and not what "print the form's bound controls" means. The JSON shape drops it and keeps the three fields that describe the form itself.
export interface OdbFormSummary {
  readonly name: string;
  readonly href: string;
  readonly forms: readonly OdbFormDefinition[];
}

export function odbFormSummary(form: OdbForm): OdbFormSummary {
  return { name: form.name, href: form.href, forms: form.forms };
}

function countReportBandElements(band: OdbReportBand | undefined): number {
  return band?.elements.length ?? 0;
}

function countReportGroupElements(group: OdbReportGroup): number {
  return countReportBandElements(group.header) + countReportBandElements(group.footer) + group.groups.reduce((total, nested) => total + countReportGroupElements(nested), 0);
}

function countReportGroups(groups: readonly OdbReportGroup[]): number {
  return groups.reduce((total, group) => total + 1 + countReportGroups(group.groups), 0);
}

export function describeOdbReport(report: OdbReport): string {
  const dataSource = describeDataSource(report.command, report.commandType);
  const groupCount = countReportGroups(report.groups);
  const elementCount =
    countReportBandElements(report.reportHeader) +
    countReportBandElements(report.pageHeader) +
    countReportBandElements(report.detail) +
    countReportBandElements(report.pageFooter) +
    countReportBandElements(report.reportFooter) +
    report.groups.reduce((total, group) => total + countReportGroupElements(group), 0);
  const source = dataSource === undefined ? 'no data source' : `on ${dataSource}`;
  return `${report.name} [${report.href}] -- ${source}, ${groupCount} group${groupCount === 1 ? '' : 's'}, ${elementCount} element${elementCount === 1 ? '' : 's'}`;
}

function reportElementLine(element: OdbReportElement, depth: number): string {
  const parts: string[] = [element.tag];
  if (element.name !== undefined) {
    parts.push(quoted(element.name));
  }
  // A `rpt:formatted-text` carries its expression in `formula` (`field:[AMOUNT]` for a plain column reference, `rpt:SUM([AMOUNT])` for an aggregate); a `rpt:fixed-content` carries literal `text` instead. Both are rendered, since an element is free to carry either and the distinction is exactly what a reader is looking for.
  if (element.formula !== undefined) {
    parts.push(`= ${element.formula}`);
  }
  if (element.dataField !== undefined) {
    parts.push(`-> ${element.dataField}`);
  }
  // Appended to the joined head rather than pushed as its own token, so the colon sits flush against the element's name instead of floating a space away from it.
  const head = `${indent(depth)}${parts.join(' ')}`;
  return element.text === undefined ? head : `${head}: ${quoted(element.text)}`;
}

function reportBandLines(band: OdbReportBand | undefined, depth: number): readonly string[] {
  if (band === undefined) {
    return [];
  }
  const header = band.name === undefined ? band.kind : `${band.kind} ${quoted(band.name)}`;
  const lines: string[] = [`${indent(depth)}${header}`];
  if (band.elements.length === 0) {
    lines.push(`${indent(depth + 1)}(no elements)`);
  }
  for (const element of band.elements) {
    lines.push(reportElementLine(element, depth + 1));
  }
  return lines;
}

function reportFunctionLines(functions: readonly OdbReportFunction[], depth: number): readonly string[] {
  if (functions.length === 0) {
    return [];
  }
  return [`${indent(depth)}functions`, ...functions.map((fn) => `${indent(depth + 1)}${fn.name} = ${fn.formula}`)];
}

function reportGroupLines(group: OdbReportGroup, depth: number): readonly string[] {
  const headerParts: string[] = ['group'];
  // A group key is an EXPRESSION, not a bare column name -- real Report Builder output writes `rpt:HASCHANGED("REGION")` here, and a group keyed on a user-defined function names that function rather than any column. Printed verbatim for exactly that reason.
  if (group.groupExpression !== undefined) {
    headerParts.push(group.groupExpression);
  }
  const attributes: string[] = [];
  if (group.sortExpression !== undefined) {
    attributes.push(`sort ${group.sortExpression} ${group.sortAscending === false ? 'descending' : 'ascending'}`);
  }
  if (group.startNewColumn === true) {
    attributes.push('new column');
  }
  if (group.resetPageNumber === true) {
    attributes.push('reset page number');
  }
  if (group.keepTogether !== undefined) {
    attributes.push(`keep together ${group.keepTogether}`);
  }
  if (attributes.length > 0) {
    headerParts.push(`(${attributes.join(', ')})`);
  }

  return [
    `${indent(depth)}${headerParts.join(' ')}`,
    ...reportBandLines(group.header, depth + 1),
    ...group.groups.flatMap((nested) => reportGroupLines(nested, depth + 1)),
    ...reportFunctionLines(group.functions, depth + 1),
    ...reportBandLines(group.footer, depth + 1),
  ];
}

// The report's own model shape, rendered structurally rather than in print order: bands in the order `OdbReport` declares them, groups nested as they nest, `detail` at report level (which is where the model puts it, even though the XML nests the detail band inside the innermost group). Nothing here is reordered or inferred -- what you read is the parsed structure.
export function formatOdbReportLines(report: OdbReport): readonly string[] {
  const lines: string[] = [];
  const dataSource = describeDataSource(report.command, report.commandType);
  if (dataSource !== undefined) {
    lines.push(`data source: ${dataSource}`);
  }
  if (report.caption !== undefined) {
    lines.push(`caption: ${report.caption}`);
  }
  if (report.mimeType !== undefined) {
    lines.push(`mime type: ${report.mimeType}`);
  }
  lines.push(...reportBandLines(report.reportHeader, 0));
  lines.push(...reportBandLines(report.pageHeader, 0));
  lines.push(...report.groups.flatMap((group) => reportGroupLines(group, 0)));
  lines.push(...reportBandLines(report.detail, 0));
  lines.push(...reportBandLines(report.pageFooter, 0));
  lines.push(...reportBandLines(report.reportFooter, 0));
  lines.push(...reportFunctionLines(report.functions, 0));
  return lines;
}
