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

/// 判断路径是否为 git 仓库工作区（用 rev-parse 而非仅检查 .git 是否存在）。
/// 非 git 目录或 git 命令失败均返回 false。
pub fn is_git_repo(repo: &Path) -> bool {
    git(repo, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true")
        .unwrap_or(false)
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

/// auto_commit：在隔离 worktree 内把改动提交到 agent 分支（不 push、不 merge）。
/// 仅当队友 auto_commit=true 且有改动时由 executor 调用。
pub fn commit_worktree(worktree: &Path, task_id: &str) -> Result<()> {
    git(worktree, &["add", "-A"])?;
    // 有暂存内容才 commit（避免"无改动"报错）
    if git(worktree, &["diff", "--cached", "--quiet"]).is_err() {
        git(worktree, &["commit", "-m", &format!("agent: task {task_id}")])?;
    }
    Ok(())
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

    // ──────────────────────────────────────────────────────────────
    // 集成测试：用真实临时 git 仓库验证 worktree 生命周期
    // 这些测试在 CI(ubuntu, `cargo test --lib`) 中真跑；
    // Windows 本机因 Tauri GUI DLL 限制(0xc0000139)只验编译。
    // ──────────────────────────────────────────────────────────────

    /// 构造唯一临时目录路径（<系统tmp>/<前缀>_pid_<进程id>）。
    /// 并行测试中每个用例都有独立路径，避免竞争。
    fn tmp_repo(test_name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "keelson_wt_{}_{}_{}",
            test_name,
            std::process::id(),
            // 再加个纳秒时间戳以防同 pid 多次运行
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_nanos()
        ))
    }

    /// 在目录 dir 下执行 git 命令（直接用 std::process::Command，测试不依赖 hidden_command）。
    fn g(dir: &Path, args: &[&str]) -> std::process::Output {
        std::process::Command::new("git")
            .current_dir(dir)
            .args(args)
            .output()
            .expect("git 命令启动失败")
    }

    /// 初始化一个带初始提交的临时 git 仓库，返回仓库根路径。
    /// - 分支名固定为 main（`git init -b main` 或 init 后 rename）
    /// - 设置 user.email / user.name（CI 无全局身份时必须）
    /// - 建一个初始文件并 commit，确保 HEAD 有真实提交
    fn setup_repo(test_name: &str) -> std::path::PathBuf {
        let repo = tmp_repo(test_name);
        std::fs::create_dir_all(&repo).expect("创建临时目录失败");

        // 尝试 git init -b main（Git >= 2.28）；若不支持则 init 后 rename
        let init_out = g(&repo, &["init", "-b", "main"]);
        if !init_out.status.success() {
            // 旧版 git：先 init，再把默认分支改名为 main
            let o = g(&repo, &["init"]);
            assert!(o.status.success(), "git init 失败");
            let o = g(&repo, &["checkout", "-b", "main"]);
            // checkout -b 在空仓库可能失败；忽略，后续 commit 会建分支
            let _ = o;
        }

        // 设置 CI 需要的本地 git 身份（不影响全局配置）
        let o = g(&repo, &["config", "user.email", "t@t"]);
        assert!(o.status.success(), "git config email 失败");
        let o = g(&repo, &["config", "user.name", "t"]);
        assert!(o.status.success(), "git config name 失败");

        // 建初始文件并提交，产生第一个 commit（无此 commit worktree 无法建分支）
        let init_file = repo.join("init.txt");
        std::fs::write(&init_file, "initial").expect("写初始文件失败");
        let o = g(&repo, &["add", "init.txt"]);
        assert!(o.status.success(), "git add 失败");
        let o = g(&repo, &["commit", "-m", "init"]);
        assert!(o.status.success(), "初始 commit 失败");

        // 确保 HEAD 在 main 分支上
        let o = g(&repo, &["symbolic-ref", "--short", "HEAD"]);
        if o.status.success() {
            let branch = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if branch != "main" {
                // 有些旧版 git 默认分支是 master，rename 到 main
                let _rename = g(&repo, &["branch", "-m", &branch, "main"]);
            }
        }

        repo
    }

    /// 检查 git 仓库中某分支是否存在。
    fn branch_exists(repo: &Path, branch: &str) -> bool {
        let o = g(repo, &["branch", "--list", branch]);
        o.status.success() && !String::from_utf8_lossy(&o.stdout).trim().is_empty()
    }

    /// RAII 清理守卫：测试结束（含 panic）时自动删临时目录。
    struct TmpGuard(std::path::PathBuf);
    impl Drop for TmpGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// 用例1：完整生命周期——add_worktree → has_diff/diff_stat → merge_branch → 断言清理。
    #[test]
    fn full_lifecycle_merges_and_cleans_up() {
        let repo = setup_repo("lifecycle");
        let _guard = TmpGuard(repo.clone()); // 测试结束自动清理

        // ① 建 worktree
        let (wt, base) = add_worktree(&repo, "t1").expect("add_worktree 失败");
        assert!(wt.exists(), "worktree 目录应存在");
        // base 分支应为 main（或当前分支名）
        assert!(!base.is_empty(), "base 分支名不应为空");
        // agent/task-t1 分支应已建立
        assert!(
            branch_exists(&repo, "agent/task-t1"),
            "agent/task-t1 分支应存在"
        );

        // ② 在 worktree 里写一个新文件，制造改动
        let new_file = wt.join("feature.txt");
        std::fs::write(&new_file, "hello from agent").expect("写 feature.txt 失败");

        // has_diff 应返回 true
        assert!(has_diff(&wt).expect("has_diff 失败"), "worktree 应检测到改动");
        // diff_stat 应非空
        let stat = diff_stat(&wt).expect("diff_stat 失败");
        assert!(!stat.is_empty(), "diff_stat 应返回非空概要");

        // ③ 合并回 base 分支
        merge_branch(&repo, "t1", &base).expect("merge_branch 失败");

        // 断言：base 分支上有新文件（git show <base>:feature.txt）
        let show_out = g(
            &repo,
            &["show", &format!("{}:feature.txt", base)],
        );
        assert!(
            show_out.status.success(),
            "base 分支上应能看到 feature.txt，git show 失败: {}",
            String::from_utf8_lossy(&show_out.stderr)
        );
        let content = String::from_utf8_lossy(&show_out.stdout);
        assert_eq!(content.trim(), "hello from agent", "feature.txt 内容应一致");

        // 断言：worktree 目录已删除
        assert!(!wt.exists(), "merge 后 worktree 目录应已删除");
        // 断言：agent/task-t1 分支已删
        assert!(
            !branch_exists(&repo, "agent/task-t1"),
            "merge 后 agent/task-t1 分支应已删除"
        );
        // 断言：主仓库 HEAD 仍在原分支（base）
        let head_out = g(&repo, &["symbolic-ref", "--short", "HEAD"]);
        assert!(head_out.status.success(), "symbolic-ref 应成功");
        let head = String::from_utf8_lossy(&head_out.stdout).trim().to_string();
        assert_eq!(head, base, "合并后主仓库 HEAD 应仍在原分支 {base}");
    }

    /// 用例2（C1 修复验证）：主工作区有未提交改动时，merge_branch 必须返回 Err。
    #[test]
    fn merge_refuses_when_main_worktree_dirty() {
        let repo = setup_repo("dirty");
        let _guard = TmpGuard(repo.clone());

        // 建 worktree 并在 worktree 里制造改动
        let (wt, base) = add_worktree(&repo, "t1").expect("add_worktree 失败");
        std::fs::write(wt.join("feature.txt"), "agent work").expect("写 feature.txt 失败");

        // 在**主仓库**工作区制造未提交改动（不 stage，不 commit）
        let dirty_file = repo.join("dirty.txt");
        std::fs::write(&dirty_file, "dirty main workspace").expect("写 dirty.txt 失败");

        // merge_branch 应因主工作区脏而返回 Err
        let result = merge_branch(&repo, "t1", &base);
        assert!(
            result.is_err(),
            "主工作区脏时 merge_branch 应返回 Err，实际返回 Ok"
        );

        // 验证：失败后主仓库的未提交改动应仍然存在（merge 没有破坏工作区）
        assert!(
            dirty_file.exists(),
            "merge 失败后，主仓库 dirty.txt 应仍存在"
        );
        // 验证：dirty.txt 仍未提交（在 status 中可见）
        let status_out = g(&repo, &["status", "--porcelain"]);
        let status_str = String::from_utf8_lossy(&status_out.stdout).to_string();
        assert!(
            status_str.contains("dirty.txt"),
            "merge 失败后 dirty.txt 应仍在未提交状态"
        );
    }

    /// 用例4（C1 核心路径）：用户在非 base 分支时，merge_branch 合并完必须切回原分支而非留在 base。
    ///
    /// 覆盖 `merge_branch` 里 `if o != base_branch { git checkout o }` 这条分支——
    /// 即用户当前 HEAD ≠ base_branch 时，合并后必须切回用户原分支。
    #[test]
    fn full_lifecycle_restores_original_non_base_branch() {
        let repo = setup_repo("restore_branch");
        let _guard = TmpGuard(repo.clone()); // 测试结束（含 panic）自动清理临时目录

        // ① 建 worktree：此时主仓库 HEAD = main，base = "main"
        let (wt, base) = add_worktree(&repo, "t2").expect("add_worktree 失败");
        assert_eq!(base, "main", "base 分支应为 main");
        assert!(wt.exists(), "worktree 目录应存在");

        // ② 在主仓库新建并切到 "other" 分支（≠ base）
        // add_worktree 之后主工作区是干净的，可以安全切分支
        let o = g(&repo, &["checkout", "-b", "other"]);
        assert!(
            o.status.success(),
            "git checkout -b other 失败: {}",
            String::from_utf8_lossy(&o.stderr)
        );
        // 确认主仓库 HEAD 现在指向 other
        let head_before = {
            let o = g(&repo, &["symbolic-ref", "--short", "HEAD"]);
            String::from_utf8_lossy(&o.stdout).trim().to_string()
        };
        assert_eq!(head_before, "other", "切换后 HEAD 应为 other");

        // ③ 在 worktree 里写入新文件（让 agent 分支有可合并改动）
        std::fs::write(wt.join("agent_work.txt"), "from agent t2").expect("写 agent_work.txt 失败");

        // ④ 合并 agent/task-t2 → base(main)；此时主仓库 HEAD = other ≠ base
        merge_branch(&repo, "t2", &base).expect("merge_branch 失败");

        // ⑤ 核心断言（C1 修复）：主仓库 HEAD 应切回 "other"，而非停在 "main"
        let head_after_out = g(&repo, &["symbolic-ref", "--short", "HEAD"]);
        assert!(
            head_after_out.status.success(),
            "合并后 symbolic-ref 应成功"
        );
        let head_after = String::from_utf8_lossy(&head_after_out.stdout)
            .trim()
            .to_string();
        assert_eq!(
            head_after, "other",
            "C1 断言：合并后主仓库 HEAD 应切回原分支 other，而非停在 base(main)"
        );

        // ⑥ base(main) 上确实有 agent_work.txt（证明文件合入了 main 而非 other）
        let show_out = g(&repo, &["show", "main:agent_work.txt"]);
        assert!(
            show_out.status.success(),
            "main 分支上应能看到 agent_work.txt，git show 失败: {}",
            String::from_utf8_lossy(&show_out.stderr)
        );
        let content = String::from_utf8_lossy(&show_out.stdout);
        assert_eq!(
            content.trim(),
            "from agent t2",
            "main 分支上 agent_work.txt 内容应正确"
        );

        // ⑦ worktree 目录已删
        assert!(!wt.exists(), "merge 后 worktree 目录应已删除");
        // ⑧ agent/task-t2 分支已删
        assert!(
            !branch_exists(&repo, "agent/task-t2"),
            "merge 后 agent/task-t2 分支应已删除"
        );
    }

    /// 用例5：is_git_repo 对普通目录返回 false，对真实 git 仓库返回 true。
    #[test]
    fn is_git_repo_detects_git_vs_plain() {
        // 普通目录（非 git）→ false
        let plain = tmp_repo("plain_dir");
        std::fs::create_dir_all(&plain).expect("创建普通目录失败");
        let _guard_plain = TmpGuard(plain.clone());
        assert!(
            !is_git_repo(&plain),
            "普通目录不应被识别为 git 仓库"
        );

        // 真实 git 仓库（setup_repo 已 git init + 初始 commit）→ true
        let repo = setup_repo("is_git");
        let _guard_repo = TmpGuard(repo.clone());
        assert!(
            is_git_repo(&repo),
            "git 仓库应被 is_git_repo 正确识别"
        );
    }

    /// 用例3：remove_worktree 清理目录和分支。
    #[test]
    fn remove_worktree_cleans_branch_and_dir() {
        let repo = setup_repo("remove");
        let _guard = TmpGuard(repo.clone());

        // 建 worktree
        let (wt, _base) = add_worktree(&repo, "t1").expect("add_worktree 失败");
        assert!(wt.exists(), "worktree 目录应存在");
        assert!(branch_exists(&repo, "agent/task-t1"), "分支应存在");

        // 执行清理
        remove_worktree(&repo, "t1").expect("remove_worktree 失败");

        // 断言：目录已删
        assert!(!wt.exists(), "remove_worktree 后目录应已删除");
        // 断言：分支已删
        assert!(
            !branch_exists(&repo, "agent/task-t1"),
            "remove_worktree 后 agent/task-t1 分支应已删除"
        );
    }
}
