import { describe, it, expect } from "vitest";
import { isTombstoned } from "./tombstone";

describe("isTombstoned", () => {
  it("deleted_at 非空 → true", () => {
    expect(isTombstoned({ deleted_at: "2026-08-05T00:00:00Z" })).toBe(true);
  });
  it("deleted_at 空串/缺省 → false", () => {
    expect(isTombstoned({ deleted_at: "" })).toBe(false);
    expect(isTombstoned({})).toBe(false);
  });
});
