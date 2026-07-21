// MemoryEditDialog —— 记忆内容的 markdown 编辑器：源码编辑 + 实时预览切换。
// 与 PromptDialog 同接口（open/defaultValue/onResult），便于替换。
import { useEffect, useState } from "react";
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
          <DialogTitle>编辑记忆</DialogTitle>
          <DialogDescription>
            支持 markdown；内容会喂回 CLI，尽量简洁。
          </DialogDescription>
        </DialogHeader>

        {/* 编辑 / 预览切换 */}
        <div className="flex shrink-0 gap-1">
          <button type="button" className={tabCls(tab === "edit")} onClick={() => setTab("edit")}>
            编辑
          </button>
          <button type="button" className={tabCls(tab === "preview")} onClick={() => setTab("preview")}>
            预览
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {tab === "edit" ? (
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="记忆内容（支持 markdown）"
              className="min-h-48 font-mono text-sm"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          ) : value.trim() ? (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <Markdown content={value} />
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">无内容可预览</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onResult(null)}>
            取消
          </Button>
          <Button onClick={save} disabled={!value.trim()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
