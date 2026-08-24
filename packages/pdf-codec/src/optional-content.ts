import type { PdfDiagnosticSink } from "./diagnostics";
import type { PdfObjectResolver } from "./interpret";
import type { LayoutLayer } from "./layout";
import type { PdfDict, PdfObject } from "./objects";
import { asArray, asName, dictGet } from "./objects";
import { decodePdfString } from "./pdf-text";

// Optional-content reading (#721): /OCProperties groups and the default configuration's visibility state, plus the OCG-dict -> name resolution the content interpreter stamps onto items inside /OC spans. An OCMD (membership dict) resolves to no name by design: its visibility is a function of OTHER groups' states, and collapsing that to a single group's name would misreport membership.

export interface OptionalContentContext {
  readonly layers: readonly LayoutLayer[];
  // The layer name an /OC value (an OCG dict, a ref to one, or a name inside a marked-content property dict) resolves to, or undefined for an OCMD, an unknown dict, or anything that is not optional content at all.
  readonly layerNameOf: (obj: PdfObject | undefined) => string | undefined;
}

export function readOptionalContent(
  catalog: PdfDict,
  resolver: PdfObjectResolver,
  sink: PdfDiagnosticSink,
): OptionalContentContext {
  const ocProperties = resolver.resolveDict(dictGet(catalog, "OCProperties"));
  if (ocProperties === undefined) {
    return { layers: [], layerNameOf: () => undefined };
  }

  // Identity-keyed so an /OC reference to the same OCG resolves to the same name from any content stream -- the object store caches, so a ref and the dict it names are one instance.
  const nameByGroup = new Map<PdfDict, string>();
  const groups: { dict: PdfDict; name: string }[] = [];
  const ocgs = asArray(resolver.resolve(dictGet(ocProperties, "OCGs"))) ?? [];
  for (const ocgRef of ocgs) {
    const ocg = resolver.resolveDict(ocgRef);
    if (ocg === undefined) {
      sink({
        code: "pdf/ocg-unresolved",
        severity: "warning",
        message:
          "an entry in /OCProperties /OCGs did not resolve to a dictionary; skipping it",
      });
      continue;
    }
    const nameObj = dictGet(ocg, "Name");
    const name =
      nameObj?.kind === "string"
        ? decodePdfString(nameObj.bytes)
        : mintLayerName(nameByGroup);
    nameByGroup.set(ocg, name);
    groups.push({ dict: ocg, name });
  }

  // The default configuration (ISO 32000-1 8.11.4.3): BaseState (ON unless the dict states OFF) adjusted by the /ON and /OFF lists. /Order and /RBGroups are display grouping and radio behaviour, not visibility, and stay unread here.
  const defaultConfig = resolver.resolveDict(dictGet(ocProperties, "D"));
  const baseVisible =
    defaultConfig === undefined ||
    asName(dictGet(defaultConfig, "BaseState")) !== "OFF";
  const groupsIn = (key: string): Set<PdfDict> => {
    const set = new Set<PdfDict>();
    const arr =
      defaultConfig === undefined
        ? undefined
        : asArray(resolver.resolve(dictGet(defaultConfig, key)));
    if (arr !== undefined) {
      for (const entry of arr) {
        const dict = resolver.resolveDict(entry);
        if (dict !== undefined) {
          set.add(dict);
        }
      }
    }
    return set;
  };
  const on = groupsIn("ON");
  const off = groupsIn("OFF");
  const layers: LayoutLayer[] = groups.map(({ dict, name }) => ({
    name,
    visible: off.has(dict) ? false : on.has(dict) ? true : baseVisible,
  }));

  return {
    layers,
    layerNameOf: (obj: PdfObject | undefined): string | undefined => {
      const dict = resolver.resolveDict(obj);
      return dict !== undefined ? nameByGroup.get(dict) : undefined;
    },
  };
}

function mintLayerName(taken: Map<PdfDict, string>): string {
  const used = new Set(taken.values());
  let n = 1;
  while (used.has(`layer${n}`)) {
    n++;
  }
  return `layer${n}`;
}
