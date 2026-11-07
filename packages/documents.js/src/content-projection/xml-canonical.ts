import {
  scanXml,
  type QualifiedName,
  type ScannedAttribute,
  type ScannedElement,
} from "./xml-scan";

/** The two serialisations `canonicalizeXml` produces for one XML document. */
export interface CanonicalXml {
  /** The canonical form: every lexical difference removed, nothing else touched. */
  readonly canonical: string;
  /** The canonical form with identifier and revision-stamp attributes left out. Two documents whose `canonical` forms differ but whose `identifierFree` forms agree differ only in identifiers. */
  readonly identifierFree: string;
}

const MARKUP_COMPATIBILITY_NAMESPACE =
  "http://schemas.openxmlformats.org/markup-compatibility/2006";

// Markup Compatibility and Extensibility (ECMA-376 Part 3, clause 10): attributes whose values are lists of namespace prefixes or prefixed names. A prefix is a document-local alias, so the list is rewritten to namespace URIs and sorted: the specification treats each list as a set.
const PREFIX_LIST_ATTRIBUTES: ReadonlySet<string> = new Set([
  "Ignorable",
  "ProcessContent",
  "PreserveElements",
  "PreserveAttributes",
  "MustUnderstand",
]);

/**
 * Attribute local names that identify a node or stamp a revision rather than carry content. They are never removed from `canonical`; `identifierFree` leaves them out so a difference confined to them is reported as an identifier difference and not as a content difference.
 */
const IDENTIFIER_ATTRIBUTE =
  /^(rsid\w*|paraId|textId|durableId|id|Id|uniqueId|uid|guid|anchorId|editId|docId|cnvPrId)$/;

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#xD;");
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#x9;")
    .replace(/\n/g, "&#xA;")
    .replace(/\r/g, "&#xD;");
}

function expandedName(name: QualifiedName): string {
  return name.uri === "" ? name.local : `{${name.uri}}${name.local}`;
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function canonicalAttributeValue(
  attribute: ScannedAttribute,
  element: ScannedElement,
): string {
  if (
    attribute.uri !== MARKUP_COMPATIBILITY_NAMESPACE ||
    !PREFIX_LIST_ATTRIBUTES.has(attribute.local)
  ) {
    return attribute.value;
  }
  return attribute.value
    .split(/\s+/)
    .filter((token) => token !== "")
    .map((token) => {
      const colon = token.indexOf(":");
      const prefix = colon < 0 ? token : token.slice(0, colon);
      const uri = element.namespaceFor(prefix);
      if (uri === undefined) {
        return token;
      }
      return colon < 0 ? `{${uri}}` : `{${uri}}${token.slice(colon + 1)}`;
    })
    .sort(compareText)
    .join(" ");
}

// How many fragments are held before they are joined into one flat string. A document has millions of small fragments, and holding each as its own array element and string costs many times the characters it carries; joining every so many into a flat chunk bounds that overhead to one chunk's worth. Any value from the hundreds to the hundred thousands gives the same output, so this is a memory tuning knob only, not a parameter of the canonical form.
const FRAGMENTS_PER_CHUNK = 4096;

/** Accumulates a long string from many small fragments without holding one object per fragment. */
class ChunkedText {
  readonly #chunks: string[] = [];
  #fragments: string[] = [];

  push(fragment: string): void {
    this.#fragments.push(fragment);
    if (this.#fragments.length >= FRAGMENTS_PER_CHUNK) {
      this.#chunks.push(this.#fragments.join(""));
      this.#fragments = [];
    }
  }

  toString(): string {
    return this.#chunks.join("") + this.#fragments.join("");
  }
}

/**
 * Serialises one XML document in a canonical form that removes lexical difference and nothing else. The transformations are a closed list:
 *
 * 1. The byte order mark and the XML declaration are dropped.
 * 2. CRLF and lone CR become LF, and literal tabs and line feeds in attribute values become spaces (XML 1.0 sections 2.11 and 3.3.3).
 * 3. Entity and character references are decoded, then the output is re-escaped with one fixed escaping, so `&#65;`, `&#x41;` and `A` agree.
 * 4. Namespace prefixes are replaced by the namespace URIs they resolve to and namespace declarations are dropped, so a prefix rename changes nothing. Prefix lists in the Markup Compatibility attributes are rewritten the same way and sorted.
 * 5. Attributes are sorted by expanded name, and quoting and whitespace inside tags are fixed.
 * 6. An empty element is always written as a start tag and an end tag.
 * 7. CDATA sections become ordinary text and adjacent text is merged.
 *
 * Nothing else is touched: identifiers, revision stamps, timestamps, relationship identifiers, child order, whitespace-only text, comments and processing instructions all survive, so a real difference is never normalised away. A prefix inside an ordinary attribute value (an `xsi:type` or a formula) is content, not syntax, and is left as written.
 *
 * Throws `XmlDoctypeError` on a document type declaration rather than dropping it, and `XmlScanError` on malformed XML.
 */
export function canonicalizeXml(source: string): CanonicalXml {
  const canonical = new ChunkedText();
  const identifierFree = new ChunkedText();
  let pendingText = "";

  const emit = (fragment: string): void => {
    canonical.push(fragment);
    identifierFree.push(fragment);
  };
  const flushText = (): void => {
    if (pendingText !== "") {
      emit(escapeText(pendingText));
      pendingText = "";
    }
  };

  scanXml(source, {
    startElement(element) {
      flushText();
      const attributes = element.attributes
        .map((attribute) => ({
          key: expandedName(attribute),
          local: attribute.local,
          rendered: escapeAttribute(
            canonicalAttributeValue(attribute, element),
          ),
        }))
        .sort((left, right) => compareText(left.key, right.key));
      const name = expandedName(element);
      canonical.push(`<${name}`);
      identifierFree.push(`<${name}`);
      for (const attribute of attributes) {
        const rendered = ` ${attribute.key}="${attribute.rendered}"`;
        canonical.push(rendered);
        if (!IDENTIFIER_ATTRIBUTE.test(attribute.local)) {
          identifierFree.push(rendered);
        }
      }
      emit(">");
    },
    endElement(name) {
      flushText();
      emit(`</${expandedName(name)}>`);
    },
    text(value) {
      pendingText += value;
    },
    comment(value) {
      flushText();
      emit(`<!--${value}-->`);
    },
    processingInstruction(target, data) {
      flushText();
      emit(`<?${target}${data === "" ? "" : ` ${data}`}?>`);
    },
  });
  return {
    canonical: canonical.toString(),
    identifierFree: identifierFree.toString(),
  };
}
