// usage-calc.ts 纯函数单测：窗口过滤(边界) / 聚合 / 排名(tokens 优先·全0退messages) /
// 成本(子串匹配+default+多模型求和) / 估算(含 >100%)。全部用固定 now，不触碰 Date.now()。
import { describe, it, expect } from "vitest";
import type { Session } from "@/types/session";
import {
  sessionsInWindow,
  aggregateByModel,
  aggregateByProvider,
  topSessions,
  topProjects,
  costUsd,
  estimatePercent,
  WINDOW_5H_MS,
  type RateForModel,
} from "./usage-calc";

// 测试用单价查询：单价来源现由调用方注入（生产走 store/cost.ts）。
// 这里用一套固定的子串匹配价，覆盖成本求和/多模型/回退逻辑，与具体价表解耦。
const rate: RateForModel = (model: string): number => {
  const name = model.toLowerCase();
  if (name.includes("opus")) return 30;
  if (name.includes("sonnet")) return 6;
  if (name.includes("codex")) return 5;
  return 0; // 未知模型回退 0（不臆造）
};

// ── fixture 工厂：只填测试关心的字段，其余给合理默认 ──────────
function mk(partial: Partial<Session>): Session {
  return {
    session_id: partial.session_id ?? "s",
    provider: partial.provider ?? "claude",
    project_path: partial.project_path ?? "/p",
    project_name: partial.project_name ?? "proj",
    first_prompt: "",
    last_prompt: "",
    created_at: partial.created_at ?? "2026-08-13T00:00:00Z",
    updated_at: partial.updated_at ?? "2026-08-13T00:00:00Z",
    message_count: partial.message_count ?? 0,
    user_messages: [],
    total_tokens: partial.total_tokens ?? 0,
    by_model: partial.by_model,
  };
}

// 固定「现在」= 2026-08-13T12:00:00Z
const NOW = Date.parse("2026-08-13T12:00:00Z");

describe("sessionsInWindow", () => {
  it("保留窗口内、剔除窗口外的会话", () => {
    const inside = mk({ session_id: "in", updated_at: "2026-08-13T10:00:00Z" }); // 2h 前
    const old = mk({ session_id: "old", updated_at: "2026-08-13T05:00:00Z" }); // 7h 前
    const res = sessionsInWindow([inside, old], NOW, WINDOW_5H_MS);
    expect(res.map((s) => s.session_id)).toEqual(["in"]);
  });

  it("边界闭合：正好等于窗口起点/终点都算命中", () => {
    const startEdge = mk({
      session_id: "start",
      updated_at: new Date(NOW - WINDOW_5H_MS).toISOString(), // 恰在起点
    });
    const endEdge = mk({
      session_id: "end",
      updated_at: new Date(NOW).toISOString(), // 恰在终点
    });
    const res = sessionsInWindow([startEdge, endEdge], NOW, WINDOW_5H_MS);
    expect(res.map((s) => s.session_id).sort()).toEqual(["end", "start"]);
  });

  it("剔除 updated_at 早于起点 1ms 的会话", () => {
    const justBefore = mk({
      session_id: "before",
      updated_at: new Date(NOW - WINDOW_5H_MS - 1).toISOString(),
    });
    expect(sessionsInWindow([justBefore], NOW, WINDOW_5H_MS)).toEqual([]);
  });

  it("updated_at 无法解析(NaN)视为不命中", () => {
    const bad = mk({ session_id: "bad", updated_at: "not-a-date" });
    expect(sessionsInWindow([bad], NOW, WINDOW_5H_MS)).toEqual([]);
  });
});

describe("aggregateByModel", () => {
  it("合并多会话的 by_model", () => {
    const a = mk({ by_model: { "claude-opus-4": 100, "claude-sonnet-4": 50 } });
    const b = mk({ by_model: { "claude-opus-4": 30 } });
    expect(aggregateByModel([a, b])).toEqual({
      "claude-opus-4": 130,
      "claude-sonnet-4": 50,
    });
  });

  it("跳过无 by_model 的会话", () => {
    const a = mk({ by_model: { x: 10 } });
    const b = mk({ total_tokens: 999 }); // 无 by_model
    expect(aggregateByModel([a, b])).toEqual({ x: 10 });
  });

  it("空数组返回空对象", () => {
    expect(aggregateByModel([])).toEqual({});
  });
});

describe("aggregateByProvider", () => {
  it("按 provider 累加 tokens/messages/sessionCount", () => {
    const s1 = mk({ provider: "claude", total_tokens: 100, message_count: 4 });
    const s2 = mk({ provider: "claude", total_tokens: 50, message_count: 2 });
    const s3 = mk({ provider: "codex", total_tokens: 0, message_count: 9 });
    const res = aggregateByProvider([s1, s2, s3]);
    expect(res.claude).toEqual({ tokens: 150, messages: 6, sessionCount: 2 });
    expect(res.codex).toEqual({ tokens: 0, messages: 9, sessionCount: 1 });
  });
});

describe("costUsd（单价由注入的 rateForModel 提供）", () => {
  it("多模型求和", () => {
    // opus: 1e6 tok × 30/M = 30；sonnet: 0.5e6 × 6/M = 3 → 合计 33
    const cost = costUsd(
      { "claude-opus-4": 1_000_000, "claude-sonnet-4": 500_000 },
      rate,
    );
    expect(cost).toBeCloseTo(33, 6);
  });

  it("空映射为 0", () => {
    expect(costUsd({}, rate)).toBe(0);
  });

  it("未知模型单价为 0 → 不计入成本", () => {
    expect(costUsd({ "unknown-x": 1_000_000 }, rate)).toBe(0);
  });
});

describe("topSessions", () => {
  it("按 tokens 降序，截前 N", () => {
    const a = mk({ session_id: "a", total_tokens: 10 });
    const b = mk({ session_id: "b", total_tokens: 100 });
    const c = mk({ session_id: "c", total_tokens: 50 });
    const res = topSessions([a, b, c], 2, rate);
    expect(res.map((s) => s.session_id)).toEqual(["b", "c"]);
  });

  it("tokens 全 0 时退化按 messages 降序", () => {
    const a = mk({ session_id: "a", total_tokens: 0, message_count: 3 });
    const b = mk({ session_id: "b", total_tokens: 0, message_count: 9 });
    const c = mk({ session_id: "c", total_tokens: 0, message_count: 1 });
    const res = topSessions([a, b, c], 3, rate);
    expect(res.map((s) => s.session_id)).toEqual(["b", "a", "c"]);
  });

  it("主导模型取 by_model 中 token 最大者", () => {
    const s = mk({
      session_id: "s",
      total_tokens: 300,
      by_model: { "claude-sonnet-4": 100, "claude-opus-4": 200 },
    });
    expect(topSessions([s], 1, rate)[0].model).toBe("claude-opus-4");
  });

  it("无 by_model 时主导模型回退 provider，成本按 provider 名查单价", () => {
    const s = mk({ session_id: "s", provider: "codex", total_tokens: 1_000_000 });
    const r = topSessions([s], 1, rate)[0];
    expect(r.model).toBe("codex");
    expect(r.cost).toBeCloseTo(5, 6); // codex 名 → 5/M
  });
});

describe("topProjects", () => {
  it("按 project_path 聚合并按 tokens 排名", () => {
    const p1a = mk({ project_path: "/p1", project_name: "P1", total_tokens: 100 });
    const p1b = mk({ project_path: "/p1", project_name: "P1", total_tokens: 200 });
    const p2 = mk({ project_path: "/p2", project_name: "P2", total_tokens: 250 });
    const res = topProjects([p1a, p1b, p2], 5, rate);
    expect(res.map((p) => p.project_path)).toEqual(["/p1", "/p2"]); // p1=300 > p2=250
    expect(res[0].sessionCount).toBe(2);
    expect(res[0].tokens).toBe(300);
  });

  it("项目级 tokens 全 0 时按 messages 排名", () => {
    const p1 = mk({ project_path: "/p1", total_tokens: 0, message_count: 2 });
    const p2 = mk({ project_path: "/p2", total_tokens: 0, message_count: 8 });
    const res = topProjects([p1, p2], 5, rate);
    expect(res.map((p) => p.project_path)).toEqual(["/p2", "/p1"]);
  });

  it("聚合项目成本 = 成员成本之和", () => {
    const a = mk({ project_path: "/p", by_model: { "claude-opus-4": 1_000_000 } }); // 30
    const b = mk({ project_path: "/p", by_model: { "claude-sonnet-4": 1_000_000 } }); // 6
    expect(topProjects([a, b], 1, rate)[0].cost).toBeCloseTo(36, 6);
  });
});

describe("estimatePercent", () => {
  it("正常百分比", () => {
    expect(estimatePercent(22_000, 44_000)).toBeCloseTo(50, 6);
  });

  it("可超过 100%", () => {
    expect(estimatePercent(88_000, 44_000)).toBeCloseTo(200, 6);
  });

  it("baseline 为 0 或非法返回 0（防除零）", () => {
    expect(estimatePercent(1000, 0)).toBe(0);
    expect(estimatePercent(1000, -5)).toBe(0);
  });
});
