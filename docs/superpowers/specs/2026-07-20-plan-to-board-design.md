# 计划闭环：计划→看板 / 设计→文档（Plan-to-Board / Spec-to-Docs）

> 把 rework 为项目写的实现计划（`<repo>/docs/superpowers/plans/*.md`，`### Task N` 结构）与设计 spec，一键导入项目自身的**看板卡片**与**文档**，让「写计划」闭环进 rework，而非停在游离的 md 文件。

**Goal:** 项目工作台一键：解析计划的 `### Task N` → 看板卡片（幂等，可追踪 pending→active→done）；可选把对应设计 spec → 项目文档（耐久知识）。

**Architecture:** 纯前端解析（可测）+ 复用现成 `createTask`（带 `source_anchor` 幂等）与 `createDocRecord`；后端只补一个「读仓库 markdown」的文件命令。无 PB schema 变更（`board_tasks`/`docs` 已存在）。

**Tech Stack:** Rust/Tauri（fs 命令）、React 19/TS、vitest。

## 已定取舍（来自脑暴）
1. **计划→看板：做**。`### Task N: 名称` → 卡片（title=名称，description=任务体含步骤 markdown）。step 不各自成卡。
2. **spec→文档：做**；**原始 plan→文档：不做**（执行脚手架用完即弃，看板已表达）。
3. **触发：手动导入按钮**（方案 A）。扫 `<repo>/docs/superpowers/plans/`，用户选，可控、幂等。
4. **幂等**：`source_anchor = "plan:<文件名>#task-<N>"`；已存在同 anchor 的卡片跳过（不重复建）。

## 数据流
项目工作台「导入计划」按钮 → 对话框：
1. `list_markdown_files(<repo>/docs/superpowers/plans)` 列出计划文件。
2. 用户选一个 → `read_text_file(path)` → `parsePlanTasks(md)` 预览「解析出 N 个任务」。
3. 自动探测同名 spec（`<base>-design.md` 于 `specs/`），有则给复选「同时把设计 spec 存为项目文档」。
4. 「导入」：
   - 每个任务：若项目内无同 `source_anchor` 卡片 → `createTask`（state=首个 pending 列，description=任务体）；有则跳过。
   - 若勾选 spec：`read_text_file(spec)` → `createDocRecord({owner, project, title, content})`（title=spec 首个 `#` 标题或文件名）。
   - toast 报告：新建 X 张、跳过 Y 张已存在、spec 已存为文档。

## 后端（`src-tauri/src/commands/fs.rs` 扩展）
```rust
#[derive(serde::Serialize)]
pub struct MdFile { pub name: String, pub path: String }

/// 读文本文件（导入计划/规格用）。不存在/非 UTF-8 → Err。
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String>;

/// 列目录下的 .md 文件（非递归，按名排序）。目录不存在 → 空列表（非错误）。
#[tauri::command]
pub fn list_markdown_files(dir: String) -> Result<Vec<MdFile>, String>;
```
`lib.rs` 注册两命令。`ipc.ts` 加 `readTextFile` / `listMarkdownFiles`。

## 前端解析（`src/features/board/plan-import.ts`，纯函数可测）
```ts
export interface PlanTask { n: number; title: string; body: string; }
/** 解析 ### Task N: 标题 段落；body = 到下一个 ### / ## / EOF 之间。 */
export function parsePlanTasks(md: string): PlanTask[];
/** 计划/spec 首个 `# 标题`；无则返回空串。 */
export function parseDocTitle(md: string): string;
/** 计划文件名 → 同名 spec 文件名：<base>.md → <base>-design.md。 */
export function specNameForPlan(planName: string): string;
/** 幂等锚点：plan:<文件名>#task-<N>。 */
export function taskAnchor(planName: string, n: number): string;
```
- 解析规则：行首匹配 `^###\s+Task\s+(\d+)\s*[:：]\s*(.+?)\s*$`；title=捕获组 2；body=该行之后到下一个 `^###`/`^##`/EOF（trim）。无匹配返回空数组。

## UI
- `src/features/board/ImportPlanDialog.tsx`：props `{ open, onClose, project }`。
  - 打开时 `listMarkdownFiles(repo/docs/superpowers/plans)`；无仓库路径或空目录 → 空态提示。
  - 选计划 → 读+解析 → 列任务标题预览 + 「解析出 N 个任务」；探测 spec，有则给「存 spec 为文档」复选（默认勾）。
  - 「导入」按钮：调 store 新增动作 `importPlanTasks`（见下）+ 可选建文档；忙态、报告 toast。
- 挂载：`ProjectWorkspace.tsx` 头部「项目设置」旁加「导入计划」按钮（仅 `repoPath` 时显示），或看板 tab 内工具条。选头部，全局可达。
- `store/board.ts` 加 `importPlanTasks(tasks: PlanTask[], planName: string): Promise<{created:number; skipped:number}>`：
  - 首个 `category==="pending"` 的 state（无则首个 state）。
  - 逐任务：`anchor=taskAnchor`；`tasks` 里已有同 `source_anchor` → skipped++；否则 `createTask({project, state, title, description:body, source_anchor:anchor, source_provider:"rework-plan"})` → created++。

## 测试
- 前端 vitest（`plan-import.test.ts`）：
  - `parsePlanTasks`：多任务切分、`：`/`:` 兼容、body 到下一个 `###` 截断、无任务空数组、中文标题。
  - `parseDocTitle`：取首个 `#`；无则空。
  - `specNameForPlan` / `taskAnchor`：字符串映射。
- 后端：`list_markdown_files` 目录不存在返回空（不 panic）。

## 约束
- 注释/日志中文；中性主题不硬编码颜色。
- 幂等：重复导入不产生重复卡片（靠 `source_anchor`）。
- 只读仓库 md、只建卡/文档；不改/删用户既有卡片文档。
- 无 PB schema 变更。
- `read_text_file` 限文本；大文件（>~1MB）可截断或拒绝（计划/spec 均小，简单读全量即可）。
