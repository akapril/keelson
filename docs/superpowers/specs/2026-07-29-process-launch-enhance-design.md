# 进程启动增强（收藏/历史/选目录/选脚本）设计

> 状态：设计已确认（2026-07-29）。用户选定：收藏=纯便捷收藏库不限制；范围=按项目；脚本=填进命令框可编辑；并追加**命令历史（自动）**；记录连同 cwd。

## 问题

桌面项目「进程」栏启动进程现在只有单命令框，cwd 固定 = 项目根，常用命令要反复手打。用户要：① 记住常用命令（收藏）② 自动命令历史可重跑 ③ 选工作目录 ④ 选脚本文件执行。

## 目标

把项目「进程」栏的「启动」区做强，全部**按项目隔离、纯前端存储、后端零改动**（`handle_start` 早就吃 `cwd` 参数）：
- **收藏（手动）**：⭐ 固定常用命令，永不被历史挤掉。
- **历史（自动）**：每次启动自动记录 `{命令, cwd}`，最近优先、去重、上限 30。
- **选目录**：原生文件夹选择作为该次 cwd（默认项目根，可重置）。
- **选脚本**：原生文件选择 → 按扩展名生成命令填进命令框（可编辑）+ cwd 设为脚本目录。
- 收藏/历史每条连同 cwd 存，点一下命令+目录一起还原 → 真正一键重跑。

**非目标（YAGNI）**：不做安全允许清单（不限制只能跑收藏的）；不做全局收藏（仅按项目）；不跨设备同步（localStorage 本机）；不改后端进程模型。

## 架构

纯前端。dialog 用已装的 `@tauri-apps/plugin-dialog` 的 `open()`（capabilities `dialog:default` 已放行；复用 `CreateProjectDialog` 的用法）。

### 新增文件

**`src/features/board/command-store.ts`** —— 按项目的收藏+历史（localStorage）
- `type CommandEntry = { command: string; cwd?: string }`
- 存储：单 key `rework-cmds:<repoPath>` → JSON `{ favorites: CommandEntry[]; history: CommandEntry[] }`。读写容错（解析失败→空）。
- `loadCommands(projectKey): { favorites, history }`
- `addHistory(projectKey, entry)`：按 `command+cwd` 去重、置顶、上限 30。
- `toggleFavorite(projectKey, entry)`：在 favorites 里增/删（按 command+cwd 匹配）。
- `isFavorite(projectKey, entry): boolean`
- `removeHistory(projectKey, entry)` / `removeFavorite(projectKey, entry)`
- 纯逻辑（依赖 localStorage，jsdom 下可测）。

**`src/features/board/script-command.ts`** —— 脚本路径→命令（纯函数，可测）
- `scriptToCommand(path: string, isWindows: boolean): { command: string; cwd: string }`
- `cwd` = 父目录（按最后一个 `/` 或 `\` 切）。
- 扩展名映射（值含路径加引号）：
  - `.sh`/`.bash` → unix `sh "p"`；windows `bash "p"`
  - `.ps1` → `pwsh -File "p"`
  - `.js`/`.mjs`/`.cjs` → `node "p"`
  - `.py` → `python "p"`
  - `.rb`→`ruby "p"` · `.bat`/`.cmd`/其他 → 直接 `"p"`

**`src/features/board/CommandPicker.tsx`** —— 「历史 ▾」Popover
- Props：`projectKey`、`onPick(entry: CommandEntry)`、`version`(用于变更后刷新)。
- 内部 `loadCommands` 读收藏+历史；分两段渲染（**收藏**在上、**最近历史**在下）。
- 每行：命令文本 + cwd 小字提示 · ⭐ 切换收藏（`toggleFavorite`）· × 删除（对应 remove）。
- 点行 → `onPick(entry)` → 父组件填命令+cwd。
- 复用 `@/components/ui/popover`、语义色、i18n `board` 命名空间。

### 修改文件

**`src/features/board/WorkspaceProcesses.tsx`**
- 新增 state：`cwd: string | null`（null=用项目根）、`cmdVersion`（收藏/历史变更后触发 Picker 刷新）。
- `effectiveCwd = cwd ?? repoPath`。
- `startNew`：用 `effectiveCwd` 传给 `runtimeStart`/`runtimePtyStart`；成功后 `addHistory(repoPath, {command, cwd: effectiveCwd})` + `bump cmdVersion`。
- 「选目录」按钮 → `open({directory:true, multiple:false})` → `setCwd(dir)`。
- 「选脚本」按钮 → `open({multiple:false})` → `scriptToCommand(path, isWin)` → `setCmd(command)` + `setCwd(cwd)`。
- 「⭐收藏当前」按钮 → `toggleFavorite(repoPath, {command: cmd.trim(), cwd: effectiveCwd})` + bump。
- 「历史 ▾」= `<CommandPicker onPick={e => { setCmd(e.command); setCwd(e.cwd ?? null); }} />`。
- cwd 展示行：显示当前 cwd（项目根 or 已选路径）+「重置为项目根」（setCwd(null)）。
- `isWin` 由 `navigator.userAgent`/`platform` 判定（`/win/i`）。
- 布局（两行）：
  ```
  [命令输入框...........] [历史▾] [交互式☐] [启动]
  [📁 目录: 项目根/已选] [选目录] [选脚本] [⭐收藏] [刷新]
  ```

**`src/i18n/locales/{zh,en}/board.json`**：processes 内加 `launch`（或平铺）文案：目录标签/选目录/选脚本/收藏/历史/重置项目根/收藏空/历史空/选择失败 toast 等，zh/en 双语。

## 平台

- Windows：headless 经 `cmd /C`；`.sh` 生成 `bash "p"`（需 PATH 有 bash，用户可编辑纠正）。命令框可编辑兜底一切平台差异。
- 路径分隔符：`scriptToCommand` 的 dirname 同时兼容 `/` 与 `\`。

## 安全 / 边界

- 纯本机桌面用户操作；命令仍走现有 `runtimeStart`/`runtimePtyStart`（同信任模型）。
- localStorage 容错：损坏→空；上限 30 防膨胀。
- cwd 选择只影响本次启动的工作目录，仍是本机用户自选目录（非 web 面）。

## 测试

- `command-store`：addHistory 去重/置顶/上限 30；toggleFavorite 增删；isFavorite；remove。（jsdom localStorage）
- `script-command`：各扩展名映射 + dirname（`/` 与 `\`、无目录）+ Windows/unix 的 `.sh` 分支。（纯函数）
- 现有 vitest 全量不回归；tsc/eslint。
- 手动：选目录/选脚本/收藏/历史点选填回/一键重跑（含 cwd 还原）/交互与非交互均生效。

## 变更文件清单

- 新增 `src/features/board/command-store.ts` + `__tests__/command-store.test.ts`
- 新增 `src/features/board/script-command.ts` + `__tests__/script-command.test.ts`
- 新增 `src/features/board/CommandPicker.tsx`
- 改 `src/features/board/WorkspaceProcesses.tsx`
- 改 `src/i18n/locales/{zh,en}/board.json`
