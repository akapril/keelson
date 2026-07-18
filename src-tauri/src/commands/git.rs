//! git_info 命令：读取本地仓库的当前分支与未提交变更数（移植自 retalk）。
//! 直接调用系统 `git` CLI（std::process），不引入额外 crate。
use serde::Serialize;
use std::process::Command;

#[derive(Serialize, Clone, Debug)]
pub struct GitInfo {
    pub branch: Option<String>,
    pub dirty_count: u32,
    pub is_repo: bool,
}

/// 统计 `git status --porcelain` 输出的变更行数（每行一个变更；空行忽略）。
pub fn count_dirty(porcelain: &str) -> u32 {
    porcelain.lines().filter(|l| !l.trim().is_empty()).count() as u32
}

/// 从 `git symbolic-ref HEAD` 输出解析分支名；detached HEAD 返回 None。
pub fn parse_branch(symref: &str) -> Option<String> {
    let s = symref.trim();
    s.strip_prefix("refs/heads/").map(|b| b.to_string())
}

/// 在指定路径执行 git 命令，成功则返回 stdout，否则 None。
fn git(path: &str, args: &[&str]) -> Option<String> {
    let out = Command::new("git").arg("-C").arg(path).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

/// 返回给定目录的 git 状态：当前分支 + 未提交变更数；非仓库时 is_repo=false。
#[tauri::command]
pub fn git_info(path: String) -> GitInfo {
    // 探测是否处于 git 工作树内
    let is_repo = git(&path, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true")
        .unwrap_or(false);
    if !is_repo {
        return GitInfo { branch: None, dirty_count: 0, is_repo: false };
    }
    let branch = git(&path, &["symbolic-ref", "HEAD"]).and_then(|s| parse_branch(&s));
    let dirty_count = git(&path, &["status", "--porcelain"])
        .map(|s| count_dirty(&s))
        .unwrap_or(0);
    GitInfo { branch, dirty_count, is_repo: true }
}

// ─────────────────────────────────────────────────────────────
// 会话 → Commit 溯源：git_log 读取 + 关联判定
// ─────────────────────────────────────────────────────────────

/// 一条提交的元信息（含解析自 Rework-Session trailer 的会话 id，若有）。
#[derive(Serialize, Clone, Debug)]
pub struct CommitInfo {
    pub hash: String,
    pub short: String,
    pub subject: String,
    pub author: String,
    pub committed_at: String, // ISO8601（%cI）
    pub rework_session: Option<String>,
}

/// 关联方式：trailer 精确 / 时间窗可能相关。
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LinkKind {
    Trailer,
    Time,
}

/// 一条「与某会话关联」的提交及其关联方式。
#[derive(Serialize, Clone, Debug)]
pub struct CorrelatedCommit {
    pub commit: CommitInfo,
    pub link_kind: LinkKind,
}

/// 解析 git log 输出：每行一条，列以 \x1f(unit separator) 分隔；trailer 空串 → None。
/// 与 git_log 命令的 --pretty format 列序严格对应。
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
            // trailer 列：多值时 git 以逗号分隔（format 指定 separator=,），取首个非空值
            let trailer = it.next().unwrap_or("");
            let rework_session = trailer
                .split(',')
                .map(|s| s.trim())
                .find(|s| !s.is_empty())
                .map(|s| s.to_string());
            Some(CommitInfo { hash, short, subject, author, committed_at, rework_session })
        })
        .collect()
}

/// 判定一批(同仓库)提交与某会话的关联：
/// - trailer == session_id → Trailer（精确，优先，不受时间窗限制）
/// - 否则 committed_at ∈ [created, updated + grace] → Time（可能相关）
/// - 都不满足 / 时间解析失败 → 排除
pub fn correlate_session_commits(
    created: chrono::DateTime<chrono::Utc>,
    updated: chrono::DateTime<chrono::Utc>,
    session_id: &str,
    commits: Vec<CommitInfo>,
    grace_secs: i64,
) -> Vec<CorrelatedCommit> {
    let end = updated + chrono::Duration::seconds(grace_secs);
    commits
        .into_iter()
        .filter_map(|c| {
            if c.rework_session.as_deref() == Some(session_id) {
                return Some(CorrelatedCommit { commit: c, link_kind: LinkKind::Trailer });
            }
            match chrono::DateTime::parse_from_rfc3339(&c.committed_at) {
                Ok(t) => {
                    let t = t.with_timezone(&chrono::Utc);
                    if t >= created && t <= end {
                        Some(CorrelatedCommit { commit: c, link_kind: LinkKind::Time })
                    } else {
                        None
                    }
                }
                Err(_) => None,
            }
        })
        .collect()
}

/// 读取仓库在 [since, until] 内的提交（ISO 时间；None 则不限）。limit 钳 ≤500。
/// 非仓库 / git 失败 → 空 Vec（非致命，与 git_info 一致）。
#[tauri::command]
pub fn git_log(
    path: String,
    since: Option<String>,
    until: Option<String>,
    limit: u32,
) -> Vec<CommitInfo> {
    let n = limit.min(500).to_string();
    // 列序：hash / short / subject / author / committedISO / Rework-Session trailer。
    // separator=%x2c(逗号) 把多值 trailer 压到单行，避免行错位（解析取首值）。
    let fmt = "--pretty=format:%H\u{1f}%h\u{1f}%s\u{1f}%an\u{1f}%cI\u{1f}%(trailers:key=Rework-Session,valueonly,separator=%x2c)";
    let mut args: Vec<&str> = vec!["log", "--no-color", fmt, "-n", &n];
    if let Some(s) = since.as_deref() {
        args.push("--since");
        args.push(s);
    }
    if let Some(u) = until.as_deref() {
        args.push("--until");
        args.push(u);
    }
    match git(&path, &args) {
        Some(out) => parse_git_log(&out),
        None => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};
    #[test]
    fn parse_status_counts_dirty_lines() {
        let out = " M src/a.rs\n?? new.txt\nA  b.rs\n";
        assert_eq!(count_dirty(out), 3);
        assert_eq!(count_dirty(""), 0);
    }
    #[test]
    fn parse_branch_from_head() {
        assert_eq!(parse_branch("refs/heads/feat/board\n"), Some("feat/board".to_string()));
        assert_eq!(parse_branch("HEAD\n"), None);
    }

    #[test]
    fn parse_git_log_extracts_fields_and_trailer() {
        let out = "abc123\u{1f}abc\u{1f}修复登录\u{1f}Alice\u{1f}2026-07-18T10:00:00+08:00\u{1f}sess-1\n\
                   def456\u{1f}def\u{1f}加日志\u{1f}Bob\u{1f}2026-07-18T11:00:00+08:00\u{1f}\n";
        let v = parse_git_log(out);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].hash, "abc123");
        assert_eq!(v[0].short, "abc");
        assert_eq!(v[0].subject, "修复登录");
        assert_eq!(v[0].author, "Alice");
        assert_eq!(v[0].rework_session.as_deref(), Some("sess-1"));
        assert_eq!(v[1].rework_session, None); // 空 trailer → None
    }

    #[test]
    fn parse_git_log_empty_is_empty() {
        assert!(parse_git_log("").is_empty());
        assert!(parse_git_log("\n").is_empty());
    }

    #[test]
    fn parse_git_log_multi_trailer_takes_first() {
        // 多值 trailer 经 separator=, 压到单行 → 取首个非空值
        let out = "h\u{1f}h\u{1f}s\u{1f}a\u{1f}2026-07-18T10:00:00+00:00\u{1f}sess-1,sess-2\n";
        let v = parse_git_log(out);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].rework_session.as_deref(), Some("sess-1"));
    }

    fn ci(hash: &str, at: &str, sess: Option<&str>) -> CommitInfo {
        CommitInfo {
            hash: hash.into(),
            short: hash.into(),
            subject: "s".into(),
            author: "a".into(),
            committed_at: at.into(),
            rework_session: sess.map(|x| x.into()),
        }
    }

    #[test]
    fn correlate_trailer_wins_and_time_window() {
        let created = Utc.with_ymd_and_hms(2026, 7, 18, 10, 0, 0).unwrap();
        let updated = Utc.with_ymd_and_hms(2026, 7, 18, 11, 0, 0).unwrap();
        let commits = vec![
            ci("c_trailer", "2026-07-20T00:00:00+00:00", Some("S")), // 窗外但 trailer 命中 → Trailer
            ci("c_time", "2026-07-18T11:30:00+00:00", None),         // updated+4h 内 → Time
            ci("c_out", "2026-07-18T20:00:00+00:00", None),          // >updated+4h → 排除
            ci("c_other", "2026-07-18T10:30:00+00:00", Some("X")),   // 别的会话 trailer，但时间在窗内 → Time
        ];
        let out = correlate_session_commits(created, updated, "S", commits, 14400);
        let ids: Vec<(&str, LinkKind)> =
            out.iter().map(|c| (c.commit.hash.as_str(), c.link_kind)).collect();
        assert!(ids.contains(&("c_trailer", LinkKind::Trailer)));
        assert!(ids.contains(&("c_time", LinkKind::Time)));
        assert!(ids.contains(&("c_other", LinkKind::Time))); // 时间窗兜住
        assert!(!ids.iter().any(|(h, _)| *h == "c_out"));
    }

    #[test]
    fn correlate_trailer_wins_even_before_created() {
        // trailer 命中的提交即使早于会话 created，也应判为 Trailer（精确不受时间窗限制）
        let created = Utc.with_ymd_and_hms(2026, 7, 18, 10, 0, 0).unwrap();
        let updated = Utc.with_ymd_and_hms(2026, 7, 18, 11, 0, 0).unwrap();
        let commits = vec![ci("early", "2026-07-18T08:00:00+00:00", Some("S"))];
        let out = correlate_session_commits(created, updated, "S", commits, 14400);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].link_kind, LinkKind::Trailer);
    }

    #[test]
    fn correlate_excludes_before_created_and_bad_time() {
        let created = Utc.with_ymd_and_hms(2026, 7, 18, 10, 0, 0).unwrap();
        let updated = Utc.with_ymd_and_hms(2026, 7, 18, 11, 0, 0).unwrap();
        let commits = vec![
            ci("before", "2026-07-18T09:00:00+00:00", None), // 早于 created → 排除
            ci("bad", "not-a-date", None),                   // 解析失败 → 排除
        ];
        let out = correlate_session_commits(created, updated, "S", commits, 14400);
        assert!(out.is_empty());
    }
}
