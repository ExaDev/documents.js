// The minimal XMP reader (#721): a bounded extractor for the standard Dublin Core / XMP Basic fields of an XMP packet (ISO 16684-1), NOT an XML parser. This is a dependency-minimal codec -- a real RDF/XML parser would be the package's largest dependency for one optional stream -- so the extractor handles exactly the shapes the standard fields take (an element whose text content is either a plain value or an rdf:Alt/rdf:Bag/rdf:Seq of rdf:li items) and leaves everything else in the raw packet, which rides whole as package-level residue. Namespaces are matched by their local names (dc:title, xmp:Producer) because every producer of the standard fields spells the prefixes the same way; a packet using exotic prefixes still lands in residue undamaged.

export interface XmpMetadata {
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  readonly keywords?: string[];
  readonly creator?: string;
  readonly producer?: string;
  readonly createdIso?: string;
  readonly modifiedIso?: string;
}

export function readXmpMetadata(packet: string): XmpMetadata {
  return {
    ...field(xmpValue(packet, 'dc:title'), 'title'),
    ...field(xmpValue(packet, 'dc:creator'), 'author'),
    ...field(xmpValue(packet, 'dc:description'), 'subject'),
    ...field(xmpValue(packet, 'xmp:CreatorTool'), 'creator'),
    ...field(xmpValue(packet, 'pdf:Producer'), 'producer'),
    ...field(xmpValue(packet, 'xmp:CreateDate'), 'createdIso'),
    ...field(xmpValue(packet, 'xmp:ModifyDate'), 'modifiedIso'),
    ...keywordsOf(packet),
  };
}

// One element's value: its own text content when it carries a plain value, or the concatenation / item list of the rdf:Alt / rdf:Bag / rdf:Seq container the standard's array forms use. Returns undefined for an element the packet does not carry -- absence is the packet's statement, not an error.
function xmpValue(packet: string, element: string): string | readonly string[] | undefined {
  const match = new RegExp(`<${element}(?:\\s[^>]*)?>([\\s\\S]*?)</${element}>`).exec(packet);
  if (match === null) {
    return undefined;
  }
  const inner = match[1] ?? '';
  const items = listItems(inner);
  if (items.length > 0) {
    return items;
  }
  const text = inner.trim();
  return text.length > 0 ? text : undefined;
}

function listItems(inner: string): string[] {
  const items: string[] = [];
  const pattern = /<rdf:li(?:\s[^>]*)?>([\s\S]*?)<\/rdf:li>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(inner)) !== null) {
    const text = (match[1] ?? '').trim();
    if (text.length > 0) {
      items.push(text);
    }
  }
  return items;
}

function field(value: string | readonly string[] | undefined, key: string): Record<string, string> {
  if (typeof value === 'string') {
    return { [key]: value };
  }
  if (Array.isArray(value) && value.length > 0) {
    return { [key]: value.join(', ') };
  }
  return {};
}

function keywordsOf(packet: string): { keywords?: string[] } {
  const match = new RegExp('<dc:subject(?:\\s[^>]*)?>([\\s\\S]*?)</dc:subject>').exec(packet);
  if (match === null) {
    return {};
  }
  const items = listItems(match[1] ?? '');
  return items.length > 0 ? { keywords: items } : {};
}
