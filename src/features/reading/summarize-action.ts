// 阅读 AI 摘要的共享动作：详情弹窗与列表卡片都复用，避免重复门禁/写回/toast 逻辑。
import { toast } from "sonner";
import { useSettingsStore } from "@/store/settings";
import { useReadingStore } from "@/store/reading";
import { summarizeReadingItem } from "./summarize";
import type { ReadingItem } from "@/types/reading";

/**
 * 对阅读条目执行 AI 摘要并写回 store。内含「无 key 门禁」与成功/失败 toast。
 * 本地 CLI provider 无需 key；其他 provider 缺 key 时提示去设置。
 * @returns 是否成功（供调用方决定后续，如按钮状态）。
 */
export async function runReadingSummarize(item: ReadingItem): Promise<boolean> {
  if (!item.url) {
    toast.error("该条目无链接，无法摘要");
    return false;
  }
  const cfg = useSettingsStore.getState().aiConfig;
  const isCli = cfg.provider === "claude-cli" || cfg.provider === "codex-cli";
  if (!isCli && !cfg.api_key) {
    toast.error("请先在设置中配置 AI 服务");
    return false;
  }
  try {
    const r = await summarizeReadingItem(item, cfg);
    const patch: Record<string, unknown> = {
      summary: r.summary,
      key_points: JSON.stringify(r.key_points),
      content_text: r.content_text,
    };
    // AI 推荐标签:仅当条目还没有标签时自动填(不覆盖用户已有标签)
    if (r.tags.length > 0 && !item.tags?.trim()) {
      patch.tags = r.tags.join(",");
    }
    await useReadingStore.getState().updateItem(item.id, patch);
    toast.success(
      r.tags.length > 0 && !item.tags?.trim()
        ? `已生成 AI 摘要(含 ${r.tags.length} 个推荐标签)`
        : "已生成 AI 摘要",
    );
    return true;
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
    return false;
  }
}
