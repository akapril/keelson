import { describe, it, expect } from "vitest";
import { substituteVars } from "./substitute";

const NOW = new Date(2026, 6, 22, 9, 5); // 2026-07-22 09:05（本地）

describe("substituteVars", () => {
  it("替换 project / repo_path", () => {
    const out = substituteVars(
      "在 {{project}}（{{repo_path}}）里做 X",
      { project: "rework", repoPath: "D:/workspace/rework" },
      NOW,
    );
    expect(out).toBe("在 rework（D:/workspace/rework）里做 X");
  });

  it("date / time（本地格式）", () => {
    expect(substituteVars("{{date}} {{time}}", {}, NOW)).toBe("2026-07-22 09:05");
  });

  it("缺失上下文 → 空串", () => {
    expect(substituteVars("[{{project}}]", {}, NOW)).toBe("[]");
  });

  it("未知变量原样保留", () => {
    expect(substituteVars("{{unknown}} {{project}}", { project: "p" }, NOW)).toBe(
      "{{unknown}} p",
    );
  });

  it("容忍花括号内空白", () => {
    expect(substituteVars("{{  project  }}", { project: "p" }, NOW)).toBe("p");
  });
});
