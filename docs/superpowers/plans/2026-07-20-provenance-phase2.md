# 会话 → Commit 溯源链 Phase 2 —— git 钩子自动打 trailer（实现计划）

> Phase 1（已合入）已能**读**：`git_log`/`parse_git_log`/`correlate_session_commits` 解析 commit 的
> `Rework-Session: <id>` trailer，前端 SessionCommits + WorkspaceCommits 双向展示。
> Phase 2 目标：**写**——`prepare-commit-msg` 钩子在**新**提交尾部自动追加 trailer，让不打开
> rework、直接 `git log` 也能看到会话来源。opt-in 每仓库，可卸载，不改历史。
>
> 源 spec：`docs/superpowers/specs/2026-07-18-session-commit-provenance.md`（Phase 2 章节 98–106 行）。

---

## 0. 已核实的代码事实（决策依据）

| 事实 | 位置 | 对 Phase 2 的含义 |
|---|---|---|
| 会话缓存的**唯一**更新点 | `lib.rs` `watcher_cb` 闭包（~476–513）：full_rescan 时 `*slot.lock()=fresh`；增量时 upsert 循环 | marker 同步只需挂在此闭包尾部一处，无第二写入口 |
| `Session` 字段 | `models.rs`：`session_id` / `provider` / `project_path` / `created_at` / `updated_at`（`DateTime<Utc>`） | marker 需要的 repo→(session_id, provider, updated_at) 全部就绪 |
| git 调用助手 | `commands/git.rs` `fn git(path,&[&str])->Option<String>`（`std::process::Command`，`git -C`） | 钩子安装/卸载命令复用同一模式，无新 crate |
| app_data 目录 | `paths::AppPaths.app_data`（`AppState.paths`） | 集中式 json 落此处；但见下方推荐（不采用集中式） |
| 命令注册点 | `lib.rs` `generate_handler!`（288–306），git 命令已在列 | 新增 3 个命令追加到 git 分组 |
| 「启用仓库」列表 | **当前不存在** | 用「钩子文件是否存在」即事实来源，不新建配置（YAGNI，见 §3） |

---

## 1. 架构决策（KISS/YAGNI 权衡）

### 决策 A：marker 载体 —— **每仓库 `.git/rework-session`（推荐）** vs 集中式 json

| 维度 | 每仓库 `.git/rework-session`（推荐） | 集中 `app_data/latest-session-by-repo.json` |
|---|---|---|
| 钩子逻辑 | 钩子只需 `cat "$GIT_DIR/rework-session"`——无需解析 json、无需定位 app_data、无需知道 rework 装哪 | 钩子须定位 app_data（跨平台路径）+ 解析 json + 按 repo_path 查表 |
| 跨平台脚本复杂度 | 极低（POSIX sh 一行 read） | 高（sh 里 grep/sed 抠 json，或依赖 jq——不可假设存在） |
| opt-in 事实来源 | 钩子在 = 启用；文件天然随钩子共存 | 需另存「启用列表」 |
| 写入耦合 | scanner 需知道「哪些 repo 装了钩子」才去写（否则给没装钩子的 repo 乱写文件） | 无脑写全表 |
| `.git` 目录归属 | 文件落 `.git/`（非工作树），不进版本控制、不脏 `git status` | 无此问题 |
| **结论** | **推荐**：钩子零依赖、零解析，最符合 KISS。写入侧的「哪些 repo 装了钩子」用 §3 的探测解决 | 落选：把复杂度从「写一次」转嫁到「每次提交都在 sh 里解析」 |

**采用**：`.git/rework-session`，纯文本两行：
```
session_id=<id>
provider=<claude|codex>
```
（两行 `key=value`，钩子 `grep '^session_id=' | cut -d= -f2-`；未来加字段不破坏旧钩子。）

> 说明：spec 原文提「`latest-session-by-repo.json`」，本计划据「钩子零依赖」原则改为每仓库 marker。
> 这是对 spec 的**收敛优化**，需在 §7 决策点确认。

### 决策 B：「当前会话」判据

沿用 spec 启发式：某 repo 的**最近 `updated_at` 会话** = 该 repo 的当前会话。marker 只保存这一个。
写入时机 = 会话缓存更新时（§2），保证提交前 marker 已是最新。

### 决策 C：钩子只 append、不覆盖、不改历史

`prepare-commit-msg` 仅在提交信息**尚无** `Rework-Session:` 行时 append，幂等；绝不 amend/rebase。
merge/squash/commit --amend 由钩子第 2 参数（`$2` = commit source）判断，普通提交才注入（见 §4）。

---

## 2. marker 同步（scanner/updater 侧）

**改动文件**：`src-tauri/src/commands/git.rs`（新纯函数 + 写函数）、`src-tauri/src/lib.rs`（`watcher_cb` 尾部调用）。

**要点**：
1. 新增 `git.rs::write_session_marker(repo_path, session_id, provider)`：
   - 仅当 `<repo>/.git/rework-session` 的**钩子已安装**时才写（探测 `hook_installed(repo)`，见 §3），否则跳过——避免污染未启用仓库。
   - 用 `git -C repo rev-parse --git-dir` 拿到真实 `.git` 目录（支持 worktree / submodule / `.git` 为文件的情形），marker 落该目录下。
   - 原子写：写临时文件再 rename（避免钩子读到半截）。
2. 新增纯函数 `pick_latest_session_per_repo(sessions: &[SessionLite]) -> HashMap<repo, (id, provider)>`：
   - 输入抽象为 `SessionLite { project_path, session_id, provider, updated_at }`（便于单测，不依赖完整 `Session`）。
   - 按 `project_path` 分组取 `updated_at` 最大者。**纯函数，单测重点**。
3. `lib.rs` `watcher_cb`：在 `to_sync` 确定后（缓存已更新），对 `to_sync`（增量）或全量缓存跑
   `pick_latest_session_per_repo` → 对每个 repo 调 `write_session_marker`。放在 `spawn` 内、sync 之后，非致命失败只 `eprintln!`。
   - 增量分支：只需处理本次变化涉及的 repo（`to_sync` 里的 `project_path` 去重）——但「最近会话」要跟全量缓存比，故传 `slot.lock()` 快照给纯函数，只对变化涉及的 repo 落盘。

**验证**：`pick_latest_session_per_repo` 单测（同 repo 多会话取最新、多 repo 隔离、空输入）。手测：装钩子后触发一次会话更新，检查 `.git/rework-session` 内容 = 最近会话 id。**需 `cargo build` 重建。**

---

## 3. opt-in 追踪：以「钩子存在」为唯一事实来源

**不新建配置文件/PB 表**（YAGNI）。启用状态 = `hook_installed(repo)` 的探测结果：

`git.rs::hook_installed(repo) -> bool`：
- 定位 hooks 目录：`git -C repo rev-parse --git-path hooks`（尊重 `core.hooksPath` 配置）。
- 读 `<hooks>/prepare-commit-msg`，判断是否含 rework 的**标记注释**（如 `# >>> rework-session-trailer >>>`）。
- 含标记 = 已装（我们的）；文件存在但无标记 = 别的工具的钩子（见 §4 共存）。

**优点**：无状态漂移、卸载后自动「未启用」、跨机/跨 clone 各自独立（钩子不随 clone 走，符合直觉）。

---

## 4. 钩子安装 / 卸载命令（跨平台、幂等、不破坏已有钩子）

**改动文件**：`src-tauri/src/commands/git.rs`（新命令）、`lib.rs`（注册 3 命令）。

### 命令签名
```rust
#[tauri::command] pub fn session_hook_status(path: String) -> HookStatus;   // { installed, hooks_path, foreign_hook_present }
#[tauri::command] pub fn install_session_trailer_hook(path: String) -> Result<(), String>;
#[tauri::command] pub fn uninstall_session_trailer_hook(path: String) -> Result<(), String>;
```

### 钩子脚本（POSIX sh，Windows 走 Git 自带 `sh.exe`）
`prepare-commit-msg` 收到 `$1=消息文件路径`、`$2=source`（`message`/`commit`/`merge`/`squash`/`template`）：
```sh
#!/bin/sh
# >>> rework-session-trailer >>>
# 仅普通提交注入；merge/squash/amend(-c/-C 走 commit source) 跳过，避免污染
case "$2" in message|template|"") : ;; *) exit 0 ;; esac
GITDIR=$(git rev-parse --git-dir 2>/dev/null) || exit 0
MARKER="$GITDIR/rework-session"
[ -f "$MARKER" ] || exit 0
SID=$(grep '^session_id=' "$MARKER" | head -n1 | cut -d= -f2-)
[ -n "$SID" ] || exit 0
grep -qi '^Rework-Session:' "$1" && exit 0   # 已有则不重复
printf '\nRework-Session: %s\n' "$SID" >> "$1"
# <<< rework-session-trailer <<<
```
标记注释 `>>> rework-session-trailer >>>` / `<<<` 用于：幂等安装、卸载时精准剔除、与他人钩子共存判定。

### 安装逻辑（幂等 + 共存）
1. `install`：
   - 定位 hooks 目录（`rev-parse --git-path hooks`），不存在则 `mkdir`。
   - **无 `prepare-commit-msg`** → 直接写上面脚本，`chmod +x`（Unix；Windows 靠 shebang + git 自带 sh，权限位可忽略）。
   - **已有 `prepare-commit-msg`（他人的）** → **不覆盖**。两个子方案（§7 决策点）：
     - (b1) 在已有脚本尾部追加我们的**标记块**（`>>>...<<<` 之间），保留原逻辑——推荐，最不破坏。
     - (b2) 拒绝安装并回错，提示用户「已存在第三方钩子，请手动合并」——最保守。
     - **推荐 b1**：追加标记块，且安装前检测已含本标记则跳过（幂等）。
2. `uninstall`：
   - 若文件**仅**是我们的脚本（首行 shebang + 我们的标记块占满）→ 删文件。
   - 若含他人内容 → 只删 `>>> ... <<<` 之间的标记块，保留其余。
   - 一并可选删除 `.git/rework-session` marker（卸载即彻底停用）。

**验证**：装→提交一条→`git log -1 --format='%(trailers)'` 应含 `Rework-Session`；merge 提交不应含；卸载后再提交不含。共存：预置一个第三方 `prepare-commit-msg`，装/卸后其原逻辑仍在。跨平台在 Windows（Git Bash 提供的 sh）实测一次。**需 `cargo build`。**

---

## 5. 前端：工作台「提交」tab 启用/停用按钮 + 状态

**改动文件**：`WorkspaceCommits`（Phase 1 已建的提交面组件）或其父 `ProjectWorkspace.tsx` 的「提交」tab；`ipc` 封装。

**要点**：
1. `ipc` 新增 `sessionHookStatus(repo)` / `installSessionTrailerHook(repo)` / `uninstallSessionTrailerHook(repo)`。
2. 提交面顶部加状态条：
   - 未装 → 按钮「在此仓库启用会话溯源」。
   - 已装 → 徽章「会话溯源已启用」+「停用」按钮。
   - `foreign_hook_present`（他人钩子存在）→ 提示文案「将与已有 prepare-commit-msg 钩子共存」。
3. 启用/停用后重新拉 `sessionHookStatus` 刷新；操作失败 toast 错误串。
4. 仅在 `git_info.is_repo` 时显示该区块（复用现有判断，YAGNI）。

**验证**：手测点击启用→按钮变「已启用」；在该 repo 提交→WorkspaceCommits 里该 commit 显示 🎯 精确徽章（Phase 1 已有渲染）。纯前端，无需重建 Rust。

---

## 6. 开放风险处理（spec 106 行已列）

| 风险 | 处理 | 状态 |
|---|---|---|
| 多会话并行「最近会话」选错 | 用 `updated_at` 最大者做启发式；trailer 明确是**启发式来源**（Phase 1 UI 已把 trailer 标注为一种 link_kind，不当绝对事实）；用户可在 commit 时手改消息删/改 trailer。**不做多会话消歧 UI（YAGNI）** | 已处理（接受启发式） |
| 钩子跨平台 | 纯 POSIX sh + shebang，Windows 依赖 Git 自带 sh（rework 已假设本机有 git）；不用 jq/bash-only 语法；marker 用两行 `k=v` 而非 json，sh 零依赖解析 | 已处理 |
| 误触/破坏他人 `prepare-commit-msg` | §3 标记注释区分归属；§4 安装用「追加标记块」不覆盖，卸载只删标记块；命令返回 `foreign_hook_present` 供 UI 告知 | 已处理（b1 推荐，待 §7 拍板） |
| marker 写入污染未启用仓库 | `write_session_marker` 先 `hook_installed(repo)` 探测，未装不写 | 已处理 |
| `.git` 为文件（worktree/submodule） | 一律用 `rev-parse --git-dir` / `--git-path hooks` 解析真实路径，不硬编码 `<repo>/.git` | 已处理 |
| 钩子读到半截 marker | 原子写（temp + rename） | 已处理 |

---

## 7. 需拍板的决策点（实现前确认）

1. **marker 载体**：采用每仓库 `.git/rework-session`（本计划推荐，偏离 spec 的集中 json）——是否同意？
2. **已有第三方 `prepare-commit-msg`**：b1 追加标记块共存（推荐）/ b2 拒绝安装让用户手合——选哪个？
3. **卸载是否删 marker 文件**：卸载即删 `.git/rework-session`（推荐彻底）/ 保留（无副作用因钩子已走）——确认。
4. **命令命名**：`install_session_trailer_hook` 等是否沿用；前端 tab 文案「在此仓库启用会话溯源」是否可。

---

## 8. 分阶段任务列表

| # | 任务 | 改动文件 | 要点 | 验证 | 重建 |
|---|---|---|---|---|---|
| P2-1 | marker 纯函数 + 写入 | `commands/git.rs` | `pick_latest_session_per_repo`（纯，单测）；`write_session_marker`（rev-parse --git-dir + 原子写 + 装钩子才写）；`hook_installed`/`hooks 目录探测` | `cargo test` 纯函数用例通过 | ✅ Rust |
| P2-2 | 钩子安装/卸载/状态命令 | `commands/git.rs` + `lib.rs`（注册） | 3 命令；POSIX sh 脚本 + 标记注释块；幂等；共存（b1）；`HookStatus` 结构 | `cargo build`；手测装→提交→查 trailer；merge 不注入；卸载还原 | ✅ Rust |
| P2-3 | marker 同步接线 | `lib.rs` `watcher_cb` | 缓存更新后对变化 repo 落 marker（快照传纯函数）；非致命失败 eprintln | 手测：改会话→装钩子的 repo 的 `.git/rework-session` 更新 | ✅ Rust |
| P2-4 | 前端 ipc + 提交面按钮 | `ipc` 封装 + `WorkspaceCommits`/`ProjectWorkspace.tsx` | 3 个 ipc；状态条 启用/停用/foreign 提示；操作后刷新 | 手测：启用→提交→commit 显示 🎯 精确徽章 | ❌ 前端 |
| P2-5 | 跨平台冒烟 + 文档回填 | — | Windows(Git Bash sh) 实测钩子；把「每仓库 marker」定稿回填 spec Phase 2 章节 | 全链路：装→提交→Phase 1 面板精确关联 | — |

**依赖**：P2-2 → P2-1（hook_installed 供写入探测用，可并行开发接口）；P2-3 依赖 P2-1；P2-4 依赖 P2-2。
**无新 crate、无新前端依赖。** Rust 改动（P2-1..3）需 `cargo build`；注意 MEMORY：构建前只 kill `pocketbase*`，勿误杀。
