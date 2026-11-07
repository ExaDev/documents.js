import { describe, expect, it } from "vitest";
import {
  scanXml,
  XmlDoctypeError,
  XmlScanError,
  type XmlScanHandler,
} from "./xml-scan";

interface Recorded {
  readonly events: string[];
}

function record(source: string): Recorded {
  const events: string[] = [];
  const handler: XmlScanHandler = {
    startElement(element) {
      const attributes = element.attributes
        .map(
          (a) =>
            `${a.uri === "" ? "" : `{${a.uri}}`}${a.local}=${JSON.stringify(a.value)}`,
        )
        .join(",");
      events.push(
        `<${element.uri === "" ? "" : `{${element.uri}}`}${element.local}${attributes === "" ? "" : ` ${attributes}`}>`,
      );
    },
    endElement(name) {
      events.push(`</${name.local}>`);
    },
    text(value) {
      events.push(`text:${JSON.stringify(value)}`);
    },
    comment(value) {
      events.push(`comment:${JSON.stringify(value)}`);
    },
    processingInstruction(target, data) {
      events.push(`pi:${target}|${data}`);
    },
  };
  scanXml(source, handler);
  return { events };
}

describe("scanXml names", () => {
  it("resolves prefixed and default namespaces and leaves unprefixed attributes in no namespace", () => {
    const { events } = record(
      '<a:root xmlns:a="urn:a" xmlns="urn:d" a:x="1" y="2"><child/></a:root>',
    );
    expect(events).toEqual([
      '<{urn:a}root {urn:a}x="1",y="2">',
      "<{urn:d}child>",
      "</child>",
      "</root>",
    ]);
  });

  it("reports the same expanded name whatever prefix is used", () => {
    expect(record('<p:t xmlns:p="urn:n"/>').events[0]).toBe(
      record('<q:t xmlns:q="urn:n"/>').events[0],
    );
  });

  it("scopes a declaration to its element and restores the outer binding after it", () => {
    const { events } = record(
      '<r xmlns:p="urn:outer"><p:a xmlns:p="urn:inner"/><p:b/></r>',
    );
    expect(events).toContain("<{urn:inner}a>");
    expect(events).toContain("<{urn:outer}b>");
  });

  it("lets xmlns undeclare the default namespace", () => {
    expect(record('<r xmlns="urn:d"><c xmlns=""/></r>').events).toContain(
      "<c>",
    );
  });

  it("offers the prefixes in scope to the handler", () => {
    let resolved: string | undefined;
    scanXml('<r xmlns:p="urn:p"><c/></r>', {
      startElement(element) {
        if (element.local === "c") {
          resolved = element.namespaceFor("p");
        }
      },
    });
    expect(resolved).toBe("urn:p");
  });
});

describe("scanXml references and normalisation", () => {
  it("decodes the predefined entities and decimal and hexadecimal references in text and attributes", () => {
    const { events } = record(
      '<r a="&lt;&#65;&#x42;&amp;">&gt;&quot;&apos;&#x1F600;</r>',
    );
    expect(events[0]).toBe('<r a="<AB&">');
    expect(events[1]).toBe(`text:${JSON.stringify(">\"'\u{1F600}")}`);
  });

  it("decodes in one pass, so a decoded ampersand never starts another reference", () => {
    expect(record("<r>&amp;#101;</r>").events[1]).toBe('text:"&#101;"');
  });

  it("turns literal tabs and line feeds in attribute values into spaces but keeps referenced ones", () => {
    const { events } = record('<r a="x\ty\nz&#10;w"/>');
    expect(events[0]).toBe('<r a="x y z\\nw">');
  });

  it("normalises CRLF and lone CR to LF", () => {
    expect(record("<r>a\r\nb\rc</r>").events[1]).toBe('text:"a\\nb\\nc"');
  });

  it("raises a CDATA section as text without decoding it", () => {
    expect(record("<r><![CDATA[<&amp;>]]></r>").events[1]).toBe(
      'text:"<&amp;>"',
    );
  });

  it("drops a leading byte order mark and the XML declaration but reports comments and instructions", () => {
    const { events } = record('﻿<?xml version="1.0"?><r><!--c--><?t d e?></r>');
    expect(events).toEqual(["<r>", 'comment:"c"', "pi:t|d e", "</r>"]);
  });

  it("ignores whitespace around the root element", () => {
    expect(record("\n <r/>\n").events).toEqual(["<r>", "</r>"]);
  });
});

describe("scanXml refusals", () => {
  it("refuses a document type declaration, with or without an internal subset", () => {
    expect(() => {
      scanXml("<!DOCTYPE r><r/>", {});
    }).toThrow(XmlDoctypeError);
    expect(() => {
      scanXml('<!DOCTYPE r [<!ENTITY e "x">]><r>&e;</r>', {});
    }).toThrow(XmlDoctypeError);
  });

  it.each([
    ["an undeclared entity", "<r>&nbsp;</r>"],
    ["a character reference outside Char", "<r>&#0;</r>"],
    ["an unterminated reference", "<r>a &amp b</r>"],
    ["a mismatched end tag", "<r><a></b></r>"],
    ["an unclosed element", "<r><a>"],
    ["an unbound element prefix", "<p:r/>"],
    ["an unbound attribute prefix", '<r p:a="1"/>'],
    ["text outside the root", "x<r/>"],
    ["two roots", "<r/><r/>"],
    ["no root", "<!--c-->"],
    ["a duplicate attribute", '<r a="1" a="2"/>'],
    ["a less-than in an attribute value", '<r a="<"/>'],
    ["an unterminated comment", "<r><!-- c</r>"],
    ["an unsupported markup declaration", "<r><!ELEMENT x></r>"],
  ])("refuses %s", (_label, source) => {
    expect(() => {
      scanXml(source, {});
    }).toThrow(XmlScanError);
  });

  it("names the doctype error and the scan error distinctly", () => {
    expect(new XmlDoctypeError("x")).toBeInstanceOf(XmlScanError);
    expect(new XmlDoctypeError("x").name).toBe("XmlDoctypeError");
    expect(new XmlScanError("x").name).toBe("XmlScanError");
  });
});
