// 项目上下文收集（轻量 RAG：上下文注入，无向量库）。
// 汇总当前项目的文档正文 + 关联本地会话的提示词，拼成一段上下文供 AI 参考。
// 后续可升级为 embedding 检索（rig-fastembed + sqlite-vec）。
import { listDocs } from "@/lib/pb/docs";
import { useSessionsStore } from "@/store/sessions";

/** 上下文字符预算（超出截断，避免超模型上下文/费用）。 */
const MAX_CONTEXT_CHARS = 8000;

/**
 * 构造项目上下文文本。
 * @param projectId 项目 ID（取其文档）
 * @param repoPath  项目仓库路径（按 project_path 匹配关联会话；为空则跳过会话）
 */
export async function buildProjectContext(
  projectId: string,
  repoPath?: string,
): Promise<string> {
  const parts: string[] = [];

  // 1) 项目文档
  try {
    const docs = await listDocs(projectId);
    for (const d of docs) {
      const content = (d.content || "").trim();
      if (content) parts.push(`【文档：${d.title || "未命名"}】\n${content}`);
    }
  } catch {
    /* 文档加载失败不阻断对话 */
  }

  // 2) 关联本地会话（取每条会话的最后/首条提示词）
  if (repoPath) {
    const sessions = useSessionsStore
      .getState()
      .sessions.filter((s) => s.project_path === repoPath);
    for (const s of sessions) {
      const prompt = (s.last_prompt || s.first_prompt || "").trim();
      if (prompt) parts.push(`【会话（${s.provider}）】${prompt}`);
    }
  }

  let ctx = parts.join("\n\n");
  if (ctx.length > MAX_CONTEXT_CHARS) {
    ctx = ctx.slice(0, MAX_CONTEXT_CHARS) + "\n…（上下文已截断）";
  }
  return ctx;
}
