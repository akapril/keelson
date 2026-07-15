// commands/terminal.rs — 终端恢复命令（Task 16）
// 职责：将前端的 terminal_resume 请求路由到 terminal 模块执行。
// as_tab 参数在 MVP 阶段为存根（暂无多标签实现）。

use crate::AppState;
use crate::terminal::{detect_terminal, build_plan, execute, ResumeRequest};
use tauri::State;

/// 在系统终端中恢复指定 AI 工具会话。
///
/// # 参数
/// - `provider`：provider 标识符，如 "claude" / "codex"
/// - `project_path`：项目绝对路径（终端启动后 cd 到此目录）
/// - `session_id`：要恢复的会话 ID
/// - `as_tab`：是否在新标签中打开（MVP 阶段为存根，行为等同 false）
///
/// # 说明
/// MVP 阶段 `as_tab=true` 与 `as_tab=false` 行为相同：
/// Windows Terminal 的 `new-tab` 已在 plan.rs 中处理，其他终端不支持多标签。
/// Task 20/21 可在此处扩展多标签逻辑。
#[tauri::command]
pub fn terminal_resume(
    provider: String,
    project_path: String,
    session_id: String,
    as_tab: bool,
    state: State<AppState>,
) -> Result<(), String> {
    // 注意：as_tab 目前为存根，记录日志便于后续追踪
    if as_tab {
        eprintln!("[rework] terminal_resume: as_tab=true（MVP 阶段存根，行为等同 false）");
    }

    // 1. 通过 provider 注册表生成恢复命令字符串
    let p = state
        .reg
        .by_id(&provider)
        .ok_or_else(|| format!("未知 provider: {provider}"))?;

    let resume_cmd = p.resume_command(&project_path, &session_id);

    // 2. 构造恢复请求
    let req = ResumeRequest {
        project_path: project_path.clone(),
        resume_cmd,
    };

    // 3. 检测当前系统终端类型（读取配置中的偏好，或自动探测）
    let term_pref = state.config.lock().terminal_pref.clone();
    let kind = detect_terminal(&term_pref);

    // 4. 纯函数构建启动计划（无副作用，可测试）
    let plan = build_plan(&kind, &req);

    // 5. 执行（薄 IO 层）
    execute(plan).map_err(|e| format!("启动终端失败: {e:#}"))
}
