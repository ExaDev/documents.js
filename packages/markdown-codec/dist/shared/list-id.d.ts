//#region src/shared/list-id.d.ts
interface ListNumIdInfo {
  readonly type: 'bullet' | 'ordered';
  readonly start?: number;
  readonly task: boolean;
  readonly loose: boolean;
}
interface ListNumIdMintOptions {
  readonly type: 'bullet' | 'ordered';
  readonly start?: number;
  readonly task: boolean;
  readonly loose: boolean;
}
interface NumIdMintState {
  next: number;
}
declare function createNumIdMintState(): NumIdMintState;
declare function mintListNumId(state: NumIdMintState, options: ListNumIdMintOptions): string;
declare function parseListNumId(numId: string): ListNumIdInfo | undefined;
declare function mintedListType(numId: string): 'bullet' | 'ordered' | undefined;
//#endregion
export { ListNumIdInfo, ListNumIdMintOptions, NumIdMintState, createNumIdMintState, mintListNumId, mintedListType, parseListNumId };