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
    const container = containerRef.current;
    if (container === null) return;
    container.innerHTML = "";
    const math = document.createElementNS(MATHML_NS, "math");
    appendMathMlNodes(math, mathml);
    container.appendChild(math);
  }, [mathml]);

  return <div ref={containerRef} className={className} />;
}
