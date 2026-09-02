// 快速记录条 —— Toggl 式零摩擦捕获：输入「刚才做了什么」回车，即以当前时刻在当天建一条事件。
// 非阻塞：回车瞬间清空 + 保留焦点，onSubmit 甩后台（乐观插卡在 store 内），连录如流水。
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

export function QuickLogBar({ onSubmit }: { onSubmit: (text: string) => void }) {
  const { t } = useTranslation("calendar");
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // 回车提交：避开中文输入法组合态；清空续录、保留焦点
  const submit = () => {
    const v = text.trim();
    if (!v) return;
    setText("");
    inputRef.current?.focus();
    onSubmit(v);
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <HugeiconsIcon
        icon={Add01Icon}
        strokeWidth={2}
        className="size-4 shrink-0 text-muted-foreground"
      />
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={t("quicklog.placeholder")}
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      <span className="hidden shrink-0 text-2xs text-muted-foreground sm:inline">
        {t("quicklog.hint")}
      </span>
    </div>
  );
}
