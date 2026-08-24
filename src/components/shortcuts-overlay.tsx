// 全局快捷键速查表（按 ? 唤起）。
// 目的：本 app 唯一暴露的键是头部 ⌘K 徽标，Spotlight/命令面板的键位用户无从发现；
// 仿 Linear/Superhuman 用 ? 作为「快捷键索引页」，非输入态按 ? 即可查全部键位。
// 键位为字面符号（不翻译），描述走 i18n。数据须与实际实现保持一致：
//   命令面板 = command-palette.tsx；Spotlight = features/spotlight/useSpotlightKeys.ts。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// 分组：全局 + Spotlight。keys 为逐个渲染的键位 token。
const GROUPS = [
  {
    labelKey: "shortcuts.groupGlobal",
    items: [
      { keys: ["⌘K", "Ctrl+K"], descKey: "shortcuts.commandPalette" },
      { keys: ["?"], descKey: "shortcuts.cheatsheet" },
    ],
  },
  {
    labelKey: "shortcuts.groupSpotlight",
    items: [
      { keys: ["↑", "↓"], descKey: "shortcuts.spotMove" },
      { keys: ["Enter"], descKey: "shortcuts.spotResume" },
      { keys: ["Tab"], descKey: "shortcuts.spotMode" },
      { keys: ["⌘1–6"], descKey: "shortcuts.spotCategory" },
      { keys: ["Esc"], descKey: "shortcuts.spotClose" },
    ],
  },
];

export function ShortcutsOverlay() {
  const { t } = useTranslation("shell");
  const [open, setOpen] = useState(false);

  // 非输入态、非中文输入法组合态时，按 ? 切换速查表
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "?") return;
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      if (typing || e.isComposing) return;
      e.preventDefault();
      setOpen((o) => !o);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
          <DialogDescription>{t("shortcuts.desc")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {GROUPS.map((g) => (
            <div key={g.labelKey} className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {t(g.labelKey)}
              </p>
              {g.items.map((it) => (
                <div
                  key={it.descKey}
                  className="flex items-center justify-between gap-4 text-sm"
                >
                  <span className="text-foreground">{t(it.descKey)}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {it.keys.map((k, i) => (
                      <kbd
                        key={i}
                        className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
