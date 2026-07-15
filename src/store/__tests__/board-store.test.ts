import { describe, it, expect } from "vitest";
import { groupTasksByState } from "../board";
import type { BoardTask } from "../../types/board";

const t = (id: string, state: string): BoardTask =>
  ({
    id,
    state,
    project: "p",
    title: id,
    priority: "none",
    created_by: "u",
    created: "",
    updated: "",
  } as BoardTask);

describe("groupTasksByState", () => {
  it("groups by state id", () => {
    const g = groupTasksByState([t("a", "s1"), t("b", "s2"), t("c", "s1")]);
    expect(g["s1"].map((x) => x.id)).toEqual(["a", "c"]);
    expect(g["s2"].map((x) => x.id)).toEqual(["b"]);
  });
});
