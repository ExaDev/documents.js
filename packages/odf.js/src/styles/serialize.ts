import type { Attribute, XmlElement } from '../model/node';
import { el } from '../xml/fragment';
import { paragraphPropertiesToAttributes, textPropertiesToAttributes, type StyleProperties } from './properties';

// The canonical, deterministic half of style interning: turning a property bag into real style:*-properties XML (for actually writing a new automatic style) and into a canonical string (for registry.ts's fingerprint-based reuse detection). Both are pure functions of `properties` alone -- same bag in, byte-identical output out, every call -- which is exactly what registry.ts's fingerprinting depends on to tell whether two intern() requests describe identical formatting.

function attributesToRecord(attributes: readonly Attribute[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const attribute of attributes) {
    record[attribute.name] = attribute.value;
  }
  return record;
}

// Builds the <style:paragraph-properties>/<style:text-properties> children a style:style element needs for this property bag. Paragraph-properties is emitted before text-properties, matching both real ODF producer output (see properties.ts's ground-truth note) and the ODF schema's own element sequence for style:style's content model. A half with nothing set is omitted entirely -- an empty <style:text-properties/> is never written -- since real ODF producers never emit an empty properties element either.
export function buildStylePropertyElements(properties: StyleProperties): XmlElement[] {
  const elements: XmlElement[] = [];

  const paragraphAttributes = paragraphPropertiesToAttributes(properties);
  if (paragraphAttributes.length > 0) {
    elements.push(el('style:paragraph-properties', attributesToRecord(paragraphAttributes)));
  }

  const textAttributes = textPropertiesToAttributes(properties);
  if (textAttributes.length > 0) {
    elements.push(el('style:text-properties', attributesToRecord(textAttributes)));
  }

  return elements;
}

// A pure, deterministic string encoding of a property bag's canonical attribute set, built from the exact same fixed-order attribute lists buildStylePropertyElements uses above -- so this string and the XML this module actually writes can never drift apart. Two property bags that are equivalent (same fields, same values) always produce the same string; two that differ in any field always produce a different one, since every entry carries both its attribute name and its value ("name=value"), so a bag that omits a field can never be confused with one that sets it to some coincidentally-matching value. Used exclusively as an input to registry.ts's fingerprint() -- it is not itself a fingerprint (see registry.ts for why style family and parentStyleName are combined with this separately, never folded in here).
export function canonicalPropertiesString(properties: StyleProperties): string {
  const attributes = [...paragraphPropertiesToAttributes(properties), ...textPropertiesToAttributes(properties)];
  return attributes.map((attribute) => `${attribute.name}=${attribute.value}`).join('|');
}
