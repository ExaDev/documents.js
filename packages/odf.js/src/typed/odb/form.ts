import type { XmlElement } from "../../model/node";
import type { Package } from "../../model/package";
import { findChildElement, rootElement } from "../../xml/query";
import { readOdtContent, type OdtDocument } from "../odt/read";
import { resolveOdbComponent } from "./read";
import { subDocumentPackage } from "./subdocument";
import {
  readOdfFormDefinitions,
  type OdbFormDefinition,
} from "../shared/forms";

// A .odb form sub-document -> its ordinary ODF text content PLUS its office:forms/form:form control tree. STATIC STRUCTURE ONLY: nothing here executes SQL, opens a connection, resolves a control's runtime value, or evaluates a list box's own value list -- a form's real rendered content only exists once a live database engine has answered its query, which is categorically out of scope for this package (see typed/odb/read.ts's own top-of-file note for the same boundary applied to the inventory).
//
// EMPIRICALLY CONFIRMED against real, unmodified LibreOffice 26.2 output (src/typed/odb/fixtures/form-and-report.odb -- see typed/odb/read.ts's own top-of-file note for how that fixture was generated and cross-verified), not assumed:
//
// 1. A form sub-document is a COMPLETE, ordinary ODF TEXT document. Its own directory holds content.xml/styles.xml/settings.xml (plus a manifest.rdf), its manifest:media-type is "application/vnd.oasis.opendocument.text", and its content.xml root is the usual office:document-content/office:body/office:text. readOdtContent therefore reads it unmodified through a synthetic sub-Package (see subdocument.ts) -- no form-specific text reader needed, and the paragraphs/tables a form's designer laid out around its controls come back exactly as they would from a standalone .odt.
// 2. The control tree hangs off office:text/office:forms, NOT off the drawing layer. office:forms holds one form:form per top-level form; a control is a form:<kind> ELEMENT (form:text, form:formatted-text, form:listbox, form:fixed-text, form:checkbox, ...) whose own form:data-field names the bound column. The drawing layer separately carries a draw:control element per control, referencing the control by its form:id -- that is the control's own GEOMETRY (position/size/anchor), which no reader here resolves today: readBlocks (typed/odt/read.ts) has no draw:control branch, and the ods shape walker skips the element explicitly (see typed/ods/read.ts's collectAnchoredFrames note), so control geometry is dropped entirely rather than re-derived here.
// 3. A form:form can NEST another form:form (a real Base sub-form, bound to its own command -- the fixture's own "HighValueSubForm" is a genuine nested form:form bound to a QUERY while its parent is bound to a TABLE). Sub-forms are consequently modelled as their own recursive OdbFormDefinition list rather than flattened into the parent's controls.
// 4. form:properties (an untyped bag of form:property elements carrying UNO property values LibreOffice round-trips for its own benefit -- PropertyChangeNotificationEnabled, DefaultControl, ObjIDinMSO, ...) appears on the form and on most controls. It is deliberately never read: none of it is form STRUCTURE, and surfacing a producer-specific property bag would invite callers to depend on LibreOffice internals.
//
// Control elements are read GENERICALLY -- by their real element tag plus the small set of structural attributes confirmed above -- rather than through a closed per-kind union. That is what lets a form:grid's own form:column children (a real ODF shape this fixture does not happen to exercise) come back as ordinary nested controls instead of being silently dropped, and it keeps this reader from inventing a per-control-kind schema no real file here has verified.

// The control/form tree shapes live in typed/shared/forms.ts beside the walker itself, extracted there so the odt reader can reuse the same walk for office:forms in ordinary text documents (this module imports the odt reader, so the walker staying here would make that reuse a reader cycle). index.ts names the two tree types from their new home directly.

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

const CONTENT_PART = "content.xml";

// office:text/office:forms' own top-level form:form children, through typed/shared/forms.ts's walker (the same walk the odt reader maps onto content controls). An office:text with no office:forms element at all (a form sub-document whose designer deleted every control, or an ordinary .odt read through this same path) yields an empty array rather than throwing -- the text content is still perfectly readable, so this degrades rather than failing, matching this package's general "malformed-but-salvageable degrades" posture.
function readFormDefinitions(
  contentRoot: XmlElement | undefined,
): OdbFormDefinition[] {
  const body =
    contentRoot === undefined
      ? undefined
      : findChildElement(contentRoot.children, "office:body");
  const text =
    body === undefined
      ? undefined
      : findChildElement(body.children, "office:text");
  const forms =
    text === undefined
      ? undefined
      : findChildElement(text.children, "office:forms");
  return forms === undefined ? [] : readOdfFormDefinitions(forms);
}

// Package + a form's own db:forms/db:component name -> OdbForm. Throws when the .odb declares no form by that name, or when the sub-document its db:component points at is missing from the package -- both are genuinely unusable references rather than salvageable degradations, matching every other typed reader's own "missing required structural element" throw convention.
export function readOdbForm(pkg: Package, formName: string): OdbForm {
  const component = resolveOdbComponent(pkg, "form", formName);
  const subPackage = subDocumentPackage(pkg, component.href);
  const contentPart = subPackage.parts[CONTENT_PART];
  if (contentPart?.kind !== "xml") {
    throw new Error(
      `readOdbForm: form "${formName}" sub-document ${component.href}/${CONTENT_PART} is not an XML part`,
    );
  }
  return {
    name: component.name,
    href: component.href,
    document: readOdtContent(subPackage),
    forms: readFormDefinitions(rootElement(contentPart.nodes)),
  };
}
