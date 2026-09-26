// The marked-content scope helpers, split from interpret.ts: collapsing a BDC/TO marked-content property dict into the scope-props lookup the content writer consults for StructParents assignment.
import type { PdfDict } from "./objects";
import type { PdfObjectResolver } from "./interpret-types";
import { asNumber, dictGet } from "./objects";
import type { PdfObject } from "./objects";
import { decodePdfString } from "./pdf-text";

export function markedContentProperties(
  operand: PdfObject | undefined,
  resources: PdfDict,
  resolver: Readonly<PdfObjectResolver>,
): PdfDict | undefined {
  if (operand?.kind === "dict") {
    return operand;
  }
  if (operand?.kind === "name") {
    const properties = resolver.resolveDict(dictGet(resources, "Properties"));
    return properties === undefined
      ? undefined
      : resolver.resolveDict(dictGet(properties, operand.name));
  }
  return undefined;
}

export function markedContentScopeProps(props: PdfDict | undefined): {
  actualText?: string;
  alt?: string;
  mcid?: number;
} {
  if (props === undefined) {
    return {};
  }
  const actualTextObj = dictGet(props, "ActualText");
  const altObj = dictGet(props, "Alt");
  const mcid = asNumber(dictGet(props, "MCID"));
  return {
    ...(actualTextObj?.kind === "string"
      ? { actualText: decodePdfString(actualTextObj.bytes) }
      : {}),
    ...(altObj?.kind === "string"
      ? { alt: decodePdfString(altObj.bytes) }
      : {}),
    ...(mcid !== undefined && mcid >= 0 ? { mcid } : {}),
  };
}
