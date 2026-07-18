# 会话 → Commit 溯源链 —— 设计

> 把「AI 会话 ↔ 衍生的任务/文档 ↔ Git commit」串成可回放的因果链：从会话看它期间产生的提交，
> 从提交看催生它的会话。吃 rework 独有的「跨厂商会话聚合 + 双向 MCP 现场因果 + 本地仓库」资产。

## 决策纪要（已确认）

| 维度 | 决定 |
|---|---|
| 关联机制 | **A 时间窗打底 + B commit trailer 精确化**。A：会话时段内同仓库 commits = 可能相关；B：commit 尾部 `Rework-Session: <session_id>` trailer = 精确关联，优先于 A。 |
| 方向 | **双向**：会话→commits（会话预览/工作台展示"此会话期间的提交"）+ commit→会话（工作台 Git 面浏览提交、看催生它的会话）。 |
| 关联标注 | 每条关联标 `link_kind`：`trailer`(精确) / `time`(可能相关)。UI 明确区分，不把启发式当事实。 |
| 分期 | **Phase 1**：A 双向 + B-read(解析已存在的 trailer)。**Phase 2**：B-write(可选 git 钩子自动打 trailer)。先交付 Phase 1。 |
| 非目标 | 不改写已有 git 历史（B-write 用钩子只影响新提交，不 amend）；不做 AI 匹配(方案 C)；不跨仓库聚合。 |

## 关键约束（已核实的代码事实）

- `commands/git.rs` 有 `fn git(path, args) -> Option<String>`（shell `git -C path ...`）+ `git_info`。扩展 `git_log` 同法，无新 crate。
- `Session { session_id, provider, project_path, created_at, updated_at, ... }`（`models`），时间为 `DateTime<Utc>`。
- 任务/文档已有 `source_session_id` + `source_provider`（`board_tasks`；docs 无——见非目标，本功能不依赖）。
- `AppState.sessions: Arc<Mutex<Vec<Session>>>` 缓存全量会话（含 project_path + 时间），可做 commit→会话反查。
- `ProjectWorkspace.tsx` 有 概览/会话/看板/文档/AI 五 tab + git 状态条，但**无提交浏览面**（commit→会话需新增一个「提交」tab 或区块）。
- 前端 `ipc.gitInfo(path)` 已有；新增 `ipc.gitLog(...)` 同层。

## 架构总览

三层，纯逻辑与 IO 分离、可单测：

1. **Rust：`git_log` 命令 + 提交解析**（`commands/git.rs`）——读某仓库指定时间窗的提交，解析 `Rework-Session` trailer。
2. **关联纯函数**（`commands/git.rs` 或新 `provenance.rs`）——`correlate(session, commits, grace)`：给每条 commit 定 `link_kind`。**纯函数、单测重点**。
3. **前端两个入口**——会话→commits（会话预览区块）、commit→会话（工作台「提交」tab）。

## Phase 1 详细设计

### 1) `git_log` 命令

```rust
#[derive(Serialize)]
pub struct CommitInfo {
    pub hash: String,          // 全 hash
    pub short: String,         // 短 hash
    pub subject: String,       // 首行
    pub author: String,        // 作者名
    pub committed_at: String,  // ISO8601（%cI）
    pub rework_session: Option<String>, // 解析自 Rework-Session trailer
}

/// 读取仓库在 [since, until] 内的提交（ISO 时间；空则不限）。limit 上限保护。
#[tauri::command]
pub fn git_log(path: String, since: Option<String>, until: Option<String>, limit: u32) -> Vec<CommitInfo>;
```

- 实现：`git -C path log --no-color --date=iso-strict` +
  `--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%cI%x1f%(trailers:key=Rework-Session,valueonly)` +
  `--since=<iso>` `--until=<iso>` `-n <limit.min(500)>`。按 `%x1f`(unit separator) 分列、按行分条。
- 非仓库 / git 失败 → 返回空 Vec（非致命，与 git_info 一致）。
- 纯解析函数 `parse_git_log(stdout) -> Vec<CommitInfo>` 单测（含 trailer 有/无、空输出、多条）。

### 2) 关联纯函数

```rust
pub enum LinkKind { Trailer, Time }  // serde 小写

pub struct CorrelatedCommit { pub commit: CommitInfo, pub link_kind: LinkKind }

/// 给定一个会话与一批(同仓库)提交，判定关联：
/// - trailer == session_id → Trailer（精确）
/// - 否则 committed_at ∈ [created_at, updated_at + grace] → Time（可能相关）
/// - 都不满足 → 不纳入
pub fn correlate_session_commits(
    session_created: DateTime<Utc>, session_updated: DateTime<Utc>,
    session_id: &str, commits: Vec<CommitInfo>, grace_secs: i64,
) -> Vec<CorrelatedCommit>;
```

- `grace_secs` 默认 4h（14400）——提交常在会话结束后不久。可后续做成设置。
- 反向 commit→会话在前端用 `sessions_list` + 该纯函数的镜像判断即可（或加 `correlate_commit_sessions`）。**优先复用同一时间/trailer 判据**，避免两套逻辑漂移。

### 3) 前端：会话 → commits

- `ipc.gitLog(repoPath, since, until, limit)` 包装。
- `SessionPreviewPane`（或其内新组件 `SessionCommits`）：会话选中后，用 `session.project_path` +
  `[created_at, updated_at + grace]` 调 `gitLog` → 展示"此会话期间的提交（N）"，每条：短 hash + subject +
  `link_kind` 徽章（🎯精确 / 🕐可能相关）。无 / 非仓库 → 不显示该区块（YAGNI，不打扰）。
- 复用现有会话时间字段；纯前端过滤/展示，关联判据调用后端纯函数或在 TS 侧镜像一份小工具（择一，避免两份）。

### 4) 前端：commit → 会话

- `ProjectWorkspace` 加「提交」tab（或在 概览 加区块）：调 `gitLog(repoPath, 近 N 天, now, limit)` 列最近提交。
- 每条 commit：若有 `rework_session` → 直接链到该会话（精确）；否则按时间窗从 `sessions`(该 repo) 反查
  重叠会话，列为"可能来自"。点击 → 跳会话中枢 `?session=<id>`（深链已存在）。

### 5) 因果链闭合（免费增量）

任务已带 `source_session_id`。于是链条自动成型：**commit —(trailer/时间)→ 会话 —(source_session_id)→ 任务/文档**。
会话预览里同一处已能看到"衍生任务"(SessionLinkedTasks 已存在) + 新增"期间提交"，即在会话这个枢纽看到两侧因果。

## Phase 2 设计（B-write，本轮不实现，spec 先记）

**目标**：不用 rework 也能从 `git log` 看到会话——把 `Rework-Session` trailer 写进新提交。

- **不改历史**：只用 `prepare-commit-msg` 钩子影响**新**提交，绝不 amend 已推送提交。
- **"当前会话"解析**：rework 的 scanner 维护 `app_data/latest-session-by-repo.json`（repo_path → 最近 session_id/provider）。提交时你刚在某会话干完活，该 repo 的最近会话即"当前会话"——足够好的启发式。
- **钩子**：`install_session_trailer_hook(repo_path)` 命令写一个 `prepare-commit-msg` 脚本：`git rev-parse --show-toplevel` 取 repo → 读上述 json → 若命中且提交信息里尚无该 trailer，则 append `Rework-Session: <id>`。
- **opt-in**：工作台 Git 面一个「在此仓库启用会话溯源」按钮。可一键卸载（删钩子）。
- **风险**：钩子是本地脚本（跨平台 sh；Windows 走 git 自带的 sh）；"最近会话"可能选错（多会话并行）——标注 trailer 为启发式来源，且用户可在 commit 面手动改。**Phase 2 前需再评审这些开放点**。

## 测试

- **Rust 纯函数**：`parse_git_log`（trailer 有/无、空、多条、字段含分隔符的鲁棒性）；`correlate_session_commits`
  （trailer 命中→Trailer、时间窗内→Time、窗外→排除、grace 边界）。
- 前端展示为集成逻辑，手测：选一个近期有提交的会话 → 看到"期间提交"；工作台提交面 → 点带 trailer 的
  提交跳到对应会话。
- `git_log` 命令依赖真实 git，不单测其 IO，只测解析纯函数。

## 依赖与前置

- 无新 crate（复用 `commands/git.rs` 的 `git()` + std::process）、无新前端依赖。
- Phase 1 纯 Rust 命令 + 前端两处；需 `cargo build` 重建。
- Phase 2 需 scanner 落 `latest-session-by-repo.json`（小改）+ 钩子命令。

## 非目标（YAGNI）

- 不改写已有 git 历史。
- 不做 AI 匹配相关性（方案 C）。
- 不跨仓库/跨机聚合提交。
- 不在 Phase 1 做 trailer 写入（Phase 2）。
- 不做 commit diff 展示（只到 subject + 元信息；点进去看会话即可）。
