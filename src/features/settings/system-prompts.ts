// 系统提示词管理：把内置功能写死的系统提示做成「可覆盖的默认值」。
// 覆盖值仅存本机 localStorage（与 AI 配置一致，无需后端）。留空/等于默认 = 用内置。
//
// ⚠️ 只纳入「输出自由文本、编辑安全」的系统提示。摘要/提炼那类要求严格 JSON 输出的
// 暂不开放——用户一改可能破坏解析。要加时须格外谨慎。
import { REPORT_SYSTEM } from "@/features/report/generateReport";

export interface SystemPromptDef {
  /** 稳定 key（localStorage 覆盖以此为键） */
  key: string;
  /** 展示名 */
  label: string;
  /** 用途说明 */
  description: string;
  /** 内置默认文本 */
  def: string;
}

/** 可管理的系统提示词注册表（当前仅报告默认；后续可扩展）。 */
export const SYSTEM_PROMPTS: SystemPromptDef[] = [
  {
    key: "report",
    label: "工作报告 · 默认格式",
    description: "生成工作报告时、未选具体模板（默认格式）所用的系统提示。",
    def: REPORT_SYSTEM,
  },
];

const KEY = "rework-system-prompts";

function loadOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function saveOverrides(o: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* 隐私模式等写入失败：忽略 */
  }
}

const defOf = (key: string) => SYSTEM_PROMPTS.find((s) => s.key === key)?.def ?? "";

/** 取生效的系统提示：有非空覆盖用覆盖，否则用内置默认。 */
export function getSystemPrompt(key: string): string {
  const ov = loadOverrides()[key];
  return ov && ov.trim() ? ov : defOf(key);
}

/** 是否被用户覆盖过（非空且与默认不同）。 */
export function isSystemPromptOverridden(key: string): boolean {
  const ov = loadOverrides()[key];
  return !!(ov && ov.trim() && ov.trim() !== defOf(key).trim());
}

/** 保存覆盖；传空或等于默认 = 恢复默认（删除覆盖）。 */
export function setSystemPromptOverride(key: string, text: string): void {
  const o = loadOverrides();
  if (!text.trim() || text.trim() === defOf(key).trim()) delete o[key];
  else o[key] = text;
  saveOverrides(o);
}
