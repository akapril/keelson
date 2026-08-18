# 技能一等化（S6）设计文档

> 状态：设计已与用户确认，待 review。
> 属 agent-中心 IA 蓝图的 **S6**（见 [[rework-agent-centric-ia-direction]]）。接已合 master 的 S1-S5。
> 目标：把「指令库(prompts)」升级出一等的 **技能(skill)** 类型——技能是绑给 agent 作系统提示注入的可复用能力，与「插入片段(snippet)」「报告模板(report)」并列且互不污染。

## 背景与真实缺口

蓝图把 S6 定为「prompts→绑 agent」，但 **S2 已把绑定+注入全做完**：`agent_profiles.skill_prompts`（关联 prompts，多选）+ `skill_text` 自由文本，AgentEditSheet 可勾选绑定，`resolve_agent`（`src-tauri/src/agent/resolve.rs`）拉取绑定 prompts 的 content + skill_text 注入任务 prompt。

**唯一真实粗糙点：** prompts 只有 `snippet`/`report` 两型，无「技能」概念；AgentEditSheet 的技能选择器 `listPrompts()` 不过滤，把**报告模板也列进技能候选**（噪音）。S6 = 补上「技能」类型 + 库化，让技能成为与片段/报告区分的一等可复用能力。

## 决策（已确认）

1. **范围 = 技能类型 + 库化**（非"仅小修"，也非"技能独立实体+元数据"的更重方案）。
2. **skill = prompts 的第三种类型**（与 snippet/report 并列，单选，一个 prompt 一种类型）。
3. **技能选择器只列 skill 类型 + 迁移现有**：把当前被任何 agent 绑定过的 prompt 自动转 `type=skill`，保留绑定不断、旧绑定升为一等技能。
4. **技能不做 `{{变量}}` 替换**：`resolve_agent` 注入逻辑完全不动（按 id 拉 content 原样注入）。
5. 技能天然排除于聊天插入/斜杠/报告模板面（经归一函数自动实现）。

## 现状基线

- `src/types/prompt.ts`：`PromptType = "snippet" | "report"`；`Prompt.type?: PromptType`。
- `src/features/prompts/prompt-utils.ts:18` `promptType(p)`：`p.type === "report" ? "report" : "snippet"`——**所有类型消费的归一choke point**。`PROMPT_TYPE_LABEL: Record<PromptType,string>` = **硬编码中文字面量** `{snippet:"片段", report:"报告模板"}`（非 i18n；下拉/胶囊用）。
- 消费面按归一类型过滤：
  - `src/features/prompts/usePromptInsert.tsx:50`：`prompts.filter(p => promptType(p)==="snippet")`（插入菜单/斜杠只列片段）。
  - 报告页选择器：`promptType(p)==="report"`。
  - `seed-defaults.ts`：按 `promptType==="report"` 播种报告模板。
- `src/pages/prompts.tsx`（/prompts 页，i18n 用 **shell ns** `prompts.*`）：
  - `:45` `typeFilter: "all" | PromptType`；`:78` 过滤 `typeFilter==="all" || promptType(p)===typeFilter`（加 skill tab 后天然生效）。
  - `:142` 筛选 tab 数组硬列 `[["all",filterAll],["snippet",typeSnippet],["report",typeReport]]`——**须加 skill 项**。
  - `:204`/`:209` 卡片徽标是**二元三目**（`promptType==="report"?…:…` 色 + `promptType==="snippet"? typeSnippet : typeReport` 标签）——**skill 会落入 else 误显「报告模板」，须改三态**。
  - `:253` `defaultType = typeFilter==="all" ? "snippet" : typeFilter`（skill 直通，无需改）。
- `src/features/prompts/PromptEditDialog.tsx:96`：类型选择器硬列 `["snippet","report"]`——**须加 skill**；`:76` 正文提示是**二元三目** `type==="snippet" ? (片段提示) : (报告提示)`——**skill 落入 report 提示，须加第三分支**。
- `src/features/agents/AgentEditSheet.tsx`：`listPrompts()`（无过滤）→ 技能选择器多选勾选任意 prompt；`skill_prompts` 存 id 数组。
- `src/lib/pb/prompts.ts:9` `listPrompts()`：拉全部未删 prompts（无 type 过滤）。
- `src-tauri/pb_migrations/1720001800_prompt_type.js`：`prompts.type` = **select field**，`maxSelect:1`，`values:["snippet","report"]`——加 skill **须 schema 迁移**。
- `resolve_agent`（resolve.rs）：`skill_prompts` id 数组 → OR 查询取 `prompts.content` 注入。**按 id 解析，与 type 无关**——迁移后绑定照常解析。

## A. 数据模型 + 迁移

### A1. 新迁移 `src-tauri/pb_migrations/1786500000_prompt_skill.js`

- **up：**
  1. `prompts.type` select field values `["snippet","report"]` → `["snippet","report","skill"]`（取出 field，改 values，save collection）。幂等：已含 skill 则跳过。
  2. **回填**：遍历 `agent_profiles` 全部记录，收集所有 `skill_prompts`（关联字段，值为 id 数组）里出现的 prompt id 去重；对每个 id 找到 prompts 记录，若其 `type !== "skill"` 则设 `type="skill"` 并 save。沿用 `1720001800` 的 `findAllRecords`/`getString`/`set`/`save` + try/catch best-effort 范式，幂等安全。
- **down：** values 还原 `["snippet","report"]`（best-effort try/catch）；不强制回退已转 skill 的记录（down 仅结构还原，遵循现有迁移 down 只删字段/结构的克制风格）。
- 时间戳 `1786500000` 紧接 `1786400000_agent_profiles`。

### A2. 类型归一（`src/types/prompt.ts` + `src/features/prompts/prompt-utils.ts`）

- `PromptType = "snippet" | "report" | "skill"`。
- `promptType(p)`：`p.type === "report" ? "report" : p.type === "skill" ? "skill" : "snippet"`（未知/空仍归 snippet，兼容旧数据）。
- `PROMPT_TYPE_LABEL` 加 `skill: "技能"`（沿用现有硬编码中文字面量风格；`Record<PromptType,string>` 加 skill 后 tsc 强制补全，防漏）。用户可见 tab/徽标走 i18n `prompts.typeSkill`（见 D）。

**自动收益：** `usePromptInsert`（`==="snippet"`）与报告选择器（`==="report"`）无需改动即排除技能——技能不进聊天插入/斜杠/报告面。

## B. /prompts 页（`src/pages/prompts.tsx`）

- **类型筛选**（`:142`）：tab 数组加 `["skill", t("prompts.typeSkill")]`（筛选逻辑 `:78` 复用 `promptType`，天然生效）。
- **卡片徽标**（`:204`/`:209`）：**把二元三目改三态**——按 `promptType(p)` 分 snippet/report/skill 三种，skill 用独立标签 `t("prompts.typeSkill")` 与徽标色（复用现有徽标样式，skill 给一档区分色，如复用现有中性/主色）。**不可让 skill 落入 report 分支**。
- **`PromptEditDialog`**（`src/features/prompts/PromptEditDialog.tsx`）：
  - 类型选择器（`:96`）`["snippet","report"]` → `["snippet","report","skill"]`。
  - 正文提示（`:76`）**二元三目改三态**：加 `type==="skill"` 分支 → "作为 agent 系统提示注入，不替换变量"（i18n），与 snippet/report 提示并列。
- 空态/搜索文案不变（复用现有）。

## C. AgentEditSheet 技能选择器

- 技能候选来源：`listPrompts()` 结果 → **前端过滤 `promptType(p)==="skill"`**（不改 `lib/pb/prompts.ts` 的通用 `listPrompts`，避免影响其它调用方；在 AgentEditSheet 内 `useMemo` 派生 skills）。
- 空态（无技能类型 prompt）：引导文案"还没有技能，去指令库新建"，链接 `/prompts`（复用现有 `noPromptsHint` 文案位，改为技能语义）。
- 已绑定但非 skill 类型的历史 prompt：迁移后已转 skill，正常显示勾选；未被迁移覆盖的极端情况（无），不特殊处理。

## D. i18n（**shell ns**，zh + en）

prompts 相关 i18n 均在 shell ns 的 `prompts.*`；agents 相关在 `agentsPage.*`（实现时按现有键归位）。新增：
- `prompts.typeSkill`「技能」/「Skill」（筛选 tab + 卡片徽标）。
- `prompts.edit.typeSkill`（或复用 PromptEditDialog 现有 typeSnippet/typeReport 提示位）技能正文提示："作为 agent 系统提示注入，不替换变量" / 英文对应。
- AgentEditSheet 技能空态引导（复用/改 `agentsPage.noPromptsHint` 为技能语义，zh/en）。
- 键 zh/en 一致；旧键保留。

## E. 明确不做（YAGNI / 边界）

- 技能**不做 `{{repo_path}}`/`{{project}}` 变量替换**——`resolve_agent` 注入逻辑完全不动。
- 不做内置技能库 / 技能名·描述·when-to-use 元数据（被否的"更重"方案）。
- prompts.type 保持单选（一个 prompt 不能既是技能又是片段；需要则复制）。
- 不改 `resolve_agent` / `skill_text` / worker / 注入拼接（Rust 侧零改动）。
- 不改 `lib/pb/prompts.ts` 通用 `listPrompts`（过滤放消费方）。
- 不动 seed-defaults 报告模板播种（不预置技能）。

## F. 约束（继承全局）

- 中文注释；不硬编码（类型值/标签用具名常量与 i18n 键）。
- 迁移沿用现有 select 改值 + best-effort 回填 + try/catch 幂等范式；软删/tombstone 不涉及（仅改 type 字段）。
- store 写失败重抛 + toast（prompts store 现有范式；本设计 create/update 走既有路径）。
- TDD：`promptType` skill 分支纯函数先写失败测试；断言 snippets 过滤排除技能。
- Rust 无改动 → 无需 cargo check（除非误触）；tsc 通过；vitest 过。
- 提交不加 `Co-Authored-By: Claude` 尾注。
- 只 `git add` 各 Task 确切文件，严禁 `-A`/`.`（工作区有未跟踪 spec/plan + 私有 docs/promotion/）。

## G. 测试

- 纯函数：`promptType({type:"skill"})==="skill"`；`promptType({type:"report"})==="report"`；`promptType({})==="snippet"`（兼容）；`usePromptInsert` 的 snippets 过滤排除 skill（可测归一后 filter 结果）。
- 手验（GUI 重启触发迁移）：
  - 现有已被 agent 绑定的 prompt 迁移后在 /prompts 显示为「技能」类型。
  - /prompts 类型筛选「技能」可用；新建可选技能类型，正文提示为系统提示语义。
  - AgentEditSheet 技能选择器只列技能类型 prompt；报告模板/片段不再出现；空态引导可点达 /prompts。
  - 聊天斜杠/插入菜单不含技能；报告模板选择器不含技能。
  - 绑定技能的 agent 派活，注入行为与迁移前一致（resolve_agent 未变）。

## 文件影响

- 新 `src-tauri/pb_migrations/1786500000_prompt_skill.js`（select 加 skill + 回填绑定 prompt→skill）。
- `src/types/prompt.ts`（PromptType 加 skill）。
- `src/features/prompts/prompt-utils.ts`（promptType 加 skill 分支 + label）。
- `src/features/prompts/prompt-utils.test.ts`（若无则新建；promptType skill 分支单测）。
- `src/features/prompts/PromptEditDialog.tsx`（类型选择器加 skill + 正文提示二元→三态）。
- `src/pages/prompts.tsx`（类型筛选 tab 加「技能」+ 卡片徽标二元→三态）。
- `src/features/agents/AgentEditSheet.tsx`（技能选择器只列 skill + 空态语义）。
- `src/i18n/locales/{zh,en}/shell.json`（`prompts.typeSkill` + 技能正文提示 + `agentsPage` 技能空态；shell ns）。

## 分期

单一实现计划。任务顺序建议：
1. 迁移 `1786500000_prompt_skill.js`（select 加 skill + 回填）。
2. 类型归一：`PromptType` 加 skill + `promptType()` 分支 + label（TDD 纯函数）。
3. /prompts：类型筛选加「技能」+ `PromptEditDialog` 类型选择器/技能提示。
4. AgentEditSheet 技能选择器只列 skill + 空态引导。
5. i18n zh/en 补键 + 手验清单。
