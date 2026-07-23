// 记忆桥：把 Claude 文件记忆(~/.claude/projects/*/memory/*.md)导入 rework 记忆账本。
// 默认 status=pending（待审），用户在记忆页收件箱采纳后才生效——与 create_memory MCP 同策略。
// 幂等：锚点 file-memory:<name>，已导入则跳过。
import { ipc } from "@/lib/tauri/ipc";
import { listMemories, createMemoryRecord } from "@/lib/pb/memory";
import { currentUserId } from "@/lib/pb";
import type { MemoryKind } from "@/types/memory";

// 文件记忆 frontmatter 的 type → 账本 kind（有损，用户可在审核时改）
const KIND_MAP: Record<string, MemoryKind> = {
  feedback: "convention", // 如何协作的约定
  user: "preference", // 用户偏好
  project: "fact", // 项目事实
  reference: "fact", // 参考事实
};

export interface ImportResult {
  imported: number;
  skipped: number;
}

/** 扫描文件记忆并导入账本（待审、幂等）。 */
export async function importFileMemories(): Promise<ImportResult> {
  const files = await ipc.scanFileMemories();
  if (files.length === 0) return { imported: 0, skipped: 0 };

  const existing = await listMemories();
  const seen = new Set(existing.map((m) => m.source_anchor).filter(Boolean));

  let imported = 0;
  let skipped = 0;
  for (const f of files) {
    const anchor = `file-memory:${f.name}`;
    if (seen.has(anchor)) {
      skipped++;
      continue;
    }
    // content 取 description（一句话断言最贴 rework 记忆形态）；无则取正文首行 / name。截断 2000。
    const content = (
      f.description ||
      f.body.split("\n").find((l) => l.trim()) ||
      f.name
    )
      .trim()
      .slice(0, 2000);
    await createMemoryRecord({
      owner: currentUserId(),
      content,
      kind: KIND_MAP[f.kind_hint] ?? "fact",
      scope: "global", // 文件记忆不绑仓库；导入为全局，用户审核时可改 scope
      status: "pending", // 待审：收件箱采纳后才入账/注入
      project: "",
      confidence: 1,
      source_session_id: "",
      source_provider: "claude-file",
      source_anchor: anchor,
      superseded_by: "",
    });
    imported++;
  }
  return { imported, skipped };
}
