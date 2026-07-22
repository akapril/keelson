// 首次把「内置报告默认格式」种进指令库，使它在库里可见/可编辑（而不是藏在代码里）。
// 幂等：只成功种一次（localStorage 标记）；用户之后删了不会复活。
// 去重：若已存在同名 report 记录（含竞态留下的重复），保留最新一条、删掉多余的。
// 串行化：并发调用（报告页 + 指令库页同时挂载）复用同一次执行，避免各建一条。
// 自愈：若 type 字段尚未生效（未重建）导致种进去的记录不是 report 类型，
//       则撤销该记录且不置标记，等重建后再正确种一次——不留脏的无类型数据。
import { listPrompts, createPromptRecord, deletePromptRecord } from "@/lib/pb/prompts";
import { currentUserId } from "@/lib/pb";
import { REPORT_SYSTEM } from "@/features/report/generateReport";
import { promptType } from "./prompt-utils";

// v2：升版以强制跑一次去重逻辑，清理 v1 竞态可能留下的重复记录。
const SEED_FLAG = "rework-prompts-seeded-report-default-v2";
const TITLE = "工作报告 · 默认格式";

// 进行中的种子任务（模块级）：并发调用复用，避免竞态重复创建。
let inFlight: Promise<void> | null = null;

export function ensureDefaultPromptsSeeded(): Promise<void> {
  if (localStorage.getItem(SEED_FLAG)) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = seedOnce().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function seedOnce(): Promise<void> {
  try {
    const all = await listPrompts();
    // listPrompts 按 -updated 排序：dupes[0] 为最近更新的一条（保留它，删其余）
    const dupes = all.filter((p) => promptType(p) === "report" && p.title === TITLE);
    if (dupes.length > 0) {
      for (const d of dupes.slice(1)) await deletePromptRecord(d.id).catch(() => {});
      localStorage.setItem(SEED_FLAG, "1");
      return;
    }
    const created = await createPromptRecord({
      owner: currentUserId(),
      title: TITLE,
      content: REPORT_SYSTEM,
      tags: "报告",
      type: "report",
    });
    if (promptType(created) === "report") {
      localStorage.setItem(SEED_FLAG, "1"); // 种成功且类型正确 → 定标，永不再种
    } else {
      // type 字段还没生效（未重建）：撤销这条无类型记录，下次（重建后）再种
      await deletePromptRecord(created.id).catch(() => {});
    }
  } catch {
    // 失败（如集合未建/离线）：不置标记，下次再试
  }
}
