//! 组装派给 agent 的任务 prompt（纯函数，可测）。
//! 约定：让 agent 完成即停；被阻塞时用 MCP update_task 报告；带上 task_id 供其自报。

/// 由任务字段 + 队友附加信息组出交给 CLI 的 prompt。
/// agent_instructions/skills/skill_text 均可空——空段省略，不引入空标题。
pub fn build_task_prompt(
    title: &str,
    description: &str,
    project_name: &str,
    task_id: &str,
    agent_instructions: &str,
    skills: &[String],
    skill_text: &str,
) -> String {
    let desc = if description.trim().is_empty() { "(无描述)" } else { description.trim() };

    // 队友指令段（非空才加，置于最前，定调身份/风格）
    let mut head = String::new();
    if !agent_instructions.trim().is_empty() {
        head.push_str(&format!("# 队友指令\n{}\n\n", agent_instructions.trim()));
    }

    // 技能/参考段（绑定 prompts 内容 + 自由文本，任一非空才加）
    let mut skill_block = String::new();
    let has_skills = skills.iter().any(|s| !s.trim().is_empty()) || !skill_text.trim().is_empty();
    if has_skills {
        skill_block.push_str("\n# 技能 / 参考\n");
        for s in skills {
            if !s.trim().is_empty() {
                skill_block.push_str(&format!("- {}\n", s.trim()));
            }
        }
        if !skill_text.trim().is_empty() {
            skill_block.push_str(&format!("{}\n", skill_text.trim()));
        }
    }

    format!(
        "{head}你是被指派到看板任务的编码助手，正在项目「{project_name}」的独立 git 工作树里工作。\n\n\
         # 任务\n标题：{title}\n描述：{desc}\n\n\
         # 要求\n\
         - 在当前工作目录直接完成此任务（改代码/加文件）。完成即停，不要开始新任务。\n\
         - 若被阻塞无法完成，用工具 update_task 说明 blocker，task_id = {task_id}。\n\
         - 不要执行 git commit/push，改动留在工作区即可（由人 review 后合并）。\n\
{skill_block}",
        head = head, project_name = project_name.trim(), title = title.trim(),
        desc = desc, task_id = task_id, skill_block = skill_block,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn includes_title_desc_project_taskid() {
        let p = build_task_prompt("修登录 bug", "点击无反应", "keelson", "abc123", "", &[], "");
        assert!(p.contains("修登录 bug"));
        assert!(p.contains("点击无反应"));
        assert!(p.contains("keelson"));
        assert!(p.contains("abc123"));
    }
    #[test]
    fn empty_description_falls_back() {
        let p = build_task_prompt("t", "   ", "proj", "id1", "", &[], "");
        assert!(p.contains("(无描述)"));
    }
    #[test]
    fn instructs_no_commit() {
        let p = build_task_prompt("t", "d", "proj", "id1", "", &[], "");
        assert!(p.contains("不要执行 git commit"));
    }

    #[test]
    fn injects_instructions_and_skills() {
        let p = build_task_prompt(
            "标题", "描述", "proj", "id1",
            "你是资深后端", &["技能A内容".into(), "技能B内容".into()], "自由文本技能",
        );
        assert!(p.contains("你是资深后端"));
        assert!(p.contains("技能A内容"));
        assert!(p.contains("技能B内容"));
        assert!(p.contains("自由文本技能"));
        // 原任务字段仍在
        assert!(p.contains("标题") && p.contains("描述") && p.contains("proj") && p.contains("id1"));
    }

    #[test]
    fn empty_agent_extras_omitted() {
        // 全空的队友附加信息：不应引入"队友指令"/"技能"段标题
        let p = build_task_prompt("t", "d", "proj", "id1", "", &[], "");
        assert!(!p.contains("# 队友指令"));
        assert!(!p.contains("# 技能"));
    }
}
