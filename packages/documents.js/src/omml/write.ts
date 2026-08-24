import type { XmlElement, XmlNode } from "ooxml.js";
import { parseMathLength } from "../mathml/length";
import type { MathMlElement, MathMlNode } from "../mathml/nodes";
import {
  attrValue,
  elementChildren,
  elementLocalName,
  isMathMlElement,
  textContent,
} from "../mathml/nodes";
import { operatorProperties } from "../mathml/operators";
import type { MathVariant } from "../mathml/variant";
import { isMathVariant } from "../mathml/variant";
import { encodeXmlText, needsSpacePreserve } from "../xml/entities";
import { el, txt } from "../xml/fragment";
import type { OmmlDiagnostic, OmmlDiagnosticKind } from "./shared";
import { miIntrinsicDefault, VARIANT_RUN_PROPERTIES } from "./shared";

// MathML presentation markup -> OMML (Office Math Markup Language, ECMA-376 Part 1 §22.1's own `m:` vocabulary), the write-side counterpart to src/mathml/layout.ts's own MathML -> MathBox typesetting engine. Both consume the identical MathMlNode tree and cover the identical construct set, deliberately: a formula rendered to PDF and the same formula written into a docx should degrade in the same places, never one silently better than the other.
//
// This is a STRUCTURAL translation, not a rendering one -- it emits no geometry, measures nothing, and loads no font. OMML is a semantic math vocabulary of its own (m:f for a fraction, m:rad for a radical, m:sSub/m:sSup for scripts, m:m for a matrix), so every construct below maps onto a real OMML element Word itself both writes and renders, rather than onto positioned glyphs. That is what makes a formula crossing the odt -> docx bridge arrive as genuinely editable Word math rather than the plain-text stand-in it used to become.
//
// Why this module lives outside src/mathml/: that directory is deliberately self-contained (no ooxml.js, no odf.js, no document-schema.js -- see its own module comments), and this translator's whole output type is ooxml.js's XmlElement. It consumes src/mathml/'s own node helpers, operator dictionary, and mathvariant type, and nothing else local.

// http://schemas.openxmlformats.org/officeDocument/2006/math -- OMML's own namespace, declared on the fragment's own root element rather than on the host document's w:document, so a fragment stays valid when appended to ANY docx, including one this package did not scaffold (openDocx over a third-party file whose root declares only xmlns:w). Redundant namespace declarations on a descendant are ordinary, valid XML; a missing one is not.
const OMML_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";

export interface OmmlWriteResult {
  // undefined when the source MathML produced no OMML content at all -- an empty formula, or one whose every node was a non-element (a whitespace text node between siblings). A caller then falls back to whatever whole-formula stand-in it already has (src/model/formula.ts's formulaPlaceholderText), rather than writing an empty equation.
  readonly element: XmlElement | undefined;
  readonly diagnostics: readonly OmmlDiagnostic[];
}

interface WriteContext {
  // undefined = "no ancestor mstyle set one" -- a token element then applies its own intrinsic default, matching src/mathml/layout.ts's own LayoutContext.inheritedVariant exactly.
  readonly inheritedVariant: MathVariant | undefined;
  readonly displayStyle: boolean;
  readonly diagnostics: OmmlDiagnostic[];
}

// MathML columnalign -> OMML's own m:mcJc (ST_XAlign). ST_XAlign also has 'inside'/'outside', which MathML's columnalign has no counterpart for; anything unrecognised falls back to 'center', mtable's own default.
function columnJustification(align: string | undefined): string {
  return align === "left" || align === "right" || align === "center"
    ? align
    : "center";
}

function diagnose(
  ctx: WriteContext,
  kind: OmmlDiagnosticKind,
  element: MathMlElement,
): void {
  ctx.diagnostics.push({ kind, detail: elementLocalName(element) });
}

// A math text run: <m:r>[<m:rPr>…</m:rPr>]<m:t>…</m:t></m:r>. `text` is a raw string (XML-encoded here, matching src/xml/fragment.ts's own "values must already be encoded" contract), and carries xml:space="preserve" whenever leading/trailing whitespace would otherwise be collapsed -- the same rule w:t already follows in src/edit/docx/run.ts.
function mathRun(text: string, properties: XmlElement | undefined): XmlElement {
  const tAttrs: Record<string, string> = needsSpacePreserve(text)
    ? { "xml:space": "preserve" }
    : {};
  const children: XmlNode[] = [];
  if (properties !== undefined) {
    children.push(properties);
  }
  children.push(el("m:t", tAttrs, [txt(encodeXmlText(text))]));
  return el("m:r", {}, children);
}

// CT_MRPr's own element sequence is lit, nor, scr, sty, brk, aln -- only scr/sty and nor are ever written here, so emitting scr before sty is all the ordering this needs.
function variantRunProperties(variant: MathVariant): XmlElement {
  const mapped = VARIANT_RUN_PROPERTIES[variant];
  const children: XmlElement[] = [];
  if (mapped.scr !== undefined) {
    children.push(el("m:scr", { "m:val": mapped.scr }));
  }
  children.push(el("m:sty", { "m:val": mapped.sty }));
  return el("m:rPr", {}, children);
}

function tokenVariant(
  element: MathMlElement,
  intrinsicDefault: MathVariant,
  ctx: WriteContext,
): MathVariant {
  const attr = attrValue(element, "mathvariant");
  if (attr !== undefined && isMathVariant(attr)) {
    return attr;
  }
  return ctx.inheritedVariant ?? intrinsicDefault;
}

// mtext is MathML's "ordinary text inside a formula" token, and OMML's own m:nor ("normal text") is its exact counterpart -- a run marked m:nor renders in the surrounding paragraph's text font rather than the math font, which is precisely what mtext means and what Word itself writes for literal text inside an equation. An mtext carrying an explicit mathvariant is treated as an ordinary styled math token instead, since m:nor and m:scr/m:sty describe mutually exclusive run kinds.
function tokenRun(
  element: MathMlElement,
  rawText: string,
  intrinsicDefault: MathVariant,
  ctx: WriteContext,
  normalText: boolean,
): XmlElement[] {
  if (rawText.length === 0) {
    return [];
  }
  if (normalText && attrValue(element, "mathvariant") === undefined) {
    return [mathRun(rawText, el("m:rPr", {}, [el("m:nor")]))];
  }
  return [
    mathRun(
      rawText,
      variantRunProperties(tokenVariant(element, intrinsicDefault, ctx)),
    ),
  ];
}

// One OMML argument slot (m:e, m:num, m:den, m:sub, m:sup, m:deg, m:lim), holding the EG_OMathElements sequence a single MathML child converts to. CT_OMathArg permits an empty slot, so a malformed source tree missing a child still produces schema-valid OMML (Word renders an empty placeholder box) rather than throwing.
function argSlot(
  tag: string,
  child: MathMlElement | undefined,
  ctx: WriteContext,
): XmlElement {
  return el(tag, {}, child === undefined ? [] : convertElement(child, ctx));
}

// msqrt's own content model is an IMPLICIT mrow of every child (MathML3 3.3.6), unlike mroot's fixed (radicand, index) pair -- so its slot takes the whole child list rather than one element.
function argSlotFromChildren(
  tag: string,
  children: readonly MathMlElement[],
  ctx: WriteContext,
): XmlElement {
  return el(
    tag,
    {},
    children.flatMap((child) => convertElement(child, ctx)),
  );
}

// mfrac -> m:f. A linethickness of 0 (MathML's own way of writing a barless binomial-style stack) becomes m:fPr/m:type="noBar", OMML's own equivalent; every other linethickness value is dropped, since OMML's m:type is an enumeration of four fraction SHAPES (bar/noBar/skw/lin), not a rule-width control.
function convertFraction(
  element: MathMlElement,
  ctx: WriteContext,
): XmlElement {
  const children = elementChildren(element);
  const lineThickness = attrValue(element, "linethickness");
  const barless =
    lineThickness !== undefined && parseMathLength(lineThickness, 1) === 0;
  const parts: XmlElement[] = [];
  if (barless) {
    parts.push(el("m:fPr", {}, [el("m:type", { "m:val": "noBar" })]));
  }
  parts.push(
    argSlot("m:num", children[0], ctx),
    argSlot("m:den", children[1], ctx),
  );
  return el("m:f", {}, parts);
}

// msqrt/mroot -> m:rad. CT_Rad's own sequence is radPr?, deg, e -- m:deg is present and EMPTY for a square root, with m:radPr/m:degHide marking it hidden, exactly as Word itself writes one. mroot's MathML child order is (radicand, index); OMML's is the reverse (degree first), so the two are swapped here rather than passed through.
function convertRadical(
  element: MathMlElement,
  kind: "msqrt" | "mroot",
  ctx: WriteContext,
): XmlElement {
  const children = elementChildren(element);
  if (kind === "msqrt") {
    return el("m:rad", {}, [
      el("m:radPr", {}, [el("m:degHide", { "m:val": "1" })]),
      el("m:deg"),
      argSlotFromChildren("m:e", children, ctx),
    ]);
  }
  return el("m:rad", {}, [
    argSlot("m:deg", children[1], ctx),
    argSlot("m:e", children[0], ctx),
  ]);
}

function convertScripts(
  element: MathMlElement,
  kind: "msub" | "msup" | "msubsup",
  ctx: WriteContext,
): XmlElement {
  const children = elementChildren(element);
  const base = argSlot("m:e", children[0], ctx);
  if (kind === "msub") {
    return el("m:sSub", {}, [base, argSlot("m:sub", children[1], ctx)]);
  }
  if (kind === "msup") {
    return el("m:sSup", {}, [base, argSlot("m:sup", children[1], ctx)]);
  }
  return el("m:sSubSup", {}, [
    base,
    argSlot("m:sub", children[1], ctx),
    argSlot("m:sup", children[2], ctx),
  ]);
}

function isMovableLimitsOperator(element: MathMlElement | undefined): boolean {
  return (
    element !== undefined &&
    elementLocalName(element) === "mo" &&
    operatorProperties(textContent(element).trim()).movablelimits
  );
}

// munder/mover/munderover -> m:limLow/m:limUpp, nested for the both-limits case: OMML has no single element carrying an under AND an over script, so munderover becomes an m:limUpp whose own base is an m:limLow -- a real, valid, Word-renderable composition, and exactly what Word itself produces when a limit is added to an already-limited base.
//
// Deliberately NOT m:nary, even for the ∑/∏/∫ case m:nary exists for: m:nary's own m:e slot is the OPERAND being summed/integrated, and MathML records no operand at all inside munderover -- it sits outside, as a following sibling of the mrow, with no grouping marking where it ends. Choosing one would be guessing at operand scope, which this package's conventions rule out; nesting limUpp/limLow guesses nothing and loses nothing but the auto-grown operator glyph.
//
// A movablelimits operator (∑, ∏, ⋃, ...) outside display style takes its limits as an ordinary sub/sup pair instead -- the same \nolimits-vs-\limits distinction src/mathml/layout.ts's own layoutUnderOverElement makes, resolved here identically so the docx and PDF paths agree.
function convertUnderOver(
  element: MathMlElement,
  kind: "munder" | "mover" | "munderover",
  ctx: WriteContext,
): XmlElement {
  const children = elementChildren(element);
  if (!ctx.displayStyle && isMovableLimitsOperator(children[0])) {
    const scriptKind =
      kind === "munder" ? "msub" : kind === "mover" ? "msup" : "msubsup";
    return convertScripts(element, scriptKind, ctx);
  }
  if (kind === "munder") {
    return el("m:limLow", {}, [
      argSlot("m:e", children[0], ctx),
      argSlot("m:lim", children[1], ctx),
    ]);
  }
  if (kind === "mover") {
    return el("m:limUpp", {}, [
      argSlot("m:e", children[0], ctx),
      argSlot("m:lim", children[1], ctx),
    ]);
  }
  const lower = el("m:limLow", {}, [
    argSlot("m:e", children[0], ctx),
    argSlot("m:lim", children[1], ctx),
  ]);
  return el("m:limUpp", {}, [
    el("m:e", {}, [lower]),
    argSlot("m:lim", children[2], ctx),
  ]);
}

// mtable/mtr/mtd -> m:m/m:mr/m:e. Column alignment travels through m:mPr/m:mcs, one m:mc per column with its own m:count="1" and m:mcJc, rather than one m:mc spanning a run of same-aligned columns: an exact per-column expression needs no run-length merging to be correct, and OMML permits up to 64 m:mc entries.
//
// CT_MR requires at least one m:e, so a row with no mtd cells at all is padded with a single empty one rather than written as an invalid empty row.
function convertTable(element: MathMlElement, ctx: WriteContext): XmlElement {
  const rows = elementChildren(element).filter(
    (child) => elementLocalName(child) === "mtr",
  );
  const columnAligns = (attrValue(element, "columnalign") ?? "")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  const rowCells = rows.map((row) =>
    elementChildren(row).filter((child) => elementLocalName(child) === "mtd"),
  );
  const columnCount = rowCells.reduce(
    (max, cells) => Math.max(max, cells.length),
    0,
  );

  const children: XmlElement[] = [];
  if (columnCount > 0) {
    const columns: XmlElement[] = [];
    for (let column = 0; column < columnCount; column++) {
      // MathML's own columnalign rule: a shorter list repeats its LAST entry across every remaining column.
      const align = columnJustification(
        columnAligns[column] ?? columnAligns[columnAligns.length - 1],
      );
      columns.push(
        el("m:mc", {}, [
          el("m:mcPr", {}, [
            el("m:count", { "m:val": "1" }),
            el("m:mcJc", { "m:val": align }),
          ]),
        ]),
      );
    }
    children.push(el("m:mPr", {}, [el("m:mcs", {}, columns)]));
  }

  for (const cells of rowCells) {
    const slots = cells.map((cell) =>
      argSlotFromChildren("m:e", elementChildren(cell), ctx),
    );
    children.push(el("m:mr", {}, slots.length === 0 ? [el("m:e")] : slots));
  }
  return el("m:m", {}, children);
}

// mspace has no OMML counterpart that preserves its width: OMML expresses a space only as literal space characters in an m:t run, with no width-parameterised spacer element anywhere in its vocabulary. A positive width becomes exactly one literal space (a real space, just not the requested one) with an 'approximated-element' diagnostic; a zero or absent width becomes nothing at all, which is exactly what it renders as. The width is parsed against a font size of 1 purely to test its sign -- every unit parseMathLength understands is a positive multiple of the size it is given, so positivity is size-independent.
function convertSpace(element: MathMlElement, ctx: WriteContext): XmlElement[] {
  const width = attrValue(element, "width");
  const widthValue =
    width === undefined ? undefined : parseMathLength(width, 1);
  if (widthValue === undefined || widthValue <= 0) {
    return [];
  }
  diagnose(ctx, "approximated-element", element);
  return [mathRun(" ", el("m:rPr", {}, [el("m:nor")]))];
}

// semantics wraps its real content plus one or more parallel-markup annotations -- only the first non-annotation child is translated, matching src/mathml/layout.ts's own layoutSemantics exactly. A formula's StarMath annotation is separately available to a caller as ContentFormula.starMath, so nothing is lost by skipping it here.
function convertSemantics(
  element: MathMlElement,
  ctx: WriteContext,
): XmlElement[] {
  const content = elementChildren(element).find((child) => {
    const name = elementLocalName(child);
    return name !== "annotation" && name !== "annotation-xml";
  });
  return content === undefined ? [] : convertElement(content, ctx);
}

function mstyleContext(
  element: MathMlElement,
  ctx: WriteContext,
): WriteContext {
  let next = ctx;
  const displayAttr = attrValue(element, "displaystyle");
  if (displayAttr === "true" || displayAttr === "false") {
    next = { ...next, displayStyle: displayAttr === "true" };
  }
  const variantAttr = attrValue(element, "mathvariant");
  if (variantAttr !== undefined && isMathVariant(variantAttr)) {
    next = { ...next, inheritedVariant: variantAttr };
  }
  return next;
}

// The single recursive dispatch, returning a SEQUENCE rather than one element: mrow (and mstyle, and semantics) has no OMML counterpart of its own because every OMML argument slot already holds an EG_OMathElements sequence, so a row simply flattens into whichever slot contains it.
function convertElement(node: MathMlElement, ctx: WriteContext): XmlElement[] {
  const name = elementLocalName(node);

  switch (name) {
    case "mrow":
      return convertNodes(node.children, ctx);
    case "mstyle":
      return convertNodes(node.children, mstyleContext(node, ctx));
    case "semantics":
      return convertSemantics(node, ctx);
    case "mi": {
      const text = textContent(node);
      return tokenRun(node, text, miIntrinsicDefault(text), ctx, false);
    }
    case "mn":
      return tokenRun(node, textContent(node), "normal", ctx, false);
    case "mo":
      return tokenRun(node, textContent(node).trim(), "normal", ctx, false);
    case "mtext":
      return tokenRun(node, textContent(node), "normal", ctx, true);
    case "mspace":
      return convertSpace(node, ctx);
    case "mfrac":
      return [convertFraction(node, ctx)];
    case "msqrt":
      return [convertRadical(node, "msqrt", ctx)];
    case "mroot":
      return [convertRadical(node, "mroot", ctx)];
    case "msub":
    case "msup":
    case "msubsup":
      return [convertScripts(node, name, ctx)];
    case "munder":
    case "mover":
    case "munderover":
      return [convertUnderOver(node, name, ctx)];
    case "mtable":
      return [convertTable(node, ctx)];
    case "mtr":
    case "mtd":
      // Reached only when a caller hands one over directly rather than through 'mtable' (a malformed tree) -- treated as an implicit row of its own children, the same fallback src/mathml/layout.ts applies.
      return convertNodes(node.children, ctx);
    default: {
      // No OMML equivalent: degrade this ONE construct to a literal-text math run carrying its own text content, and report it. The rest of the formula still translates -- a single unsupported element never fails the document.
      diagnose(ctx, "unsupported-element", node);
      return tokenRun(node, textContent(node), "normal", ctx, true);
    }
  }
}

// A non-element node (a whitespace text node between siblings -- normal, valid MathML formatting) contributes nothing and is not a diagnostic-worthy event, matching src/mathml/layout.ts's own layoutNode.
function convertNodes(
  nodes: readonly MathMlNode[],
  ctx: WriteContext,
): XmlElement[] {
  const out: XmlElement[] = [];
  for (const node of nodes) {
    if (!isMathMlElement(node)) {
      continue;
    }
    out.push(...convertElement(node, ctx));
  }
  return out;
}

function rootContext(diagnostics: OmmlDiagnostic[]): WriteContext {
  return { inheritedVariant: undefined, displayStyle: true, diagnostics };
}

// MathML (the children of a <math> root, exactly what ContentFormula.mathml holds) -> one m:oMath element: OMML's own inline equation container, valid anywhere EG_PContent is.
export function buildOfficeMath(
  mathml: readonly MathMlNode[],
): OmmlWriteResult {
  const diagnostics: OmmlDiagnostic[] = [];
  const children = convertNodes(mathml, rootContext(diagnostics));
  if (children.length === 0) {
    return { element: undefined, diagnostics };
  }
  return {
    element: el("m:oMath", { "xmlns:m": OMML_NS }, children),
    diagnostics,
  };
}

// The same translation wrapped in m:oMathPara -- OMML's own DISPLAY equation container, the correct form for a formula that occupies a paragraph of its own (which is exactly what a ContentEmbeddedObjectBlock is). The namespace declaration moves to the outer element so the fragment still carries exactly one.
export function buildOfficeMathParagraph(
  mathml: readonly MathMlNode[],
): OmmlWriteResult {
  const diagnostics: OmmlDiagnostic[] = [];
  const children = convertNodes(mathml, rootContext(diagnostics));
  if (children.length === 0) {
    return { element: undefined, diagnostics };
  }
  return {
    element: el("m:oMathPara", { "xmlns:m": OMML_NS }, [
      el("m:oMath", {}, children),
    ]),
    diagnostics,
  };
}
