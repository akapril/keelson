// CommandPicker.tsx —— 「历史 ▾」下拉：分段列出收藏 + 最近历史，点选回填命令+cwd。
// 每行可 ⭐ 切换收藏 / × 删除。按项目隔离，数据来自 command-store（localStorage）。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type CommandEntry,
  type CommandStore,
  loadCommands,
  toggleFavorite,
  removeFavorite,
  removeHistory,
} from "./command-store";

interface CommandPickerProps {
  /** 项目路径（收藏/历史隔离 key） */
  projectKey: string;
  /** 外部变更计数（收藏当前 / 启动记历史后 +1）→ 触发重载 */
  version: number;
  /** 选中一条 → 回填命令+cwd 到父组件 */
  onPick: (entry: CommandEntry) => void;
  /** 内部改动（收藏/删除）后通知父组件（供其 bump version 保持一致） */
  onChanged: () => void;
}

/** 单行命令项：点主体回填；⭐ 切收藏；× 删除。 */
function Row({
  entry,
  favorite,
  onPick,
  onToggleFav,
  onRemove,
}: {
  entry: CommandEntry;
  favorite: boolean;
  onPick: () => void;
  onToggleFav: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="group flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent/50">
      <button
        type="button"
        onClick={onPick}
        className="flex min-w-0 flex-1 flex-col items-start text-left"
        title={entry.command}
      >
        <span className="w-full truncate font-mono text-xs text-foreground">
          {entry.command}
        </span>
        {entry.cwd && (
          <span className="w-full truncate text-[10px] text-muted-foreground" title={entry.cwd}>
            {entry.cwd}
          </span>
        )}
      </button>
      {/* 收藏切换 */}
      <button
        type="button"
        onClick={onToggleFav}
        className={cn(
          "shrink-0 rounded px-1 text-xs",
          favorite ? "text-amber-500" : "text-muted-foreground hover:text-foreground",
        )}
        aria-pressed={favorite}
        title={favorite ? "unfavorite" : "favorite"}
      >
        {favorite ? "★" : "☆"}
      </button>
      {/* 删除 */}
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded px-1 text-xs text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
        title="remove"
      >
        ×
      </button>
    </div>
  );
}

export function CommandPicker({ projectKey, version, onPick, onChanged }: CommandPickerProps) {
  const { t } = useTranslation("board");
  const [open, setOpen] = useState(false);
  const [store, setStore] = useState<CommandStore>({ favorites: [], history: [] });

  // 打开时或外部 version 变化时重载（避免关闭态无谓读 localStorage）。
  useEffect(() => {
    if (open) setStore(loadCommands(projectKey));
  }, [open, version, projectKey]);

  const reload = () => setStore(loadCommands(projectKey));

  const handlePick = (entry: CommandEntry) => {
    onPick(entry);
    setOpen(false);
  };
  const handleToggleFav = (entry: CommandEntry) => {
    toggleFavorite(projectKey, entry);
    reload();
    onChanged();
  };
  const handleRemove = (entry: CommandEntry, fromFavorites: boolean) => {
    if (fromFavorites) removeFavorite(projectKey, entry);
    else removeHistory(projectKey, entry);
    reload();
    onChanged();
  };

  const empty = store.favorites.length === 0 && store.history.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" title={t("processes.launch.historyTitle")}>
          {t("processes.launch.history")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        {empty ? (
          <p className="px-1.5 py-3 text-center text-xs text-muted-foreground">
            {t("processes.launch.emptyHint")}
          </p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {/* 收藏段 */}
            {store.favorites.length > 0 && (
              <div className="space-y-0.5">
                <p className="px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  {t("processes.launch.favorites")}
                </p>
                {store.favorites.map((e, i) => (
                  <Row
                    key={`f-${i}-${e.command}-${e.cwd ?? ""}`}
                    entry={e}
                    favorite
                    onPick={() => handlePick(e)}
                    onToggleFav={() => handleToggleFav(e)}
                    onRemove={() => handleRemove(e, true)}
                  />
                ))}
              </div>
            )}
            {/* 历史段 */}
            {store.history.length > 0 && (
              <div className="space-y-0.5">
                <p className="px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  {t("processes.launch.recent")}
                </p>
                {store.history.map((e, i) => (
                  <Row
                    key={`h-${i}-${e.command}-${e.cwd ?? ""}`}
                    entry={e}
                    favorite={store.favorites.some(
                      (f) => f.command === e.command && (f.cwd || "") === (e.cwd || ""),
                    )}
                    onPick={() => handlePick(e)}
                    onToggleFav={() => handleToggleFav(e)}
                    onRemove={() => handleRemove(e, false)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
