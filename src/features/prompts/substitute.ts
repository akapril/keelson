// 指令变量替换（纯函数，可测）：插入指令时把 {{变量}} 替换为当前上下文。
// 支持 {{project}} 项目名、{{repo_path}} 仓库路径、{{date}} 日期、{{time}} 时间。
// 未知变量原样保留（让用户看到没填上的占位，而非静默清空）。

export interface PromptVarCtx {
  /** 当前项目名（无则空串） */
  project?: string;
  /** 当前项目仓库路径（无则空串） */
  repoPath?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 支持的变量清单（用于 UI 提示）。 */
export const PROMPT_VARS = ["project", "repo_path", "date", "time"] as const;

/**
 * 把 content 里的 {{var}} 替换为上下文值。now 由调用方传入（便于测试与固定时区）。
 * 未知变量保持 {{var}} 原样。
 */
export function substituteVars(
  content: string,
  ctx: PromptVarCtx,
  now: Date,
): string {
  const map: Record<string, string> = {
    project: ctx.project ?? "",
    repo_path: ctx.repoPath ?? "",
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
  return content.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (m, key: string) =>
    key in map ? map[key] : m,
  );
}
