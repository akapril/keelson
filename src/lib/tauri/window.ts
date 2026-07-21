import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
export const thisWindowLabel = () => getCurrentWindow().label;
export const hideThisWindow = () => getCurrentWindow().hide();
export const showThisWindow = () => getCurrentWindow().show();
export const closeThisWindow = () => getCurrentWindow().close();

/**
 * 在独立原生窗口打开某篇文档（label=`doc-<id>`，与 capabilities 的 doc-* glob 对应）。
 * 已开则聚焦复用，避免同一文档开多个窗口。窗口内加载 #/doc-window/:id（无侧栏纯编辑器）。
 */
export async function openDocWindow(id: string, title?: string): Promise<void> {
  const label = `doc-${id}`;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow(label, {
    url: `index.html#/doc-window/${id}`,
    title: title ? `${title} — rework` : "rework 文档",
    width: 900,
    height: 720,
    minWidth: 480,
    minHeight: 400,
    // 无原生标题栏，与主窗口一致用自建 TitleBar（拖拽 + 最小化/最大化/关闭）
    decorations: false,
  });
  win.once("tauri://error", (e) => {
    console.error("打开文档窗口失败", e);
  });
}
