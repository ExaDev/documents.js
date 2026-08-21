import type { ContentBlock, ContentControlDescriptor, ContentControlType } from 'document-schema.js';
import type { XmlElement } from '../../model/node';
import { attrValue, childrenWithTag } from '../../xml/query';
import { decodeXmlText } from '../../xml/entities';
import { odfResidue, type OdfResidueFormat } from './constructs';

// The form:form/form:<kind> tree walker, extracted from typed/odb/form.ts (which keeps it as its own reading engine and re-exports the types) so the odt reader can reuse the SAME walk for office:forms in an ordinary text document without importing odb/form.ts -- that module imports the odt reader for its own sub-document reading, so the walker living there would turn odt's forms row into a reader cycle. The tree shapes and attribute names here are the ones typed/odb/form.ts verified against real LibreOffice Base output; see that module's own top-of-file note for the evidence.

// A control's own real ODF element tag, e.g. 'form:text', 'form:listbox', 'form:fixed-text', kept verbatim rather than mapped onto a closed enum -- the odb reader's own convention, so an unrecognised kind degrades with its tag intact rather than being dropped.
export interface OdbFormControl {
  tag: string;
  name?: string;
  controlImplementation?: string;
  dataField?: string;
  id?: string;
  label?: string;
  controls: OdbFormControl[];
}

export interface OdbFormDefinition {
  name?: string;
  command?: string;
  commandType?: string;
  datasource?: string;
  filter?: string;
  order?: string;
  controls: OdbFormControl[];
  subForms: OdbFormDefinition[];
}

const FORM_ELEMENT_TAG = 'form:form';
const FORM_PROPERTIES_TAG = 'form:properties';
const FORM_TAG_PREFIX = 'form:';

// A form:* attribute's own value, entity-decoded -- odf.js's lossless model keeps entities raw for round-trip fidelity, and every projected string this walker returns is exactly the boundary where that encoding needs undoing.
function formAttr(element: XmlElement, name: string): string | undefined {
  const raw = attrValue(element, name);
  return raw === undefined ? undefined : decodeXmlText(raw);
}

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

// An office:forms element's own top-level form:form children, in document order -- the tree the odt reader maps onto content controls and the odb reader reads as OdbFormDefinition (via the re-export in typed/odb/form.ts).
export function readOdfFormDefinitions(formsElement: XmlElement): OdbFormDefinition[] {
  const definitions: OdbFormDefinition[] = [];
  for (const child of formsElement.children) {
    if (child.type === 'element' && child.tag === FORM_ELEMENT_TAG) {
      definitions.push(readFormDefinition(child));
    }
  }
  return definitions;
}

// --- the odt contentControl mapping ---------------------------------------------------------------------------------

// Which ContentControlType a form:<kind> control degrades to. The members document-schema.js itself names as ODF spellings (checkbox, listbox->dropDown, combobox, button) map exactly; the text-entry family maps to plainText; a grid is a container of column controls (group); everything else has no analogue and degrades to richText with its whole element quarantined in residue -- the standing degrade-to-nearest-kind-with-residue rule.
const CONTROL_TYPE_BY_TAG: ReadonlyMap<string, ContentControlType> = new Map([
  ['form:text', 'plainText'],
  ['form:textarea', 'plainText'],
  ['form:formatted-text', 'plainText'],
  ['form:password', 'plainText'],
  ['form:file', 'plainText'],
  ['form:listbox', 'dropDown'],
  ['form:combobox', 'comboBox'],
  ['form:checkbox', 'checkbox'],
  ['form:radio', 'checkbox'],
  ['form:button', 'button'],
  ['form:image-frame', 'picture'],
  ['form:fixed-text', 'richText'],
  ['form:frame', 'richText'],
  ['form:grid', 'group'],
  ['form:hidden', 'richText'],
]);

// The original form element a walker node came from is what residue serialises, so the construct builder walks the ELEMENTS directly rather than the projected nodes -- the projection loses the form:properties bag this mapping deliberately quarantines.
function controlConstruct(element: XmlElement, format: OdfResidueFormat): ContentBlock[] {
  const mapped = CONTROL_TYPE_BY_TAG.get(element.tag);
  const descriptor: ContentControlDescriptor = { kind: 'contentControl', controlType: mapped ?? 'richText' };
  const name = formAttr(element, 'form:name');
  if (name !== undefined) {
    descriptor.tag = name;
  }
  if (mapped !== undefined) {
    const value = formAttr(element, 'form:current-value') ?? formAttr(element, 'form:value');
    if (value !== undefined) {
      descriptor.value = value;
    }
    if (element.tag === 'form:checkbox' || element.tag === 'form:radio') {
      descriptor.checked = formAttr(element, 'form:current-state') === 'checked';
    }
    const properties = childrenWithTag(element, FORM_PROPERTIES_TAG)[0];
    if (properties !== undefined) {
      descriptor.source = odfResidue(format, properties);
    }
  } else {
    descriptor.source = odfResidue(format, element);
  }
  return [
    { kind: 'constructStart', descriptor },
    { kind: 'constructEnd' },
  ];
}

// One office:forms element -> the point contentControl constructs its tree reads as, in pre-order: each form:form becomes a group control carrying its name, each control its mapped kind, tag, and value/checked state. ODF form controls have no rendered block extent in the text flow -- their geometry lives in the drawing layer's draw:control elements, which no reader resolves -- so every construct here is a point pair and the tree shape states as pre-order document order (the exact structure, bindings included, stays the odb reader's own model for documents that are form sub-documents). The office:forms wrapper element itself emits no construct: it is a pure container, and the group member already names what its child forms are.
export function readOdfFormControlConstructs(formsElement: XmlElement, format: OdfResidueFormat): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const emitForm = (form: XmlElement): void => {
    const descriptor: ContentControlDescriptor = { kind: 'contentControl', controlType: 'group' };
    const name = formAttr(form, 'form:name');
    if (name !== undefined) {
      descriptor.tag = name;
    }
    const properties = childrenWithTag(form, FORM_PROPERTIES_TAG)[0];
    if (properties !== undefined) {
      descriptor.source = odfResidue(format, properties);
    }
    blocks.push({ kind: 'constructStart', descriptor }, { kind: 'constructEnd' });
    for (const child of form.children) {
      if (child.type !== 'element') {
        continue;
      }
      if (child.tag === FORM_ELEMENT_TAG) {
        emitForm(child);
      } else if (child.tag.startsWith(FORM_TAG_PREFIX) && child.tag !== FORM_PROPERTIES_TAG) {
        blocks.push(...controlConstruct(child, format));
      }
    }
  };
  for (const child of formsElement.children) {
    if (child.type === 'element' && child.tag === FORM_ELEMENT_TAG) {
      emitForm(child);
    }
  }
  return blocks;
}
