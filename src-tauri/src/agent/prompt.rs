//! 组装派给 agent 的任务 prompt（纯函数，可测）。
//! 约定：让 agent 完成即停；被阻塞时用 MCP update_task 报告；带上 task_id 供其自报。

/// 由任务标题/描述/项目名/task_id 组出交给 CLI 的 prompt。
pub fn build_task_prompt(title: &str, description: &str, project_name: &str, task_id: &str) -> String {
    let desc = if description.trim().is_empty() { "(无描述)" } else { description.trim() };
    format!(
        "你是被指派到看板任务的编码助手，正在项目「{project_name}」的独立 git 工作树里工作。\n\n\
         # 任务\n标题：{title}\n描述：{desc}\n\n\
         # 要求\n\
         - 在当前工作目录直接完成此任务（改代码/加文件）。完成即停，不要开始新任务。\n\
         - 若被阻塞无法完成，用工具 update_task 说明 blocker，task_id = {task_id}。\n\
         - 不要执行 git commit/push，改动留在工作区即可（由人 review 后合并）。\n",
        project_name = project_name, title = title.trim(), desc = desc, task_id = task_id
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn includes_title_desc_project_taskid() {
        let p = build_task_prompt("修登录 bug", "点击无反应", "keelson", "abc123");
        assert!(p.contains("修登录 bug"));
        assert!(p.contains("点击无反应"));
        assert!(p.contains("keelson"));
        assert!(p.contains("abc123"));
    }
    #[test]
    fn empty_description_falls_back() {
        let p = build_task_prompt("t", "   ", "proj", "id1");
        assert!(p.contains("(无描述)"));
    }
    #[test]
    fn instructs_no_commit() {
        let p = build_task_prompt("t", "d", "proj", "id1");
        assert!(p.contains("不要执行 git commit"));
    }
}
