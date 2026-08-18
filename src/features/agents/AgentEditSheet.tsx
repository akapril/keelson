// 队友编辑抽屉：新建 / 编辑 AgentProfile 的完整表单。
// 字段：name / emoji / color / provider / instructions / skill_prompts(多选) /
//       skill_text / timeout_secs / max_concurrent / with_tools / auto_commit。
// 保存调 useAgentStore.createAgent/updateAgent，失败重抛并 toast.error。
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { useAgentStore } from "@/store/agents";
import { listPrompts } from "@/lib/pb/prompts";
import { promptType } from "@/features/prompts/prompt-utils";
import { PROVIDER_META } from "@/lib/providers";
import type { AgentProfile } from "@/types/agent-profile";
import type { Prompt } from "@/types/prompt";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// provider 下拉固定为 S1 支持的两个（claude / codex）
const SUPPORTED_PROVIDERS = ["claude", "codex"] as const;

// 颜色下拉的「无色」哨兵值：Radix Select 禁止 value=""，用此占位映射空字符串
const NO_COLOR = "__none__";

interface Props {
  /** 编辑时传入，新建时 undefined */
  editing?: AgentProfile;
  open: boolean;
  onClose: () => void;
}

export function AgentEditSheet({ editing, open, onClose }: Props) {
  const { t } = useTranslation("board");

  // 表单字段状态
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🤖");
  const [color, setColor] = useState("");
  const [provider, setProvider] = useState<string>("claude");
  const [instructions, setInstructions] = useState("");
  const [skillPrompts, setSkillPrompts] = useState<string[]>([]);
  const [skillText, setSkillText] = useState("");
  const [timeoutSecs, setTimeoutSecs] = useState<string>("");
  const [maxConcurrent, setMaxConcurrent] = useState<string>("");
  const [withTools, setWithTools] = useState(true);
  const [autoCommit, setAutoCommit] = useState(false);

  // 指令库列表（用于技能多选）
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [saving, setSaving] = useState(false);

  // 只把技能类型(skill)的指令作为可绑定技能（片段/报告模板不列）
  const skills = useMemo(() => prompts.filter((p) => promptType(p) === "skill"), [prompts]);

  // 打开时加载指令库 + 回填编辑态字段
  useEffect(() => {
    if (!open) return;
    // 拉取全部指令库列表（下方 useMemo 过滤出 skill 类型；若拉取失败则展示空列表）
    listPrompts()
      .then(setPrompts)
      .catch(() => setPrompts([]));

    if (editing) {
      setName(editing.name);
      setEmoji(editing.emoji || "🤖");
      setColor(editing.color || "");
      setProvider(editing.provider || "claude");
      setInstructions(editing.instructions || "");
      setSkillPrompts(editing.skill_prompts || []);
      setSkillText(editing.skill_text || "");
      setTimeoutSecs(editing.timeout_secs ? String(editing.timeout_secs) : "");
      setMaxConcurrent(editing.max_concurrent ? String(editing.max_concurrent) : "");
      setWithTools(editing.with_tools !== false); // 默认 true
      setAutoCommit(editing.auto_commit ?? false);
    } else {
      // 新建：重置为默认值
      setName("");
      setEmoji("🤖");
      setColor("");
      setProvider("claude");
      setInstructions("");
      setSkillPrompts([]);
      setSkillText("");
      setTimeoutSecs("");
      setMaxConcurrent("");
      setWithTools(true);
      setAutoCommit(false);
    }
  }, [open, editing]);

  /** 切换指令库技能多选 */
  const toggleSkillPrompt = (id: string) => {
    setSkillPrompts((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  /** 提交保存 */
  const handleSave = async () => {
    // 校验必填：name + provider
    if (!name.trim()) {
      toast.error(t("agentsPage.errorNameRequired"));
      return;
    }
    if (!provider) {
      toast.error(t("agentsPage.errorProviderRequired"));
      return;
    }

    const draft: Partial<AgentProfile> = {
      name: name.trim(),
      emoji: emoji.trim() || "🤖",
      color: color || undefined,
      provider,
      instructions: instructions.trim() || undefined,
      skill_prompts: skillPrompts.length > 0 ? skillPrompts : undefined,
      skill_text: skillText.trim() || undefined,
      timeout_secs: timeoutSecs ? Number(timeoutSecs) : undefined,
      max_concurrent: maxConcurrent ? Number(maxConcurrent) : undefined,
      with_tools: withTools,
      auto_commit: autoCommit,
    };

    setSaving(true);
    try {
      if (editing) {
        await useAgentStore.getState().updateAgent(editing.id, draft);
      } else {
        await useAgentStore.getState().createAgent(draft);
      }
      toast.success(editing ? t("agentsPage.toastUpdateSuccess") : t("agentsPage.toastCreateSuccess"));
      onClose();
    } catch (e) {
      toast.error(t("agentsPage.toastSaveError", { msg: String(e) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex flex-col overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {editing ? t("agentsPage.titleEdit") : t("agentsPage.titleNew")}
          </SheetTitle>
          <SheetDescription>
            {t("agentsPage.sheetDesc")}
          </SheetDescription>
        </SheetHeader>

        {/* 表单主体 */}
        <div className="flex flex-1 flex-col gap-4 px-6 py-2">
          {/* 名称（必填） */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-name">
              {t("agentsPage.fieldName")}
              <span className="text-destructive"> *</span>
            </Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("agentsPage.namePlaceholder")}
            />
          </div>

          {/* Emoji */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-emoji">{t("agentsPage.fieldEmoji")}</Label>
            <Input
              id="agent-emoji"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              placeholder="🤖"
              className="w-24"
            />
          </div>

          {/* 主题色（来自 PROVIDER_META 键） */}
          <div className="flex flex-col gap-1.5">
            <Label>{t("agentsPage.fieldColor")}</Label>
            {/*
              Radix Select 不允许 SelectItem value=""，否则运行时抛错导致崩溃。
              用哨兵 NO_COLOR 代替空字符串：
                - value 绑定：空色→哨兵，让「无色」项高亮
                - onValueChange：哨兵→还原为空字符串写入 state
            */}
            <Select
              value={color || NO_COLOR}
              onValueChange={(v) => setColor(v === NO_COLOR ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("agentsPage.colorPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {/* 用哨兵值而非空字符串，避免 Radix 抛出空 value 错误 */}
                <SelectItem value={NO_COLOR}>{t("agentsPage.colorNone")}</SelectItem>
                {Object.keys(PROVIDER_META).map((key) => (
                  <SelectItem key={key} value={key}>
                    {key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Provider（必填，固定 claude/codex） */}
          <div className="flex flex-col gap-1.5">
            <Label>
              {t("agentsPage.fieldProvider")}
              <span className="text-destructive"> *</span>
            </Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue placeholder={t("agentsPage.providerPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p === "claude" ? "Claude" : "Codex"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 默认指令 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-instructions">{t("agentsPage.fieldInstructions")}</Label>
            <Textarea
              id="agent-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={t("agentsPage.instructionsPlaceholder")}
              rows={4}
            />
          </div>

          {/* 绑定技能（指令库多选）：无论指令库是否为空都显示该区块 */}
          <div className="flex flex-col gap-1.5">
            <Label>{t("agentsPage.fieldSkillPrompts")}</Label>
            {skills.length > 0 ? (
              // 有技能时展示复选框列表
              <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2 space-y-1.5">
                {skills.map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`skill-${p.id}`}
                      checked={skillPrompts.includes(p.id)}
                      onCheckedChange={() => toggleSkillPrompt(p.id)}
                    />
                    <label
                      htmlFor={`skill-${p.id}`}
                      className="cursor-pointer text-sm leading-none"
                    >
                      {p.title}
                    </label>
                  </div>
                ))}
              </div>
            ) : (
              // 无技能时引导去指令库新建技能类型指令
              <p className="text-xs text-muted-foreground">
                {t("agentsPage.noSkillsHint")}
              </p>
            )}
          </div>

          {/* 自由文本技能 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-skill-text">{t("agentsPage.fieldSkillText")}</Label>
            <Textarea
              id="agent-skill-text"
              value={skillText}
              onChange={(e) => setSkillText(e.target.value)}
              placeholder={t("agentsPage.skillTextPlaceholder")}
              rows={3}
            />
          </div>

          {/* 超时秒数 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-timeout">{t("agentsPage.fieldTimeout")}</Label>
            <Input
              id="agent-timeout"
              type="number"
              min={0}
              value={timeoutSecs}
              onChange={(e) => setTimeoutSecs(e.target.value)}
              placeholder={t("agentsPage.timeoutPlaceholder")}
            />
          </div>

          {/* 并发上限 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-concurrent">{t("agentsPage.fieldMaxConcurrent")}</Label>
            <Input
              id="agent-concurrent"
              type="number"
              min={1}
              value={maxConcurrent}
              onChange={(e) => setMaxConcurrent(e.target.value)}
              placeholder={t("agentsPage.maxConcurrentPlaceholder")}
            />
          </div>

          {/* 工具开关（with_tools，默认 true） */}
          <div className="flex items-center gap-3">
            <Checkbox
              id="agent-with-tools"
              checked={withTools}
              onCheckedChange={(v) => setWithTools(v === true)}
            />
            <label htmlFor="agent-with-tools" className="cursor-pointer text-sm">
              {t("agentsPage.fieldWithTools")}
            </label>
          </div>

          {/* 自动提交（auto_commit，默认 false） */}
          <div className="flex items-center gap-3">
            <Checkbox
              id="agent-auto-commit"
              checked={autoCommit}
              onCheckedChange={(v) => setAutoCommit(v === true)}
            />
            <label htmlFor="agent-auto-commit" className="cursor-pointer text-sm">
              {t("agentsPage.fieldAutoCommit")}
            </label>
          </div>
        </div>

        {/* 底部操作按钮 */}
        <SheetFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("agentsPage.cancelBtn")}
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? t("agentsPage.saving") : t("agentsPage.saveBtn")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
