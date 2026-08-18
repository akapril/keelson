import type { Prompt, PromptType } from "@/types/prompt";

// 指令标签工具：空格/逗号（中英）分隔 ↔ 数组。
export function splitTags(s: string): string[] {
  return (s || "")
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// 指令类型的中文标签（下拉/胶囊展示用）。
export const PROMPT_TYPE_LABEL: Record<PromptType, string> = {
  snippet: "片段",
  report: "报告模板",
  skill: "技能",
};

/** 归一取类型：report/skill 各自归位，缺省/未知视为 snippet（兼容旧数据）。 */
export function promptType(p: Pick<Prompt, "type">): PromptType {
  return p.type === "report" ? "report" : p.type === "skill" ? "skill" : "snippet";
}
