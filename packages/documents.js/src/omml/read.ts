import type { MathMlElement, MathMlNode } from "document-schema.js";
import type { XmlElement, XmlNode } from "ooxml.js";
import { decodeEntities } from "ooxml.js";
import { localName } from "../mathml/nodes";
import type { MathVariant } from "../mathml/variant";
import type { OmmlDiagnostic, OmmlDiagnosticKind } from "./shared";
import { miIntrinsicDefault, variantFromRunProperties } from "./shared";

// OMML (Office Math Markup Language, ECMA-376 Part 1 s22.1's own `m:` vocabulary) -> MathML presentation markup: the structural inverse of write.ts. Every construct write.ts emits comes back through here as the MathML element it was translated from, so a formula that crossed odt -> docx as real OOXML math crosses docx -> odt back as real MathML rather than vanishing into an empty paragraph.
//
// This reads more constructs than write.ts writes, deliberately and by necessity: write.ts only ever has to express what MathML can say, but this side has to cope with whatever Word itself authored. m:d (delimiters -- Word's representation of every parenthesised sub-expression), m:nary (a sum/product/integral with limits), m:acc (an accent), m:bar (an over/underbar), m:func (a named function applied to an argument), and m:sPre (prescripts) have no writer counterpart at all here and are never produced by this package, but each has one exact, unambiguous MathML inverse and each appears in essentially every real Word equation, so reading them is what makes "readDocxContent recovers a Word-authored equation" true rather than nearly true.
//
// Everything else degrades rather than failing: an OMML element with argument slots of its own (m:box, m:borderBox, m:phant, m:groupChr, m:eqArr -- containers whose decoration MathML has no direct equivalent for) becomes an mrow of those slots' own content with an 'approximated-element' diagnostic, so its content survives with its structure; an element with no slots at all becomes an mtext of its own text content with an 'unsupported-element' diagnostic. Neither ever fails the surrounding document, matching write.ts's own per-construct degradation policy exactly.
//
// One asymmetry is inherent to OMML rather than to this implementation: a run marked m:nor ("normal text") comes back as mtext, but an mtext carrying an explicit mathvariant was written as an ordinary styled math run (see write.ts's own tokenRun), and OMML records nothing distinguishing that from a genuinely styled mi -- so it reads back as mi/mn/mo. OMML also has no mi/mn/mo distinction of its own at all: every token is an m:r, and tokenTag below recovers the kind from the run's own content, which is what MathML itself means by those three elements.

// Output is document-schema.js's own MathMlNode, the exact type ContentFormula.mathml holds -- structurally identical to src/mathml/nodes.ts's own read-only mirror, so a tree built here feeds layoutFormula and write.ts with no cast anywhere.
export interface OmmlReadResult {
  readonly mathml: MathMlNode[];
  readonly diagnostics: readonly OmmlDiagnostic[];
}

interface ReadContext {
  readonly diagnostics: OmmlDiagnostic[];
}

// The OMML argument slots every construct holds its operands in (CT_OMathArg and its siblings). Used both by the named constructs below and by the generic degradation path, which flattens whichever of these an unrecognised element happens to carry.
const ARGUMENT_SLOTS: ReadonlySet<string> = new Set([
  "e",
  "num",
  "den",
  "sub",
  "sup",
  "lim",
  "deg",
  "fName",
]);

// OOXML's universal "this element is a properties bag, not content" suffix: m:fPr, m:radPr, m:naryPr, m:oMathParaPr, m:ctrlPr, and every other. Each named construct below reads its own properties by explicit lookup, so a properties element reached while walking a content sequence is genuinely nothing to translate -- skipped silently rather than reported, exactly as write.ts skips a whitespace text node between MathML siblings.
function isPropertiesElement(name: string): boolean {
  return name.endsWith("Pr");
}

// Word writes every OMML tag under the "m:" prefix, but the prefix is a document-level binding rather than part of the name -- stripped before every comparison here for the same reason src/mathml/nodes.ts strips MathML's own "math:" prefix: a producer that binds a different prefix produces the same document.
function elementLocalName(element: XmlElement): string {
  return localName(element.tag);
}

function elementChildren(element: XmlElement): XmlElement[] {
  return element.children.filter(
    (child): child is XmlElement => child.type === "element",
  );
}

function childByLocalName(
  element: XmlElement | undefined,
  name: string,
): XmlElement | undefined {
  return element === undefined
    ? undefined
    : elementChildren(element).find(
        (child) => elementLocalName(child) === name,
      );
}

function childrenByLocalName(element: XmlElement, name: string): XmlElement[] {
  return elementChildren(element).filter(
    (child) => elementLocalName(child) === name,
  );
}

// ooxml.js stores every attribute value raw (processEntities:false -- see src/xml/entities.ts), so a value used as real text has to be decoded here, exactly as write.ts encodes on the way out.
function attrByLocalName(
  element: XmlElement | undefined,
  name: string,
): string | undefined {
  const raw = element?.attributes.find(
    (attribute) => localName(attribute.name) === name,
  )?.value;
  return raw === undefined ? undefined : decodeEntities(raw);
}

// The m:val of a child property element, e.g. m:fPr/m:type's own "noBar".
function propertyValue(
  properties: XmlElement | undefined,
  name: string,
): string | undefined {
  return attrByLocalName(childByLocalName(properties, name), "val");
}

// OOXML's ST_OnOff semantics: the property element being PRESENT with no m:val at all means true, and an explicit value is read as the boolean it names. Absent means false.
function isPropertyOn(
  properties: XmlElement | undefined,
  name: string,
): boolean {
  const element = childByLocalName(properties, name);
  if (element === undefined) {
    return false;
  }
  const value = attrByLocalName(element, "val");
  return (
    value === undefined || value === "1" || value === "true" || value === "on"
  );
}

function textOf(node: XmlNode): string {
  if (node.type === "text") {
    return decodeEntities(node.value);
  }
  if (node.type !== "element") {
    return "";
  }
  let out = "";
  for (const child of node.children) {
    out += textOf(child);
  }
  return out;
}

function mathElement(
  tag: string,
  attributes: Record<string, string>,
  children: MathMlNode[],
): MathMlElement {
  return {
    type: "element",
    tag,
    attributes: Object.entries(attributes).map(([name, value]) => ({
      name,
      value,
    })),
    children,
  };
}

function mathToken(
  tag: string,
  attributes: Record<string, string>,
  text: string,
): MathMlElement {
  return mathElement(tag, attributes, [{ type: "text", value: text }]);
}

function operator(character: string): MathMlElement {
  return mathToken("mo", {}, character);
}

function diagnose(
  ctx: ReadContext,
  kind: OmmlDiagnosticKind,
  element: XmlElement,
): void {
  ctx.diagnostics.push({ kind, detail: elementLocalName(element) });
}

// OMML has one token element (m:r) where MathML has three, so a run's own kind is recovered from what it actually contains -- which is the same thing MathML's own mi/mn/mo distinction encodes. A run of digits (with one optional decimal separator) is a number; a run of letters is an identifier; a run of nothing but symbols/punctuation is an operator; anything mixed falls back to an identifier, MathML's own catch-all token for a named quantity.
const NUMBER_RUN = /^\d+(?:[.,]\d+)?$/u;
const LETTER_RUN = /^\p{L}+$/u;
const SYMBOL_RUN = /^[^\p{L}\p{N}\s]+$/u;

function tokenTag(text: string): "mi" | "mn" | "mo" {
  if (NUMBER_RUN.test(text)) {
    return "mn";
  }
  if (LETTER_RUN.test(text)) {
    return "mi";
  }
  return SYMBOL_RUN.test(text) ? "mo" : "mi";
}

// m:r -> one token element. An m:rPr carrying m:nor marks OMML's own "normal text" run, whose exact MathML counterpart is mtext (see write.ts's own tokenRun for the same correspondence in the other direction). Otherwise the m:scr/m:sty pair resolves back to a mathvariant, which is written out as an explicit attribute only when it differs from the recovered token's own MathML intrinsic default -- writing mathvariant="italic" onto every single-character mi would be markup that changes nothing.
function convertRun(run: XmlElement, ctx: ReadContext): MathMlElement[] {
  const text = childrenByLocalName(run, "t")
    .map((t) => textOf(t))
    .join("");
  if (text.length === 0) {
    return [];
  }
  const properties = childByLocalName(run, "rPr");
  if (isPropertyOn(properties, "nor")) {
    return [mathToken("mtext", {}, text)];
  }
  const script = propertyValue(properties, "scr");
  const style = propertyValue(properties, "sty");
  const variant: MathVariant | undefined = variantFromRunProperties(
    script,
    style,
  );
  if (variant === undefined) {
    diagnose(ctx, "approximated-element", run);
  }
  const tag = tokenTag(text);
  const intrinsic = tag === "mi" ? miIntrinsicDefault(text) : "normal";
  const attributes: Record<string, string> =
    variant !== undefined && variant !== intrinsic
      ? { mathvariant: variant }
      : {};
  return [mathToken(tag, attributes, text)];
}

// One OMML argument slot's own content, as the single MathML element a fixed-arity MathML construct (mfrac, msub, mover, ...) requires in that position: the slot's own single child when it has exactly one, an mrow of everything otherwise. An mrow is also what an EMPTY slot becomes -- MathML's own way of writing "nothing here", matching write.ts's own tolerance of a malformed source tree missing a child.
function slotArgument(
  parent: XmlElement,
  slot: string,
  ctx: ReadContext,
): MathMlElement {
  const nodes = slotContent(parent, slot, ctx);
  const [only] = nodes;
  return nodes.length === 1 && only !== undefined
    ? only
    : mathElement("mrow", {}, nodes);
}

// The same slot's content as a flat sequence, for a MathML construct whose own content model is an implicit mrow (msqrt) or a row context (mtd, mrow).
function slotContent(
  parent: XmlElement,
  slot: string,
  ctx: ReadContext,
): MathMlElement[] {
  const element = childByLocalName(parent, slot);
  return element === undefined ? [] : convertNodes(element.children, ctx);
}

// m:f -> mfrac. m:fPr/m:type="noBar" is OMML's barless binomial-style stack, whose MathML counterpart is linethickness="0" -- the exact pair write.ts maps in the other direction. OMML's other three shapes (skw, lin) have no MathML equivalent that isn't a rendering hint, so they read back as an ordinary fraction.
function convertFraction(element: XmlElement, ctx: ReadContext): MathMlElement {
  const barless =
    propertyValue(childByLocalName(element, "fPr"), "type") === "noBar";
  return mathElement("mfrac", barless ? { linethickness: "0" } : {}, [
    slotArgument(element, "num", ctx),
    slotArgument(element, "den", ctx),
  ]);
}

// m:rad -> msqrt or mroot. CT_Rad always carries an m:deg slot; a square root is the one whose degree is hidden (m:radPr/m:degHide) or empty, which is exactly what write.ts emits for msqrt. mroot's MathML child order is (radicand, index), the reverse of OMML's own (degree, base) -- swapped back here, mirroring the same swap on the way out.
function convertRadical(element: XmlElement, ctx: ReadContext): MathMlElement {
  const degree = childByLocalName(element, "deg");
  const hidden =
    isPropertyOn(childByLocalName(element, "radPr"), "degHide") ||
    degree === undefined ||
    elementChildren(degree).length === 0;
  if (hidden) {
    return mathElement("msqrt", {}, slotContent(element, "e", ctx));
  }
  return mathElement("mroot", {}, [
    slotArgument(element, "e", ctx),
    slotArgument(element, "deg", ctx),
  ]);
}

// m:limUpp whose own base is nothing but an m:limLow is the composition write.ts emits for munderover (OMML has no single both-limits element), so it is recognised as one rather than read back as an mover wrapping a munder -- the two render identically but only the former is the construct the source actually had.
function nestedLimLow(element: XmlElement): XmlElement | undefined {
  const base = childByLocalName(element, "e");
  if (base === undefined) {
    return undefined;
  }
  const children = elementChildren(base);
  const [only] = children;
  return children.length === 1 &&
    only !== undefined &&
    elementLocalName(only) === "limLow"
    ? only
    : undefined;
}

// m:d -> an mrow of the delimiters and their content. OMML records a delimiter's own characters as properties rather than as content, so the fences are minted here as real mo tokens; an explicitly EMPTY m:begChr/m:endChr (m:val="") is Word's own way of writing an unpaired delimiter and produces no token at all, while an absent one takes CT_DPr's documented default. Multiple m:e slots are a multi-argument delimiter (a binomial coefficient, a case list), separated by m:sepChr.
function convertDelimiter(
  element: XmlElement,
  ctx: ReadContext,
): MathMlElement {
  const properties = childByLocalName(element, "dPr");
  const beginChar = propertyValue(properties, "begChr") ?? "(";
  const endChar = propertyValue(properties, "endChr") ?? ")";
  const separatorChar = propertyValue(properties, "sepChr") ?? "|";
  const children: MathMlNode[] = [];
  if (beginChar.length > 0) {
    children.push(operator(beginChar));
  }
  childrenByLocalName(element, "e").forEach((slot, index) => {
    if (index > 0 && separatorChar.length > 0) {
      children.push(operator(separatorChar));
    }
    children.push(...convertNodes(slot.children, ctx));
  });
  if (endChar.length > 0) {
    children.push(operator(endChar));
  }
  return mathElement("mrow", {}, children);
}

// m:nary -> the n-ary operator carrying its own limits, followed by the operand it applies to. m:limLoc decides whether those limits sit under/over the operator or beside it as scripts (CT_NaryPr's own default is subSup), and m:subHide/m:supHide mark a limit Word is not showing at all. This is the construct write.ts deliberately declines to PRODUCE (see its convertUnderOver: MathML records no operand inside munderover, so choosing one would be guessing at operand scope) -- reading one loses nothing, because OMML states the operand explicitly in its own m:e slot.
function convertNary(element: XmlElement, ctx: ReadContext): MathMlElement {
  const properties = childByLocalName(element, "naryPr");
  const character = propertyValue(properties, "chr") ?? "∫";
  const underOver = propertyValue(properties, "limLoc") === "undOvr";
  const hasLower = !isPropertyOn(properties, "subHide");
  const hasUpper = !isPropertyOn(properties, "supHide");
  const base = operator(character);

  let scripted: MathMlElement = base;
  if (hasLower && hasUpper) {
    scripted = mathElement(underOver ? "munderover" : "msubsup", {}, [
      base,
      slotArgument(element, "sub", ctx),
      slotArgument(element, "sup", ctx),
    ]);
  } else if (hasLower) {
    scripted = mathElement(underOver ? "munder" : "msub", {}, [
      base,
      slotArgument(element, "sub", ctx),
    ]);
  } else if (hasUpper) {
    scripted = mathElement(underOver ? "mover" : "msup", {}, [
      base,
      slotArgument(element, "sup", ctx),
    ]);
  }
  return mathElement("mrow", {}, [scripted, ...slotContent(element, "e", ctx)]);
}

// m:acc -> mover with accent="true", MathML's own "this script is a diacritic over its base" marking. CT_AccPr's documented default character is U+0302 COMBINING CIRCUMFLEX ACCENT.
function convertAccent(element: XmlElement, ctx: ReadContext): MathMlElement {
  const character =
    propertyValue(childByLocalName(element, "accPr"), "chr") ?? "̂";
  return mathElement("mover", { accent: "true" }, [
    slotArgument(element, "e", ctx),
    operator(character),
  ]);
}

// m:bar -> mover/munder carrying a rule character. OMML expresses the bar as a position property (m:barPr/m:pos, defaulting to "bot") with no character of its own, so the character is minted here: U+203E OVERLINE above, U+005F LOW LINE below.
function convertBar(element: XmlElement, ctx: ReadContext): MathMlElement {
  const top =
    propertyValue(childByLocalName(element, "barPr"), "pos") === "top";
  return mathElement(top ? "mover" : "munder", { accent: "true" }, [
    slotArgument(element, "e", ctx),
    operator(top ? "‾" : "_"),
  ]);
}

// m:m -> mtable. Column alignment travels in m:mPr/m:mcs as one m:mc per column group, each with its own m:count and m:mcJc -- expanded back into MathML's own per-column columnalign list. An all-centre list is mtable's own default and is left unwritten rather than restated.
function convertMatrix(element: XmlElement, ctx: ReadContext): MathMlElement {
  const columns = childByLocalName(childByLocalName(element, "mPr"), "mcs");
  const alignments: string[] = [];
  for (const column of columns === undefined
    ? []
    : childrenByLocalName(columns, "mc")) {
    const properties = childByLocalName(column, "mcPr");
    const justification = propertyValue(properties, "mcJc") ?? "center";
    const count = Number.parseInt(
      propertyValue(properties, "count") ?? "1",
      10,
    );
    for (
      let index = 0;
      index < (Number.isFinite(count) && count > 0 ? count : 1);
      index++
    ) {
      alignments.push(justification);
    }
  }
  const rows = childrenByLocalName(element, "mr").map((row) =>
    mathElement(
      "mtr",
      {},
      childrenByLocalName(row, "e").map((cell) =>
        mathElement("mtd", {}, convertNodes(cell.children, ctx)),
      ),
    ),
  );
  const attributes: Record<string, string> = alignments.some(
    (alignment) => alignment !== "center",
  )
    ? { columnalign: alignments.join(" ") }
    : {};
  return mathElement("mtable", attributes, rows);
}

// An OMML container this module has no named inverse for, but which does hold its content in the ordinary argument slots (m:box, m:borderBox, m:phant, m:groupChr, m:eqArr, ...): its content survives as an mrow, in document order, with a diagnostic naming what was flattened. Only the container's own decoration -- a border, a grouping character, a phantom's invisibility -- is lost, never the mathematics inside it.
function convertUnknownContainer(
  element: XmlElement,
  ctx: ReadContext,
): MathMlElement[] {
  const slots = elementChildren(element).filter((child) =>
    ARGUMENT_SLOTS.has(elementLocalName(child)),
  );
  if (slots.length > 0) {
    diagnose(ctx, "approximated-element", element);
    return [
      mathElement(
        "mrow",
        {},
        slots.flatMap((slot) => convertNodes(slot.children, ctx)),
      ),
    ];
  }
  diagnose(ctx, "unsupported-element", element);
  const text = textOf(element);
  return text.length === 0 ? [] : [mathToken("mtext", {}, text)];
}

function convertElement(
  element: XmlElement,
  ctx: ReadContext,
): MathMlElement[] {
  const name = elementLocalName(element);

  if (isPropertiesElement(name)) {
    return [];
  }

  switch (name) {
    case "oMathPara":
    case "oMath":
      return convertNodes(element.children, ctx);
    case "r":
      return convertRun(element, ctx);
    case "f":
      return [convertFraction(element, ctx)];
    case "rad":
      return [convertRadical(element, ctx)];
    case "sSub":
      return [
        mathElement("msub", {}, [
          slotArgument(element, "e", ctx),
          slotArgument(element, "sub", ctx),
        ]),
      ];
    case "sSup":
      return [
        mathElement("msup", {}, [
          slotArgument(element, "e", ctx),
          slotArgument(element, "sup", ctx),
        ]),
      ];
    case "sSubSup":
      return [
        mathElement("msubsup", {}, [
          slotArgument(element, "e", ctx),
          slotArgument(element, "sub", ctx),
          slotArgument(element, "sup", ctx),
        ]),
      ];
    case "sPre":
      // Prescripts: MathML expresses them as an mmultiscripts whose postscript list is empty and whose mprescripts marker is followed by the sub/sup pair. Exact, and the one construct this module reads back that write.ts would degrade on the way out again (mmultiscripts has no OMML counterpart write.ts can express without guessing) -- an honest asymmetry, not a silent one.
      return [
        mathElement("mmultiscripts", {}, [
          slotArgument(element, "e", ctx),
          mathElement("mprescripts", {}, []),
          slotArgument(element, "sub", ctx),
          slotArgument(element, "sup", ctx),
        ]),
      ];
    case "limLow":
      return [
        mathElement("munder", {}, [
          slotArgument(element, "e", ctx),
          slotArgument(element, "lim", ctx),
        ]),
      ];
    case "limUpp": {
      const inner = nestedLimLow(element);
      if (inner !== undefined) {
        return [
          mathElement("munderover", {}, [
            slotArgument(inner, "e", ctx),
            slotArgument(inner, "lim", ctx),
            slotArgument(element, "lim", ctx),
          ]),
        ];
      }
      return [
        mathElement("mover", {}, [
          slotArgument(element, "e", ctx),
          slotArgument(element, "lim", ctx),
        ]),
      ];
    }
    case "m":
      return [convertMatrix(element, ctx)];
    case "d":
      return [convertDelimiter(element, ctx)];
    case "nary":
      return [convertNary(element, ctx)];
    case "acc":
      return [convertAccent(element, ctx)];
    case "bar":
      return [convertBar(element, ctx)];
    case "func":
      return [
        mathElement("mrow", {}, [
          ...slotContent(element, "fName", ctx),
          ...slotContent(element, "e", ctx),
        ]),
      ];
    case "e":
    case "num":
    case "den":
    case "sub":
    case "sup":
    case "lim":
    case "deg":
    case "fName":
    case "mr":
      // Reached only when a caller hands a slot (or a matrix row) over directly rather than through the construct that owns it -- a malformed tree. Treated as an implicit row of its own children, the same fallback write.ts applies to a bare mtr/mtd.
      return convertNodes(element.children, ctx);
    default:
      return convertUnknownContainer(element, ctx);
  }
}

// A non-element node inside an OMML content sequence (whitespace between siblings) contributes nothing and is not a diagnostic-worthy event, matching write.ts's own convertNodes.
function convertNodes(
  nodes: readonly XmlNode[],
  ctx: ReadContext,
): MathMlElement[] {
  const out: MathMlElement[] = [];
  for (const node of nodes) {
    if (node.type !== "element") {
      continue;
    }
    out.push(...convertElement(node, ctx));
  }
  return out;
}

// One m:oMath (or m:oMathPara) element -> the MathML node sequence a ContentFormula.mathml holds: exactly the children of a <math> root, matching what odf.js's own readOdfFormulaMathMl produces for an ODF formula and what write.ts consumes on the way back out.
export function readOfficeMath(element: XmlElement): OmmlReadResult {
  const diagnostics: OmmlDiagnostic[] = [];
  const mathml = convertNodes([element], { diagnostics });
  return { mathml, diagnostics };
}

// Every m:oMath element anywhere beneath `nodes`, in document order -- a deep walk, since WordprocessingML permits an equation directly in a w:p, wrapped in an m:oMathPara display container, or nested inside a w:hyperlink/w:ins/w:sdt run container. A found m:oMath is not descended into: OMML has no nested-equation construct, so anything inside it is that equation's own content.
export function collectOfficeMathElements(
  nodes: readonly XmlNode[],
): readonly XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (candidates: readonly XmlNode[]): void => {
    for (const node of candidates) {
      if (node.type !== "element") {
        continue;
      }
      if (localName(node.tag) === "oMath") {
        out.push(node);
        continue;
      }
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}
