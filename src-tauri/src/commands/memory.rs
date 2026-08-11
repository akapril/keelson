//! 记忆注入命令：把选定记忆写进项目根 CLAUDE.md / AGENTS.md 的受管块（HTML 注释标记，块外内容零改动）。
use crate::models::FileMemory;
use crate::paths::AppPaths;
use std::path::Path;

const MARK_BEGIN: &str = "<!-- >>> rework-memories >>> -->";
const MARK_END: &str = "<!-- <<< rework-memories <<< -->";

// 看板任务受管块标记（与记忆块分开，同一文件里两块互不干扰）。
const TASK_MARK_BEGIN: &str = "<!-- >>> keelson-tasks >>> -->";
const TASK_MARK_END: &str = "<!-- <<< keelson-tasks <<< -->";
/// 改名前的旧受管块标记：写新块前先清掉旧块，避免 CLAUDE.md 里新旧两块并存。
const OLD_TASK_MARK_BEGIN: &str = "<!-- >>> rework-tasks >>> -->";
const OLD_TASK_MARK_END: &str = "<!-- <<< rework-tasks <<< -->";

/// 从文件里剔除改名前的旧 rework-tasks 块（含首尾标记行），就地写回。无块则不动。best-effort。
fn strip_old_task_block(path: &Path) {
    let Ok(content) = std::fs::read_to_string(path) else {
        return;
    };
    if !content.contains(OLD_TASK_MARK_BEGIN) {
        return;
    }
    let mut out: Vec<&str> = Vec::new();
    let mut skip = false;
    for line in content.lines() {
        let t = line.trim();
        if t == OLD_TASK_MARK_BEGIN {
            skip = true;
            continue;
        }
        if t == OLD_TASK_MARK_END {
            skip = false;
            continue;
        }
        if !skip {
            out.push(line);
        }
    }
    let mut s = out.join("\n");
    if content.ends_with('\n') && !s.is_empty() {
        s.push('\n');
    }
    let _ = std::fs::write(path, s);
}

#[derive(serde::Deserialize)]
pub struct MemLine {
    pub content: String,
    pub kind: String,
    pub scope: String,
}

#[derive(serde::Serialize)]
pub struct MemFilesStatus {
    pub claude_md: bool,
    pub agents_md: bool,
}

// ── 记忆桥：扫描 Claude 文件记忆（供前端映射写入记忆账本，待审） ──────────

/// 扫描 `~/.claude/projects/*/memory/*.md` 的文件记忆，解析 frontmatter + 正文，返回候选。
/// 跳过 MEMORY.md（索引文件）。目录不存在 → 空。
#[tauri::command]
pub fn scan_file_memories() -> Vec<FileMemory> {
    let projects = AppPaths::detect().claude_dir().join("projects");
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(&projects) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for proj in entries.flatten() {
        let mem_dir = proj.path().join("memory");
        let files = match std::fs::read_dir(&mem_dir) {
            Ok(f) => f,
            Err(_) => continue, // 该项目无 memory 目录
        };
        // 该项目的真实仓库路径：从同目录任一会话 jsonl 的 cwd 取（编码目录名有损不可反解）
        let repo_path = repo_path_of_project_dir(&proj.path());
        for f in files.flatten() {
            let p = f.path();
            if p.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            if p.file_name().and_then(|n| n.to_str()) == Some("MEMORY.md") {
                continue; // 索引文件，非单条记忆
            }
            if let Ok(content) = std::fs::read_to_string(&p) {
                if let Some(mut fm) = parse_file_memory(&content) {
                    fm.repo_path = repo_path.clone();
                    out.push(fm);
                }
            }
        }
    }
    out
}

/// 取项目目录下任一会话 jsonl 首个含 cwd 的值（精确仓库路径）；取不到 → 空串。
fn repo_path_of_project_dir(proj_dir: &Path) -> String {
    let rd = match std::fs::read_dir(proj_dir) {
        Ok(r) => r,
        Err(_) => return String::new(),
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("jsonl") {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(&p) {
            for line in content.lines().take(50) {
                // cwd 通常在头几行；限量避免读满大文件
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                    if let Some(cwd) = v.get("cwd").and_then(|c| c.as_str()) {
                        if !cwd.is_empty() {
                            return cwd.to_string();
                        }
                    }
                }
            }
        }
    }
    String::new()
}

/// 解析文件记忆：取第一个 `---` 到下一个 `---` 之间为 frontmatter，其后为正文。
/// 抽 name / description / metadata.type；无 frontmatter 或无 name → None。
fn parse_file_memory(content: &str) -> Option<FileMemory> {
    let trimmed = content.trim_start();
    let rest = trimmed.strip_prefix("---")?;
    let end = rest.find("\n---")?;
    let fm = &rest[..end];
    let body = rest[end + 4..].trim_start().to_string();

    let clean = |v: &str| v.trim().trim_matches('"').trim_matches('\'').trim().to_string();
    let mut name = String::new();
    let mut description = String::new();
    let mut kind_hint = String::new();
    for line in fm.lines() {
        let t = line.trim();
        if let Some(v) = t.strip_prefix("name:") {
            name = clean(v);
        } else if let Some(v) = t.strip_prefix("description:") {
            description = clean(v);
        } else if let Some(v) = t.strip_prefix("type:") {
            // metadata.type（注意 node_type: 不以 "type:" 开头，不会误匹配）
            kind_hint = clean(v);
        }
    }
    if name.is_empty() {
        return None;
    }
    Some(FileMemory {
        name,
        description,
        kind_hint,
        body,
        repo_path: String::new(), // 由 scan_file_memories 按项目目录填充
    })
}

/// kind → 中文小节标题；顺序固定（fact/preference/decision/convention）。
fn kind_label(kind: &str) -> &'static str {
    match kind {
        "fact" => "事实",
        "preference" => "偏好",
        "decision" => "决策",
        "convention" => "约定",
        _ => "其他",
    }
}

/// 渲染受管块正文（不含标记行）。空记忆返回空串。按 kind 固定顺序分组。
pub fn render_memories_block(mems: &[MemLine]) -> String {
    if mems.is_empty() {
        return String::new();
    }
    let mut out = String::from("（rework 生成，请勿手改此块）\n");
    for k in ["fact", "preference", "decision", "convention"] {
        let group: Vec<&MemLine> = mems.iter().filter(|m| m.kind == k).collect();
        if group.is_empty() {
            continue;
        }
        out.push_str(&format!("\n### {}\n", kind_label(k)));
        for m in group {
            out.push_str(&format!("- {}\n", m.content.trim()));
        }
    }
    // 收尾未匹配到上述 kind 的（其他）
    let others: Vec<&MemLine> = mems
        .iter()
        .filter(|m| !["fact", "preference", "decision", "convention"].contains(&m.kind.as_str()))
        .collect();
    if !others.is_empty() {
        out.push_str("\n### 其他\n");
        for m in others {
            out.push_str(&format!("- {}\n", m.content.trim()));
        }
    }
    out.trim_end().to_string()
}

/// 幂等替换指定标记的受管块：移除既有 begin..end（含标记行），block 非空则末尾追加，空则净卸载。
/// 块外内容逐字保留。通用——memory / tasks 各传自己的标记，同一文件里互不干扰。
pub fn replace_block(content: &str, begin: &str, end: &str, block: &str) -> String {
    // 先剥离既有块
    let mut kept: Vec<&str> = Vec::new();
    let mut skip = false;
    for line in content.lines() {
        let t = line.trim();
        if t == begin {
            skip = true;
            continue;
        }
        if t == end {
            skip = false;
            continue;
        }
        if !skip {
            kept.push(line);
        }
    }
    let mut base = kept.join("\n");
    // 去掉尾部多余空白，稍后统一控制间隔
    while base.ends_with('\n') || base.ends_with(' ') {
        base.pop();
    }
    if block.is_empty() {
        // 净卸载：保留原内容尾换行风格（原有内容非空则补一个换行）
        if base.is_empty() {
            return String::new();
        }
        base.push('\n');
        return base;
    }
    let managed = format!("{begin}\n{block}\n{end}\n");
    if base.is_empty() {
        managed
    } else {
        format!("{base}\n\n{managed}")
    }
}

fn write_block(path: &Path, begin: &str, end: &str, block: &str) -> Result<(), String> {
    let existing = std::fs::read_to_string(path).unwrap_or_default();
    let next = replace_block(&existing, begin, end, block);
    std::fs::write(path, next).map_err(|e| format!("写入 {} 失败：{e}", path.display()))?;
    Ok(())
}

fn write_one(path: &Path, block: &str) -> Result<bool, String> {
    write_block(path, MARK_BEGIN, MARK_END, block)?;
    Ok(true)
}

/// 看板任务受管块的一行（前端传入：标题 + 是否完成 + 状态提示）。
#[derive(serde::Deserialize)]
pub struct TaskLine {
    pub title: String,
    pub done: bool,
    pub hint: String,
}

/// 渲染任务受管块：`- [ ] 标题（状态）` 清单。空 → 空串（净卸载）。
fn render_tasks_block(tasks: &[TaskLine]) -> String {
    if tasks.is_empty() {
        return String::new();
    }
    let mut out = String::from("## rework 看板任务（本项目，rework 生成，请勿手改此块）\n");
    for t in tasks {
        let title = t.title.trim();
        if title.is_empty() {
            continue;
        }
        let checkbox = if t.done { "x" } else { " " };
        let hint = t.hint.trim();
        let suffix = if hint.is_empty() {
            String::new()
        } else {
            format!("（{hint}）")
        };
        out.push_str(&format!("- [{checkbox}] {title}{suffix}\n"));
    }
    out.trim_end().to_string()
}

/// 把看板任务写进 <repo>/CLAUDE.md 与 <repo>/AGENTS.md 的 rework-tasks 受管块。返回写入的路径。
/// 传空 tasks = 净卸载该块。与记忆块分开，块外内容零改动。
#[tauri::command]
pub fn tasks_write_project_files(
    repo_path: String,
    tasks: Vec<TaskLine>,
) -> Result<Vec<String>, String> {
    let root = Path::new(&repo_path);
    if !root.is_dir() {
        return Err(format!("仓库路径不是目录：{repo_path}"));
    }
    let block = render_tasks_block(&tasks);
    let mut written = Vec::new();
    for name in ["CLAUDE.md", "AGENTS.md"] {
        let p = root.join(name);
        strip_old_task_block(&p); // 先清掉改名前的旧 rework-tasks 块，避免新旧并存
        write_block(&p, TASK_MARK_BEGIN, TASK_MARK_END, &block)?;
        written.push(p.display().to_string());
    }
    Ok(written)
}

/// 看板任务注入状态（供前端常驻显示"注了没/几条"）。
#[derive(serde::Serialize)]
pub struct TasksInjectStatus {
    /// CLAUDE.md 是否含 rework-tasks 块
    pub claude_md: bool,
    /// AGENTS.md 是否含 rework-tasks 块
    pub agents_md: bool,
    /// 块内任务条数（取两文件的最大值，通常一致）
    pub count: u32,
}

/// 取某文件 rework-tasks 块内的任务条数（`- [ ]` / `- [x]` 行数）；无块 → 0。
fn count_task_lines(path: &Path) -> u32 {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return 0,
    };
    let mut inside = false;
    let mut n = 0u32;
    for line in content.lines() {
        let t = line.trim();
        if t == TASK_MARK_BEGIN {
            inside = true;
            continue;
        }
        if t == TASK_MARK_END {
            break;
        }
        if inside && (t.starts_with("- [ ]") || t.starts_with("- [x]")) {
            n += 1;
        }
    }
    n
}

/// 查看板任务受管块状态：两文件是否含块 + 块内任务条数。
#[tauri::command]
pub fn tasks_project_files_status(repo_path: String) -> TasksInjectStatus {
    let root = Path::new(&repo_path);
    let has = |name: &str| {
        std::fs::read_to_string(root.join(name))
            .map(|c| c.contains(TASK_MARK_BEGIN))
            .unwrap_or(false)
    };
    let count = count_task_lines(&root.join("CLAUDE.md")).max(count_task_lines(&root.join("AGENTS.md")));
    TasksInjectStatus {
        claude_md: has("CLAUDE.md"),
        agents_md: has("AGENTS.md"),
        count,
    }
}

/// 把记忆写进 <repo>/CLAUDE.md 与 <repo>/AGENTS.md 的受管块。返回写入的路径。
#[tauri::command]
pub fn memory_write_project_files(repo_path: String, mems: Vec<MemLine>) -> Result<Vec<String>, String> {
    let root = Path::new(&repo_path);
    if !root.is_dir() {
        return Err(format!("仓库路径不是目录：{repo_path}"));
    }
    let block = render_memories_block(&mems);
    let mut written = Vec::new();
    for name in ["CLAUDE.md", "AGENTS.md"] {
        let p = root.join(name);
        write_one(&p, &block)?;
        written.push(p.display().to_string());
    }
    Ok(written)
}

/// 查项目两文件是否含受管块。
#[tauri::command]
pub fn memory_project_files_status(repo_path: String) -> Result<MemFilesStatus, String> {
    let root = Path::new(&repo_path);
    let has = |name: &str| {
        std::fs::read_to_string(root.join(name))
            .map(|c| c.contains(MARK_BEGIN))
            .unwrap_or(false)
    };
    Ok(MemFilesStatus {
        claude_md: has("CLAUDE.md"),
        agents_md: has("AGENTS.md"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ml(content: &str, kind: &str, scope: &str) -> MemLine {
        MemLine { content: content.into(), kind: kind.into(), scope: scope.into() }
    }

    #[test]
    fn render_empty_is_empty() {
        assert_eq!(render_memories_block(&[]), "");
    }

    #[test]
    fn render_groups_by_kind_in_order() {
        let mems = vec![ml("偏好A", "preference", "global"), ml("事实B", "fact", "global")];
        let out = render_memories_block(&mems);
        // 事实小节应在偏好小节之前（固定顺序）
        let fi = out.find("### 事实").unwrap();
        let pi = out.find("### 偏好").unwrap();
        assert!(fi < pi);
        assert!(out.contains("- 事实B"));
        assert!(out.contains("- 偏好A"));
    }

    #[test]
    fn memory_and_task_blocks_coexist() {
        let content = "# 项目\n用户内容\n";
        let with_mem = replace_block(content, MARK_BEGIN, MARK_END, "记忆块内容");
        // 写任务块不应动记忆块
        let with_both = replace_block(&with_mem, TASK_MARK_BEGIN, TASK_MARK_END, "任务块内容");
        assert!(with_both.contains("记忆块内容"));
        assert!(with_both.contains("任务块内容"));
        assert!(with_both.contains("用户内容"));
        // 更新任务块不动记忆块
        let updated = replace_block(&with_both, TASK_MARK_BEGIN, TASK_MARK_END, "新任务块");
        assert!(updated.contains("记忆块内容"));
        assert!(updated.contains("新任务块"));
        assert!(!updated.contains("任务块内容"));
    }

    #[test]
    fn render_tasks_block_checkbox_and_hint() {
        let tasks = vec![
            TaskLine { title: "A".into(), done: false, hint: "待办".into() },
            TaskLine { title: "B".into(), done: true, hint: "".into() },
        ];
        let out = render_tasks_block(&tasks);
        assert!(out.contains("- [ ] A（待办）"));
        assert!(out.contains("- [x] B"));
        assert_eq!(render_tasks_block(&[]), ""); // 空 → 净卸载
    }

    // 记忆块的便捷包装（测试用）
    fn rm_block(content: &str, block: &str) -> String {
        replace_block(content, MARK_BEGIN, MARK_END, block)
    }

    #[test]
    fn replace_appends_then_idempotent() {
        let orig = "# 我的项目\n\n一些说明\n";
        let block = "（rework 生成）\n### 事实\n- x";
        let once = rm_block(orig, block);
        assert!(once.contains(MARK_BEGIN) && once.contains(MARK_END));
        assert!(once.contains("# 我的项目")); // 块外保留
        let twice = rm_block(&once, block);
        assert_eq!(once, twice); // 幂等
    }

    #[test]
    fn replace_empty_block_uninstalls_keeps_foreign() {
        let with = rm_block("# 标题\n", "### 事实\n- x");
        let cleaned = rm_block(&with, "");
        assert!(!cleaned.contains(MARK_BEGIN));
        assert!(cleaned.contains("# 标题")); // 块外保留
    }
}
