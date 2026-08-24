import type { MathVariant } from "../mathml/variant";
import { isMathVariant } from "../mathml/variant";

// The pieces both OMML translation directions genuinely share: the diagnostic shape each reports through, the mathvariant <-> run-property table each reads in one direction, and mi's own intrinsic-variant default. Kept here rather than in write.ts (with read.ts importing "down" from the writer) because neither direction owns them -- they describe the correspondence itself, which is what both sides consult.

// 'unsupported-element': a construct with no counterpart at all in the target vocabulary -- degraded to a literal-text token carrying that element's own text content, exactly as src/mathml/layout.ts's own `unsupported` fallback degrades one for the PDF path, so the formula still arrives (partially) rather than vanishing or failing the whole document. 'approximated-element': a construct that DOES map onto a real target element, but whose own attributes the target cannot carry (writing: mspace's explicit width, which OMML has no width-parameterised spacer for; reading: an OMML m:scr/m:sty combination MathML's own fourteen-value mathvariant enumeration cannot name, and a generic OMML container reduced to an mrow of its own argument slots).
export type OmmlDiagnosticKind = "unsupported-element" | "approximated-element";

export interface OmmlDiagnostic {
  readonly kind: OmmlDiagnosticKind;
  readonly detail: string; // the element's own local tag name, namespace prefix stripped -- a MathML name when writing, an OMML name when reading
}

// MathML's fourteen mathvariant values map exactly onto OMML's own two-axis (m:scr script x m:sty style) run properties, with no residue: m:scr names the alphabet (roman/script/fraktur/double-struck/sans-serif/monospace) and m:sty names the weight/slope (p=plain, b=bold, i=italic, bi=bold-italic). A 'roman' m:scr is OMML's own default and is left unwritten. Deliberately NOT applied by rewriting the characters themselves into the Unicode Mathematical Alphanumeric Symbols block the way src/mathml/variant.ts's applyMathVariant does for glyph rendering: OMML carries the style as markup, so writing both would double-apply it in Word.
export const VARIANT_RUN_PROPERTIES: Record<
  MathVariant,
  { readonly scr?: string; readonly sty: string }
> = {
  normal: { sty: "p" },
  bold: { sty: "b" },
  italic: { sty: "i" },
  "bold-italic": { sty: "bi" },
  "double-struck": { scr: "double-struck", sty: "p" },
  script: { scr: "script", sty: "p" },
  "bold-script": { scr: "script", sty: "b" },
  fraktur: { scr: "fraktur", sty: "p" },
  "bold-fraktur": { scr: "fraktur", sty: "b" },
  "sans-serif": { scr: "sans-serif", sty: "p" },
  "bold-sans-serif": { scr: "sans-serif", sty: "b" },
  "sans-serif-italic": { scr: "sans-serif", sty: "i" },
  "sans-serif-bold-italic": { scr: "sans-serif", sty: "bi" },
  monospace: { scr: "monospace", sty: "p" },
};

// OMML's own defaults for an m:rPr that omits either axis: ST_Script defaults to "roman" and ST_Style to "i" (ECMA-376 Part 1 s22.1.3.28/s22.1.3.32), so an unadorned m:r is an italic roman math run -- which is exactly MathML's own intrinsic default for a single-character mi, the overwhelmingly common case.
const DEFAULT_SCRIPT = "roman";
const DEFAULT_STYLE = "i";

// Object.entries widens the key back to string, so each one is narrowed through the real MathVariant guard rather than asserted -- the table is keyed by exactly those fourteen values, so the guard never actually rejects one.
function buildVariantLookup(): ReadonlyMap<string, MathVariant> {
  const lookup = new Map<string, MathVariant>();
  for (const [variant, mapped] of Object.entries(VARIANT_RUN_PROPERTIES)) {
    if (isMathVariant(variant)) {
      lookup.set(`${mapped.scr ?? DEFAULT_SCRIPT}|${mapped.sty}`, variant);
    }
  }
  return lookup;
}

const VARIANT_BY_RUN_PROPERTIES = buildVariantLookup();

// The reverse of VARIANT_RUN_PROPERTIES, derived from that one table rather than transcribed alongside it. Returns undefined for a combination MathML's own enumeration cannot name at all (an italic double-struck run, say -- OMML's two axes are genuinely independent, MathML's fourteen named values are not their full cross product); the caller then reports an 'approximated-element' diagnostic and falls back to the token's own intrinsic default rather than inventing a mathvariant value.
export function variantFromRunProperties(
  script: string | undefined,
  style: string | undefined,
): MathVariant | undefined {
  return VARIANT_BY_RUN_PROPERTIES.get(
    `${script ?? DEFAULT_SCRIPT}|${style ?? DEFAULT_STYLE}`,
  );
}

// mi's own intrinsic default (MathML3 3.2.3): italic for a single-character identifier, normal for anything longer. Both directions need it -- the writer to decide which m:sty an unadorned mi implies, the reader to decide whether a recovered variant is worth writing back as an explicit mathvariant attribute at all.
export function miIntrinsicDefault(content: string): MathVariant {
  return [...content].length === 1 ? "italic" : "normal";
}
