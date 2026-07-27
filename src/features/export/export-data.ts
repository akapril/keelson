// 数据导出：汇总看板（项目/状态/标签/任务）+ 文档为一个包，序列化为 JSON / Markdown。
// 只导出 PocketBase 独有数据（会话本身已存在于本地 .jsonl 文件，无需导出）。
// 纯序列化逻辑（toJson/toMarkdown）不依赖 IO，便于单测；落盘走浏览器 Blob 下载。
import { listProjects, listStates, listLabels, listTasks } from "@/lib/pb/board";
import { listDocs } from "@/lib/pb/docs";
import type {
  BoardProject,
  BoardState,
  BoardLabel,
  BoardTask,
} from "@/types/board";
import type { BoardDoc } from "@/types/docs";

/** 单个项目的完整导出数据 */
export interface ProjectExport {
  project: BoardProject;
  states: BoardState[];
  labels: BoardLabel[];
  tasks: BoardTask[];
  docs: BoardDoc[];
}

/** 导出包（含版本号，便于将来导入兼容） */
export interface ExportBundle {
  version: 1;
  exportedAt: string;
  projects: ProjectExport[];
}

/**
 * 汇总当前用户全部项目的看板 + 文档数据。
 * @param exportedAt 导出时间戳（由调用方传入，保持本模块纯净可测）
 */
export async function gatherExport(exportedAt: string): Promise<ExportBundle> {
  const projects = await listProjects();
  const per = await Promise.all(
    projects.map(async (p): Promise<ProjectExport> => {
      const [states, labels, tasks, docs] = await Promise.all([
        listStates(p.id),
        listLabels(p.id),
        listTasks(p.id),
        listDocs(p.id),
      ]);
      return { project: p, states, labels, tasks, docs };
    }),
  );
  return { version: 1, exportedAt, projects: per };
}

/** 序列化为 JSON（完整备份，可用于将来导入）。 */
export function toJson(bundle: ExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/** 序列化为 Markdown（人类可读：每项目 → 按状态分组的任务 + 文档正文）。 */
export function toMarkdown(bundle: ExportBundle): string {
  const lines: string[] = [];
  lines.push("# Keelson 数据导出", "", `导出时间：${bundle.exportedAt}`, "");

  for (const pe of bundle.projects) {
    lines.push(`## 项目：${pe.project.name}`, "");
    if (pe.project.description) lines.push(pe.project.description, "");

    // 看板：按 sort_order 遍历状态列，列内按 rank 排序
    lines.push("### 看板", "");
    const sortedStates = [...pe.states].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    for (const st of sortedStates) {
      const inState = pe.tasks
        .filter((t) => t.state === st.id)
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
      lines.push(`#### ${st.name}（${inState.length}）`, "");
      for (const t of inState) {
        const due = t.due_date ? ` @${t.due_date.slice(0, 10)}` : "";
        const pr = t.priority && t.priority !== "none" ? `[${t.priority}] ` : "";
        lines.push(`- ${pr}${t.title}${due}`);
        if (t.description) {
          lines.push(`  - ${t.description.replace(/\s+/g, " ").trim()}`);
        }
      }
      lines.push("");
    }

    // 文档：标题 + 正文原文
    if (pe.docs.length > 0) {
      lines.push("### 文档", "");
      for (const d of pe.docs) {
        lines.push(`#### ${d.title || "未命名文档"}`, "", d.content || "", "");
      }
    }

    lines.push("---", "");
  }

  return lines.join("\n");
}

/**
 * 通过浏览器 Blob + 下载锚点落盘（WebView2 支持，无需 Tauri 文件插件）。
 */
export function downloadTextFile(
  filename: string,
  content: string,
  mime: string,
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 延迟释放，确保下载已开始
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
