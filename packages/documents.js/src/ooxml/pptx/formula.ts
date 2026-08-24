import type { ContentShape, ContentSlide } from "document-schema.js";
import type { XmlElement, XmlNode } from "ooxml.js";
import { childrenWithTag } from "ooxml.js";
import { buildFormulaBlock } from "../../model/formula";
import type { OmmlDiagnostic } from "../../omml/shared";
import { readOfficeMath } from "../../omml/read";

// pptx-side embedded-formula detection (ExaDev/documents.js#563), the counterpart to src/odf/formula/detect.ts's own collectSlideFormulaFrames -- same "one shape, one formula" granularity as odp (not docx's finer, inline-within-flowing-text splice, src/ooxml/docx/embedded-objects.ts, which a pptx shape has no structural equivalent of: a PowerPoint equation lives inside its own text box, not spliced into running prose the way an inline Word equation is). A shape mixing a real equation alongside ordinary text runs is out of this module's scope -- see formulaOnlyEquation's own comment -- and is read back as plain text, its OMML markup never inspected.

export type OmmlDiagnosticSink = (
  diagnostic: OmmlDiagnostic,
  context: { readonly sourcePath?: string },
) => void;

interface WalkState {
  shapeIndex: number;
}

interface FoundFormulaShape {
  readonly shapeIndex: number;
  readonly equation: XmlElement;
}

// A p:sp shape whose ENTIRE p:txBody is exactly one a:p holding nothing but a single m:oMathPara -- exactly what src/edit/pptx/shape.ts's own PptxShape.appendOfficeMath writes, so a formula this package wrote itself always reads straight back. m:oMathPara (OMML's own display-equation container) is what buildOfficeMathParagraph always wraps its output in, so that is what this looks for, not a bare m:oMath -- readOfficeMath (src/omml/read.ts) accepts either form directly.
function formulaOnlyEquation(shape: XmlElement): XmlElement | undefined {
  const txBody = childrenWithTag(shape, "p:txBody")[0];
  if (txBody === undefined) {
    return undefined;
  }
  const paragraphs = childrenWithTag(txBody, "a:p");
  if (paragraphs.length !== 1) {
    return undefined;
  }
  const [paragraph] = paragraphs;
  const mathParas = childrenWithTag(paragraph!, "m:oMathPara");
  if (mathParas.length !== 1) {
    return undefined;
  }
  const [mathPara] = mathParas;
  for (const child of paragraph!.children) {
    if (child.type === "text") {
      if (child.value.trim().length > 0) {
        return undefined;
      }
      continue;
    }
    if (
      child.type !== "element" ||
      child.tag === "a:pPr" ||
      child === mathPara
    ) {
      continue;
    }
    return undefined;
  }
  return mathPara;
}

// A shape-tree walk mirroring src/ooxml/pptx/vector.ts's own collectVectorOnlyShapes exactly: p:sp/p:pic/p:graphicFrame each occupy one shape slot in document order, p:grpSp recurses, p:cxnSp occupies none.
function collectFormulaShapes(
  children: readonly XmlNode[],
  state: WalkState,
  out: FoundFormulaShape[],
): void {
  for (const node of children) {
    if (node.type !== "element") {
      continue;
    }
    if (node.tag === "p:sp") {
      const shapeIndex = state.shapeIndex;
      state.shapeIndex += 1;
      const equation = formulaOnlyEquation(node);
      if (equation !== undefined) {
        out.push({ shapeIndex, equation });
      }
    } else if (node.tag === "p:pic" || node.tag === "p:graphicFrame") {
      state.shapeIndex += 1;
    } else if (node.tag === "p:grpSp") {
      collectFormulaShapes(node.children, state, out);
    }
    // p:cxnSp (a connector) occupies no shape slot, matching collectVectorOnlyShapes's identical exclusion.
  }
}

// Rebuilds a slide's own shapes array, replacing each formula-only p:sp's blocks with a real formula-kind embedded object. Must run BEFORE src/ooxml/pptx/vector.ts's own collapseVectorShapeRuns -- that pass can shrink the shapes array (collapsing several empty shape slots into one synthetic shape), which would invalidate the shapeIndex correspondence this function's own walk depends on, mirroring src/odf/odp/read.ts's own identical ordering rationale for its formula-then-vector two-pass structure. Returns `slide` unchanged when nothing was recovered.
export function spliceSlideFormulas(
  slide: ContentSlide,
  slideIndex: number,
  spTreeChildren: readonly XmlNode[],
  onMathDiagnostic?: OmmlDiagnosticSink,
): ContentSlide {
  const state: WalkState = { shapeIndex: 0 };
  const found: FoundFormulaShape[] = [];
  collectFormulaShapes(spTreeChildren, state, found);
  if (found.length === 0) {
    return slide;
  }

  const shapes: ContentShape[] = [...slide.shapes];
  for (const { shapeIndex, equation } of found) {
    const shape = shapes[shapeIndex];
    if (shape === undefined) {
      continue;
    }
    const sourcePath = `slides[${slideIndex}].shapes[${shapeIndex}]`;
    const { mathml, diagnostics } = readOfficeMath(equation);
    for (const diagnostic of diagnostics) {
      onMathDiagnostic?.(diagnostic, { sourcePath });
    }
    // An equation whose OMML produced no MathML at all leaves the shape's existing (ordinary-text) reading in place -- mirroring src/ooxml/docx/embedded-objects.ts's own identical narrowing for the same case.
    if (mathml.length === 0) {
      continue;
    }
    shapes[shapeIndex] = {
      ...shape,
      blocks: [buildFormulaBlock({ mathml }, shape.frame, sourcePath)],
    };
  }
  return { ...slide, shapes };
}
