import { describe, it, expect } from "vitest";
import { selectPinnedProjects } from "../board";
import type { BoardProject } from "../../types/board";

const p = (id: string, pinned?: boolean, pin_rank?: number): BoardProject =>
  ({
    id,
    owner: "u",
    name: id,
    created: "",
    updated: "",
    pinned,
    pin_rank,
  } as BoardProject);

describe("selectPinnedProjects", () => {
  it("只取 pinned，按 pin_rank 升序", () => {
    const out = selectPinnedProjects([
      p("a", true, 2048),
      p("b", false, 100),
      p("c", true, 1024),
      p("d"),
    ]);
    expect(out.map((x) => x.id)).toEqual(["c", "a"]);
  });

  it("无收藏返回空数组", () => {
    expect(selectPinnedProjects([p("a"), p("b", false)])).toEqual([]);
  });
});
