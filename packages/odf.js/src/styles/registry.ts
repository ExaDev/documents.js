import type { Package } from "../model/package";
import type { XmlElement, XmlNode } from "../model/node";
import { el } from "../xml/fragment";
import { buildXml } from "../xml/build";
import { encodeXmlText } from "../xml/entities";
import {
  parseStyleElementProperties,
  type StyleProperties,
} from "./properties";
import {
  buildStylePropertyElements,
  canonicalPropertiesString,
} from "./serialize";

// The style-name family space every automatic style this registry manages belongs to. ODF style:name uniqueness is per-family across the whole document (two styles of DIFFERENT families may legally share a name), not per-container -- see forPart's collision-checking below, which is scoped to exactly this per-family rule.
export const STYLE_FAMILIES = [
  "paragraph",
  "text",
  "table",
  "table-column",
  "table-row",
  "table-cell",
  "graphic",
] as const;
export type StyleFamily = (typeof STYLE_FAMILIES)[number];

// Exported so cascade.ts (this directory's sibling default-style/parent-chain resolver) can reuse this exact guard rather than redeclaring STYLE_FAMILIES' membership check a second time.
export function isStyleFamily(value: string): value is StyleFamily {
  return (
    value === "paragraph" ||
    value === "text" ||
    value === "table" ||
    value === "table-column" ||
    value === "table-row" ||
    value === "table-cell" ||
    value === "graphic"
  );
}

// What intern()/fingerprint() need to identify a style: its formatting (properties.ts's property bag), which family it belongs to, and an optional style:parent-style-name reference.
export interface InternRequest {
  properties: StyleProperties;
  family: StyleFamily;
  parentStyleName?: string;
  // Property elements properties.ts's StyleProperties vocabulary has no field for, supplied already built by the caller: a style:table-column-properties/@style:column-width, a style:table-row-properties/@style:row-height, a style:table-cell-properties fill/border bag, a style:graphic-properties wrap/anchor bag. They are appended after buildStylePropertyElements' own paragraph/text output and folded into the fingerprint through their canonical XML serialization, so two requests carrying element-identical bags still intern to one style rather than minting a duplicate per call. This is the one seam that lets a writer mint the table-family and graphic-family automatic styles ODF requires without a second, parallel name-minting authority beside this registry -- properties.ts deliberately models only paragraph/run-level formatting (see its own top-of-file note), and widening it to the table families would change what the READER treats as unmodelled, which is load-bearing for rule (b)'s adoption behaviour and for the residue channel.
  propertyElements?: readonly XmlElement[];
}

export interface OtherPartRef {
  pkg: Package;
  partPath: string;
}

export interface StyleRegistryOptions {
  // The OTHER of content.xml/styles.xml, when both exist and a caller wants full cross-part collision checking (rule d): a StyleRegistry instance is constructed for exactly one part, so it has no way to see the other part's style names unless told about them explicitly.
  otherPart?: OtherPartRef;
  // Extra names to treat as taken regardless of family, e.g. a name the caller knows it's about to use for something else. Rare in practice; most callers only need `otherPart`.
  additionalReservedNames?: readonly string[];
}

// Content.xml mints bare short prefixes; styles.xml mints the same prefixes with a trailing "S". This is rule (e)'s structural half: a name content.xml mints (`${prefix}${n}`, e.g. "P1", "ta3") can never equal a name styles.xml mints (`${prefix}S${n}`, e.g. "PS1", "taS3") for ANY n, because "S" never appears at that position in the content.xml scheme -- so the two registries' minted names are guaranteed disjoint even before rule (d)'s explicit collision check runs. Prefixes p/T/ta/co/ro/ce/fr were verified against real LibreOffice 26.2 output (P/T from a Writer HTML->ODT conversion; ta/co/ro from a Calc CSV->ODS conversion; ce from a real .ots template shipped with LibreOffice itself; fr from a Writer image-frame HTML->ODT conversion) -- see properties.ts's top-of-file note for the verification method. table/table-column/table-row/table-cell intentionally follow Calc's short two-letter convention throughout (rather than mixing in Writer's own longer, address-based "Table1.A1" scheme, which requires spreadsheet-style cell-address bookkeeping this registry does not do) so the whole family-prefix set stays internally consistent.
const CONTENT_PREFIXES: Record<StyleFamily, string> = {
  paragraph: "P",
  text: "T",
  table: "ta",
  "table-column": "co",
  "table-row": "ro",
  "table-cell": "ce",
  graphic: "fr",
};

const STYLES_PREFIXES: Record<StyleFamily, string> = {
  paragraph: "PS",
  text: "TS",
  table: "taS",
  "table-column": "coS",
  "table-row": "roS",
  "table-cell": "ceS",
  graphic: "frS",
};

function prefixesForPart(partPath: string): Record<StyleFamily, string> {
  const baseName = partPath.slice(partPath.lastIndexOf("/") + 1);
  if (baseName === "content.xml") {
    return CONTENT_PREFIXES;
  }
  if (baseName === "styles.xml") {
    return STYLES_PREFIXES;
  }
  throw new Error(
    `StyleRegistry.forPart: expected a part named "content.xml" or "styles.xml" (by base name), got "${partPath}"`,
  );
}

function emptyFamilySets(): Record<StyleFamily, Set<string>> {
  return {
    paragraph: new Set(),
    text: new Set(),
    table: new Set(),
    "table-column": new Set(),
    "table-row": new Set(),
    "table-cell": new Set(),
    graphic: new Set(),
  };
}

function attrValue(element: XmlElement, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value;
}

function findDirectChild(
  nodes: readonly XmlNode[],
  tag: string,
): XmlElement | undefined {
  for (const node of nodes) {
    if (node.type === "element" && node.tag === tag) {
      return node;
    }
  }
  return undefined;
}

function findRootElement(nodes: readonly XmlNode[]): XmlElement {
  const root = nodes.find(
    (node): node is XmlElement => node.type === "element",
  );
  if (root === undefined) {
    throw new Error(
      "StyleRegistry: part has no root XML element -- construct the part's minimal root (office:document-content/office:document-styles) before building a StyleRegistry for it",
    );
  }
  return root;
}

// Finds this part's <office:automatic-styles>, creating and inserting one at the correct schema position if it doesn't exist yet: after whatever's already there (office:scripts, office:font-face-decls, office:styles), but before office:body/office:master-styles/office:settings if any of those are present. Mutates `root.children` directly -- this is a live view over the actual part, matching odf.js's model throughout (see manifest.ts and xml/fragment.ts).
function ensureAutomaticStyles(root: XmlElement): XmlElement {
  const existing = findDirectChild(root.children, "office:automatic-styles");
  if (existing !== undefined) {
    return existing;
  }
  const created = el("office:automatic-styles");
  const insertBeforeTags = new Set([
    "office:body",
    "office:master-styles",
    "office:settings",
  ]);
  const insertIndex = root.children.findIndex(
    (node) => node.type === "element" && insertBeforeTags.has(node.tag),
  );
  if (insertIndex === -1) {
    root.children.push(created);
  } else {
    root.children.splice(insertIndex, 0, created);
  }
  return created;
}

// Scans a container's DIRECT style:style children (office:styles or office:automatic-styles) and reserves every (family, name) pair found, regardless of whether this registry recognises the family. Used both for this part's own office:styles (named styles are reserved but never adopted for fingerprint reuse -- see forPart) and for the other part's containers (rule d's cross-part collision check).
function reserveStyleNames(
  container: XmlElement,
  reserved: Record<StyleFamily, Set<string>>,
): void {
  for (const child of container.children) {
    if (child.type !== "element" || child.tag !== "style:style") {
      continue;
    }
    const name = attrValue(child, "style:name");
    const family = attrValue(child, "style:family");
    if (name === undefined || family === undefined || !isStyleFamily(family)) {
      continue;
    }
    reserved[family].add(name);
  }
}

const FINGERPRINT_SEPARATOR = " "; // NUL -- forbidden outright in well-formed XML 1.0 content, so it can never appear inside canonicalPropertiesString's output or a real style:parent-style-name value. Safe, unambiguous separator between the fingerprint's three components.
const NO_PARENT_SENTINEL = ""; // Also XML-forbidden; distinguishes "no parentStyleName" from a (spec-impossible, but let's not rely on that) empty-string parentStyleName -- an explicit marker, not a silent `?? ''` fallback.

// Rule (c): style family, canonical properties, and parentStyleName are combined as three explicit, separately-delimited components -- never via JSON.stringify (which is sensitive to key order and undefined-vs-absent in ways that would make matching unreliable). Two styles with byte-identical properties but different parentStyleName values are genuinely different styles and must never fingerprint-match each other; including `family` here too (not required by the stated rule, but a straightforward extra safety net) means a coincidental property-string match between two different families -- e.g. a paragraph style and an unrelated table-cell style -- can never merge either.
function computeFingerprint(
  family: StyleFamily,
  properties: StyleProperties,
  parentStyleName: string | undefined,
  propertyElements: readonly XmlElement[] | undefined,
): string {
  // Not a masked-missing-value fallback (the case CLAUDE.md's "no empty fallback values" rule warns against) -- NO_PARENT_SENTINEL is a deliberate, documented, distinguishable marker for "no parent" within this concatenation scheme, and a real parentStyleName can never legitimately equal it (see NO_PARENT_SENTINEL's own comment). `??` here is semantically identical to an explicit `=== undefined` ternary, since parentStyleName's type has no `null` member, and matches this project's own `prefer-nullish-coalescing` lint rule.
  const parentComponent = parentStyleName ?? NO_PARENT_SENTINEL;
  const components = [
    family,
    canonicalPropertiesString(properties),
    parentComponent,
  ];
  // A fourth component only when there is genuinely something to state, so a request carrying no propertyElements at all fingerprints byte-identically to the way it always did -- an empty bag and an absent one describe the same style and must never mint two.
  if (propertyElements !== undefined && propertyElements.length > 0) {
    components.push(buildXml([...propertyElements]));
  }
  return components.join(FINGERPRINT_SEPARATOR);
}

// Interns ODF automatic styles for one part (content.xml or styles.xml) of a package, deduplicating by formatting so two edits that produce identical properties end up referencing the same named style instead of minting a duplicate for every call. See the five numbered rules in each method's own comment for the exact, non-negotiable behaviour this class implements.
//
// Known, documented limitation: names() and gc() are keyed by bare style:name string (matching their mandated flat signatures), not by (family, name). ODF's real per-family uniqueness means two DIFFERENT families could in principle share an identical adopted name string in a hand-crafted or third-party document; if that ever happens, this registry's internal `knownStyles`/`fingerprintToName` bookkeeping tracks only one of the two elements sharing that name (last one wins during adoption), and gc()/names() cannot disambiguate between them either. No known real-world ODF producer -- including this registry's own minting, which is always family-consistent per its prefix table above -- ever does this, so it is treated as an accepted, narrow scope boundary rather than a bug to engineer around.
export class StyleRegistry {
  private readonly automaticStyles: XmlElement;
  private readonly prefixes: Record<StyleFamily, string>;
  private readonly reservedByFamily: Record<StyleFamily, Set<string>>;
  private readonly knownStyles = new Map<string, XmlElement>();
  private readonly fingerprintToName = new Map<string, string>();
  private readonly nameToFingerprint = new Map<string, string>();
  private readonly familyCounters: Record<StyleFamily, number> = {
    paragraph: 1,
    text: 1,
    table: 1,
    "table-column": 1,
    "table-row": 1,
    "table-cell": 1,
    graphic: 1,
  };

  private constructor(
    automaticStyles: XmlElement,
    prefixes: Record<StyleFamily, string>,
    reservedByFamily: Record<StyleFamily, Set<string>>,
  ) {
    this.automaticStyles = automaticStyles;
    this.prefixes = prefixes;
    this.reservedByFamily = reservedByFamily;
  }

  // Rule (a) ADOPTION ON CONSTRUCTION + rule (b) UNKNOWN ATTRIBUTES OPT OUT OF REUSE + rule (d) CROSS-CONTAINER COLLISION CHECKING.
  //
  // Walks every existing style:style already present in this part's own <office:automatic-styles>, parses each one's properties, and registers (fingerprint -> name) for every style whose content this package fully understands (rule a) -- but for a style carrying any attribute (or child element, or risky style:style-level attribute) properties.ts doesn't model, its name is reserved (never re-minted) while its fingerprint is deliberately NOT registered, so a future intern() call that would otherwise match it mints a genuinely new style instead of silently reusing/overwriting one that might carry formatting this reader doesn't understand (rule b). Separately, before any name is ever minted, this part's own <office:styles> (named/common styles -- reserved, but never adopted for fingerprint reuse, since they are user-authored semantic styles, not automatic ones) and, if `options.otherPart` is given, the OTHER part's <office:styles> and <office:automatic-styles> are all scanned too, so name collisions are checked across all four possible containers, scoped per family exactly as ODF's own uniqueness rule requires (rule d).
  static forPart(
    pkg: Package,
    partPath: string,
    options: StyleRegistryOptions = {},
  ): StyleRegistry {
    const part = pkg.parts[partPath];
    if (part?.kind !== "xml") {
      throw new Error(
        `StyleRegistry.forPart: "${partPath}" is not an XML part of the given package`,
      );
    }
    const prefixes = prefixesForPart(partPath);
    const root = findRootElement(part.nodes);
    const automaticStyles = ensureAutomaticStyles(root);

    const reservedByFamily = emptyFamilySets();
    const registry = new StyleRegistry(
      automaticStyles,
      prefixes,
      reservedByFamily,
    );

    for (const child of automaticStyles.children) {
      if (child.type !== "element" || child.tag !== "style:style") {
        continue;
      }
      const name = attrValue(child, "style:name");
      const family = attrValue(child, "style:family");
      if (
        name === undefined ||
        family === undefined ||
        !isStyleFamily(family)
      ) {
        continue;
      }

      registry.knownStyles.set(name, child);
      reservedByFamily[family].add(name);

      const parsed = parseStyleElementProperties(child);
      if (!parsed.hasUnknown) {
        const parentStyleName = attrValue(child, "style:parent-style-name");
        // No propertyElements component: an adopted style reaching this branch carried nothing properties.ts could not model (hasUnknown is false above), so by construction it has no extra property elements to state.
        const fingerprint = computeFingerprint(
          family,
          parsed.properties,
          parentStyleName,
          undefined,
        );
        // First adopted style with a given fingerprint wins; a well-formed document should never have two automatic styles with identical (family, properties, parent) in the first place, but staying deterministic here rather than silently overwriting is the safer choice if one ever does.
        if (!registry.fingerprintToName.has(fingerprint)) {
          registry.fingerprintToName.set(fingerprint, name);
          registry.nameToFingerprint.set(name, fingerprint);
        }
      }
    }

    const ownStyles = findDirectChild(root.children, "office:styles");
    if (ownStyles !== undefined) {
      reserveStyleNames(ownStyles, reservedByFamily);
    }

    if (options.otherPart !== undefined) {
      const otherPart = options.otherPart.pkg.parts[options.otherPart.partPath];
      if (otherPart?.kind === "xml") {
        const otherRoot = findRootElement(otherPart.nodes);
        const otherAutomatic = findDirectChild(
          otherRoot.children,
          "office:automatic-styles",
        );
        if (otherAutomatic !== undefined) {
          reserveStyleNames(otherAutomatic, reservedByFamily);
        }
        const otherStyles = findDirectChild(
          otherRoot.children,
          "office:styles",
        );
        if (otherStyles !== undefined) {
          reserveStyleNames(otherStyles, reservedByFamily);
        }
      }
    }

    if (options.additionalReservedNames !== undefined) {
      for (const family of STYLE_FAMILIES) {
        for (const name of options.additionalReservedNames) {
          reservedByFamily[family].add(name);
        }
      }
    }

    return registry;
  }

  // Rule (c) FINGERPRINT INCLUDES parentStyleName, KEPT SEPARATE FROM PROPERTIES. Pure query: computes what fingerprint() a given request would produce, without minting or reusing anything. See computeFingerprint above for the exact three-component construction.
  fingerprint(request: InternRequest): string {
    return computeFingerprint(
      request.family,
      request.properties,
      request.parentStyleName,
      request.propertyElements,
    );
  }

  // Returns the style:name to reference for this request's formatting: an existing name if a style with an identical fingerprint is already known (adopted or minted earlier this session), or a freshly minted one otherwise. Minting appends a real <style:style> child to this part's <office:automatic-styles> -- intern() is not a pure computation, it mutates the actual document, matching odf.js's live-view model throughout.
  intern(request: InternRequest): string {
    const fingerprint = this.fingerprint(request);
    const existingName = this.fingerprintToName.get(fingerprint);
    if (existingName !== undefined) {
      return existingName;
    }

    const name = this.mintName(request.family);
    const attributes: Record<string, string> = {
      "style:name": name,
      "style:family": request.family,
    };
    if (request.parentStyleName !== undefined) {
      attributes["style:parent-style-name"] = encodeXmlText(
        request.parentStyleName,
      );
    }
    const styleElement = el("style:style", attributes, [
      ...buildStylePropertyElements(request.properties),
      ...(request.propertyElements ?? []),
    ]);
    this.automaticStyles.children.push(styleElement);

    this.knownStyles.set(name, styleElement);
    // No `reservedByFamily[family].add(name)` here for a freshly minted name: mintName's own counter for this family always advances past whatever it just minted (see mintName below), so no later mintName call for this same registry instance can ever re-derive this exact counter value and need to check it against `reserved` again -- and adoption (the only other place a name can become "taken") only ever runs once, before construction finishes, never interleaved with intern() calls. A name minted here therefore never needs its own registration in `reserved` to stay unique.
    this.fingerprintToName.set(fingerprint, name);
    this.nameToFingerprint.set(name, fingerprint);
    return name;
  }

  // Rule (d) NAME MINTING IS COLLISION-CHECKED ACROSS ALL FOUR CONTAINERS + rule (e) DISTINCT PREFIXES PER PART.
  //
  // `this.reservedByFamily[family]` is the single source of truth for "is this name already taken, for THIS family": it is built once in forPart from this part's own adopted <office:automatic-styles> (every family, not just the ones with fully-modelled properties -- see rule (a)/(b)), this part's own <office:styles>, and (via `options.otherPart`) the other part's <office:automatic-styles> and <office:styles> -- all four containers -- plus every name minted by this registry since. Checking only the family-scoped set here (rather than also checking `this.knownStyles`, which spans every family this registry has ever seen a name for) is deliberate: ODF's own uniqueness rule is per-family, so a name already used by, say, a "table" style must remain available to the "paragraph" family.
  private mintName(family: StyleFamily): string {
    const prefix = this.prefixes[family];
    const reserved = this.reservedByFamily[family];
    let counter = this.familyCounters[family];
    while (reserved.has(`${prefix}${counter}`)) {
      counter += 1;
    }
    const name = `${prefix}${counter}`;
    this.familyCounters[family] = counter + 1;
    return name;
  }

  // Every style:name this registry currently knows about (adopted at construction, or minted since) -- style names removed by a prior gc() call are no longer included.
  names(): readonly string[] {
    return [...this.knownStyles.keys()];
  }

  // Explicit opt-in cleanup only -- never called automatically by intern()/forPart(). Removes every known style whose name is absent from `referenced`, deleting its <style:style> element from the actual <office:automatic-styles> and forgetting it from this registry's own bookkeeping (though its name stays reserved forever within this registry's lifetime -- see the class-level comment on why gc'd names are never reissued). Returns the number of styles removed.
  gc(referenced: ReadonlySet<string>): number {
    let removed = 0;
    for (const [name, element] of [...this.knownStyles]) {
      if (referenced.has(name)) {
        continue;
      }
      // No `index !== -1` guard: `element` is the exact reference this same class itself put into `automaticStyles.children` -- either during forPart's own adoption scan of that very array, or via intern()'s own `.push(styleElement)` just before storing that same reference in knownStyles -- and nothing in this class ever replaces `.children` wholesale or removes a name from knownStyles without also splicing its element out in this same step, so a name still in knownStyles always has its element still present in the array, findable by indexOf.
      this.automaticStyles.children.splice(
        this.automaticStyles.children.indexOf(element),
        1,
      );
      this.knownStyles.delete(name);
      const fingerprint = this.nameToFingerprint.get(name);
      if (fingerprint !== undefined) {
        this.fingerprintToName.delete(fingerprint);
      }
      // No `this.nameToFingerprint.delete(name)` here: nameToFingerprint is only ever read (above) for a name still present in knownStyles, and this same iteration just removed `name` from knownStyles for good (a gc'd name is reserved forever and never re-adopted or re-minted -- see this method's own class-level comment), so no future gc() call can ever read this entry again. Deleting it would only ever tidy a map slot nothing will look at again, exactly like reservedByFamily's own already-documented "kept forever" bookkeeping above.
      removed += 1;
    }
    return removed;
  }
}
