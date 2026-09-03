// A hand-written reader for the Word Binary File Format ([MS-DOC], .doc) against the shared document-schema.js content pivot. The layers below are exported individually as well as through the top-level read, because a .doc's structures are addressed by offsets a consumer sometimes needs to inspect directly -- and because each one is independently testable against the specification's own field tables, which is how they were built.
export * from "./errors";
export * from "./bytes";
export * from "./plc";
export * from "./detect";
export * from "./fib/offsets";
export * from "./fib/fib";
export * from "./text/piece-table";
export * from "./text/characters";
export * from "./text/special";
export * from "./prop/sprm";
export * from "./prop/fkp";
export * from "./prop/chp";
export * from "./prop/pap";
export * from "./style/stsh";
export * from "./read";
