// 全局唤起快捷键设置区（从 pages/settings.tsx 拆出，逻辑逐字保留）。
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/store/settings";

// ── 快捷键字符串构建辅助 ───────────────────────────────────────
/**
 * 从 KeyboardEvent 构建形如 "CommandOrControl+Shift+Space" 的快捷键字符串。
 * 遵循 tauri_plugin_global_shortcut 期望的格式。
 */
function buildHotkeyString(e: KeyboardEvent): string {
  const parts: string[] = [];

  // 修饰键（按固定顺序，避免 "Shift+Ctrl" vs "Ctrl+Shift" 歧义）
  if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  // 主键（排除纯修饰键按下）
  const MODIFIER_KEYS = new Set([
    "Control", "Meta", "Alt", "Shift",
    "CapsLock", "NumLock", "ScrollLock",
  ]);
  if (!MODIFIER_KEYS.has(e.key)) {
    // 将浏览器 key 名称标准化为 Tauri 期望格式
    const key = normalizeKey(e.key, e.code);
    parts.push(key);
  }

  return parts.join("+");
}

/**
 * 将浏览器 KeyboardEvent.key 标准化为 Tauri 快捷键格式。
 * 参考：https://docs.rs/global-hotkey/latest/global_hotkey/hotkey/enum.Code.html
 */
function normalizeKey(key: string, code: string): string {
  // 功能键直接使用
  if (/^F\d+$/.test(key)) return key;
  // 空格
  if (key === " " || key === "Spacebar") return "Space";
  // 方向键
  const arrowMap: Record<string, string> = {
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  };
  if (key in arrowMap) return arrowMap[key];
  // 单字符：数字和字母直接大写
  if (key.length === 1) return key.toUpperCase();
  // 其余（Escape、Enter、Tab、Backspace 等）直接透传
  // 对于 code 中的 Key* / Digit* 作为兜底
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return key;
}

// ── 快捷键捕获控件 ────────────────────────────────────────────
interface HotkeyCaptureProps {
  value: string;
  onCapture: (hotkey: string) => void;
  disabled?: boolean;
}

function HotkeyCapture({ value, onCapture, disabled }: HotkeyCaptureProps) {
  const { t } = useTranslation("settings");
  // 是否处于"捕获中"状态
  const [capturing, setCapturing] = useState(false);
  // 捕获中显示的预览字符串
  const [preview, setPreview] = useState("");
  const divRef = useRef<HTMLDivElement>(null);

  // 进入捕获模式：聚焦 div 并重置预览
  function startCapture() {
    if (disabled) return;
    setCapturing(true);
    setPreview("");
    divRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();

    // Escape 取消捕获
    if (e.key === "Escape") {
      setCapturing(false);
      setPreview("");
      return;
    }

    const combo = buildHotkeyString(e.nativeEvent);
    setPreview(combo);

    // 只有包含非修饰键时才视为完整组合，触发回调
    const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "Shift"]);
    if (!MODIFIER_KEYS.has(e.key) && combo.includes("+")) {
      setCapturing(false);
      onCapture(combo);
    }
  }

  function handleBlur() {
    // 失焦时退出捕获模式
    setCapturing(false);
    setPreview("");
  }

  // 显示文本：捕获中 → 预览；否则 → 当前值（或提示）
  const displayText = capturing
    ? preview || t("shortcut.capturePrompt")
    : value || t("shortcut.clickToSet");

  const ariaLabelValue = value || t("shortcut.ariaLabelUnset");

  return (
    <div
      ref={divRef}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={t("shortcut.ariaLabel", { value: ariaLabelValue })}
      aria-disabled={disabled}
      onMouseDown={startCapture}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      className={[
        "inline-flex min-w-48 cursor-pointer select-none items-center",
        "rounded-md border px-3 py-1.5 font-mono text-sm",
        "transition-colors focus:outline-none",
        capturing
          ? "border-ring bg-accent text-accent-foreground ring-2 ring-ring"
          : "border-border bg-muted text-foreground hover:bg-accent hover:text-accent-foreground",
        disabled ? "pointer-events-none opacity-50" : "",
      ].join(" ")}
    >
      {displayText}
    </div>
  );
}

/**
 * 全局唤起快捷键区：HotkeyCapture 捕获组合键，经 useSettingsStore.saveHotkey
 * 持久化并在 Rust 端立即重注册。
 */
export function ShortcutSection() {
  const { t } = useTranslation("settings");
  const hotkey = useSettingsStore((s) => s.hotkey);
  const loading = useSettingsStore((s) => s.loading);
  const saveHotkey = useSettingsStore((s) => s.saveHotkey);

  // 捕获到完整快捷键组合时保存
  function handleHotkeyCapture(combo: string) {
    saveHotkey(combo);
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t("shortcut.title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("shortcut.desc")}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <HotkeyCapture
          value={hotkey}
          onCapture={handleHotkeyCapture}
          disabled={loading}
        />
        {loading && (
          <span className="text-xs text-muted-foreground">{t("shortcut.saving")}</span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {t("shortcut.hint")}
      </p>
    </section>
  );
}
