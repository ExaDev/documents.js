import { describe, expect, it } from "vitest";
import {
  affectedMutationPackages,
  planShards,
  shardMatrix,
} from "./compute-mutation-shards";

describe("affectedMutationPackages", () => {
  it("extracts only the _test:mutation task's own packages from a turbo dry-run plan", () => {
    const plan = JSON.stringify({
      tasks: [
        {
          task: "_build",
          package: "byte-codec",
          directory: "packages/byte-codec",
        },
        {
          task: "_test:mutation",
          package: "byte-codec",
          directory: "packages/byte-codec",
        },
        {
          task: "_test:mutation",
          package: "doc-codec",
          directory: "packages/doc-codec",
        },
      ],
    });
    expect(affectedMutationPackages(plan)).toEqual([
      { name: "byte-codec", directory: "packages/byte-codec" },
      { name: "doc-codec", directory: "packages/doc-codec" },
    ]);
  });

  it("returns an empty list when nothing is affected", () => {
    expect(affectedMutationPackages(JSON.stringify({ tasks: [] }))).toEqual([]);
  });
});

describe("planShards", () => {
  it("returns nothing for an empty weight map", () => {
    expect(planShards(new Map(), 8)).toEqual([]);
  });

  it("never creates more shards than packages, even when maxShards is larger", () => {
    const weights = new Map([
      ["a", 100],
      ["b", 50],
    ]);
    expect(planShards(weights, 8)).toHaveLength(2);
  });

  it("bounds shard count at maxShards regardless of how many packages there are", () => {
    const weights = new Map(
      Array.from({ length: 20 }, (_, i) => [`pkg-${String(i)}`, 10]),
    );
    expect(planShards(weights, 8)).toHaveLength(8);
  });

  it("strands the single largest package alone under round-robin but balances it here", () => {
    // The exact scenario the top-of-file note names: one package an order of magnitude larger than the rest. A naive `index % shardCount` assignment puts the giant on its own shard with 3 small packages on the other -- this packs the giant alone precisely because doing so keeps both shards' totals as close as LPT bin-packing can get them.
    const weights = new Map([
      ["giant", 1000],
      ["small-a", 10],
      ["small-b", 10],
      ["small-c", 10],
    ]);
    const shards = planShards(weights, 2);
    expect(shards).toHaveLength(2);
    const giantShard = shards.find((shard) => shard.includes("giant"));
    expect(giantShard).toEqual(["giant"]);
    const otherShard = shards.find((shard) => !shard.includes("giant"));
    expect(otherShard).toEqual(
      expect.arrayContaining(["small-a", "small-b", "small-c"]),
    );
  });

  it("balances near-equal weights roughly evenly across shards", () => {
    const weights = new Map([
      ["a", 100],
      ["b", 100],
      ["c", 100],
      ["d", 100],
    ]);
    const shards = planShards(weights, 2);
    expect(shards).toHaveLength(2);
    expect(shards[0]).toHaveLength(2);
    expect(shards[1]).toHaveLength(2);
  });

  it("assigns every package exactly once", () => {
    const weights = new Map([
      ["a", 7],
      ["b", 3],
      ["c", 9],
      ["d", 1],
      ["e", 5],
    ]);
    const shards = planShards(weights, 3);
    const allAssigned = shards.flat();
    expect(allAssigned.sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("shardMatrix", () => {
  it("joins each shard's packages into a space-separated string, indexed from zero", () => {
    expect(shardMatrix([["a", "b"], ["c"]])).toEqual([
      { index: 0, packages: "a b" },
      { index: 1, packages: "c" },
    ]);
  });

  it("returns an empty array for no shards", () => {
    expect(shardMatrix([])).toEqual([]);
  });
});
