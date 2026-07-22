import type { XmlElement, XmlNode } from '../model/node';
import type { Part } from '../model/package';

// Depth-first walk over a node forest, yielding every node and descending into element children.
export function* walk(nodes: XmlNode[]): Generator<XmlNode> {
  for (const node of nodes) {
    yield node;
    if (node.type === 'element') {
      yield* walk(node.children);
    }
  }
}

// Recursive descendant search by tag.
export function elementsWithTag(nodes: XmlNode[], tag: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const node of walk(nodes)) {
    if (node.type === 'element' && node.tag === tag) {
      out.push(node);
    }
  }
  return out;
}

// Direct-child search by tag, for elements whose OOXML schema fixes the parent.
export function childrenWithTag(element: XmlElement, tag: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of element.children) {
    if (child.type === 'element' && child.tag === tag) {
      out.push(child);
    }
  }
  return out;
}

export function attr(element: XmlElement, name: string): string | undefined {
  for (const a of element.attributes) {
    if (a.name === name) {
      return a.value;
    }
  }
  return undefined;
}

// The root element of a part, skipping the leading <?xml ?> declaration node; undefined for a missing or binary part.
export function rootElement(part: Part | undefined): XmlElement | undefined {
  if (part === undefined || part.kind !== 'xml') {
    return undefined;
  }
  for (const node of part.nodes) {
    if (node.type === 'element') {
      return node;
    }
  }
  return undefined;
}

// The lossless layer keeps XML entities raw (e.g. &amp;) for fidelity; this typed reading view decodes the five standard entities so projected text is human-readable.
export function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => {
    switch (entity) {
      case '&amp;':
        return '&';
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&quot;':
        return '"';
      case '&apos;':
        return "'";
      default:
        return entity;
    }
  });
}

// Flattened, entity-decoded character content of an element: every descendant text and cdata value concatenated in document order.
export function textContent(element: XmlElement): string {
  let text = '';
  for (const node of walk(element.children)) {
    if (node.type === 'text' || node.type === 'cdata') {
      text += node.value;
    }
  }
  return decodeEntities(text);
}
