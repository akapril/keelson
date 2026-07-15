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

#[cfg(test)]
mod tests {
    use super::*;
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
}
