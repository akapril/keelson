# 会话→Commit 溯源链 Phase 1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 或 executing-plans 逐任务实现。步骤用 `- [ ]` 跟踪。

**Goal:** 双向展示会话与 commit 的因果关联（时间窗打底 + 已存在的 Rework-Session trailer 精确化）。

**Architecture:** Rust 加 `git_log` 命令（复用 `git()` helper）+ 纯函数关联判定；前端两入口（会话预览"期间提交" + 工作台"提交"tab）。B-write(钩子)为 Phase 2，本计划不含。

**Tech Stack:** Rust std::process + chrono；React/TS。

## Global Constraints

- 关联判据单一来源：`link_kind` = `trailer`(精确) / `time`(可能相关)；grace 默认 14400s(4h)。
- `git_log` limit 钳 ≤ 500；非仓库/git 失败返回空 Vec（不报错）。
- 不改 git 历史；不做 trailer 写入（Phase 2）。
- 注释/日志中文；不硬编码主题色；UI 明确区分 精确 vs 可能相关。
- `cargo check` 前先杀 `pocketbase*`（勿杀 `rework*`）。

---

### Task 1: Rust —— git_log 命令 + 解析 + 关联纯函数

**Files:**
- Modify: `src-tauri/src/commands/git.rs`
- Modify: `src-tauri/src/lib.rs`（注册 `git_log`）
- Modify: `src/lib/tauri/ipc.ts`（`gitLog` 包装）
- Modify: `src/types/`（新增 CommitInfo / CorrelatedCommit 类型，或就近放）

**Interfaces:**
- Produces（Rust）：
  - `CommitInfo { hash, short, subject, author, committed_at, rework_session: Option<String> }`（Serialize）
  - `git_log(path, since: Option<String>, until: Option<String>, limit: u32) -> Vec<CommitInfo>`
  - `parse_git_log(stdout: &str) -> Vec<CommitInfo>`（纯）
  - `LinkKind { Trailer, Time }`（serde rename_all lowercase）
  - `correlate_session_commits(created, updated, session_id, commits, grace_secs) -> Vec<CorrelatedCommit>`（纯）
- Produces（TS）：`ipc.gitLog(path, since, until, limit) -> Promise<CommitInfo[]>`

- [ ] **Step 1: 写 parse_git_log 失败测试**

```rust
#[test]
fn parse_git_log_extracts_fields_and_trailer() {
    // 列分隔 \x1f，条目分隔 \n
    let out = "abc123\x1fabc\x1f修复登录\x1fAlice\x1f2026-07-18T10:00:00+08:00\x1fsess-1\n\
               def456\x1fdef\x1f加日志\x1fBob\x1f2026-07-18T11:00:00+08:00\x1f\n";
    let v = parse_git_log(out);
    assert_eq!(v.len(), 2);
    assert_eq!(v[0].hash, "abc123");
    assert_eq!(v[0].short, "abc");
    assert_eq!(v[0].subject, "修复登录");
    assert_eq!(v[0].rework_session.as_deref(), Some("sess-1"));
    assert_eq!(v[1].rework_session, None); // 空 trailer → None
}

#[test]
fn parse_git_log_empty_is_empty() {
    assert!(parse_git_log("").is_empty());
    assert!(parse_git_log("\n").is_empty());
}
```

Run: `cd src-tauri && cargo test --lib git::` → 编译失败（parse_git_log 未定义）。

- [ ] **Step 2: 实现 parse_git_log + CommitInfo**

```rust
#[derive(Serialize, Clone, Debug)]
pub struct CommitInfo {
    pub hash: String,
    pub short: String,
    pub subject: String,
    pub author: String,
    pub committed_at: String,
    pub rework_session: Option<String>,
}

/// 解析 git log 输出：每行一条，列以 \x1f 分隔（trailer 空串→None）。
pub fn parse_git_log(stdout: &str) -> Vec<CommitInfo> {
    stdout
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let mut it = line.split('\u{1f}');
            let hash = it.next()?.to_string();
            let short = it.next()?.to_string();
            let subject = it.next().unwrap_or("").to_string();
            let author = it.next().unwrap_or("").to_string();
            let committed_at = it.next().unwrap_or("").to_string();
            let trailer = it.next().unwrap_or("").trim();
            let rework_session = if trailer.is_empty() { None } else { Some(trailer.to_string()) };
            Some(CommitInfo { hash, short, subject, author, committed_at, rework_session })
        })
        .collect()
}
```

Run: `cargo test --lib git::` → PASS。

- [ ] **Step 3: 写 correlate 测试**

```rust
use chrono::{TimeZone, Utc};
fn ci(hash: &str, at: &str, sess: Option<&str>) -> CommitInfo {
    CommitInfo { hash: hash.into(), short: hash.into(), subject: "s".into(),
        author: "a".into(), committed_at: at.into(), rework_session: sess.map(|x| x.into()) }
}
#[test]
fn correlate_trailer_wins_and_time_window() {
    let created = Utc.with_ymd_and_hms(2026,7,18,10,0,0).unwrap();
    let updated = Utc.with_ymd_and_hms(2026,7,18,11,0,0).unwrap();
    let commits = vec![
        ci("c_trailer", "2026-07-20T00:00:00+00:00", Some("S")), // 窗外但 trailer 命中 → Trailer
        ci("c_time",    "2026-07-18T11:30:00+00:00", None),      // 窗内(updated+4h) → Time
        ci("c_out",     "2026-07-18T20:00:00+00:00", None),      // 窗外(>updated+4h) → 排除
        ci("c_other",   "2026-07-18T10:30:00+00:00", Some("X")), // 别的会话 trailer，但时间在窗内 → Time
    ];
    let out = correlate_session_commits(created, updated, "S", commits, 14400);
    let ids: Vec<(&str, &str)> = out.iter().map(|c| (c.commit.hash.as_str(), match c.link_kind { LinkKind::Trailer => "trailer", LinkKind::Time => "time" })).collect();
    assert!(ids.contains(&("c_trailer","trailer")));
    assert!(ids.contains(&("c_time","time")));
    assert!(ids.contains(&("c_other","time")));   // 时间窗兜住
    assert!(!ids.iter().any(|(h,_)| *h == "c_out"));
}
```

Run: 失败（correlate 未定义）。

- [ ] **Step 4: 实现 LinkKind + correlate_session_commits**

```rust
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LinkKind { Trailer, Time }

#[derive(Serialize, Clone, Debug)]
pub struct CorrelatedCommit { pub commit: CommitInfo, pub link_kind: LinkKind }

/// trailer==session_id → Trailer(精确)；否则 committed_at ∈ [created, updated+grace] → Time；都不满足→排除。
pub fn correlate_session_commits(
    created: chrono::DateTime<chrono::Utc>,
    updated: chrono::DateTime<chrono::Utc>,
    session_id: &str,
    commits: Vec<CommitInfo>,
    grace_secs: i64,
) -> Vec<CorrelatedCommit> {
    let end = updated + chrono::Duration::seconds(grace_secs);
    commits.into_iter().filter_map(|c| {
        if c.rework_session.as_deref() == Some(session_id) {
            return Some(CorrelatedCommit { commit: c, link_kind: LinkKind::Trailer });
        }
        match chrono::DateTime::parse_from_rfc3339(&c.committed_at) {
            Ok(t) => {
                let t = t.with_timezone(&chrono::Utc);
                if t >= created && t <= end {
                    Some(CorrelatedCommit { commit: c, link_kind: LinkKind::Time })
                } else { None }
            }
            Err(_) => None,
        }
    }).collect()
}
```

Run: `cargo test --lib git::` → PASS（含既有 count_dirty/parse_branch）。

- [ ] **Step 5: git_log 命令 + 注册 + ipc**

```rust
#[tauri::command]
pub fn git_log(path: String, since: Option<String>, until: Option<String>, limit: u32) -> Vec<CommitInfo> {
    let n = limit.min(500).to_string();
    let mut args = vec!["log", "--no-color",
        "--pretty=format:%H\u{1f}%h\u{1f}%s\u{1f}%an\u{1f}%cI\u{1f}%(trailers:key=Rework-Session,valueonly)",
        "-n", &n];
    if let Some(s) = since.as_deref() { args.push("--since"); args.push(s); }
    if let Some(u) = until.as_deref() { args.push("--until"); args.push(u); }
    match git(&path, &args) { Some(out) => parse_git_log(&out), None => Vec::new() }
}
```

- `lib.rs` invoke_handler 加 `commands::git::git_log,`（紧挨 `git_info`）。
- `ipc.ts` 加 `gitLog: (path, since, until, limit) => invoke<CommitInfo[]>("git_log", { path, since, until, limit })`，并加 TS 类型 `CommitInfo`。

Run: `taskkill //F //IM pocketbase.exe 2>/dev/null; cargo check` → 0 error；`npx tsc --noEmit` → 无错。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/commands/git.rs src-tauri/src/lib.rs src/lib/tauri/ipc.ts src/types/*
git commit -m "feat(git): git_log 命令 + 会话-提交关联纯函数(trailer/时间窗)"
```

---

### Task 2: 前端 —— 会话 → 期间提交

**Files:**
- Create: `src/features/sessions/SessionCommits.tsx`
- Modify: `src/features/sessions/SessionPreviewPane.tsx`（插入该区块）
- 可能 Modify: 关联判定的 TS 侧镜像（或直接展示后端 correlate 结果——见下）

**Interfaces:**
- Consumes: `ipc.gitLog`；`session.{project_path, created_at, updated_at, session_id}`。

**说明**：关联判定优先复用后端。但后端 `git_log` 只返回 commits（不含 link_kind，因它不知道是哪个会话）。
两种做法择一（Task 实施者按简单优先）：
- (a) 在 TS 侧写一个小 `correlateCommits(commits, session, graceSecs)` 镜像后端判据（trailer 命中 / 时间窗），
  **配 vitest 单测**（与 Rust 用例对齐）；或
- (b) 后端新增 `session_commits(session_id, provider)` 命令，内部 gitLog + correlate 返回 `CorrelatedCommit[]`。
**推荐 (b)**：判据单点在 Rust，避免两份漂移（Global Constraints 要求单一来源）。若选 (b)，本 Task 顺带加该命令 + ipc 包装 + 用 AppState 取会话时间。

- [ ] Step 1: （若选 b）加 `session_commits` 命令（复用 Task1 的 git_log + correlate；从 `AppState.sessions` 取该会话的 created/updated）+ ipc 包装。`cargo check` 绿。
- [ ] Step 2: `SessionCommits` 组件：入参 session，挂载时调 `ipc.sessionCommits(session)` → 渲染"此会话期间的提交（N）"，每条：短 hash（等宽）+ subject + 徽章（🎯 精确 / 🕐 可能相关）+ committed_at。空/非仓库 → 返回 null（不显示区块）。
- [ ] Step 3: `SessionPreviewPane` 在 SessionLinkedTasks 附近插入 `<SessionCommits key={session.session_id} session={session} />`。
- [ ] Step 4: `npx tsc` 无错；vitest（若走 a）绿。
- [ ] Step 5: 提交 `feat(sessions): 会话预览展示期间提交(精确/可能相关)`。

---

### Task 3: 前端 —— 工作台「提交」→ 会话

**Files:**
- Create: `src/features/board/WorkspaceCommits.tsx`
- Modify: `src/features/board/ProjectWorkspace.tsx`（加「提交」tab）

**Interfaces:**
- Consumes: `ipc.gitLog(repoPath, since=近30天, until=now, limit=100)`；`useSessionsStore` 的该 repo 会话做反查。

- [ ] Step 1: `WorkspaceCommits`：入参 repoPath。调 gitLog 列最近提交；每条：
  - 若 `commit.rework_session` → 该会话链接（精确徽章）；
  - 否则按时间窗从 `sessions.filter(project_path==repoPath)` 反查重叠会话（committed_at ∈ [s.created, s.updated+grace]），列"可能来自：<会话>"。
  - 点会话 → `navigate('/sessions?session=' + id)`（深链已存在）。
- [ ] Step 2: `ProjectWorkspace` tab 列表加「提交」，内容渲染 `<WorkspaceCommits repoPath={repoPath} />`。仅 repoPath 为 git 仓库时有意义（非仓库时组件显空态）。
- [ ] Step 3: `npx tsc` 无错。
- [ ] Step 4: 提交 `feat(board): 工作台提交面 → 反查催生会话`。

---

## 广审 & 手测（全部任务后）

- 广审整支：`cargo test --lib`（含新纯函数）+ `cargo check` + `npx tsc` + `npx vitest run`。重点核关联判据单一来源、grace 边界、非仓库空态、深链跳转。
- 手测（需 `cargo build` 重建）：
  1. 选一个近期在某仓库有提交的会话 → 会话预览出现"此会话期间的提交"，时间窗内的标🕐。
  2. 手动在某 commit message 里加 `Rework-Session: <该会话 id>` → 该提交标🎯精确。
  3. 工作台「提交」tab → 点带 trailer 的提交跳到对应会话；无 trailer 的显"可能来自"。
