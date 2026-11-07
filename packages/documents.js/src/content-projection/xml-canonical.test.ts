import { describe, expect, it } from "vitest";
import { canonicalizeXml } from "./xml-canonical";
import { XmlDoctypeError } from "./xml-scan";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const canon = (source: string): string => canonicalizeXml(source).canonical;

describe("canonicalizeXml removes lexical difference", () => {
  const reference = `<w:p xmlns:w="${W}" w:b="1" w:a="2"><w:t>A &amp; B</w:t><w:br/></w:p>`;

  it.each([
    [
      "attribute order",
      `<w:p xmlns:w="${W}" w:a="2" w:b="1"><w:t>A &amp; B</w:t><w:br/></w:p>`,
    ],
    [
      "quote style",
      `<w:p xmlns:w='${W}' w:b='1' w:a='2'><w:t>A &amp; B</w:t><w:br/></w:p>`,
    ],
    [
      "whitespace inside tags",
      `<w:p   xmlns:w="${W}"\n  w:b = "1"\tw:a="2" ><w:t >A &amp; B</w:t ><w:br /></w:p >`,
    ],
    [
      "empty element form",
      `<w:p xmlns:w="${W}" w:b="1" w:a="2"><w:t>A &amp; B</w:t><w:br></w:br></w:p>`,
    ],
    [
      "a prefix rename",
      `<x:p xmlns:x="${W}" x:b="1" x:a="2"><x:t>A &amp; B</x:t><x:br/></x:p>`,
    ],
    [
      "a default namespace for elements",
      `<p xmlns="${W}" xmlns:w="${W}" w:b="1" w:a="2"><t>A &amp; B</t><br/></p>`,
    ],
    [
      "the declaration and a byte order mark",
      `\uFEFF<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${reference}`,
    ],
    [
      "numeric and hexadecimal character references",
      `<w:p xmlns:w="${W}" w:b="&#49;" w:a="&#x32;"><w:t>&#65; &#x26; B</w:t><w:br/></w:p>`,
    ],
    [
      "a CDATA section",
      `<w:p xmlns:w="${W}" w:b="1" w:a="2"><w:t><![CDATA[A & B]]></w:t><w:br/></w:p>`,
    ],
  ])("%s", (_label, variant) => {
    expect(canon(variant)).toBe(canon(reference));
  });

  it("agrees across a namespace declared on an ancestor and the same one declared on the element", () => {
    expect(canon(`<root xmlns:w="${W}"><w:p w:b="1"/></root>`)).toBe(
      canon(`<root><w:p xmlns:w="${W}" w:b="1"/></root>`),
    );
  });

  it("agrees across CRLF, lone CR and LF line ends", () => {
    expect(canon("<r>a\r\nb\rc</r>")).toBe(canon("<r>a\nb\nc</r>"));
  });

  it("merges adjacent text and CDATA into one run", () => {
    expect(canon("<r>ab<![CDATA[cd]]>ef</r>")).toBe(canon("<r>abcdef</r>"));
  });

  it("keeps a literal carriage return distinct from a line feed once referenced", () => {
    expect(canon("<r>a&#13;b</r>")).not.toBe(canon("<r>a\nb</r>"));
  });

  it("treats the Markup Compatibility prefix lists as sets of namespaces, whatever their prefixes and order", () => {
    const one = `<r xmlns:mc="${MC}" xmlns:p="urn:p" xmlns:q="urn:q" mc:Ignorable="p q"/>`;
    const two = `<r xmlns:m="${MC}" xmlns:x="urn:q" xmlns:y="urn:p" m:Ignorable="x y"/>`;
    expect(canon(one)).toBe(canon(two));
  });
});

describe("canonicalizeXml keeps every real difference", () => {
  it.each([
    ["a different attribute value", '<r a="1"/>', '<r a="2"/>'],
    ["different text", "<r>one</r>", "<r>two</r>"],
    ["whitespace-only text", "<r><a/> <b/></r>", "<r><a/><b/></r>"],
    ["child order", "<r><a/><b/></r>", "<r><b/><a/></r>"],
    ["comment text", "<r><!--x--></r>", "<r><!--y--></r>"],
    ["a different namespace", '<r xmlns="urn:a"/>', '<r xmlns="urn:b"/>'],
    [
      "a prefix inside an ordinary attribute value",
      '<r a="p:x"/>',
      '<r a="q:x"/>',
    ],
    ["an extra element", "<r><a/></r>", "<r><a/><a/></r>"],
    ["a processing instruction", "<r><?t a?></r>", "<r><?t b?></r>"],
  ])("%s", (_label, left, right) => {
    expect(canon(left)).not.toBe(canon(right));
  });
});

describe("canonicalizeXml identifier-free form", () => {
  it("treats a difference confined to identifiers as an identifier difference", () => {
    const left = canonicalizeXml(
      `<w:p xmlns:w="${W}" w:rsidR="00A1" w:paraId="1F2E"><w:t>x</w:t></w:p>`,
    );
    const right = canonicalizeXml(
      `<w:p xmlns:w="${W}" w:rsidR="00B2" w:paraId="9ABC"><w:t>x</w:t></w:p>`,
    );
    expect(left.canonical).not.toBe(right.canonical);
    expect(left.identifierFree).toBe(right.identifierFree);
  });

  it("covers relationship identifiers and generic id attributes", () => {
    const left = canonicalizeXml('<r id="1" Id="a"><e uid="x"/></r>');
    const right = canonicalizeXml('<r id="2" Id="b"><e uid="y"/></r>');
    expect(left.identifierFree).toBe(right.identifierFree);
  });

  it("does not hide a content difference", () => {
    const left = canonicalizeXml(
      `<w:p xmlns:w="${W}" w:rsidR="1"><w:t>x</w:t></w:p>`,
    );
    const right = canonicalizeXml(
      `<w:p xmlns:w="${W}" w:rsidR="2"><w:t>y</w:t></w:p>`,
    );
    expect(left.identifierFree).not.toBe(right.identifierFree);
  });

  it("does not hide a difference in a non-identifier attribute", () => {
    const left = canonicalizeXml('<r id="1" val="a"/>');
    const right = canonicalizeXml('<r id="2" val="b"/>');
    expect(left.identifierFree).not.toBe(right.identifierFree);
  });
});

describe("canonicalizeXml refusals", () => {
  it("fails loudly on a document type declaration instead of dropping it", () => {
    expect(() =>
      canonicalizeXml('<!DOCTYPE r [<!ENTITY e "x">]><r>&e;</r>'),
    ).toThrow(XmlDoctypeError);
  });
});
