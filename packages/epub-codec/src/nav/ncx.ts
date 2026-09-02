import {
  attrValue,
  elementsWithTag,
  findChildElement,
  rootElement,
} from "../xml/query";
import { parseXml } from "../xml/parse";

// EPUB 2's own navigation document ([OPF 2.0.1]/[Daisy NCX]): a dedicated XML format (not XHTML) whose <navMap> carries nested <navPoint> entries, each with a <content src="..."/> naming the target document. Read for the identical reconciliation purpose as src/nav/nav3.ts's own EPUB 3 reading -- see that module's top-of-file note.

// Every navPoint's own <content src> value, in document order, fragment-stripped. Returns undefined when the document has no <navMap> at all.
export function readNcxHrefs(ncxXml: string): string[] | undefined {
  const nodes = parseXml(ncxXml);
  const root = rootElement(nodes);
  const navMap =
    root === undefined ? undefined : findChildElement(root.children, "navMap");
  if (navMap === undefined) {
    return undefined;
  }
  return elementsWithTag(navMap.children, "content")
    .map((el) => attrValue(el, "src"))
    .filter((src): src is string => src !== undefined)
    .map(stripFragment);
}

function stripFragment(href: string): string {
  const index = href.indexOf("#");
  return index === -1 ? href : href.slice(0, index);
}
