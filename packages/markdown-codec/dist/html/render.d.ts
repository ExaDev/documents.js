import { g as MarkdownInlineNode, s as MarkdownDocumentNode } from "../ast-DbjiuYr8.js";
//#region src/html/render.d.ts
declare function escapeHtml(text: string): string;
declare function escapeHref(href: string): string;
declare function renderInlines(nodes: readonly MarkdownInlineNode[]): string;
declare function renderDocumentToHtml(document: MarkdownDocumentNode): string;
//#endregion
export { escapeHref, escapeHtml, renderDocumentToHtml, renderInlines };