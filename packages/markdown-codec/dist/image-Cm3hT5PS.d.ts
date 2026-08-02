import { n as ImageFormat } from "./image-DescdRgq.js";
//#region src/lower/image.d.ts
interface MarkdownImageResolveContext {
  readonly alt: string;
  readonly title?: string;
}
interface MarkdownResolvedImageBytes {
  readonly bytes: Uint8Array;
}
type MarkdownImageResolver = (destination: string, context: MarkdownImageResolveContext) => MarkdownResolvedImageBytes | undefined;
interface ResolvedMarkdownImage {
  readonly format: ImageFormat;
  readonly base64: string;
  readonly widthPt: number;
  readonly heightPt: number;
}
declare function resolveMarkdownImage(destination: string, context: MarkdownImageResolveContext, resolver: MarkdownImageResolver | undefined): ResolvedMarkdownImage | undefined;
//#endregion
export { resolveMarkdownImage as a, ResolvedMarkdownImage as i, MarkdownImageResolver as n, MarkdownResolvedImageBytes as r, MarkdownImageResolveContext as t };