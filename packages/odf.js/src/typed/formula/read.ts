import type { ContentDocument, DocumentPackage, LayoutMetadata } from 'document-schema.js';
import { assemblePackage } from 'document-schema.js';
import type { XmlElement, XmlNode } from '../../model/node';
import type { Package } from '../../model/package';
import { attrValue, elementsWithTag, rootElement } from '../../xml/query';
import { decodeXmlText } from '../../xml/entities';
import { readOdfMetadata } from '../shared/metadata';

// Package -> a standalone (or embedded) ODF Formula's raw MathML content. .odf (OpenDocument Formula) is structurally unlike every other odf.js typed reader's content.xml: there is no office:document-content/office:body wrapper at all -- the whole part IS one MathML document. Confirmed against GENUINE LibreOffice 26.2 output, not assumed: a headless UNO Basic macro (mirroring the same technique the ods/odg/odp readers' own top-of-file notes describe) created a private:factory/smath document, set its own Formula property to a real StarMath expression with a fraction and a square root ("f(x) = {x^2} over {2} + sqrt {x}"), and saved it via the "math8" filter -- the same UNO call path File > Save As itself uses -- for BOTH a standalone .odf and a Math object embedded inside a real .odt (via a com.sun.star.text.TextEmbeddedObject with Math's own CLSID, "078B7ABA-54FC-457F-8551-6147E776A997"). In both cases content.xml's root element IS content.xml's own MathML root, with NO office:document-content wrapper around it either way.
//
// Two real findings that contradict the naive "math:math" assumption this reader's own design brief started from:
// - The root element's tag is bare "math", NOT "math:math". Real LibreOffice output declares the MathML namespace as content.xml's DEFAULT namespace (xmlns="http://www.w3.org/1998/Math/MathML" on the <math> root itself) rather than binding it to a "math:" prefix the way every other odf.js part prefixes office/text/table/draw -- every descendant (<semantics>, <mrow>, <mi>, <mo>, <mn>, <msup>, <msqrt>, <annotation>, ...) is likewise unprefixed. odf.js's own XML parser (xml/parse.ts) is not namespace-aware -- an element's `tag` is exactly whatever string preceded the element name in the source -- so a genuine LibreOffice-produced root element's XmlElement.tag is literally "math", never "math:math". MATH_ROOT_TAGS below still also matches a literal "math:math" tag, purely defensively (in case a different producer prefixes it the way ns.ts's own `math:` entry would suggest), but that is NOT what real LibreOffice output does.
// - An embedded Math OLE object's OWN content.xml (its subdocument directory's content.xml -- "Object 1/content.xml" inside the real .odt built for this verification) uses the IDENTICAL bare <math> root as a standalone .odf. There is no office:document-content wrapper around an embedded formula sub-document either. findMathRoot's descendant-search fallback (for "math:math nested inside office:document-content") was therefore never actually exercised by any real file built for this verification -- it exists purely as a defensive shape for a hypothetical producer that does wrap it that way, per this reader's own design brief.
//
// StarMath, genuinely confirmed rather than guessed: a formula authored in LibreOffice Math always carries its own native StarMath syntax alongside the MathML it exports, as a standard MathML <annotation encoding="StarMath 5.0"> element -- a child of a <semantics> element wrapping the presentation MathML, per MathML's own semantics/annotation mechanism. This is NOT an ODF- or LibreOffice-specific extension element or attribute (contrary to this reader's own design brief's speculation of "an office:annotation-adjacent element or extension attribute on the math:math root"); it is plain, standard MathML. It is present because LibreOffice Math's own internal formula representation IS StarMath -- MathML is only ever an export format -- so every genuine LibreOffice-authored formula carries this annotation. A formula with no StarMath annotation at all (starMath left undefined below) would only arise from a content.xml this reader is handed that was never produced by LibreOffice Math itself -- e.g. hand-authored or third-party-produced plain presentation MathML with no <semantics>/<annotation> wrapper.

export interface OdfFormulaDocument {
  starMath?: string;
  mathml: XmlNode[];
  metadata: LayoutMetadata;
}

const CONTENT_PART = 'content.xml';

// Bare "math" is what genuine LibreOffice output actually produces (see this module's own top-of-file note); "math:math" is kept alongside it purely as a defensive match for a producer that binds the MathML namespace to a prefix instead of using it as the default namespace.
const MATH_ROOT_TAGS = ['math', 'math:math'];
const ANNOTATION_TAGS = ['annotation', 'math:annotation'];

// MathML's own semantics/annotation mechanism identifies an annotation's notation by its encoding attribute, e.g. "StarMath 5.0" -- a version-suffixed string, so this checks the encoding's own namespace-style prefix rather than an exact match.
const STARMATH_ENCODING_PREFIX = 'StarMath';

// content.xml's own MathML root: checked first at the part's own root position (the real, confirmed LibreOffice shape -- see this module's own top-of-file note), then as a descendant of whatever the actual root element turns out to be (the defensive "wrapped in office:document-content" fallback the design brief asked for, never itself observed in real output). Exported for typed/draw/embedded.ts, which asks the identical question of an EMBEDDED object's own sub-document content.xml when that sub-document turns out to have no office:body to classify it by -- the same detection, reused rather than restated, so the two can never disagree about what counts as a MathML root.
export function findMathRoot(nodes: readonly XmlNode[]): XmlElement | undefined {
  const root = rootElement(nodes);
  if (root === undefined) {
    return undefined;
  }
  if (MATH_ROOT_TAGS.includes(root.tag)) {
    return root;
  }
  for (const tag of MATH_ROOT_TAGS) {
    const [found] = elementsWithTag(root.children, tag);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

// Plain, entity-decoded text content of a MathML <annotation> element -- real StarMath annotations are simple text content, never mixed with nested elements, mirroring metadata.ts's own elementText for the identical reason.
function annotationText(element: XmlElement): string {
  let text = '';
  for (const child of element.children) {
    if (child.type === 'text') {
      text += decodeXmlText(child.value);
    }
  }
  return text;
}

// The first <annotation encoding="StarMath ..."> found anywhere under the MathML root (a descendant search, since a real <annotation> sits two levels down -- <math><semantics><annotation>, not a direct child of <math> -- see this module's own top-of-file note on the real structure).
function findStarMathAnnotation(mathRoot: XmlElement): string | undefined {
  for (const tag of ANNOTATION_TAGS) {
    for (const annotation of elementsWithTag(mathRoot.children, tag)) {
      const encoding = attrValue(annotation, 'encoding');
      if (!encoding?.startsWith(STARMATH_ENCODING_PREFIX)) {
        continue;
      }
      const text = annotationText(annotation);
      if (text.length > 0) {
        return text;
      }
    }
  }
  return undefined;
}

// Package -> OdfFormulaDocument. Throws only when content.xml itself, or a MathML root within it (see findMathRoot), is missing -- a genuinely unusable package, mirroring every other odf.js typed reader's own "missing required structural element" throw convention. `mathml` is the MathML root's own children (its real content -- typically a single <semantics> element wrapping the presentation MathML plus any <annotation>s, per real LibreOffice output; occasionally, for hand-authored presentation-only MathML with no <semantics> wrapper, the presentation elements directly), returned as the raw, lossless XmlNode[] this reader read them as -- see readOdfFormulaContent below for the document-schema.js-pivot-shaped alternative built on top of this same result.
export function readOdfFormulaMathMl(pkg: Package): OdfFormulaDocument {
  const contentPart = pkg.parts[CONTENT_PART];
  if (contentPart?.kind !== 'xml') {
    throw new Error(`readOdfFormulaMathMl: package has no ${CONTENT_PART} part`);
  }
  const mathRoot = findMathRoot(contentPart.nodes);
  if (mathRoot === undefined) {
    throw new Error(`readOdfFormulaMathMl: ${CONTENT_PART} has no MathML root element`);
  }

  const metadata = readOdfMetadata(pkg);
  const starMath = findStarMathAnnotation(mathRoot);

  return starMath === undefined ? { mathml: mathRoot.children, metadata } : { starMath, mathml: mathRoot.children, metadata };
}

// Package -> a real document-schema.js ContentDocument of kind 'formula'. Built directly on readOdfFormulaMathMl's own result -- same throw behaviour, same metadata, same raw mathml/starMath -- just reshaped into the ContentDocumentSchema 'formula' variant document-schema.js 2.0.0 now defines, for a caller that wants the shared pivot type rather than this reader's own bespoke OdfFormulaDocument shape. readOdfFormulaMathMl itself is unchanged and remains the right call for a caller that wants the raw, lossless data with no pivot-schema shaping at all.
//
// `mathml` here is odf.js's own XmlNode[] (this package's local, hand-written recursive element type); the object literal below assigns it straight into ContentFormula's own `mathml: MathMlNode[]` field, checked structurally against this function's own `ContentDocument` return type, with NO cast anywhere. XmlNode and MathMlNode are independently-defined structural mirrors of each other (see this module's own top-of-file note and src/interop.test.ts-style guards elsewhere in this family), not a shared class or branded type, so this return statement compiling unmodified is itself the live proof that document-schema.js's MathMlNode transcription is a genuine structural supertype of XmlNode.
export function readOdfFormulaContent(pkg: Package): ContentDocument {
  const { mathml, starMath, metadata } = readOdfFormulaMathMl(pkg);

  return {
    kind: 'formula',
    metadata,
    formula: starMath === undefined ? { mathml } : { mathml, starMath },
  };
}

// Package -> DocumentPackage: this module's PRIMARY entry point, the formula mirror of readOdtContent/readOdt (see src/typed/odt/read.ts's own note on why assemblePackage rather than bare decompose, and why no `pages` argument). A formula package's single child is the ContentFormula leaf itself -- there is no container structure to group and therefore nothing for the minting pass to factor, so assemblePackage's styles table is necessarily absent here; the call still routes through it rather than hand-building the envelope, so every reader in this package constructs its package exactly one way.
//
// This function takes the name readOdfFormulaMathMl carried before this package's DocumentPackage-native API landed. The two remaining names below it are the same ladder every other format has -- readOdfFormulaContent for the flat ContentDocument pivot, readOdfFormulaMathMl for the raw MathML nodes plus StarMath annotation with no pivot shaping at all -- so a caller picks the level it needs rather than the level this module happened to expose first.
export function readOdfFormula(pkg: Package): DocumentPackage {
  return assemblePackage(readOdfFormulaContent(pkg));
}
