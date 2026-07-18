// Spotlight 激活：按候选类型分派。
// - 会话：恢复终端（asTab 决定新终端窗/标签页），成功后隐藏 spotlight。
// - 任务/文档：聚焦主窗并跳转深链（Rust spotlight_open：show_main + 事件 + 隐藏 spotlight）。
// 键盘 Enter 与鼠标点击共用此逻辑。
import { useRestoreStore } from "../../store/restore";
import { hideThisWindow } from "../../lib/tauri/window";
import { ipc } from "../../lib/tauri/ipc";
import type { SpotlightItem } from "../../store/spotlight";

export async function activateItem(item: SpotlightItem, asTab: boolean): Promise<void> {
  if (item.kind === "session") {
    await useRestoreStore.getState().restore(item.session, asTab);
    await hideThisWindow();
    return;
  }
  // 任务/文档：交给后端聚焦主窗 + 广播导航事件（后端同时隐藏 spotlight）
  await ipc.spotlightOpen(item.path);
}
