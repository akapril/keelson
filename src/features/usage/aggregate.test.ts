import { describe, it, expect } from "vitest";
import { dayKey, estimateCost, aggregateUsage } from "./aggregate";
import type { Session } from "@/types/session";

function s(partial: Partial<Session>): Session {
  return {
    session_id: "x", provider: "claude", project_path: "/p", project_name: "p",
    first_prompt: "", last_prompt: "", created_at: "2026-07-10T08:00:00Z",
    updated_at: "2026-07-10T08:00:00Z", message_count: 1, user_messages: [],
    total_tokens: 0, ...partial,
  };
}

describe("dayKey", () => {
  it("提取 RFC3339 的日期部分（UTC）", () => {
    expect(dayKey("2026-07-10T23:59:00Z")).toBe("2026-07-10");
  });
});

describe("estimateCost", () => {
  it("按每百万 token 单价计算成本", () => {
    expect(estimateCost(1_000_000, 3)).toBeCloseTo(3);
    expect(estimateCost(500_000, 3)).toBeCloseTo(1.5);
    expect(estimateCost(0, 3)).toBe(0);
  });
});

describe("aggregateUsage", () => {
  const rates = { claude: 3, codex: 2 };

  it("汇总总会话数、总 token 与总成本", () => {
    const out = aggregateUsage(
      [
        s({ session_id: "a", provider: "claude", total_tokens: 1_000_000 }),
        s({ session_id: "b", provider: "codex", total_tokens: 500_000 }),
      ],
      rates,
      365,
    );
    expect(out.totalSessions).toBe(2);
    expect(out.totalTokens).toBe(1_500_000);
    expect(out.totalCost).toBeCloseTo(3 + 1); // claude 3 + codex 1
  });

  it("按 provider 分组统计并按 token 降序", () => {
    const out = aggregateUsage(
      [
        s({ session_id: "a", provider: "codex", total_tokens: 100 }),
        s({ session_id: "b", provider: "claude", total_tokens: 900 }),
        s({ session_id: "c", provider: "claude", total_tokens: 100 }),
      ],
      rates,
      365,
    );
    expect(out.byProvider[0].provider).toBe("claude");
    expect(out.byProvider[0].sessions).toBe(2);
    expect(out.byProvider[0].tokens).toBe(1000);
  });

  it("按天聚合 token，日期升序", () => {
    const out = aggregateUsage(
      [
        s({ session_id: "a", created_at: "2026-07-10T08:00:00Z", total_tokens: 100 }),
        s({ session_id: "b", created_at: "2026-07-10T20:00:00Z", total_tokens: 50 }),
        s({ session_id: "c", created_at: "2026-07-12T08:00:00Z", total_tokens: 30 }),
      ],
      rates,
      365,
    );
    expect(out.daily[0]).toEqual({ date: "2026-07-10", tokens: 150 });
    expect(out.daily[out.daily.length - 1]).toEqual({ date: "2026-07-12", tokens: 30 });
  });

  it("按项目分组统计并按 token 降序（同名不同路径不合并）", () => {
    const out = aggregateUsage(
      [
        s({ session_id: "a", project_path: "/p/a", project_name: "a", total_tokens: 200 }),
        s({ session_id: "b", project_path: "/p/b", project_name: "b", total_tokens: 900 }),
        s({ session_id: "c", project_path: "/p/a", project_name: "a", total_tokens: 100 }),
      ],
      rates,
      365,
    );
    expect(out.byProject[0].project_path).toBe("/p/b"); // 900 在前
    expect(out.byProject[1].project_path).toBe("/p/a");
    expect(out.byProject[1].sessions).toBe(2);
    expect(out.byProject[1].tokens).toBe(300);
  });

  it("按模型分组：模型单价优先、缺省回退 provider、无 by_model 回退、恒等式成立", () => {
    const out = aggregateUsage(
      [
        s({
          session_id: "a",
          provider: "claude",
          total_tokens: 1_000_000,
          by_model: { "claude-opus-4-8": 600_000, "claude-sonnet-4-6": 400_000 },
        }),
        s({ session_id: "b", provider: "codex", total_tokens: 500_000 }), // 无 by_model → 回退 {codex: 500000}
      ],
      { claude: 3, codex: 2 },
      365,
      { "claude-opus-4-8": 15 }, // 仅 opus 配了模型单价
    );
    const opus = out.byModel.find((m) => m.model === "claude-opus-4-8")!;
    expect(opus.tokens).toBe(600_000);
    expect(opus.cost).toBeCloseTo((600_000 / 1e6) * 15); // 模型单价 15
    const sonnet = out.byModel.find((m) => m.model === "claude-sonnet-4-6")!;
    expect(sonnet.cost).toBeCloseTo((400_000 / 1e6) * 3); // 回退 provider claude=3
    const codexM = out.byModel.find((m) => m.model === "codex")!;
    expect(codexM.tokens).toBe(500_000); // 无 by_model 回退到 {provider: 总token}
    // 恒等式：byModel 总 token == 总 token
    expect(out.byModel.reduce((n, m) => n + m.tokens, 0)).toBe(out.totalTokens);
  });

  it("未配置单价的 provider 成本按 0 计", () => {
    const out = aggregateUsage(
      [s({ provider: "unknown", total_tokens: 1_000_000 })],
      rates,
      365,
    );
    expect(out.totalCost).toBe(0);
  });
});
