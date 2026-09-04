import {
  Badge,
  Group,
  LoadingOverlay,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import type { ContentDocument, MathMlNode } from "documents.js";
import { useEffect, useRef } from "react";

import { flexColumn, previewFrame } from "./previewPanel.css";
import * as styles from "./FormulaPreview.css";

export interface FormulaPreviewProps {
  label: string;
  format: string;
  content?: ContentDocument;
  loading?: boolean;
  error?: unknown;
}

const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

// Real MathML producers write element tags with a "math:" namespace prefix when math is not the document's default namespace (<math:mfrac>, <math:mrow>). The browser's MathML parser expects unprefixed tags inside a namespaced <math>, so the prefix must be stripped.
function stripNamespace(tag: string): string {
  const colonIndex = tag.indexOf(":");
  return colonIndex === -1 ? tag : tag.slice(colonIndex + 1);
}

function appendMathMlNodes(parent: Node, nodes: readonly MathMlNode[]) {
  for (const node of nodes) {
    if (node.type === "text") {
      parent.appendChild(document.createTextNode(node.value));
    } else if (node.type === "element") {
      const tag = stripNamespace(node.tag);
      // <annotation> carries StarMath (or other encodings), not displayable presentation MathML -- browsers render <semantics> by showing its first child and ignoring annotation elements, but skipping them explicitly avoids any ambiguity.
      if (tag === "annotation") continue;
      const el = document.createElementNS(MATHML_NS, tag);
      for (const attr of node.attributes) {
        el.setAttribute(attr.name, attr.value);
      }
      appendMathMlNodes(el, node.children);
      parent.appendChild(el);
    }
    // cdata, comment, declaration, pi: no displayable content, skip.
  }
}

// Renders an odf-sourced formula ContentDocument as native browser MathML instead of routing through a PDF rendition. MathMlNode is a generic parsed-XML tree (not MathML-specific types), so the tree is walked imperatively via the DOM API with createElementNS -- React's JSX doesn't create MathML elements with the correct namespace. Requires a browser with MathML support (Firefox, Safari, Chrome 109+); a browser without it shows the formula's text content unstyled.
export function FormulaPreview({
  label,
  format,
  content,
  loading,
  error,
}: FormulaPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const formula = content?.kind === "formula" ? content.formula : undefined;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || formula === undefined) return;
    container.innerHTML = "";
    const math = document.createElementNS(MATHML_NS, "math");
    appendMathMlNodes(math, formula.mathml);
    container.appendChild(math);
  }, [formula]);

  return (
    <Stack gap={4} className={flexColumn}>
      <Group gap="xs">
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <Badge size="xs" variant="light">
          {format}
        </Badge>
      </Group>
      <Paper
        withBorder
        pos="relative"
        className={previewFrame({ scroll: true })}
      >
        <LoadingOverlay visible={loading === true} />
        {error !== undefined ? (
          <Group h="100%" justify="center">
            <Text c="dimmed" size="sm">
              Preview unavailable for this format.
            </Text>
          </Group>
        ) : formula === undefined ? (
          <Group h="100%" justify="center">
            <Text c="dimmed" size="sm">
              No preview yet.
            </Text>
          </Group>
        ) : (
          <div ref={containerRef} className={styles.formulaContainer} />
        )}
      </Paper>
    </Stack>
  );
}
