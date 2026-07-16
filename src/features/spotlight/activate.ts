// Spotlight 激活：恢复所选会话（asTab 决定新终端窗/标签页），成功后隐藏窗口。
// 键盘 Enter 与鼠标点击共用此逻辑。
import { useRestoreStore } from "../../store/restore";
import { hideThisWindow } from "../../lib/tauri/window";
import type { SpotlightItem } from "../../store/spotlight";

export async function activateItem(item: SpotlightItem, asTab: boolean): Promise<void> {
  await useRestoreStore.getState().restore(item.session, asTab);
  await hideThisWindow();
}
