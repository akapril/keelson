// 指令编辑弹窗：标题 + 正文(可含 {{变量}}) + 标签。新建/编辑共用。
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PROMPT_VARS } from "./substitute";
import type { Prompt } from "@/types/prompt";

export function PromptEditDialog({
  prompt,
  open,
  onClose,
  onSave,
}: {
  /** null = 新建 */
  prompt: Prompt | null;
  open: boolean;
  onClose: () => void;
  /** 返回 {title, content, tags}，由父组件落库 */
  onSave: (data: { title: string; content: string; tags: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  // 打开/切换时载入
  useEffect(() => {
    if (!open) return;
    setTitle(prompt?.title ?? "");
    setContent(prompt?.content ?? "");
    setTags(prompt?.tags ?? "");
  }, [open, prompt]);

  const save = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error("标题和正文不能为空");
      return;
    }
    setSaving(true);
    try {
      await onSave({ title: title.trim(), content, tags: tags.trim() });
      onClose();
    } catch (e) {
      toast.error(`保存失败：${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>{prompt ? "编辑指令" : "新建指令"}</DialogTitle>
          <DialogDescription>
            正文可用变量：
            {PROMPT_VARS.map((v) => (
              <code key={v} className="mx-0.5 rounded bg-muted px-1 font-mono text-[11px]">
                {`{{${v}}}`}
              </code>
            ))}
            插入时按当前项目/时间替换。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-1">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题（斜杠菜单按它匹配）"
          />
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="指令正文，可用 {{project}} / {{repo_path}} / {{date}} …"
            className="min-h-40"
            spellCheck={false}
          />
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="标签（空格/逗号分隔，可选）"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
