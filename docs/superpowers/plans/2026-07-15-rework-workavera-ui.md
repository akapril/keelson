# rework Phase ②.5 — workavera UI 采纳 + 项目工作台 IA

> 决策(2026-07-15,用户拍板):整体移植 workavera 的**外壳 + 设计系统 + 看板组件**(Apache-2.0,合法),
> 重构信息架构为**「项目工作台」**(本地仓库 = 一等项目,打开=一个含 概览/会话/看板/文档/AI 标签页的工作台)。
> workavera 参考(只读):`D:/workspace/workavera/frontend/src/`。

## 保留 / 替换 / 丢弃

- **保留(几乎不动)**:PB 迁移 `board_*`、`git_info`、我们的 board store 领域逻辑(rank 中点、created_by、repo_path、
  promote / session→task chemistry)、sessions 后端扫描器、bootstrap/auth 侧车。
- **替换**:整个前端**展示层 + 外壳 + 主题**——我这次手搓的 TaskSheet/ProjectSheet/StatusColumn/TaskCard/KanbanBoard
  以及 MVP 的 AppSidebar/布局/index.css tokens,换成移植+改写后的 workavera 组件。
- **丢弃(YAGNI,后置)**:documents/doc-link、task/project 活动日志、成员管理/owner 转移、多项目手风琴 + 分页、
  文档(milkdown)与 AI(ai-sdk)标签页先做**占位**。calendar/contacts/reading/micro-apps/dashboard 不引入。

## 全局约束(不可破)

- 隔离:`invoke` 只在 `src/lib/tauri/ipc.ts`;`pb.collection`/`pb.send`/`pb.files`/`pb.subscribe` 只在 `src/lib/pb/*`。
  workavera 的 store 在内部直接调 pb → **仿写不照抄**,把 PB 面下沉为 `lib/pb/*` 辅助函数(含 `subscribeCollection`)。
- 主题:采用 workavera 的中性 oklch tokens(与我们"clean neutral,非莫兰迪"一致);class-based `.dark`;
  theme-provider **剥离后端持久化**(纯 localStorage)。
- 图标统一 HugeIcons(替换 lucide);字体 Inter Variable。中文注释。
- 每移植一个 workavera 文件,保留其 Apache-2.0 版权头;仓库根加 `NOTICE` 注明"改编自 workavera (Apache-2.0)"。
- 验证由控制器居中跑:`pnpm exec tsc --noEmit` + `pnpm test` + 需要时 `cargo`。子 agent 只写码不跑命令,文件集互不重叠。

---

## 里程碑 M1 — 设计系统 + 外壳采纳(视觉即刻升级)

> 目标:全站换成 workavera 质感(胶囊按钮/Inter/HugeIcons/精致侧栏/sonner/动画),现有页面被新外壳重新皮肤化。

- [ ] **M1-1 依赖 + 地基(控制器,串行)**:package.json 加 `radix-ui, class-variance-authority, clsx, tailwind-merge,
  @hugeicons/react, @hugeicons/core-free-icons, @fontsource-variable/inter, tw-animate-css, sonner, next-themes,
  cmdk, react-day-picker, date-fns, react-colorful, motion`;`pnpm install`。移植 `lib/utils.ts`(cn)、`hooks/use-mobile.ts`、
  替换 `src/index.css` 的 tokens(oklch 中性 + radius 阶梯 + Inter + tw-animate-css 导入;丢弃 milkdown/streamdown 段)。
  移植 `theme-provider.tsx`(剥离 `useAuthStore.updateTheme`)+ `theme-toggle.tsx`。`sonner.tsx` 的 useTheme 指向本地 provider。
  验证:tsc + `pnpm build` 通过。
- [ ] **M1-2 ui/ 原语(并行 agent,按批,互不重叠文件)**:移植 `components/ui/*` 我们需要的:button(+variants)、
  badge、avatar、alert-dialog、dialog、sheet、dropdown-menu、popover、tooltip、select、tabs、collapsible、separator、
  label、card、input、textarea、input-group、button-group、breadcrumb、skeleton、spinner、sonner、command、calendar、
  date-picker、color-picker、sidebar、scroll-area(如有)。每文件保留版权头,依赖 radix-ui + cn + HugeIcons。
- [ ] **M1-3 外壳(控制器 + agent)**:移植 `dashboard-layout` + `sidebar.tsx` + `app-sidebar`(重写 `navigation.ts` 为 rework 路由)
  + `app-header`(剥离 notifications/chat/active-run,保留 breadcrumb + theme toggle + 用户菜单占位)+ `logo`(rework 品牌)。
  接入 `router.tsx`(保留我们的 HashRouter + bootstrap gate)。
- [ ] **M1-4 皮肤化现有页**:sessions/board/settings 页在新外壳下最小改动跑通(按钮/输入换新原语)。验证 tsc+test+build。
- [ ] **M1-5 提交** + `NOTICE` 文件。

## 里程碑 M2 — 项目工作台 IA + 看板移植

> 目标:本地仓库=项目;打开项目=工作台(标签页);用 workavera 看板替换我的手搓看板。

- [ ] **M2-1 深链接**:抄 `lib/workspace-navigation.ts`(`?open=<id>`)。
- [ ] **M2-2 lib/pb 下沉 + store 适配**:在 `lib/pb/board.ts` 补齐 ported 组件所需 PB 面(getOne/subscribeCollection 等);
  board store 暴露 ported 组件期望的选择器/动作别名(states/todos/labels/openedProject/openedTask/openProject/openTask/
  clearOpenedRecord/moveTodo≈moveTask/addTodo≈createTask/…),移植 `PRIORITY_META`、`STATE_CATEGORY_META`、`projectParticipants`。
- [ ] **M2-3 看板组件移植(并行 agent)**:`status-column`(照抄)、`todo-card`(去 documents/头像降级)、
  `todo-card-sheet`(去 documents/activity,create 补 created_by,字段映射到我们)、`kanban-board`(改单项目:去手风琴/分页,
  保留 DndContext + 拖拽 rank)、`project-sheet`(精简版:states/labels/repo_path;去 members/owner/activity;addProject 改客户端顺序创建)。
  删除我手搓的 5 个 board 组件。
- [ ] **M2-4 项目工作台容器**:左侧项目栏(board_projects + 自动探测的会话项目两级);主区打开项目 → 标签页
  `概览 | 会话 | 看板 | 文档(占位) | AI(占位)`。board 标签 = 移植后的 kanban-board;深链接 resolve effect(仿 board.tsx)。
- [ ] **M2-5 会话标签**:现有 session hub 作为「会话」标签,按 `project_path == repo_path` scope 到当前项目;全局搜索保留(spotlight)。
- [ ] **M2-6 验证 + 提交**(含 live-PB 冒烟)。

## 里程碑 M3 — chemistry 融入工作台 + 验收

- [ ] **M3-1 概览标签**:git 状态条 + 关联会话摘要 + 任务统计。
- [ ] **M3-2 chemistry 复位**:promote / session→task 融入工作台上下文;task「来源会话」深链接 `?open=`(修好 Task 12 尾巴)。
- [ ] **M3-3 验收**:全套 tsc/test/cargo + live-PB 写路径 + 更新验收清单。提交。

## 风险 / 备注

- **依赖体量**:M1 一次加 ~15 个包;`radix-ui` 统一包 + HugeIcons 是大头。install 后先确保 build 绿再继续。
- **lucide 残留**:移植 ui 后检查是否还有 lucide 引用(MVP 可能用了),统一迁 HugeIcons 或保留 lucide 共存。
- **HashRouter vs BrowserRouter**:我们用 HashRouter(Tauri);`?open=` 在 hash 后照常工作(`useSearchParams` 兼容)。
- **单用户降级**:成员/头像/owner 相关一律 owner-only 降级,Phase⑤ 多用户再补。
- **rank 精度**:浮点中点无 rebalance,规模内可接受(与现状一致)。
