import { describe, it, expect } from "vitest";
import { parseQuickLog } from "./quick-log";
import type { BoardProject } from "@/types/board";

// 最小项目桩：只需 id/name（parseQuickLog 只读这两字段）
const P = (id: string, name: string) => ({ id, name }) as BoardProject;
const projects = [P("p1", "Keelson"), P("p2", "Vidpod"), P("p3", "Ke")];

describe("parseQuickLog", () => {
  it("无 @ 标记：原样返回、不关联", () => {
    expect(parseQuickLog("修了登录 bug", projects)).toEqual({
      title: "修了登录 bug",
      project: "",
    });
  });

  it("@项目名 完全匹配：关联并剥离 token（不分大小写）", () => {
    expect(parseQuickLog("修了登录 bug @keelson", projects)).toEqual({
      title: "修了登录 bug",
      project: "p1",
    });
  });

  it("前缀匹配取最短名：@Ke → 'Ke' 而非 'Keelson'", () => {
    expect(parseQuickLog("写文档 @Ke", projects)).toEqual({
      title: "写文档",
      project: "p3",
    });
  });

  it("未匹配到项目：保留原文含 @，不乱关联", () => {
    expect(parseQuickLog("聊天 @unknown", projects)).toEqual({
      title: "聊天 @unknown",
      project: "",
    });
  });

  it("剥离后标题为空：回退用项目名当标题", () => {
    expect(parseQuickLog("@Vidpod", projects)).toEqual({
      title: "Vidpod",
      project: "p2",
    });
  });
});
