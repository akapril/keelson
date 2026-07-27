// MemoryEditDialog —— 记忆内容的 markdown 编辑器：源码编辑 + 实时预览切换。
// 与 PromptDialog 同接口（open/defaultValue/onResult），便于替换。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";

export function MemoryEditDialog({
  open,
  defaultValue,
  onResult,
}: {
  open: boolean;
  defaultValue: string;
  /** 保存返回新内容；取消返回 null。 */
  onResult: (value: string | null) => void;
}) {
  const { t } = useTranslation(["memory", "common"]);
  const [value, setValue] = useState(defaultValue);
  const [tab, setTab] = useState<"edit" | "preview">("edit");

  // 每次打开时同步初值 + 回到编辑态
  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setTab("edit");
    }
  }, [open, defaultValue]);

  const save = () => {
    const v = value.trim();
    if (!v) return;
    onResult(v);
  };

  const tabCls = (active: boolean) =>
    `rounded-lg px-2.5 py-1 text-xs transition-colors ${
      active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"
    }`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onResult(null)}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>{t("memory:editDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("memory:editDialog.description")}
          </DialogDescription>
        </DialogHeader>

        {/* 编辑 / 预览切换 */}
        <div className="flex shrink-0 gap-1">
          <button type="button" className={tabCls(tab === "edit")} onClick={() => setTab("edit")}>
            {t("memory:editDialog.tabEdit")}
          </button>
          <button type="button" className={tabCls(tab === "preview")} onClick={() => setTab("preview")}>
            {t("memory:editDialog.tabPreview")}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {tab === "edit" ? (
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t("memory:editDialog.placeholder")}
              className="min-h-48 font-mono text-sm"
              // 有意 autofocus：编辑弹窗打开即聚焦正文输入（jsx-a11y 规则暂未启用）
              autoFocus
            />
          ) : value.trim() ? (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <Markdown content={value} />
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("memory:editDialog.emptyPreview")}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onResult(null)}>
            {t("common:action.cancel")}
          </Button>
          <Button onClick={save} disabled={!value.trim()}>
            {t("common:action.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
