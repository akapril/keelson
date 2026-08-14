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
