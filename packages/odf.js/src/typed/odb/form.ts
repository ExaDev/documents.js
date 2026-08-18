import type { XmlElement } from '../../model/node';
import type { Package } from '../../model/package';
import { findChildElement, attrValue, rootElement } from '../../xml/query';
import { decodeXmlText } from '../../xml/entities';
import { readOdt, type OdtDocument } from '../odt/read';
import { resolveOdbComponent } from './read';
import { subDocumentPackage } from './subdocument';

// A .odb form sub-document -> its ordinary ODF text content PLUS its office:forms/form:form control tree. STATIC STRUCTURE ONLY: nothing here executes SQL, opens a connection, resolves a control's runtime value, or evaluates a list box's own value list -- a form's real rendered content only exists once a live database engine has answered its query, which is categorically out of scope for this package (see typed/odb/read.ts's own top-of-file note for the same boundary applied to the inventory).
//
// EMPIRICALLY CONFIRMED against real, unmodified LibreOffice 26.2 output (src/typed/odb/fixtures/form-and-report.odb -- see typed/odb/read.ts's own top-of-file note for how that fixture was generated and cross-verified), not assumed:
//
// 1. A form sub-document is a COMPLETE, ordinary ODF TEXT document. Its own directory holds content.xml/styles.xml/settings.xml (plus a manifest.rdf), its manifest:media-type is "application/vnd.oasis.opendocument.text", and its content.xml root is the usual office:document-content/office:body/office:text. readOdt therefore reads it unmodified through a synthetic sub-Package (see subdocument.ts) -- no form-specific text reader needed, and the paragraphs/tables a form's designer laid out around its controls come back exactly as they would from a standalone .odt.
// 2. The control tree hangs off office:text/office:forms, NOT off the drawing layer. office:forms holds one form:form per top-level form; a control is a form:<kind> ELEMENT (form:text, form:formatted-text, form:listbox, form:fixed-text, form:checkbox, ...) whose own form:data-field names the bound column. The drawing layer separately carries a draw:control element per control, referencing the control by its form:id -- that is the control's own GEOMETRY (position/size/anchor), which no reader here resolves today: readBlocks (typed/odt/read.ts) has no draw:control branch, and the ods shape walker skips the element explicitly (see typed/ods/read.ts's collectAnchoredFrames note), so control geometry is dropped entirely rather than re-derived here.
// 3. A form:form can NEST another form:form (a real Base sub-form, bound to its own command -- the fixture's own "HighValueSubForm" is a genuine nested form:form bound to a QUERY while its parent is bound to a TABLE). Sub-forms are consequently modelled as their own recursive OdbFormDefinition list rather than flattened into the parent's controls.
// 4. form:properties (an untyped bag of form:property elements carrying UNO property values LibreOffice round-trips for its own benefit -- PropertyChangeNotificationEnabled, DefaultControl, ObjIDinMSO, ...) appears on the form and on most controls. It is deliberately never read: none of it is form STRUCTURE, and surfacing a producer-specific property bag would invite callers to depend on LibreOffice internals.
//
// Control elements are read GENERICALLY -- by their real element tag plus the small set of structural attributes confirmed above -- rather than through a closed per-kind union. That is what lets a form:grid's own form:column children (a real ODF shape this fixture does not happen to exercise) come back as ordinary nested controls instead of being silently dropped, and it keeps this reader from inventing a per-control-kind schema no real file here has verified.

export interface OdbFormControl {
  // The control's own real ODF element tag, e.g. 'form:text', 'form:listbox', 'form:fixed-text'. Kept verbatim rather than mapped onto a closed enum -- see this module's own top-of-file note (point 4).
  tag: string;
  name?: string;
  // form:control-implementation, e.g. 'ooo:com.sun.star.form.component.TextField' -- the producer's own UNO service name for the control, carried verbatim.
  controlImplementation?: string;
  // form:data-field -- the database column this control is bound to, the single most load-bearing attribute for a static structure read.
  dataField?: string;
  // form:id, the identifier the drawing layer's own draw:control element references for geometry.
  id?: string;
  // form:label, present on a label-bearing control (form:fixed-text, form:button, ...).
  label?: string;
  // Nested control elements, e.g. a form:grid's own form:column children. Empty for a leaf control.
  controls: OdbFormControl[];
}

export interface OdbFormDefinition {
  name?: string;
  // form:command plus form:command-type ('table' | 'query' | 'command'), the form's own data binding.
  command?: string;
  commandType?: string;
  // form:datasource, when the form names its data source explicitly rather than inheriting the enclosing database document's own.
  datasource?: string;
  filter?: string;
  order?: string;
  controls: OdbFormControl[];
  // Nested form:form elements -- real Base sub-forms, each with its own independent command binding. See this module's own top-of-file note (point 3).
  subForms: OdbFormDefinition[];
}

export interface OdbForm {
  // The form's own user-visible name, from content.xml's db:forms/db:component -- NOT the persistent storage directory name (see typed/odb/read.ts's own top-of-file note on why those differ).
  name: string;
  // The sub-document's own package path, e.g. 'forms/Obj11'.
  href: string;
  // The sub-document read as the ordinary ODF text document it genuinely is.
  document: OdtDocument;
  // Every top-level form:form under office:text/office:forms, in document order.
  forms: OdbFormDefinition[];
}

const CONTENT_PART = 'content.xml';
const FORM_ELEMENT_TAG = 'form:form';
const FORM_PROPERTIES_TAG = 'form:properties';
const FORM_TAG_PREFIX = 'form:';

// A form:* attribute's own value, entity-decoded -- odf.js's lossless model keeps entities raw for round-trip fidelity, and every projected string this reader returns is exactly the boundary where that encoding needs undoing (mirroring readOdbInventory's own db:command treatment).
function formAttr(element: XmlElement, name: string): string | undefined {
  const raw = attrValue(element, name);
  return raw === undefined ? undefined : decodeXmlText(raw);
}

// One form:<kind> control element -> OdbFormControl, recursing into any nested form:* element children (a form:grid's own form:column children being the real case this covers) but never into form:properties -- see this module's own top-of-file note (point 4).
function readControl(element: XmlElement): OdbFormControl {
  const control: OdbFormControl = { tag: element.tag, controls: readControls(element) };
  const name = formAttr(element, 'form:name');
  if (name !== undefined) {
    control.name = name;
  }
  const controlImplementation = formAttr(element, 'form:control-implementation');
  if (controlImplementation !== undefined) {
    control.controlImplementation = controlImplementation;
  }
  const dataField = formAttr(element, 'form:data-field');
  if (dataField !== undefined) {
    control.dataField = dataField;
  }
  const id = formAttr(element, 'form:id');
  if (id !== undefined) {
    control.id = id;
  }
  const label = formAttr(element, 'form:label');
  if (label !== undefined) {
    control.label = label;
  }
  return control;
}

// Every form:* element child of `container` that is neither a nested form:form (those become sub-forms) nor form:properties, in document order.
function readControls(container: XmlElement): OdbFormControl[] {
  const controls: OdbFormControl[] = [];
  for (const child of container.children) {
    if (child.type !== 'element' || !child.tag.startsWith(FORM_TAG_PREFIX)) {
      continue;
    }
    if (child.tag === FORM_ELEMENT_TAG || child.tag === FORM_PROPERTIES_TAG) {
      continue;
    }
    controls.push(readControl(child));
  }
  return controls;
}

function readFormDefinition(element: XmlElement): OdbFormDefinition {
  const subForms: OdbFormDefinition[] = [];
  for (const child of element.children) {
    if (child.type === 'element' && child.tag === FORM_ELEMENT_TAG) {
      subForms.push(readFormDefinition(child));
    }
  }
  const definition: OdbFormDefinition = { controls: readControls(element), subForms };
  const name = formAttr(element, 'form:name');
  if (name !== undefined) {
    definition.name = name;
  }
  const command = formAttr(element, 'form:command');
  if (command !== undefined) {
    definition.command = command;
  }
  const commandType = formAttr(element, 'form:command-type');
  if (commandType !== undefined) {
    definition.commandType = commandType;
  }
  const datasource = formAttr(element, 'form:datasource');
  if (datasource !== undefined) {
    definition.datasource = datasource;
  }
  const filter = formAttr(element, 'form:filter');
  if (filter !== undefined) {
    definition.filter = filter;
  }
  const order = formAttr(element, 'form:order');
  if (order !== undefined) {
    definition.order = order;
  }
  return definition;
}

// office:text/office:forms' own top-level form:form children. An office:text with no office:forms element at all (a form sub-document whose designer deleted every control, or an ordinary .odt read through this same path) yields an empty array rather than throwing -- the text content is still perfectly readable, so this degrades rather than failing, matching this package's general "malformed-but-salvageable degrades" posture.
function readFormDefinitions(contentRoot: XmlElement | undefined): OdbFormDefinition[] {
  const body = contentRoot === undefined ? undefined : findChildElement(contentRoot.children, 'office:body');
  const text = body === undefined ? undefined : findChildElement(body.children, 'office:text');
  const forms = text === undefined ? undefined : findChildElement(text.children, 'office:forms');
  if (forms === undefined) {
    return [];
  }
  const definitions: OdbFormDefinition[] = [];
  for (const child of forms.children) {
    if (child.type === 'element' && child.tag === FORM_ELEMENT_TAG) {
      definitions.push(readFormDefinition(child));
    }
  }
  return definitions;
}

// Package + a form's own db:forms/db:component name -> OdbForm. Throws when the .odb declares no form by that name, or when the sub-document its db:component points at is missing from the package -- both are genuinely unusable references rather than salvageable degradations, matching every other typed reader's own "missing required structural element" throw convention.
export function readOdbForm(pkg: Package, formName: string): OdbForm {
  const component = resolveOdbComponent(pkg, 'form', formName);
  const subPackage = subDocumentPackage(pkg, component.href);
  const contentPart = subPackage.parts[CONTENT_PART];
  if (contentPart?.kind !== 'xml') {
    throw new Error(`readOdbForm: form "${formName}" sub-document ${component.href}/${CONTENT_PART} is not an XML part`);
  }
  return {
    name: component.name,
    href: component.href,
    document: readOdt(subPackage),
    forms: readFormDefinitions(rootElement(contentPart.nodes)),
  };
}
