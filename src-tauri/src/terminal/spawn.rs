use std::process::Command;
use anyhow::{Context, Result};
use crate::terminal::plan::LaunchPlan;

/// 创建隐藏窗口的 Command（Windows 上避免闪现 cmd 黑框）
#[cfg(windows)]
fn make_command(program: &str) -> Command {
    use std::os::windows::process::CommandExt;
    let mut cmd = Command::new(program);
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd
}

#[cfg(not(windows))]
fn make_command(program: &str) -> Command {
    Command::new(program)
}

/// 执行 LaunchPlan：薄 IO 层，仅负责将计划转换为系统进程调用。
///
/// 刻意保持此函数简单：不做任何参数计算或路径拼接，
/// 所有"构建什么命令"的逻辑均已在 plan.rs 的纯函数 build_plan 中完成。
pub fn execute(plan: LaunchPlan) -> Result<()> {
    match plan {
        LaunchPlan::Program { program, args } => {
            make_command(&program)
                .args(&args)
                .spawn()
                .with_context(|| format!("启动终端失败: {}", program))?;
        }
        LaunchPlan::Script { program, script } => {
            // 脚本解释器（如 osascript）通过 -e 参数接收脚本字符串
            make_command(&program)
                .args(["-e", &script])
                .spawn()
                .with_context(|| format!("执行脚本失败: {}", program))?;
        }
    }
    Ok(())
}
