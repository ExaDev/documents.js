import type { MathMlNode } from "documents.js";
import { useEffect, useRef } from "react";

import { appendMathMlNodes, MATHML_NS } from "./mathml";

export interface MathMlViewProps {
  mathml: readonly MathMlNode[];
  className?: string;
}

// Renders a parsed MathML tree as native browser MathML instead of routing through a PDF rendition -- shared by FormulaPreview (a standalone formula document filling its own preview panel) and contentBlocks.tsx (an embedded formula object inline in a wordprocessing/slide block flow). Requires a browser with MathML support (Firefox, Safari, Chrome 109+); a browser without it shows the formula's text content unstyled.
export function MathMlView({ mathml, className }: MathMlViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Never null when this effect runs: the ref is attached to an unconditionally-rendered element of this same component instance, and React attaches refs during commit, strictly before a passive effect can observe them.
    const container = containerRef.current!;
    container.innerHTML = "";
    const math = document.createElementNS(MATHML_NS, "math");
    appendMathMlNodes(math, mathml);
    container.appendChild(math);
  }, [mathml]);

  return <div ref={containerRef} className={className} />;
}
