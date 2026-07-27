// 语言设置区：跟随系统 / 中文 / English。
// 「跟随系统」= 清除 detector 的持久化语言键后按 navigator 重新判定。
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import i18n from "@/i18n";

const LNG_STORAGE_KEY = "i18nextLng"; // i18next-browser-languagedetector 默认键

type Choice = "system" | "zh" | "en";

function currentChoice(): Choice {
  return (localStorage.getItem(LNG_STORAGE_KEY) as Choice) ?? "system";
}

export function LanguageSection() {
  const { t } = useTranslation("settings");
  const [choice, setChoice] = useState<Choice>(() => currentChoice());

  function apply(next: Choice) {
    setChoice(next);
    if (next === "system") {
      localStorage.removeItem(LNG_STORAGE_KEY);
      // 按 navigator 重新判定：取首选语言前缀
      const sys = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
      void i18n.changeLanguage(sys);
    } else {
      void i18n.changeLanguage(next); // detector caches:['localStorage'] 会写回键
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t("language.title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("language.desc")}</p>
      </div>
      <Select value={choice} onValueChange={(v) => apply(v as Choice)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="system">{t("language.followSystem")}</SelectItem>
          <SelectItem value="zh">中文</SelectItem>
          <SelectItem value="en">English</SelectItem>
        </SelectContent>
      </Select>
    </section>
  );
}
