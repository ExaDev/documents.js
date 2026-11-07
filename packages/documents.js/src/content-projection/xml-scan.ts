/** A namespace-resolved name. `uri` is empty for a name in no namespace: an unprefixed attribute, or an element when no default namespace is in scope. */
export interface QualifiedName {
  readonly uri: string;
  readonly local: string;
}

export interface ScannedAttribute extends QualifiedName {
  /** The value after XML 1.0 section 3.3.3 attribute-value normalisation and reference decoding. */
  readonly value: string;
}

export interface ScannedElement extends QualifiedName {
  /** Every attribute except the namespace declarations, in source order. */
  readonly attributes: readonly ScannedAttribute[];
  /** Resolves a prefix declared in scope at this element, its own declarations included. The empty prefix is the default namespace. */
  readonly namespaceFor: (prefix: string) => string | undefined;
}

/** The events `scanXml` raises, in document order. Every handler is optional. */
export interface XmlScanHandler {
  startElement?: (element: ScannedElement) => void;
  endElement?: (name: QualifiedName) => void;
  /** Character data with references decoded. A CDATA section is raised as ordinary text, and one text run may arrive in several calls. */
  text?: (value: string) => void;
  comment?: (value: string) => void;
  processingInstruction?: (target: string, data: string) => void;
}

/** The input is not well-formed XML, or uses a construct the scanner refuses rather than guesses at. */
export class XmlScanError extends Error {
  override readonly name: string = "XmlScanError";
}

/**
 * The input carries a document type declaration. Its internal subset can declare entities that change what the text means, so dropping it silently could hide content or invent equality; no OPC part has a legitimate use for one.
 */
export class XmlDoctypeError extends XmlScanError {
  override readonly name: string = "XmlDoctypeError";
}

const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const BYTE_ORDER_MARK = "﻿";

const PREDEFINED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["lt", "<"],
  ["gt", ">"],
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
]);

const HEX_REFERENCE = /^#x([0-9A-Fa-f]+)$/;
const DECIMAL_REFERENCE = /^#([0-9]+)$/;
const HEX_RADIX = 16;
const DECIMAL_RADIX = 10;

// XML 1.0 (Fifth Edition) section 2.2, production Char: the only code points a conforming document may contain, character references included.
const CHAR_TAB = 0x9;
const CHAR_LINE_FEED = 0xa;
const CHAR_CARRIAGE_RETURN = 0xd;
const CHAR_BMP_LOW_START = 0x20;
const CHAR_BMP_LOW_END = 0xd7ff;
const CHAR_BMP_HIGH_START = 0xe000;
const CHAR_BMP_HIGH_END = 0xfffd;
const CHAR_ASTRAL_START = 0x10000;
const CHAR_ASTRAL_END = 0x10ffff;

function isXmlChar(codePoint: number): boolean {
  return (
    codePoint === CHAR_TAB ||
    codePoint === CHAR_LINE_FEED ||
    codePoint === CHAR_CARRIAGE_RETURN ||
    (codePoint >= CHAR_BMP_LOW_START && codePoint <= CHAR_BMP_LOW_END) ||
    (codePoint >= CHAR_BMP_HIGH_START && codePoint <= CHAR_BMP_HIGH_END) ||
    (codePoint >= CHAR_ASTRAL_START && codePoint <= CHAR_ASTRAL_END)
  );
}

function resolveReference(name: string): string {
  const predefined = PREDEFINED_ENTITIES.get(name);
  if (predefined !== undefined) {
    return predefined;
  }
  const hex = HEX_REFERENCE.exec(name);
  const decimal = DECIMAL_REFERENCE.exec(name);
  const digits = hex?.[1] ?? decimal?.[1];
  if (digits === undefined) {
    throw new XmlScanError(`undeclared entity reference "&${name};"`);
  }
  const codePoint = Number.parseInt(
    digits,
    hex === null ? DECIMAL_RADIX : HEX_RADIX,
  );
  if (!isXmlChar(codePoint)) {
    throw new XmlScanError(
      `character reference "&${name};" is outside XML's Char production`,
    );
  }
  return String.fromCodePoint(codePoint);
}

/** Decodes the five predefined entities and every numeric character reference in one left-to-right pass, so decoded text is never read as markup again. Any other reference is an error: with a document type declaration refused, none can be declared. */
function decodeReferences(raw: string): string {
  let at = raw.indexOf("&");
  if (at < 0) {
    return raw;
  }
  let out = "";
  let last = 0;
  while (at >= 0) {
    const semicolon = raw.indexOf(";", at);
    if (semicolon < 0) {
      throw new XmlScanError("unterminated entity reference");
    }
    out += raw.slice(last, at) + resolveReference(raw.slice(at + 1, semicolon));
    last = semicolon + 1;
    at = raw.indexOf("&", last);
  }
  return out + raw.slice(last);
}

function splitQualified(name: string): { prefix: string; local: string } {
  const colon = name.indexOf(":");
  return colon < 0
    ? { prefix: "", local: name }
    : { prefix: name.slice(0, colon), local: name.slice(colon + 1) };
}

/** The prefix a namespace declaration binds: "xmlns" declares the default namespace (the empty prefix) and "xmlns:p" declares "p". */
function declaredPrefix(declarationName: string): string {
  return declarationName === "xmlns"
    ? ""
    : declarationName.slice("xmlns:".length);
}

type Scope = ReadonlyMap<string, string>;

interface OpenElement {
  readonly rawName: string;
  readonly name: QualifiedName;
}

const TAG_NAME = /[^\s/>]+/y;
const ATTRIBUTE = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
const TAG_CLOSE = /\s*(\/?)>/y;
const END_TAG = /<\/([^\s>]+)\s*>/y;
const WHITESPACE_ONLY = /^\s*$/;
const LINE_ENDING = /\r\n?/g;
const ATTRIBUTE_WHITESPACE = /[\t\n]/g;
const COMMENT_OPEN = "<!--";
const COMMENT_CLOSE = "-->";
const CDATA_OPEN = "<![CDATA[";
const CDATA_CLOSE = "]]>";
const PI_OPEN = "<?";
const PI_CLOSE = "?>";
const DOCTYPE_OPEN = "<!DOCTYPE";
const XML_DECLARATION_TARGET = "xml";

/**
 * Scans well-formed XML in one forward pass, raising SAX-style events with names resolved to namespace URIs. No tree is built, so memory is bounded by the nesting depth and whatever the handler keeps.
 *
 * Normalisation that XML 1.0 itself requires happens here, because every conforming parser does it: a leading byte order mark is dropped, CRLF and lone CR become LF (section 2.11), literal tabs and line feeds in attribute values become spaces (section 3.3.3), and references are decoded. The XML declaration is consumed and not reported.
 *
 * Throws `XmlDoctypeError` for a document type declaration and `XmlScanError` for anything not well-formed: unbalanced or mismatched tags, an unbound prefix, an undeclared entity, a reference outside XML's Char production, text outside the root element, or no root element.
 */
export function scanXml(source: string, handler: XmlScanHandler): void {
  let text = source.startsWith(BYTE_ORDER_MARK) ? source.slice(1) : source;
  if (text.includes("\r")) {
    text = text.replace(LINE_ENDING, "\n");
  }
  const open: OpenElement[] = [];
  const scopes: Scope[] = [new Map([["xml", XML_NAMESPACE]])];
  let rootClosed = false;
  let position = 0;

  const currentScope = (): Scope => scopes[scopes.length - 1] ?? new Map();

  const raiseText = (value: string): void => {
    if (open.length === 0) {
      if (!WHITESPACE_ONLY.test(value)) {
        throw new XmlScanError("character data outside the root element");
      }
      return;
    }
    if (value !== "") {
      handler.text?.(value);
    }
  };

  const startTag = (tagStart: number): number => {
    TAG_NAME.lastIndex = tagStart + 1;
    const nameMatch = TAG_NAME.exec(text);
    if (nameMatch === null) {
      throw new XmlScanError("element name expected after '<'");
    }
    const rawName = nameMatch[0];
    const rawAttributes: { rawName: string; value: string }[] = [];
    let cursor = TAG_NAME.lastIndex;
    for (;;) {
      ATTRIBUTE.lastIndex = cursor;
      const attributeMatch = ATTRIBUTE.exec(text);
      if (attributeMatch === null) {
        break;
      }
      const attributeName = attributeMatch[1] ?? "";
      const value = attributeMatch[2] ?? attributeMatch[3] ?? "";
      if (value.includes("<")) {
        throw new XmlScanError(
          `'<' in the value of attribute "${attributeName}"`,
        );
      }
      if (
        rawAttributes.some((existing) => existing.rawName === attributeName)
      ) {
        throw new XmlScanError(`duplicate attribute "${attributeName}"`);
      }
      rawAttributes.push({
        rawName: attributeName,
        value: decodeReferences(value.replace(ATTRIBUTE_WHITESPACE, " ")),
      });
      cursor = ATTRIBUTE.lastIndex;
    }
    TAG_CLOSE.lastIndex = cursor;
    const closeMatch = TAG_CLOSE.exec(text);
    if (closeMatch === null) {
      throw new XmlScanError(`malformed start tag for "${rawName}"`);
    }
    const selfClosing = closeMatch[1] === "/";

    const declared = rawAttributes.filter(
      (attribute) =>
        attribute.rawName === "xmlns" || attribute.rawName.startsWith("xmlns:"),
    );
    let scope = currentScope();
    if (declared.length > 0) {
      const extended = new Map(scope);
      for (const declaration of declared) {
        extended.set(declaredPrefix(declaration.rawName), declaration.value);
      }
      scope = extended;
    }
    const resolve = (prefix: string): string | undefined => scope.get(prefix);

    const elementParts = splitQualified(rawName);
    const elementUri = resolve(elementParts.prefix);
    if (elementUri === undefined && elementParts.prefix !== "") {
      throw new XmlScanError(
        `unbound namespace prefix "${elementParts.prefix}"`,
      );
    }
    const attributes: ScannedAttribute[] = [];
    for (const attribute of rawAttributes) {
      if (declared.includes(attribute)) {
        continue;
      }
      const parts = splitQualified(attribute.rawName);
      if (parts.prefix === "") {
        attributes.push({
          uri: "",
          local: parts.local,
          value: attribute.value,
        });
        continue;
      }
      const uri = resolve(parts.prefix);
      if (uri === undefined) {
        throw new XmlScanError(`unbound namespace prefix "${parts.prefix}"`);
      }
      attributes.push({ uri, local: parts.local, value: attribute.value });
    }
    const name: QualifiedName = {
      uri: elementUri ?? "",
      local: elementParts.local,
    };
    handler.startElement?.({ ...name, attributes, namespaceFor: resolve });
    if (selfClosing) {
      handler.endElement?.(name);
      if (open.length === 0) {
        rootClosed = true;
      }
    } else {
      open.push({ rawName, name });
      scopes.push(scope);
    }
    return TAG_CLOSE.lastIndex;
  };

  while (position < text.length) {
    const tagStart = text.indexOf("<", position);
    if (tagStart < 0) {
      raiseText(decodeReferences(text.slice(position)));
      break;
    }
    if (tagStart > position) {
      raiseText(decodeReferences(text.slice(position, tagStart)));
    }
    if (text.startsWith(COMMENT_OPEN, tagStart)) {
      const end = text.indexOf(COMMENT_CLOSE, tagStart + COMMENT_OPEN.length);
      if (end < 0) {
        throw new XmlScanError("unterminated comment");
      }
      if (open.length > 0) {
        handler.comment?.(text.slice(tagStart + COMMENT_OPEN.length, end));
      }
      position = end + COMMENT_CLOSE.length;
    } else if (text.startsWith(CDATA_OPEN, tagStart)) {
      const end = text.indexOf(CDATA_CLOSE, tagStart + CDATA_OPEN.length);
      if (end < 0) {
        throw new XmlScanError("unterminated CDATA section");
      }
      if (open.length === 0) {
        throw new XmlScanError("CDATA section outside the root element");
      }
      handler.text?.(text.slice(tagStart + CDATA_OPEN.length, end));
      position = end + CDATA_CLOSE.length;
    } else if (text.startsWith(PI_OPEN, tagStart)) {
      const end = text.indexOf(PI_CLOSE, tagStart + PI_OPEN.length);
      if (end < 0) {
        throw new XmlScanError("unterminated processing instruction");
      }
      const body = text.slice(tagStart + PI_OPEN.length, end);
      const split = body.search(/\s/);
      const target = split < 0 ? body : body.slice(0, split);
      const data = split < 0 ? "" : body.slice(split).replace(/^\s+/, "");
      if (target !== XML_DECLARATION_TARGET && open.length > 0) {
        handler.processingInstruction?.(target, data);
      }
      position = end + PI_CLOSE.length;
    } else if (text.startsWith(DOCTYPE_OPEN, tagStart)) {
      throw new XmlDoctypeError("document type declarations are refused");
    } else if (text.startsWith("<!", tagStart)) {
      throw new XmlScanError("unsupported markup declaration");
    } else if (text.startsWith("</", tagStart)) {
      END_TAG.lastIndex = tagStart;
      const endMatch = END_TAG.exec(text);
      const top = open.pop();
      if (
        endMatch === null ||
        top === undefined ||
        endMatch[1] !== top.rawName
      ) {
        throw new XmlScanError(
          `end tag does not match open element "${top?.rawName ?? "(none)"}"`,
        );
      }
      scopes.pop();
      handler.endElement?.(top.name);
      if (open.length === 0) {
        rootClosed = true;
      }
      position = END_TAG.lastIndex;
    } else {
      if (rootClosed && open.length === 0) {
        throw new XmlScanError("more than one root element");
      }
      position = startTag(tagStart);
    }
  }
  if (open.length > 0) {
    throw new XmlScanError(
      `unclosed element "${open[open.length - 1]?.rawName ?? ""}"`,
    );
  }
  if (!rootClosed) {
    throw new XmlScanError("no root element");
  }
}
