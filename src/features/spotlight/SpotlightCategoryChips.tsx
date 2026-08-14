// SpotlightCategoryChips.tsx — 类别切换 chips（点选切类别；⌘1-6 直达见 useSpotlightKeys）
import { useTranslation } from "react-i18next";
import { CATEGORIES, useSpotlightStore, type SpotlightCategory } from "../../store/spotlight";
import { cn } from "../../lib/utils";

/** 类别 → i18n key（shell 命名空间）。 */
const LABEL_KEY: Record<SpotlightCategory, string> = {
  all: "spotlight.catAll",
  session: "spotlight.catSession",
  project: "spotlight.catProject",
  doc: "spotlight.catDoc",
  task: "spotlight.catTask",
  memory: "spotlight.catMemory",
};

/** 一排类别 chips：高亮当前类别；点选切换。onMouseDown 阻止默认，避免夺走输入框焦点。 */
export function SpotlightCategoryChips() {
  const { t } = useTranslation("shell");
  const category = useSpotlightStore((s) => s.category);
  const setCategory = useSpotlightStore((s) => s.setCategory);
  return (
    <div
      className="flex shrink-0 items-center gap-1 px-3 py-1.5"
      style={{ borderBottom: "1px solid var(--glass-border)" }}
    >
      {CATEGORIES.map((cat, i) => (
        <button
          key={cat}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setCategory(cat)}
          title={`⌘${i + 1}`}
          className={cn(
            "rounded-md px-2 py-0.5 text-xs transition-colors",
            category === cat
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(LABEL_KEY[cat])}
        </button>
      ))}
    </div>
  );
}
