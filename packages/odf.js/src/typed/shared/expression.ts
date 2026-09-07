// Balanced-paren/brace/quote-aware expression extraction, shared by every ODF mini-language reader in this package that needs to split a formula-shaped attribute string at an unnested delimiter: table:condition (typed/ods/data-validation.ts, transcribed from XMLConverter.cxx's own lclSkipExpression/lclSkipExpressionString and getExpression) and calcext:condition's own value mini-language (typed/ods/conditional-format.ts, transcribed from ScXMLConditionHelper::getExpression) both need the identical algorithm -- a comma or closing paren inside a nested `(...)`/`{...}` or a quoted string must not end the expression -- for two structurally similar but textually distinct LibreOffice source functions. Extracted here once both readers needed it, rather than duplicated.

// Skips one formula expression starting at `start`, honouring nested parentheses/braces and quoted strings. Returns the index of the first unnested occurrence of `endChar`, or `text.length` if the expression runs to the end unterminated.
export function skipExpression(
  text: string,
  start: number,
  endChar: string,
): number {
  let index = start;
  while (index < text.length) {
    const ch = text[index];
    if (ch === endChar) {
      return index;
    }
    if (ch === "(") {
      index = skipExpression(text, index + 1, ")") + 1;
      continue;
    }
    if (ch === "{") {
      index = skipExpression(text, index + 1, "}") + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const closeQuote = text.indexOf(ch, index + 1);
      index = (closeQuote === -1 ? text.length : closeQuote) + 1;
      continue;
    }
    index += 1;
  }
  return text.length;
}

// Extracts and trims one expression, advancing past its own terminator. Returns undefined (never an empty string) when the expression is empty, matching both source functions' own "empty means failure" contract for an operand.
export function takeExpression(
  text: string,
  start: number,
  endChar: string,
): { value: string | undefined; nextIndex: number } {
  const endIndex = skipExpression(text, start, endChar);
  const raw = text.slice(start, endIndex).trim();
  return {
    value: raw.length > 0 ? raw : undefined,
    nextIndex: endIndex + 1,
  };
}
