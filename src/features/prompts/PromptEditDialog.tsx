// 指令编辑弹窗：标题 + 正文(可含 {{变量}}) + 标签。新建/编辑共用。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { cn } from "@/lib/utils";
import { PROMPT_VARS } from "./substitute";
import { promptType } from "./prompt-utils";
import type { Prompt, PromptType } from "@/types/prompt";

export function PromptEditDialog({
  prompt,
  open,
  defaultType = "snippet",
  onClose,
  onSave,
}: {
  /** null = 新建 */
  prompt: Prompt | null;
  open: boolean;
  /** 新建时的默认类型（如从报告页跳来则 report） */
  defaultType?: PromptType;
  onClose: () => void;
  /** 返回 {title, content, tags, type}，由父组件落库 */
  onSave: (data: { title: string; content: string; tags: string; type: PromptType }) => Promise<void>;
}) {
  const { t } = useTranslation("shell");
  const { t: tCommon } = useTranslation("common");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [type, setType] = useState<PromptType>("snippet");
  const [saving, setSaving] = useState(false);

  // 打开/切换时载入（编辑取原类型；新建用 defaultType）
  useEffect(() => {
    if (!open) return;
    setTitle(prompt?.title ?? "");
    setContent(prompt?.content ?? "");
    setTags(prompt?.tags ?? "");
    setType(prompt ? promptType(prompt) : defaultType);
  }, [open, prompt, defaultType]);

  const save = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error(t("prompts.edit.toast.emptyError"));
      return;
    }
    setSaving(true);
    try {
      await onSave({ title: title.trim(), content, tags: tags.trim(), type });
      onClose();
    } catch (e) {
      toast.error(t("prompts.edit.toast.saveError", { msg: String(e) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>{prompt ? t("prompts.edit.titleEdit") : t("prompts.edit.titleCreate")}</DialogTitle>
          <DialogDescription>
            {type === "snippet" ? (
              <>
                {/* 说明文字保留中文，因为变量名本身是占位符 */}
                正文可用变量：
                {PROMPT_VARS.map((v) => (
                  <code key={v} className="mx-0.5 rounded bg-muted px-1 font-mono text-[11px]">
                    {`{{${v}}}`}
                  </code>
                ))}
                插入时按当前项目/时间替换。
              </>
            ) : type === "skill" ? (
              t("prompts.edit.typeSkill")
            ) : (
              t("prompts.edit.typeReport")
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-1">
          {/* 类型选择：片段 / 报告模板 / 技能 */}
          <div className="flex gap-1.5">
            {(["snippet", "report", "skill"] as PromptType[]).map((tp) => (
              <button
                key={tp}
                type="button"
                onClick={() => setType(tp)}
                className={cn(
                  "rounded-lg border px-3 py-1 text-xs transition-colors",
                  type === tp
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                {tp === "snippet"
                  ? t("prompts.typeSnippet")
                  : tp === "skill"
                    ? t("prompts.typeSkill")
                    : t("prompts.typeReport")}
              </button>
            ))}
          </div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("prompts.edit.titlePlaceholder")}
          />
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t("prompts.edit.bodyPlaceholder")}
            className="min-h-40"
            spellCheck={false}
          />
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder={t("prompts.edit.tagsPlaceholder")}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {tCommon("action.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? t("prompts.edit.saving") : tCommon("action.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
