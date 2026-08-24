// `g` 前缀直达导航（g h/g b/g s…）—— 键盘优先「不离手」直达页面。
// 交互：非输入态、非中文输入法组合态时按 g 置 pending；下一键若命中 goKey 映射即跳转，
// 任何非映射键立即清 pending（不引定时器，比超时更 KISS）。键位见 ? 速查表。
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { flatNavItems } from "@/lib/navigation";

export function GotoNav() {
  const navigate = useNavigate();
  const pendingRef = useRef(false);

  useEffect(() => {
    // 派生 goKey→url 映射（一次）
    const map = new Map<string, string>();
    for (const it of flatNavItems) if (it.goKey) map.set(it.goKey, it.url);

    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      // 输入态 / 输入法组合态 / 带修饰键：一律不参与，并清除 pending
      if (typing || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) {
        pendingRef.current = false;
        return;
      }
      if (!pendingRef.current) {
        // 起始态：仅 g 进入 pending
        if (e.key === "g") pendingRef.current = true;
        return;
      }
      // pending 态：下一键决定去向，无论命中与否都退出 pending
      pendingRef.current = false;
      const url = map.get(e.key.toLowerCase());
      if (url) {
        e.preventDefault();
        navigate(url);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return null;
}
