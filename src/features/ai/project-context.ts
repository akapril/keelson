// 项目上下文收集（轻量 RAG：关键词相关性检索 + 上下文注入，无向量库）。
// 把项目文档 + 关联会话切成 chunk，按与「提问」的关键词相关度排序，挑最相关的塞进预算内。
// 纯排序/挑选逻辑在 ./project-rank（可单测）；后续可升级为 embedding 检索。
import { listDocs } from "@/lib/pb/docs";
import { useSessionsStore } from "@/store/sessions";
import { selectChunks } from "./project-rank";

/**
 * 构造项目上下文文本。
 * @param projectId 项目 ID（取其文档）
 * @param repoPath  项目仓库路径（按 project_path 匹配关联会话；为空则跳过会话）
 * @param query     当前提问（用于相关性排序；为空则按原顺序截断）
 */
export async function buildProjectContext(
  projectId: string,
  repoPath?: string,
  query = "",
): Promise<string> {
  const chunks: string[] = [];

  // 1) 项目文档（每篇一个 chunk）
  try {
    const docs = await listDocs(projectId);
    for (const d of docs) {
      const content = (d.content || "").trim();
      if (content) chunks.push(`【文档：${d.title || "未命名"}】\n${content}`);
    }
  } catch {
    /* 文档加载失败不阻断对话 */
  }

  // 2) 关联本地会话（每条会话的最后/首条提示词一个 chunk）
  if (repoPath) {
    const sessions = useSessionsStore
      .getState()
      .sessions.filter((s) => s.project_path === repoPath);
    for (const s of sessions) {
      const prompt = (s.last_prompt || s.first_prompt || "").trim();
      if (prompt) chunks.push(`【会话（${s.provider}）】${prompt}`);
    }
  }

  return selectChunks(chunks, query);
}
