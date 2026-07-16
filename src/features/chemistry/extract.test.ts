import { describe, it, expect } from "vitest";
import { parseCandidates, buildContext } from "./extract";
import type { TimelineMessage } from "@/types/session";

describe("parseCandidates", () => {
  it("解析纯 JSON", () => {
    const r = parseCandidates(
      '{"tasks":[{"title":"修复登录","priority":"high"}],"docs":[{"title":"方案","content":"# x"}]}',
    );
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0].priority).toBe("high");
    expect(r.docs[0].title).toBe("方案");
  });
  it("去除 ```json 围栏并解析", () => {
    const r = parseCandidates('```json\n{"tasks":[{"title":"a"}],"docs":[]}\n```');
    expect(r.tasks[0].title).toBe("a");
    expect(r.tasks[0].priority).toBe("none"); // 缺省优先级归一为 none
  });
  it("非法优先级归一为 none；无 title 的项被丢弃", () => {
    const r = parseCandidates(
      '{"tasks":[{"title":"a","priority":"WTF"},{"description":"无标题"}],"docs":[]}',
    );
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0].priority).toBe("none");
  });
  it("解析失败返回空", () => {
    expect(parseCandidates("这不是 JSON")).toEqual({ tasks: [], docs: [] });
    expect(parseCandidates("")).toEqual({ tasks: [], docs: [] });
  });
});

describe("buildContext", () => {
  it("仅拼接 user/assistant 并带角色前缀", () => {
    const tl: TimelineMessage[] = [
      { role: "system", content: "sys", timestamp: "" },
      { role: "user", content: "问题", timestamp: "" },
      { role: "assistant", content: "回答", timestamp: "" },
    ];
    const ctx = buildContext(tl);
    expect(ctx).toContain("用户：问题");
    expect(ctx).toContain("助手：回答");
    expect(ctx).not.toContain("sys");
  });
});
