//#region src/inline/entity.d.ts
interface EntityMatch {
  readonly raw: string;
  readonly value: string;
}
declare function matchEntity(text: string, start: number): EntityMatch | undefined;
declare function unescapeString(text: string): string;
//#endregion
export { EntityMatch, matchEntity, unescapeString };