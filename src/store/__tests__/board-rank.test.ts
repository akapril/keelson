import { describe, it, expect } from "vitest";
import { nextRank, rankBetween, normalizeSortOrders } from "../board-rank";

describe("rank", () => {
  it("nextRank", () => {
    expect(nextRank(null)).toBe(1024);
    expect(nextRank(1024)).toBe(2048);
  });
  it("rankBetween", () => {
    expect(rankBetween(1024, 2048)).toBe(1536);
    expect(rankBetween(1024, undefined)).toBe(2048);
    expect(rankBetween(undefined, 2048)).toBe(1024);
    expect(rankBetween(undefined, undefined)).toBe(1024);
  });
  it("normalizeSortOrders", () => {
    expect(normalizeSortOrders(3)).toEqual([1024, 2048, 3072]);
  });
});
