import { describe, expect, it } from "vitest";
import { HsqldbSqlParseError, HsqldbSqlUnsupportedError } from "./errors";
import { tokenizeSql } from "./lexer";

describe("tokenizeSql", () => {
  it("folds an unquoted identifier to upper case and keeps a quoted one verbatim", () => {
    expect(tokenizeSql('region "Region"')).toEqual([
      {
        kind: "identifier",
        name: "REGION",
        quoted: false,
        text: "region",
        start: 0,
      },
      {
        kind: "identifier",
        name: "Region",
        quoted: true,
        text: '"Region"',
        start: 7,
      },
      { kind: "end", text: "", start: 15 },
    ]);
  });

  it('splits a qualified name into identifier, ".", identifier -- the parser reassembles it', () => {
    expect(tokenizeSql('"SALES"."REGION"').map((token) => token.kind)).toEqual([
      "identifier",
      "punctuation",
      "identifier",
      "end",
    ]);
  });

  it('reads "" inside a quoted identifier as one embedded double quote', () => {
    const [first] = tokenizeSql('"a""b"');
    expect(first).toEqual({
      kind: "identifier",
      name: 'a"b',
      quoted: true,
      text: '"a""b"',
      start: 0,
    });
  });

  it("reads '' inside a string literal as one embedded single quote", () => {
    const [first] = tokenizeSql("'O''Brien'");
    expect(first).toEqual({
      kind: "string",
      value: "O'Brien",
      text: "'O''Brien'",
      start: 0,
    });
  });

  it("reads integer, decimal, leading-dot and exponent numeric literals", () => {
    expect(
      tokenizeSql("1 2.5 .75 1e3 2E-2").flatMap((token) =>
        token.kind === "number" ? [token.value] : [],
      ),
    ).toEqual([1, 2.5, 0.75, 1000, 0.02]);
  });

  it('stops a numeric literal before an "E" that has no exponent digits after it', () => {
    expect(tokenizeSql("1E").map((token) => token.text)).toEqual([
      "1",
      "E",
      "",
    ]);
  });

  it("lexes every comparison operator this grammar has, longest match first", () => {
    expect(
      tokenizeSql("= <> < > <= >=").flatMap((token) =>
        token.kind === "operator" ? [token.operator] : [],
      ),
    ).toEqual(["=", "<>", "<", ">", "<=", ">="]);
  });

  it("recognises a keyword case-insensitively, and only when unquoted", () => {
    const [keyword, identifier] = tokenizeSql('select "SELECT"');
    expect(keyword).toMatchObject({ kind: "keyword", keyword: "SELECT" });
    expect(identifier).toMatchObject({
      kind: "identifier",
      name: "SELECT",
      quoted: true,
    });
  });

  it("always terminates the stream with exactly one end token", () => {
    const tokens = tokenizeSql("SELECT * FROM T");
    expect(tokens.filter((token) => token.kind === "end")).toHaveLength(1);
    expect(tokens[tokens.length - 1]).toMatchObject({ kind: "end" });
  });

  it.each([
    ["-- a comment", "a SQL line comment"],
    ["/* a comment */", "a SQL block comment"],
    ["'a' || 'b'", "the || string-concatenation operator"],
    ["A != 1", "the != operator (write <> instead)"],
    ["A + 1", "an arithmetic expression"],
    ["A / 1", "an arithmetic expression"],
    ["A % 1", "an arithmetic expression"],
    ["A = ?", "a parameter placeholder"],
    ["A = :name", "a named parameter"],
    ["A & 1", "a bitwise operator"],
  ])("names the construct it is refusing for %s", (sql, construct) => {
    expect(() => tokenizeSql(sql)).toThrow(HsqldbSqlUnsupportedError);
    expect(() => tokenizeSql(sql)).toThrow(construct);
  });

  it('passes "-" through for the parser to resolve, since it is genuinely a literal sign as well as an operator', () => {
    expect(tokenizeSql("-1").map((token) => token.text)).toEqual([
      "-",
      "1",
      "",
    ]);
  });

  it.each([
    ["'unterminated", "unterminated string literal"],
    ['"unterminated', "unterminated quoted identifier"],
    ['""', "empty quoted identifier"],
    ["£", "unexpected character"],
  ])("throws a parse error for %s", (sql, message) => {
    expect(() => tokenizeSql(sql)).toThrow(HsqldbSqlParseError);
    expect(() => tokenizeSql(sql)).toThrow(message);
  });
});
