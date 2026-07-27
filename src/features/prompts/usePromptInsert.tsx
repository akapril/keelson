// 指令插入（会话/AI 面板复用）：返回「指令库按钮 + 斜杠浮层 + 键盘处理」。
// 用法：const pi = usePromptInsert({input,setInput,ctx});
//   输入框 onKeyDown 先调 pi.onKeyDown(e)，返回 true 说明已被斜杠浮层消费；
//   把输入框包在 relative 容器里渲染 {pi.overlay}；旁边放 {pi.button}。
import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { CommandIcon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listPrompts } from "@/lib/pb/prompts";
import { substituteVars, type PromptVarCtx } from "./substitute";
import { promptType } from "./prompt-utils";
import type { Prompt } from "@/types/prompt";

export function usePromptInsert({
  input,
  setInput,
  ctx,
  disabled,
}: {
  input: string;
  setInput: (v: string) => void;
  ctx: PromptVarCtx;
  disabled?: boolean;
}) {
  const { t } = useTranslation("shell");
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);

  const ensureLoaded = () => {
    if (loaded) return;
    setLoaded(true);
    listPrompts().then(setPrompts).catch(() => setPrompts([]));
  };

  // 插入用只取「片段」类型（报告模板不在会话/AI 面板插入）
  const snippets = useMemo(() => prompts.filter((p) => promptType(p) === "snippet"), [prompts]);

  // 斜杠：input 恰为 /token（整段无空格/换行，token 可空=/）
  const slashToken = useMemo(() => {
    const m = input.match(/^\/(\S*)$/);
    return m ? m[1] : null;
  }, [input]);

  useEffect(() => {
    if (pickerOpen) ensureLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen]);
  useEffect(() => {
    if (slashToken !== null) {
      ensureLoaded();
      setSlashIndex(0);
      setSlashDismissed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashToken]);

  const slashMatches = useMemo(() => {
    if (slashToken === null) return [];
    const q = slashToken.toLowerCase();
    return snippets.filter((p) => !q || p.title.toLowerCase().includes(q)).slice(0, 8);
  }, [slashToken, snippets]);

  const slashActive = slashToken !== null && !slashDismissed && slashMatches.length > 0;

  const subst = (p: Prompt) => substituteVars(p.content, ctx, new Date());
  // 斜杠：整段就是 /token，直接替换为指令
  const insertReplace = (p: Prompt) => {
    setInput(subst(p));
    setSlashDismissed(true);
  };
  // 按钮：追加到当前输入（非空则换行分隔）
  const insertAppend = (p: Prompt) => {
    const text = subst(p);
    setInput(input.trim() ? `${input}\n${text}` : text);
  };

  const onKeyDown = (e: React.KeyboardEvent): boolean => {
    if (!slashActive) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSlashIndex((i) => (i + 1) % slashMatches.length);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
      return true;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      insertReplace(slashMatches[slashIndex] ?? slashMatches[0]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setSlashDismissed(true);
      return true;
    }
    return false;
  };

  const overlay = slashActive ? (
    <div className="absolute bottom-full left-0 z-20 mb-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-md">
      <div className="border-b border-border px-2.5 py-1 text-[10px] text-muted-foreground">
        {t("prompts.insert.footerHint")}
      </div>
      <ul className="max-h-56 overflow-y-auto py-1">
        {slashMatches.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertReplace(p);
              }}
              className={`flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left text-sm ${
                i === slashIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"
              }`}
            >
              <span className="shrink-0 font-medium">/{p.title}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {p.content}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  const filteredPicker = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return snippets.filter(
      (p) =>
        !q || p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q),
    );
  }, [snippets, pickerQuery]);

  const button = (
    <>
      <Button
        variant="ghost"
        size="icon"
        title={t("prompts.insert.btnTitle")}
        aria-label={t("prompts.insert.btnAriaLabel")}
        disabled={disabled}
        onClick={() => setPickerOpen(true)}
      >
        <HugeiconsIcon icon={CommandIcon} strokeWidth={2} />
      </Button>
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="flex max-h-[70vh] w-full max-w-md flex-col">
          <DialogHeader>
            <DialogTitle>{t("prompts.insert.dialogTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            placeholder={t("prompts.insert.searchPlaceholder")}
          />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto py-1">
            {filteredPicker.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                <Trans
                  i18nKey="prompts.insert.empty"
                  ns="shell"
                  components={{
                    1: (
                      <Link
                        to="/prompts"
                        className="text-primary hover:underline"
                        onClick={() => setPickerOpen(false)}
                      />
                    ),
                  }}
                />
              </p>
            ) : (
              filteredPicker.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    insertAppend(p);
                    setPickerOpen(false);
                  }}
                  className="block w-full rounded-lg border border-border bg-card p-2.5 text-left transition-colors hover:bg-accent"
                >
                  <span className="block truncate text-sm font-medium text-foreground">
                    {p.title}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block whitespace-pre-wrap text-xs text-muted-foreground">
                    {p.content}
                  </span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );

  return { button, overlay, onKeyDown };
}
