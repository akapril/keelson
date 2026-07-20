//! 记忆注入命令：把选定记忆写进项目根 CLAUDE.md / AGENTS.md 的受管块（HTML 注释标记，块外内容零改动）。
use std::path::Path;

const MARK_BEGIN: &str = "<!-- >>> rework-memories >>> -->";
const MARK_END: &str = "<!-- <<< rework-memories <<< -->";

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

/// 幂等替换受管块：移除既有 BEGIN..END（含标记行），block 非空则末尾追加，空则净卸载。块外逐字保留。
pub fn replace_managed_block(content: &str, block: &str) -> String {
    // 先剥离既有块
    let mut kept: Vec<&str> = Vec::new();
    let mut skip = false;
    for line in content.lines() {
        let t = line.trim();
        if t == MARK_BEGIN {
            skip = true;
            continue;
        }
        if t == MARK_END {
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
    let managed = format!("{MARK_BEGIN}\n{block}\n{MARK_END}\n");
    if base.is_empty() {
        managed
    } else {
        format!("{base}\n\n{managed}")
    }
}

fn write_one(path: &Path, block: &str) -> Result<bool, String> {
    let existing = std::fs::read_to_string(path).unwrap_or_default();
    let next = replace_managed_block(&existing, block);
    std::fs::write(path, next).map_err(|e| format!("写入 {} 失败：{e}", path.display()))?;
    Ok(true)
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
    fn replace_appends_then_idempotent() {
        let orig = "# 我的项目\n\n一些说明\n";
        let block = "（rework 生成）\n### 事实\n- x";
        let once = replace_managed_block(orig, block);
        assert!(once.contains(MARK_BEGIN) && once.contains(MARK_END));
        assert!(once.contains("# 我的项目")); // 块外保留
        let twice = replace_managed_block(&once, block);
        assert_eq!(once, twice); // 幂等
    }

    #[test]
    fn replace_empty_block_uninstalls_keeps_foreign() {
        let with = replace_managed_block("# 标题\n", "### 事实\n- x");
        let cleaned = replace_managed_block(&with, "");
        assert!(!cleaned.contains(MARK_BEGIN));
        assert!(cleaned.contains("# 标题")); // 块外保留
    }
}
