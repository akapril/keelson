// SpotlightInput.tsx — 搜索输入框，挂载时及窗口每次获得焦点时自动聚焦
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HugeiconsIcon } from "@hugeicons/react";
import { SearchIcon } from "@hugeicons/core-free-icons";
import { formatInput, parsePrefix } from "./utils";
import { useSpotlightStore } from "../../store/spotlight";

export function SpotlightInput() {
  const { t } = useTranslation("shell");
  const query = useSpotlightStore((s) => s.query);
  const category = useSpotlightStore((s) => s.category);
  const inputRef = useRef<HTMLInputElement>(null);

  // 组件挂载时自动聚焦（首次显示）
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 每次 Spotlight 窗口重新获得焦点（即热键再次唤起窗口）时：
  // 1. 重新聚焦输入框并全选已有文字，方便用户直接覆盖输入
  // 2. 重置选中索引到第一项，保持列表从顶部开始
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) {
          const el = inputRef.current;
          if (el) {
            el.focus();
            el.select(); // 全选已有内容，使新输入直接覆盖
          }
          // 重置列表选中索引到第一项
          useSpotlightStore.setState({ selectedIndex: 0 });
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    // 组件卸载时取消监听，防止内存泄漏
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <div
      className="flex items-center gap-3 px-4 py-3.5"
      style={{ borderBottom: "1px solid var(--glass-border)" }}
    >
      <HugeiconsIcon
        icon={SearchIcon}
        strokeWidth={2}
        className="size-5 shrink-0 text-muted-foreground"
      />
      <input
        ref={inputRef}
        type="text"
        value={formatInput(category, query)}
        onChange={(e) => {
          // 解析前缀 → 同步类别与纯过滤词（单一事实源），并重置选中项
          const parsed = parsePrefix(e.target.value);
          useSpotlightStore.setState({ category: parsed.category, query: parsed.query, selectedIndex: 0 });
        }}
        placeholder={t("spotlight.inputPlaceholder")}
        autoComplete="off"
        spellCheck={false}
        className="w-full border-none bg-transparent text-lg text-foreground caret-primary outline-none placeholder:text-muted-foreground/70"
      />
    </div>
  );
}
