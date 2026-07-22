// 工作报告的后台生成任务 store。
// 生成较慢（要逐仓 gitLog + 调 AI），放模块级 store 而非页面组件内，
// 使其不随页面卸载中断：用户点「生成」后可离开报告页，完成时推通知（点回报告页看结果）。
import { create } from "zustand";
import { generateReport, type ReportScope } from "@/features/report/generateReport";
import type { DateRange } from "@/features/report/report-range";
import type { AiConfig } from "@/types/ai";
import { useNotificationsStore } from "./notifications";

export type ReportJobStatus = "idle" | "running" | "done" | "error";

interface RunArgs {
  range: DateRange;
  scope: ReportScope;
  cfg: AiConfig;
  /** 模板系统提示（指令库 prompt 内容）；可空 = 用内置提示 */
  systemPrompt?: string;
}

interface ReportJobState {
  status: ReportJobStatus;
  /** 生成好的 Markdown 报告（done 时有值） */
  result: string | null;
  error?: string;
  /** 当前/最近一次任务的时间范围标签（展示用） */
  rangeLabel: string;
  /** 启动后台生成（单任务：进行中再次调用忽略） */
  run: (args: RunArgs) => void;
  /** 清空到 idle */
  reset: () => void;
}

export const useReportJobStore = create<ReportJobState>((set, get) => ({
  status: "idle",
  result: null,
  error: undefined,
  rangeLabel: "",

  run: ({ range, scope, cfg, systemPrompt }) => {
    // 单任务：已有任务在跑则忽略，避免并发覆盖
    if (get().status === "running") return;
    set({ status: "running", result: null, error: undefined, rangeLabel: range.label });

    void generateReport(range, scope, cfg, systemPrompt)
      .then((md) => {
        set({ status: "done", result: md });
        // 完成通知：点开回报告页看结果
        void useNotificationsStore
          .getState()
          .add({
            title: "工作报告已生成",
            body: range.label,
            kind: "success",
            source: "工作报告",
            link: "/report",
          })
          .catch(() => {});
      })
      .catch((e) => {
        const msg = String(e instanceof Error ? e.message : e);
        set({ status: "error", error: msg });
        void useNotificationsStore
          .getState()
          .add({
            title: "工作报告生成失败",
            body: msg.slice(0, 120),
            kind: "error",
            source: "工作报告",
            link: "/report",
          })
          .catch(() => {});
      });
  },

  reset: () => set({ status: "idle", result: null, error: undefined, rangeLabel: "" }),
}));
