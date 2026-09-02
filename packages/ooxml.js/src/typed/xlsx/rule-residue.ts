import type { SourceResidue } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import { parseXml } from "../../xml/parse";
import { buildXml } from "../../xml/build";

// Attribute-level residue for a worksheet rule element (dataValidation, cfRule) whose schema models most, but not every, ECMA-376 attribute it may carry (a rare producer flag like dataValidation's own showDropDown/imeMode, or a cfRule's pivot/id) -- captures whatever a structural reader in this directory does NOT model as a small residue element carrying only those unmanaged attributes and no children, so a same-format write can restore them without the STRUCTURED fields (which the writer always regenerates fresh from the current ContentSheetDataValidation/ContentSheetConditionalFormat, never from residue) drifting out of sync with whatever the residue happened to remember. This is deliberately distinct from typed/xlsx/content.ts's own applyCellResidueRules, which quarantines a rule's WHOLE element when this package cannot promote it structurally at all -- this mechanism exists for the small attribute gap on a rule it otherwise promotes fully.
export function captureResidualAttributes(
  element: XmlElement,
  managed: ReadonlySet<string>,
): SourceResidue | undefined {
  const residual = element.attributes.filter(
    (attribute) => !managed.has(attribute.name),
  );
  if (residual.length === 0) {
    return undefined;
  }
  return {
    format: "xlsx",
    xml: buildXml([
      { type: "element", tag: element.tag, attributes: residual, children: [] },
    ]),
  };
}

// The write-side counterpart: whatever unmanaged attributes the residue remembers, handed back as a base a caller's freshly computed managed attributes are laid on top of (the caller always overwrites every managed key, so residue can never resurrect a stale structured value). Residue of any other format, or that fails to parse as the expected single element, contributes nothing -- a hand-built rule with no residue at all writes exactly as cleanly as before this mechanism existed, and a residue produced for a DIFFERENT rule kind (mismatched tag) is silently ignored rather than misapplied.
export function residualAttributesFor(
  source: SourceResidue | undefined,
  expectedTag: string,
): Record<string, string> {
  if (source?.format !== "xlsx") {
    return {};
  }
  const nodes = parseXml(source.xml);
  const first = nodes[0];
  if (
    nodes.length !== 1 ||
    first?.type !== "element" ||
    first.tag !== expectedTag
  ) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const attribute of first.attributes) {
    result[attribute.name] = attribute.value;
  }
  return result;
}
