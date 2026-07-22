// 首次把「内置报告默认格式」种进指令库，使它在库里可见/可编辑（而不是藏在代码里）。
// 幂等：只成功种一次（localStorage 标记）；用户之后删了不会复活。
// 自愈：若 type 字段尚未生效（未重建）导致种进去的记录不是 report 类型，
//       则撤销该记录且不置标记，等重建后再正确种一次——避免留下脏的无类型数据。
import { listPrompts, createPromptRecord, deletePromptRecord } from "@/lib/pb/prompts";
import { currentUserId } from "@/lib/pb";
import { REPORT_SYSTEM } from "@/features/report/generateReport";
import { promptType } from "./prompt-utils";

const SEED_FLAG = "rework-prompts-seeded-report-default";
const TITLE = "工作报告 · 默认格式";

export async function ensureDefaultPromptsSeeded(): Promise<void> {
  if (localStorage.getItem(SEED_FLAG)) return;
  try {
    const existing = await listPrompts();
    // 已存在同名 report 模板（用户已有或曾种过）→ 只置标记，不重复种
    if (existing.some((p) => promptType(p) === "report" && p.title === TITLE)) {
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
