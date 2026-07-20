// PromptDialog —— 风格化的"输入型"对话框，替代原生 window.prompt。
// 受控：由调用方管理 open；提交回传输入值（Enter 或按钮），取消回传 null。
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PromptDialogProps {
  open: boolean;
  title: string;
  description?: string;
  /** 输入框上方标签（可选） */
  label?: string;
  placeholder?: string;
  /** 打开时的初始值 */
  defaultValue?: string;
  confirmText?: string;
  /** 允许空值提交（默认 true：如"留空恢复默认"的场景） */
  allowEmpty?: boolean;
  /** 提交（返回输入值）；取消返回 null。调用方据此关闭对话框。 */
  onResult: (value: string | null) => void;
}

export function PromptDialog({
  open,
  title,
  description,
  label,
  placeholder,
  defaultValue = "",
  confirmText = "确定",
  allowEmpty = true,
  onResult,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);

  // 每次打开时以 defaultValue 重置
  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  const canSubmit = allowEmpty || value.trim().length > 0;
  const submit = () => {
    if (!canSubmit) return;
    onResult(value);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onResult(null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {label && <Label htmlFor="prompt-dialog-input">{label}</Label>}
          <Input
            id="prompt-dialog-input"
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onResult(null)}>
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {confirmText}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
