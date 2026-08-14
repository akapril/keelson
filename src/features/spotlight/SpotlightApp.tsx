// SpotlightApp.tsx — Spotlight 窗口根组件
// 玻璃面板（glass panel），使用 CSS 变量实现透明模糊效果，支持明暗主题
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSpotlightStore } from "../../store/spotlight";
import { useSessionsStore } from "../../store/sessions";
import { buildItems } from "./utils";
import { listAllTasks, listProjects } from "../../lib/pb/board";
import { listAllDocs } from "../../lib/pb/docs";
import { listMemories } from "../../lib/pb/memory";
import type { BoardTask, BoardProject } from "../../types/board";
import type { BoardDoc } from "../../types/docs";
import type { Memory } from "../../types/memory";
import { SpotlightInput } from "./SpotlightInput";
import { SpotlightCategoryChips } from "./SpotlightCategoryChips";
import { SpotlightList } from "./SpotlightList";
import { useSpotlightKeys } from "./useSpotlightKeys";

/** Spotlight 主容器：玻璃面板 + 输入框 + 候选项列表 */
export function SpotlightApp() {
  const { t } = useTranslation("shell");
  // 加载会话数据
  const sessions = useSessionsStore((s) => s.sessions);
  const loadSessions = useSessionsStore((s) => s.load);
  const query = useSpotlightStore((s) => s.query);
  const category = useSpotlightStore((s) => s.category);
  const setItems = useSpotlightStore((s) => s.setItems);
  const itemCount = useSpotlightStore((s) => s.items.length);
  const asTab = useSpotlightStore((s) => s.asTab);
  // 全量任务/文档/项目/记忆（挂载一次性拉取，客户端过滤；失败静默留空）
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [docs, setDocs] = useState<BoardDoc[]>([]);
  const [projects, setProjects] = useState<BoardProject[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);

  // 挂载时拉取会话 + 全量任务/文档/项目/记忆
  useEffect(() => {
    loadSessions();
    void listAllTasks().then(setTasks).catch(() => {});
    void listAllDocs().then(setDocs).catch(() => {});
    void listProjects().then(setProjects).catch(() => {});
    void listMemories().then(setMemories).catch(() => {});
  }, [loadSessions]);

  // query / category / 数据变化时重算候选项
  useEffect(() => {
    setItems(buildItems(query, category, { sessions, projects, docs, tasks, memories }));
  }, [query, category, sessions, projects, docs, tasks, memories, setItems]);

  // 注册键盘事件（↑/↓/Enter/Esc/Tab）
  useSpotlightKeys();

  return (
    // 玻璃面板直接铺满整个窗口（窗口本身 transparent:true / decorations:false）。
    // 之前面板固定 600px + 60px 顶部留白，在透明未完全生效的 Windows 上会显成一圈厚边框，
    // 故去掉外层留白，让面板占满窗口，从根上消除"边框太宽"。
    <div
      role="dialog"
      aria-label={t("spotlight.ariaLabel")}
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--glass-surface)",
        backdropFilter: `blur(var(--glass-blur))`,
        WebkitBackdropFilter: `blur(var(--glass-blur))`,
        borderRadius: "12px",
        overflow: "hidden",
      }}
    >
      {/* 搜索输入框（自动聚焦） */}
      <SpotlightInput />
      {/* 类别切换 chips */}
      <SpotlightCategoryChips />
      {/* 候选项列表（键盘导航高亮，flex-1 撑满剩余空间） */}
      <SpotlightList />
      {/* 底部状态栏：结果数 + 快捷键提示 + 恢复模式 */}
      <div
        className="flex items-center justify-between px-4 py-2 text-[11px] text-muted-foreground"
        style={{ borderTop: "1px solid var(--glass-border)" }}
      >
        <span>{t("spotlight.itemCount", { count: itemCount })}</span>
        <div className="flex items-center gap-3">
          <span>{t("spotlight.hint")}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground/80">
            {t("spotlight.tabPrefix")}{asTab ? t("spotlight.modeTab") : t("spotlight.modeTerminal")}
          </span>
        </div>
      </div>
    </div>
  );
}
