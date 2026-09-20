import { describe, expect, it } from "vitest";
import { applyGfmAutolinks } from "./gfm-autolink";
import { InlineNode, createTextNode } from "./node";

function childrenOf(node: InlineNode): InlineNode[] {
  const out: InlineNode[] = [];
  for (let child = node.firstChild; child !== undefined; child = child.next) {
    out.push(child);
  }
  return out;
}

// A flat rendering that keeps every node visible, an empty text node included, so a spurious extra node shows up in the comparison rather than being absorbed into the text around it.
function describeNode(node: InlineNode): string {
  if (node.kind === "text") {
    return `text(${node.literal})`;
  }
  const inner = childrenOf(node).map(describeNode).join("");
  if (node.kind === "link") {
    return `link[${node.destination}](${inner})`;
  }
  return `${node.kind}(${inner})`;
}

function describeChildren(root: InlineNode): string {
  return childrenOf(root).map(describeNode).join("");
}

// The synthetic container a parsed inline run lives in, holding the single text node the extension walks.
function expand(literal: string): string {
  const root = new InlineNode("container");
  root.appendChild(createTextNode(literal));
  applyGfmAutolinks(root);
  return describeChildren(root);
}

describe("applyGfmAutolinks www and scheme prefixes", () => {
  it("links a bare www. address, prepending http:// to the destination only", () => {
    expect(expand("www.example.com")).toBe(
      "link[http://www.example.com](text(www.example.com))",
    );
  });

  it.each([
    "http://b.example.com",
    "https://b.example.com",
    "ftp://b.example.com",
  ])(
    "links %s by its own scheme, leaving the destination as written",
    (url) => {
      expect(expand(url)).toBe(`link[${url}](text(${url}))`);
    },
  );

  it("matches a prefix regardless of its case, keeping the source spelling in both text and destination", () => {
    expect(expand("WWW.example.com")).toBe(
      "link[http://WWW.example.com](text(WWW.example.com))",
    );
  });

  it("expands every autolink in one text node, keeping the text between them", () => {
    expect(expand("see www.a.com and http://b.com now")).toBe(
      "text(see )link[http://www.a.com](text(www.a.com))text( and )link[http://b.com](text(http://b.com))text( now)",
    );
  });
});

describe("applyGfmAutolinks start boundaries", () => {
  it("does not link an address that follows an ordinary letter", () => {
    expect(expand("xwww.example.com")).toBe("text(xwww.example.com)");
  });

  it.each([
    ["a space", " "],
    ["a tab", "\t"],
    ["a line feed", "\n"],
    ["a carriage return", "\r"],
    ["a form feed", "\f"],
  ])("starts an autolink after %s", (_name, whitespace) => {
    expect(expand(`a${whitespace}www.example.com`)).toBe(
      `text(a${whitespace})link[http://www.example.com](text(www.example.com))`,
    );
  });
});

describe("applyGfmAutolinks candidate extent", () => {
  it("ends the candidate at the first whitespace, leaving the rest as text", () => {
    expect(expand("www.example.com rest")).toBe(
      "link[http://www.example.com](text(www.example.com))text( rest)",
    );
  });

  it("ends the candidate at a `<`, leaving the rest as text", () => {
    expect(expand("www.example.com<b>")).toBe(
      "link[http://www.example.com](text(www.example.com))text(<b>)",
    );
  });

  it("drops trailing punctuation from the link and leaves it as text", () => {
    expect(expand("www.example.com.")).toBe(
      "link[http://www.example.com](text(www.example.com))text(.)",
    );
  });

  it("drops a character reference's own tail once the punctuation after it has gone", () => {
    // The trailing '.' goes first, which is what exposes the '&amp;' the entity rule then strips; trimming only the untrimmed candidate would leave the reference in the link.
    expect(expand("http://example.com/?a=1&amp;. rest")).toBe(
      "link[http://example.com/?a=1](text(http://example.com/?a=1))text(&amp;. rest)",
    );
  });
});

describe("applyGfmAutolinks domain validity", () => {
  it("rejects a domain whose segment holds a character outside the allowed set", () => {
    expect(expand("www.ex+ample.com")).toBe("text(www.ex+ample.com)");
  });

  it("rejects a domain with an underscore in one of its last two segments", () => {
    expect(expand("www.exa_mple.com")).toBe("text(www.exa_mple.com)");
  });

  it("rejects a domain with an underscore in the second of its last two segments", () => {
    expect(expand("www.a.b_c.d")).toBe("text(www.a.b_c.d)");
  });

  it("accepts an underscore in a segment before the last two", () => {
    expect(expand("www.foo_bar.example.com")).toBe(
      "link[http://www.foo_bar.example.com](text(www.foo_bar.example.com))",
    );
  });

  it("rejects a scheme-prefixed URL whose domain has no period at all", () => {
    expect(expand("http://example")).toBe("text(http://example)");
  });
});

describe("applyGfmAutolinks protocol prefixes", () => {
  it("links a mailto: address without requiring the part after the prefix to be a domain", () => {
    expect(expand("mailto:foo@example.com")).toBe(
      "link[mailto:foo@example.com](text(mailto:foo@example.com))",
    );
  });

  it("links an xmpp: address the same way", () => {
    expect(expand("xmpp:foo@example.com")).toBe(
      "link[xmpp:foo@example.com](text(xmpp:foo@example.com))",
    );
  });

  it("does not link a bare prefix whose only trailing character is trimmed away", () => {
    expect(expand("mailto:")).toBe("text(mailto:)");
  });
});

describe("applyGfmAutolinks bare email addresses", () => {
  it("links a bare address, resolving it to a mailto: destination", () => {
    expect(expand("foo@example.com")).toBe(
      "link[mailto:foo@example.com](text(foo@example.com))",
    );
  });

  it("does not link an address with no local part at all", () => {
    expect(expand("@example.com")).toBe("text(@example.com)");
  });

  it("does not link an address whose local part follows an invalid preceding character", () => {
    expect(expand("a=foo@example.com")).toBe("text(a=foo@example.com)");
  });

  it("does not link an address whose local part starts with a period", () => {
    expect(expand(".foo@example.com")).toBe("text(.foo@example.com)");
  });

  it("does not link an address whose local part ends with a period", () => {
    expect(expand("foo.@example.com")).toBe("text(foo.@example.com)");
  });

  it("drops every trailing period from the domain, not just the last one", () => {
    expect(expand("foo@example.com.. rest")).toBe(
      "link[mailto:foo@example.com](text(foo@example.com))text(.. rest)",
    );
  });

  it("does not link a domain ending in a hyphen", () => {
    expect(expand("foo@example.com-")).toBe("text(foo@example.com-)");
  });

  it("does not take a second @ as a further address when the first one ends the local part it would need", () => {
    expect(expand("a@b.com@c.com")).toBe(
      "link[mailto:a@b.com](text(a@b.com))text(@c.com)",
    );
  });
});

describe("applyGfmAutolinks tree walking", () => {
  it("leaves a text node holding no autolink in place rather than replacing it", () => {
    const root = new InlineNode("container");
    const text = createTextNode("plain text with no link");
    root.appendChild(text);
    applyGfmAutolinks(root);
    expect(root.firstChild).toBe(text);
    expect(text.next).toBeUndefined();
  });

  it("expands an autolink inside a nested node that is not opaque", () => {
    const root = new InlineNode("container");
    const emphasis = new InlineNode("emphasis");
    emphasis.appendChild(createTextNode("www.example.com"));
    root.appendChild(emphasis);
    applyGfmAutolinks(root);
    expect(describeChildren(root)).toBe(
      "emphasis(link[http://www.example.com](text(www.example.com)))",
    );
  });

  it("does not descend into an existing link", () => {
    const root = new InlineNode("container");
    const link = new InlineNode("link");
    link.destination = "http://outer.example";
    link.appendChild(createTextNode("www.inner.example.com"));
    root.appendChild(link);
    applyGfmAutolinks(root);
    expect(describeChildren(root)).toBe(
      "link[http://outer.example](text(www.inner.example.com))",
    );
  });
});
