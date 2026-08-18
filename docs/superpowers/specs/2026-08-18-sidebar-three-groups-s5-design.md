# 侧栏三组重排 + 会话降级（S5）设计文档

> 状态：设计已与用户确认，待 review。
> 属 agent-中心 IA 蓝图的 **S5**（见 [[rework-agent-centric-ia-direction]]）。接已合 master 的 S1-S4。
> 目标：把侧栏重排为 agent-中心的三组（工作 / Agent 团队 / 知识·更多），会话降级为「工作」组平级项，Inbox 首次进侧栏；顺带折入之前 parked 的侧栏「返回」修复。

## 目标

落地蓝图 §4.1 的三组 IA。纯导航层改造 + 侧栏收藏返回/高亮修复；不动路由、不动首屏(/dashboard 聚合)与 /sessions 页本身。

## 决策（已确认）

1. **三组重排**：工作 / Agent 团队 / 知识·更多。
2. **会话降级 = 仅导航重定位**：会话在「工作」组排到任务/看板之后作平级项；首屏与 /sessions 页不改。
3. **Inbox 首次进侧栏**（Agent 团队组）；原仅铃铛入口保留。
4. **总览(/dashboard)** 留「工作」组首项（保留 home 心智）。
5. **成本(/usage)** 移入「知识·更多」组 + 顶部按钮保留（双入口）。
6. **折入侧栏返回修复**（parked）：收藏进入的项目返回回列表；收藏行按 ?open 精确高亮。
7. **路由全不变**（只改分组/顺序/标签 + 收藏返回逻辑）；深链不破；不动 Spotlight。

## 现状基线

- `src/lib/navigation.ts`：`navGroups` 三组——`nav.groupWorkspace`(总览/会话/看板/文档/阅读)、`nav.groupMore`(日历/记忆/指令/Agents)、`nav.groupSystem`(运行时/设置)。`board` 项 url=`/board?tab=board`。`flatNavItems` 派生。
- `src/components/app-sidebar.tsx`：渲染收藏组(pinned projects，`FavoriteRow` NavLink→`/board?open=<id>`，**无 isActive 高亮**) + navGroups。**可折叠逻辑硬绑**：`const isMore = group.labelKey === "nav.groupMore"`（line ~246），groupMore 默认收起（localStorage `keelson-nav-more-open`）。nav item `isActive = pathname === item.url || pathname.startsWith(item.url + "/")`。
- `FavoriteRow`：`<SidebarMenuButton asChild><NavLink to={/board?open=id}>`；未订阅 openedProjectId。
- `src/features/board/ProjectWorkspace.tsx:144-149` 返回逻辑：`const deep = !!searchParams.get("open"); closeProject(); if (deep) navigate(-1);`——侧栏收藏(?open)与文档/会话跳转(?open)被同等当 deep 处理，连点收藏后逐个回退。
- `board` 页深链 effect 只读 `?open`（`requestedRecordId`）；`closeProject()` 后 URL 仍带 ?open 会被 effect 重新打开，故清列表需 `navigate("/board")`。
- Inbox：`/inbox` 路由存在（S3），**不在 navGroups**；`notification-bell.tsx:191` 铃铛 → `/inbox`。
- 成本：`/usage` 路由；顶部 `app-header.tsx` 有「成本」按钮。
- i18n `shell` ns：`nav.groupWorkspace/groupMore/groupSystem`、各 `nav.<x>.title/description`。

## A. 三组重排（navigation.ts + i18n）

### A1. navGroups 新结构

```
[
  { labelKey: "nav.groupWork", items: [
      dashboard(总览, /dashboard, Home01Icon),
      board(看板[标签不改名], /board?tab=board, DashboardSquare02Icon),   // 排到会话前;仅移位不改 nav.board.title
      sessions(会话, /sessions, Chat01Icon),
      docs(文档, /docs, File01Icon),
  ]},
  { labelKey: "nav.groupAgentTeam", items: [
      agents(Agents, /agents, BotIcon),
      runtime(运行时, /processes, TerminalIcon),
      inbox(Inbox, /inbox, <Inbox 图标>),                      // 新进侧栏
  ]},
  { labelKey: "nav.groupKnowledge", items: [
      memory(记忆, /memory, BrainIcon),
      reading(阅读, /reading, BookOpen01Icon),                 // 从工作区移入
      calendar(日历, /calendar, Calendar03Icon),
      prompts(指令, /prompts, CommandIcon),
      usage(成本, /usage, <成本图标>),                          // 新进侧栏(顶部按钮仍在)
      settings(设置, /settings, Settings02Icon),
  ]},
]
```
- **Inbox 图标**：用 `@hugeicons/core-free-icons` 里真实导出（候选 `InboxIcon`/`Mail01Icon`/`Notification03Icon`——实现时确认存在，`tsc` 会对未导出名报错；不确定用已导入的 `Chat01Icon` 兜底）。
- **成本图标**：候选 `Coins01Icon`/`DollarCircleIcon`/`ChartLineData01Icon`——同上验证，兜底用已有图标。
- `flatNavItems` 派生不变（自动含新项）。

### A2. app-sidebar 可折叠组改绑

`app-sidebar.tsx` 的 `const isMore = group.labelKey === "nav.groupMore"` → 改为 `group.labelKey === "nav.groupKnowledge"`（「知识·更多」为可折叠的 catch-all，沿用默认收起 + localStorage 记忆）。localStorage key 可保持 `keelson-nav-more-open`（语义仍是"更多类"折叠态）。

### A3. i18n（shell ns，zh + en）

- 新组标签：`nav.groupWork`（工作/Work）、`nav.groupAgentTeam`（Agent 团队/Agent Team）、`nav.groupKnowledge`（知识 · 更多/Knowledge）。
- 新项：`nav.inbox.title`（收件箱/Inbox）+ `nav.inbox.description`；`nav.usage.title`（成本/Usage）+ `nav.usage.description`。
- 保留旧组标签键 `nav.groupWorkspace/groupMore/groupSystem`（避免别处引用报错；若确认无引用可删——实现时 grep 确认）。其余 `nav.<x>` 键复用不变。

## B. 侧栏「返回」修复 + 收藏高亮（折入 parked）

### B1. 收藏行标记 + 精确高亮（app-sidebar.tsx `FavoriteRow`）

- NavLink `to={/board?open=${id}}` → `to={/board?open=${id}&from=fav}`（标记"浏览进入，返回=回列表"）。
- 精确高亮：`FavoriteRow` 订阅当前打开项目（`useBoardStore(s => s.openedProjectId)`，或由父 `AppSidebar` 读一次传入 `activeId`），`<SidebarMenuButton isActive={openedProjectId === id}>`——仅当前打开的收藏项高亮（不再所有收藏行都因 pathname `/board` 命中）。

### B2. ProjectWorkspace 返回区分来源（ProjectWorkspace.tsx:144-149）

```js
const openId = searchParams.get("open");
const fromFav = searchParams.get("from") === "fav";
closeProject();
// 上下文跳转(文档/会话,?open 无 from=fav) → 回来源;侧栏收藏/列表进入 → 回项目列表(清 ?open)
if (openId && !fromFav) navigate(-1);
else navigate("/board");
```
- `from=fav` 参数名实现时 grep 确认无冲突；board 深链 effect 只认 `?open`，加参数不破。

## C. 明确不做（YAGNI / 边界）

- 不动首屏(/dashboard 聚合)与 /sessions 页本身（会话降级仅导航层）。
- 不加会话→任务/记忆提炼动作。
- 路由全不变；深链不破。
- 不动 Spotlight、顶部成本按钮（保留）。
- 不改收藏组拖拽/菜单逻辑（只加 from=fav + 高亮）。
- Multica 的「任务=Issues 列表视图」独立于本次（S1 已给看板/列表雏形，不在 S5 扩）。
- **不把「看板」改名为「任务」**（`nav.board.title` 不动；改名属独立框架决定，留后）。

## D. 约束（继承全局）

- 数据驱动导航改动为主；中文注释；不硬编码（组 labelKey/图标用具名）。
- 图标名必须是 `@hugeicons/core-free-icons` 真实导出（tsc 校验）；不确定用已导入图标兜底。
- 收藏返回 store 写失败重抛+toast（closeProject 无写库；navigate 纯前端）。
- i18n zh/en 键一致；旧键保留避免引用断裂。
- tsc 通过；若有侧栏/i18n 纯函数或快照测试，同步过。
- 提交不加 `Co-Authored-By: Claude` 尾注。

## E. 测试

- 纯逻辑：`flatNavItems` 含新项（Inbox/成本）；返回来源判定若抽纯函数（`backTarget(openId, fromFav) -> "-1" | "/board"`）配 vitest。
- 手验：侧栏三组顺序/标签正确；Inbox/成本可点达；知识组可折叠；收藏进入项目返回回列表、文档跳转返回回来源；当前打开的收藏项高亮。
- i18n：shell 测试（若有）过。

## 文件影响

- `src/lib/navigation.ts`（重排三组 + 加 Inbox/成本 + 新组 labelKey + 图标 import）。
- `src/components/app-sidebar.tsx`（isMore 改绑 nav.groupKnowledge；FavoriteRow 加 from=fav + 精确高亮）。
- `src/features/board/ProjectWorkspace.tsx`（返回区分来源）。
- 可选新 `src/features/board/back-target.ts`（`backTarget` 纯函数 + 测）——若抽。
- `src/i18n/locales/{zh,en}/shell.json`（新组标签 + nav.inbox/nav.usage + 保留旧键）。

## 分期

单一实现计划。任务顺序建议：①navigation.ts 三组重排 + Inbox/成本项 + 图标（i18n 键同步）；②app-sidebar isMore 改绑 + FavoriteRow from=fav + 精确高亮；③ProjectWorkspace 返回区分来源（+ 可选 backTarget 纯函数测）；④i18n zh/en 补键 + 手验清单。
