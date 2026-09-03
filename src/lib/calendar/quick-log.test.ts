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

describe("parseQuickLog 中文时间/时长解析", () => {
  // 固定基准：2026-09-02 10:00（注入 now 保证「明天」等相对日确定）
  const NOW = new Date("2026-09-02T10:00:00");

  it("明天 + 下午H点 + @项目：解析日期/时刻并剥离，剩余当标题", () => {
    expect(parseQuickLog("明天下午3点 复盘 @keelson", projects, NOW)).toEqual({
      title: "复盘",
      project: "p1",
      start: "2026-09-03",
      startTime: "15:00",
    });
  });

  it("时长无显式时刻：以当前时刻为锚合成结束时刻", () => {
    expect(parseQuickLog("写周报 1小时 @keelson", projects, NOW)).toEqual({
      title: "写周报",
      project: "p1",
      endTime: "11:00", // 锚 now 10:00 + 60min
    });
  });

  it("H:MM 冒号形按 24 小时、不走下午启发式", () => {
    expect(parseQuickLog("发布 15:30", projects, NOW)).toEqual({
      title: "发布",
      project: "",
      startTime: "15:30",
    });
  });

  it("开始时刻 + 半小时：结束 = 开始 + 30min", () => {
    expect(parseQuickLog("下午2点 开会 半小时", projects, NOW)).toEqual({
      title: "开会",
      project: "",
      startTime: "14:00",
      endTime: "14:30",
    });
  });

  it("裸「H点」无时段词：1-6 点启发式判为下午", () => {
    expect(parseQuickLog("3点 站会", projects, NOW)).toEqual({
      title: "站会",
      project: "",
      startTime: "15:00",
    });
  });

  it("含「周报」不误判为星期几（周后须跟星期字）", () => {
    const r = parseQuickLog("写周报", projects, NOW);
    expect(r.title).toBe("写周报");
    expect(r.start).toBeUndefined();
  });

  it("含「提醒我」：remind=true，剥离「提醒我」token + 时刻", () => {
    expect(parseQuickLog("18点提醒我健身", projects, NOW)).toEqual({
      title: "健身",
      project: "",
      startTime: "18:00",
      remind: true,
    });
  });

  it("「明天…提醒我…」：remind=true + 日期识别", () => {
    const r = parseQuickLog("明天下午3点提醒我交报告", projects, NOW);
    expect(r.remind).toBe(true);
    expect(r.title).toBe("交报告");
    expect(r.startTime).toBe("15:00");
    expect(r.start).toBeDefined();
  });

  it("纯流水账（无「提醒」二字）：remind 缺省（不提醒）", () => {
    const r = parseQuickLog("写了一下午代码", projects, NOW);
    expect(r.remind).toBeUndefined();
  });
});
