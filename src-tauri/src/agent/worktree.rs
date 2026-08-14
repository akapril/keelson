//! agent worktree 隔离：分支名/工作树路径命名（纯函数，可测）；git 操作见下方（Task 5）。
use std::path::{Path, PathBuf};

/// agent 分支前缀：agent/task-<id>
pub const BRANCH_PREFIX: &str = "agent/task-";
/// worktree 目录（项目 repo 下）
pub const WORKTREE_DIR: &str = ".worktrees";

/// 任务 id → agent 分支名。
pub fn branch_name(task_id: &str) -> String {
    format!("{BRANCH_PREFIX}{task_id}")
}

/// 项目 repo + 任务 id → worktree 绝对路径：<repo>/.worktrees/task-<id>
pub fn worktree_path(repo: &Path, task_id: &str) -> PathBuf {
    repo.join(WORKTREE_DIR).join(format!("task-{task_id}"))
}

use anyhow::{anyhow, Result};

/// 跑一条 git 子命令（在 cwd 下），成功返回 stdout 文本；失败带 stderr 报错。
fn git(cwd: &Path, args: &[&str]) -> Result<String> {
    let out = crate::proc::hidden_command("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .map_err(|e| anyhow!("git 启动失败：{e}"))?;
    if !out.status.success() {
        return Err(anyhow!(
            "git {:?} 失败：{}",
            args,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// 项目默认分支（当前 HEAD 分支名；分离头兜底 main）。
fn default_branch(repo: &Path) -> String {
    git(repo, &["symbolic-ref", "--short", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "main".into())
}

/// 建隔离 worktree + 新分支：<repo>/.worktrees/task-<id> ← agent/task-<id>（基于默认分支）。
/// 若同名分支/路径残留，先尽力清理再建。
/// 返回 (worktree路径, 实际使用的 base 分支名)，调用方应持久化 base 分支名防止漂移。
pub fn add_worktree(repo: &Path, task_id: &str) -> Result<(PathBuf, String)> {
    let wt = worktree_path(repo, task_id);
    let branch = branch_name(task_id);
    let base = default_branch(repo);
    // 清理残留（忽略错误）
    let _ = git(repo, &["worktree", "remove", "--force", &wt.to_string_lossy()]);
    let _ = git(repo, &["branch", "-D", &branch]);
    git(
        repo,
        &["worktree", "add", "-b", &branch, &wt.to_string_lossy(), &base],
    )?;
    // 同时返回 base 分支名，供调用方持久化到 agent_runs.base_branch
    Ok((wt, base))
}

/// 工作树是否有改动（未提交 or 相对基线）。P1 用 status --porcelain 判未提交改动。
pub fn has_diff(worktree: &Path) -> Result<bool> {
    Ok(!git(worktree, &["status", "--porcelain"])?.trim().is_empty())
}

/// diff 概要（status --porcelain 计数行数）；无改动返回空串。
pub fn diff_stat(worktree: &Path) -> Result<String> {
    let s = git(worktree, &["status", "--porcelain"])?;
    let files = s.lines().count();
    Ok(if files == 0 {
        String::new()
    } else {
        format!("{files} 个文件改动")
    })
}

/// 把 agent 分支合并回指定 base 分支：commit 工作树改动 → 切 base → merge → 切回用户原分支 → 清理。
/// 仅在人点「合并」时调用。绝不自动调用。
/// base_branch 必须传入建 worktree 时持久化的值，禁止在此处再次求值（防止漂移）。
pub fn merge_branch(repo: &Path, task_id: &str, base_branch: &str) -> Result<()> {
    let wt = worktree_path(repo, task_id);
    let branch = branch_name(task_id);
    // 主工作区必须干净，否则 checkout 会失败或丢失改动
    if !git(repo, &["status", "--porcelain"])?.trim().is_empty() {
        return Err(anyhow!("主工作区有未提交改动，请先提交或暂存后再合并"));
    }
    // 记住用户当前所在分支，合并后切回（分离头状态则为 None）
    let orig = git(repo, &["symbolic-ref", "--short", "HEAD"])
        .map(|s| s.trim().to_string())
        .ok();
    // 在工作树里把改动提交到 agent 分支
    git(&wt, &["add", "-A"])?;
    // 允许"无改动"时不报错：仅当有暂存内容才 commit
    if git(&wt, &["diff", "--cached", "--quiet"]).is_err() {
        git(&wt, &["commit", "-m", &format!("agent: task {task_id}")])?;
    }
    // 切到 base 分支合并 agent 分支
    git(repo, &["checkout", base_branch])?;
    git(
        repo,
        &[
            "merge",
            "--no-ff",
            "-m",
            &format!("merge agent/task-{task_id}"),
            &branch,
        ],
    )?;
    // 切回用户原分支（仅当原分支与 base 不同时才切，避免多余操作）
    if let Some(o) = orig {
        if o != base_branch {
            git(repo, &["checkout", &o])?;
        }
    }
    remove_worktree(repo, task_id)?;
    Ok(())
}

/// 移除 worktree + 删 agent 分支（合并后 or 打回时清理）。
pub fn remove_worktree(repo: &Path, task_id: &str) -> Result<()> {
    let wt = worktree_path(repo, task_id);
    let branch = branch_name(task_id);
    let _ = git(repo, &["worktree", "remove", "--force", &wt.to_string_lossy()]);
    let _ = git(repo, &["branch", "-D", &branch]);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn branch_has_prefix() {
        assert_eq!(branch_name("abc"), "agent/task-abc");
    }
    #[test]
    fn worktree_under_dot_worktrees() {
        let p = worktree_path(Path::new("/repo"), "abc");
        assert!(p.ends_with(".worktrees/task-abc") || p.ends_with(".worktrees\\task-abc"));
    }
}
